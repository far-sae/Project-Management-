# Fine-grained CRM module permissions (Deals + Leads)

**Date:** 2026-06-03
**Status:** Approved (design)
**Branch:** `crm-module-permissions` (off `main`, independent of the bot/quick-wins branches)

## Summary

Add per-member, per-module access control for the **Deals** and **Leads** CRM modules, with three levels (None / View / Edit). Owner and admin always have full access (bypass). Members and viewers start with **no** Deals/Leads access; an owner/admin assigns grants in the Members settings screen. Enforced in **both** the UI (nav + routes + edit affordances) and Postgres **RLS** (so access can't be bypassed via the API/URL).

This is the module-level subset of the "modern CRM" permission model (Zoho/HubSpot/Salesforce profiles & permission sets) — record- and field-level grants are explicitly out of scope.

### Why this is also a security fix
Today the RLS read policies on `deals`/`leads` are `USING is_org_member(org)` — **any** org member can read all deals and leads; the sidebar only *hides* the nav. A member who navigates to `/deals` by URL currently reads everything. This spec closes that.

### Scope
- **In scope:** Deals module (`deals`, `pipelines`, `pipeline_stages`) and Leads module (`leads`, `lead_forms`, `lead_scoring_rules`, and related lead tables — exact list confirmed in the plan).
- **Out of scope:** Clients/Contacts (keep current behavior — all members view, owner/admin edit), CRM dashboards/reports (keep `requireFeature="crm"`), record-level and field-level permissions, PM modules.

## Components

### 1. Data model
New migration `124_crm_module_grants.sql` (next free number after `122`; bot branch uses `123` — if both land, renumber to avoid collision):

```sql
create table if not exists public.crm_module_grants (
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  module          text not null check (module in ('deals','leads')),
  level           text not null check (level in ('view','edit')),
  granted_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id, module)
);
create index if not exists idx_crm_module_grants_user on public.crm_module_grants(user_id, organization_id);
alter table public.crm_module_grants enable row level security;
-- Read: any org member may read grants in their org (needed so the UI can render
-- the matrix + the current user's own grants). Write: owner/admin only.
create policy "members_view_grants" on public.crm_module_grants for select to authenticated
  using (public.is_org_member(organization_id));
create policy "admin_manage_grants" on public.crm_module_grants for all to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));
```
Absence of a row = `none`. `level='edit'` implies view.

### 2. Access helper (drives all RLS + the RPC checks)
```sql
create or replace function public.has_module_access(
  p_user_id uuid, p_org_id uuid, p_module text, p_need_edit boolean
) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select
    public.is_org_admin_or_owner_for(p_user_id, p_org_id)   -- owner/admin bypass
    or exists (
      select 1 from public.crm_module_grants g
      where g.organization_id = p_org_id and g.user_id = p_user_id and g.module = p_module
        and (not p_need_edit or g.level = 'edit')
    );
$$;
```
- Requires a 2-arg `is_org_admin_or_owner_for(p_user_id, p_org_id)` (a user-explicit variant of the existing `is_org_admin_or_owner()` which uses `auth.uid()`). Add it alongside the migration-083 `is_org_member_for` pattern. RLS policies call `has_module_access(auth.uid(), organization_id, '<module>', <bool>)`.

### 3. RLS rewrite (Deals + Leads tables) — full inventory

**Deals module** tables + current policies to replace (verbatim inventory from the codebase):
- `deals` (migration 045): `members_view_deals` (SELECT, is_org_member), `members_create_deals` (INSERT, is_org_member + own), `deal_owner_edit_own` (UPDATE, owner_id=auth.uid()), `owner_or_admin_edit_deals` (UPDATE), `owner_or_admin_delete_deals` (DELETE). → **SELECT** → `has_module_access(auth.uid(), organization_id, 'deals', false)`; **INSERT/UPDATE/DELETE** → `has_module_access(..., 'deals', true)`. The per-record `deal_owner_edit_own` and member `members_create_deals` policies are **dropped** (replaced by the module-level edit grant — intended behavior change: editing is module-level, not per-record).
- `pipelines`, `pipeline_stages`, `crm_project_templates` (migration 058): READ policies (is_org_member) → `has_module_access(..., 'deals', false)`. Writes already go through SECURITY DEFINER funcs (admin-gated) — leave writes as-is.

**Leads module** tables + current policies to replace:
- `leads` (migration 100, overridden by 101): `members_view_leads` (SELECT) → view; `members_insert_leads` / `author_or_admin_update_leads` / `author_or_admin_delete_leads` (with the 101 `not is_org_viewer` override) → edit. Drop the author/owner per-record conditions.
- `lead_notes` (migration 100/101): same SELECT→view, INSERT/UPDATE/DELETE→edit rewrite.
- `lead_forms` + `form_submissions` (migration 062): READ (is_org_member) → view. `lead_forms` admin-write policy stays (config is admin-only). `form_submissions` insert is SECURITY DEFINER edge function only — unchanged.
- `lead_scoring_rules`, `lead_scoring_thresholds` (migration 060): READ → view; writes are service-func/admin — unchanged.

**General rules:** `anon_no_*` deny policies unchanged. The `crm_update_deal` RPC (migration 076) swaps its `is_org_member`/viewer gate for `has_module_access(auth.uid(), p_organization_id, 'deals', true)`. **Service-role paths are unaffected** — the bot's `executePending` and `agent_*`/`crm_*_as`/SECURITY DEFINER RPCs bypass RLS, so the bot keeps working regardless of grants (documented, intentional).

### 4. Frontend
**Reality check:** Deals and Leads are **tabs inside `src/pages/Clients.tsx`** (the `/clients` route, gated by `requireFeature="crm"`), not separate routes. The single "CRM" sidebar entry → `/clients` stays. Gating is **tab-level**, not route-level.

- **`src/services/supabase/crmGrants.ts`** (new): `listOrgGrants(orgId)`, `setModuleGrant(orgId, userId, module, level | null)` (null = delete the row to revoke). Direct table read/write — the table's RLS enforces admin-only writes, so no RPC needed.
- **`OrganizationContext`**: load the current user's grant rows after the org loads; expose `moduleGrants: { deals?: 'view'|'edit'; leads?: 'view'|'edit' }` and helpers `canViewModule(m)`, `canEditModule(m)` (owner/admin → always true).
- **Clients page tab gating** (`src/pages/Clients.tsx`): render the **Deals** tab only when `canViewModule('deals')`, the **Leads** tab only when `canViewModule('leads')`. If the active tab resolves to one the user can't view (deep-link / stale state), fall back to the Clients tab with a small "You don't have access to <module>" notice. Hide/disable create/edit/delete controls on each tab when `!canEditModule(<module>)` (Deal create ~L983/1035 + DealFormDialog/DealDetailDrawer; Lead create ~L601/613/643 + LeadFormDialog/LeadDetailDrawer — exact spots in the plan).
- **Team page "Organization access" section** (`src/pages/Team.tsx`): a new owner/admin-only section listing org members (`organization.members`) with two selectors per row — Deals and Leads = None/View/Edit. Owner/admin rows render a read-only "Full (admin)" chip. Changing a selector calls `setModuleGrant`. (Team.tsx today is project-scoped; this adds the first org-member access UI.)

### 5. Defaults & rollout
- Migration ships the empty table → on deploy, members/viewers lose the previously-open Deals/Leads **read** access. Owner/admin unaffected.
- **Rollout note (in the PR):** after deploy, an owner/admin must grant Deals/Leads to any member who legitimately needs them. This is the intended tightening.

## Data flow
- **Open a CRM tab:** `canViewModule` (context) decides whether the Deals/Leads tab renders; the data fetch hits RLS → `has_module_access(view)` → rows or empty.
- **Edit:** UI hides controls unless `canEditModule`; the write hits RLS / `crm_update_deal` → `has_module_access(edit)`.
- **Admin sets a grant:** matrix → `setModuleGrant` → upsert/delete `crm_module_grants` (RLS: admin only) → affected member's next load reflects it.

## Error handling
- RLS denials surface as empty result sets / permission errors; the UI gates *before* fetching via the tab `canViewModule` check, so users see a clear "no access" notice, not an error.
- Revoking a grant mid-session: the member keeps the stale UI until reload; the DB already denies, so no data leaks. Acceptable for v1 (no live revocation push).
- Owner/admin can never lock themselves out (bypass is unconditional).

## Testing
- **SQL/RLS:** the repo has no SQL test harness and there's no live DB in the dev environment, so this is a **documented manual `psql` script** (run against a Supabase DB / CI) asserting `has_module_access`: true for owner/admin regardless of grants; false for a member with no row; true for view when `need_edit=false`; false for view when `need_edit=true`; true for edit in both cases. The script also checks a member without a grant gets zero rows from `select * from deals`.
- **Vitest**: `canViewModule`/`canEditModule` logic (owner/admin bypass; view vs edit; no-grant denied). A render test of the Members matrix: changing a cell calls `setModuleGrant` with the right args; and that the Deals nav item is absent when `canViewModule('deals')` is false.
- **Manual**: as a member with no grant → `/deals` shows the no-access panel and the API returns no rows; grant View → page loads read-only, no edit buttons; grant Edit → can create/edit a deal; revoke → access gone after reload. Owner/admin unaffected throughout.

## Build order
1. Migration: `crm_module_grants` + `has_module_access` + `is_org_admin_or_owner_for`.
2. RLS rewrite for Deals + Leads tables + RPC updates.
3. Frontend: grants service + context helpers.
4. Frontend: Clients.tsx tab gating + edit-affordance hiding.
5. Members settings matrix UI.
Each step is independently testable; the migration + RLS (1–2) is the security-critical core.
