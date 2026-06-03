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

### 3. RLS rewrite (Deals + Leads tables)
For each Deals table (`deals`, `pipelines`, `pipeline_stages`) and Leads table (`leads`, `lead_forms`, `lead_scoring_rules`, + related):
- **SELECT**: replace `is_org_member(organization_id)` → `has_module_access(auth.uid(), organization_id, '<module>', false)`.
- **INSERT/UPDATE/DELETE**: replace `is_org_admin_or_owner(organization_id)` → `has_module_access(auth.uid(), organization_id, '<module>', true)`.
- `anon` deny policies unchanged.
- The `crm_update_deal` RPC (migration 076) and any lead-mutating RPCs: swap their `is_org_member`/`is_org_viewer` gate for `has_module_access(auth.uid(), p_organization_id, 'deals'|'leads', true)`.
- **Service-role paths are unaffected** — the bot's `executePending` and `agent_*`/`crm_*_as` RPCs use the service-role client / SECURITY DEFINER and bypass RLS, so the bot keeps working regardless of grants. (Documented, intentional.)

### 4. Frontend
- **`src/services/supabase/crmGrants.ts`** (new): `listOrgGrants(orgId)`, `setModuleGrant(orgId, userId, module, level | null)` (null = revoke/delete row).
- **`OrganizationContext`**: load the current user's grant rows; expose `moduleGrants: { deals?: 'view'|'edit'; leads?: 'view'|'edit' }` and helpers `canViewModule(m)`, `canEditModule(m)` (owner/admin → always true).
- **`ProtectedRoute`**: add a `requireModule?: 'deals'|'leads'` prop (min view). Wrap the Deals and Leads routes in `App.tsx`. On deny → render an "You don't have access to this module" panel (not a blank page).
- **Sidebar** (`src/components/sidebar/Sidebar.tsx`): show Deals/Leads nav entries only when `canViewModule(...)`.
- **Edit affordances**: on Deals/Leads pages, hide/disable create/edit/delete controls when the user has only `view` (`!canEditModule(...)`).
- **Members settings matrix**: in the existing Members/Team settings screen, add a per-member grid (rows: Deals, Leads; cell: None/View/Edit select) for owner/admin. Owner/admin rows show "Full (admin)" and are not editable. Writes call `setModuleGrant`.

### 5. Defaults & rollout
- Migration ships the empty table → on deploy, members/viewers lose the previously-open Deals/Leads **read** access. Owner/admin unaffected.
- **Rollout note (in the PR):** after deploy, an owner/admin must grant Deals/Leads to any member who legitimately needs them. This is the intended tightening.

## Data flow
- **Read a CRM page:** route `requireModule` → `canViewModule` (context) gates render; the data fetch hits RLS → `has_module_access(view)` → rows or empty.
- **Edit:** UI hides controls unless `canEditModule`; the write hits RLS / `crm_update_deal` → `has_module_access(edit)`.
- **Admin sets a grant:** matrix → `setModuleGrant` → upsert/delete `crm_module_grants` (RLS: admin only) → affected member's next load reflects it.

## Error handling
- RLS denials surface as empty result sets / permission errors; the UI gates *before* fetching via `requireModule` + `canViewModule`, so users see a clear "no access" panel, not an error.
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
4. Frontend: `requireModule` route gating + sidebar + edit-affordance hiding.
5. Members settings matrix UI.
Each step is independently testable; the migration + RLS (1–2) is the security-critical core.
