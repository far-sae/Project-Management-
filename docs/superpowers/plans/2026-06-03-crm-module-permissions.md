# CRM Module Permissions Implementation Plan (Deals + Leads)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-member None/View/Edit access to the Deals and Leads CRM modules, enforced in Postgres RLS and the UI; owner/admin bypass; members default to no access; admins assign grants in the Team page.

**Architecture:** A `crm_module_grants` table + a `has_module_access(user, org, module, need_edit)` SECURITY DEFINER helper drive RLS on all Deals/Leads tables (replacing the open `is_org_member` reads). The frontend loads the current user's grants into `OrganizationContext`, gates the Deals/Leads tabs + edit controls inside `Clients.tsx`, and exposes a grants matrix in `Team.tsx`.

**Tech Stack:** Supabase Postgres (migrations); React + TS + Vite (vitest). Deno binary for nothing here (no edge-function changes). **No live DB in the dev environment** — SQL/RLS is verified by a documented manual `psql` script against a Supabase DB; frontend by vitest + `npm run build`.

**Reference spec:** [docs/superpowers/specs/2026-06-03-crm-module-permissions-design.md](../specs/2026-06-03-crm-module-permissions-design.md).

**Branch:** `crm-module-permissions` (off `main`).

> **Migration numbering:** uses `124`/`125`. The `bot-power-expansion` branch already added `123`. If that branch merges first, these stay unique; if a collision appears at merge, renumber to the next free integers.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/124_crm_module_grants.sql` | grants table + `is_org_admin_or_owner_for` + `has_module_access` | Create |
| `supabase/migrations/125_crm_module_rls.sql` | rewrite Deals/Leads RLS + `crm_update_deal` | Create |
| `supabase/migrations/_manual_test_crm_grants.sql` | manual psql verification script | Create |
| `src/services/supabase/crmGrants.ts` | grants read/write + `computeModuleAccess` | Create |
| `tests/unit/crmGrants.test.ts` | test `computeModuleAccess` | Create |
| `src/context/OrganizationContext.tsx` | load grants, expose `canViewModule`/`canEditModule` | Modify |
| `src/pages/Clients.tsx` | gate Deals/Leads tabs + edit controls | Modify |
| `src/pages/Team.tsx` | "Organization access" grants matrix | Modify |

---

## Task 1: Migration — grants table + helpers

**Files:** Create `supabase/migrations/124_crm_module_grants.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 124_crm_module_grants.sql
-- Per-member access to CRM modules (deals, leads). Absence of a row = no
-- access. level='edit' implies view. Owner/admin bypass these rows entirely
-- (see has_module_access). Enforced in RLS on the deals/leads tables (125).

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

create index if not exists idx_crm_module_grants_user
  on public.crm_module_grants(user_id, organization_id);

alter table public.crm_module_grants enable row level security;

drop policy if exists "members_view_grants"  on public.crm_module_grants;
drop policy if exists "admin_manage_grants"   on public.crm_module_grants;

-- Any org member may READ grants in their org (so the UI can render the matrix
-- + the current user's own access). Only owner/admin may write.
create policy "members_view_grants" on public.crm_module_grants
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy "admin_manage_grants" on public.crm_module_grants
  for all to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- ── Helpers ──────────────────────────────────────────────────────────────
-- User-explicit admin/owner check (mirrors is_org_member_for from migration 083).
create or replace function public.is_org_admin_or_owner_for(p_user_id uuid, p_org_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.organizations o
    where o.organization_id = p_org_id
      and (
        o.owner_id = p_user_id
        or exists (
          select 1
          from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
          where (m->>'userId')::uuid = p_user_id
            and (m->>'role') in ('owner','admin')
        )
      )
  );
$$;

-- The single gate used by every Deals/Leads RLS policy.
-- owner/admin → always true; else require a grant row of sufficient level.
create or replace function public.has_module_access(
  p_user_id uuid, p_org_id uuid, p_module text, p_need_edit boolean
) returns boolean
language sql stable security definer set search_path = public, pg_catalog
as $$
  select
    public.is_org_admin_or_owner_for(p_user_id, p_org_id)
    or exists (
      select 1 from public.crm_module_grants g
      where g.organization_id = p_org_id
        and g.user_id = p_user_id
        and g.module = p_module
        and (not p_need_edit or g.level = 'edit')
    );
$$;
```

- [ ] **Step 2: Lint the SQL (best-effort, no live DB)**

Run: `npx supabase db lint --schema public 2>&1 | tail -20` (if the CLI/db is available; otherwise skip and rely on the manual script in Task 3). Expected: no syntax errors for this file.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/124_crm_module_grants.sql
git commit -m "feat(db): crm_module_grants table + has_module_access helper"
```

## Task 2: Migration — rewrite Deals/Leads RLS + the deal RPC

**Files:** Create `supabase/migrations/125_crm_module_rls.sql`

- [ ] **Step 1: Write the migration (drops the open policies, recreates grant-gated ones)**

```sql
-- 125_crm_module_rls.sql
-- Gate every Deals + Leads table behind has_module_access(). Replaces the open
-- "is_org_member can read" + per-record/owner-admin write policies with
-- module-level view/edit grants. Owner/admin still bypass (inside the helper).
-- BEHAVIOR CHANGE: members can no longer read/create/edit deals or leads
-- without an explicit grant; "edit" grant = edit ALL records in the module.

set search_path = public, pg_catalog;

-- ── DEALS ──────────────────────────────────────────────────────────────────
drop policy if exists "members_view_deals"        on public.deals;
drop policy if exists "members_create_deals"       on public.deals;
drop policy if exists "deal_owner_edit_own"        on public.deals;
drop policy if exists "owner_or_admin_edit_deals"  on public.deals;
drop policy if exists "owner_or_admin_delete_deals" on public.deals;

create policy "deals_view" on public.deals for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', false));
create policy "deals_insert" on public.deals for insert to authenticated
  with check (public.has_module_access(auth.uid(), organization_id, 'deals', true));
create policy "deals_update" on public.deals for update to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', true))
  with check (public.has_module_access(auth.uid(), organization_id, 'deals', true));
create policy "deals_delete" on public.deals for delete to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', true));

-- Deals-module config tables: read gated by deals-view; writes already go
-- through admin-gated SECURITY DEFINER funcs, so only the read policy changes.
drop policy if exists "pipelines read for org members" on public.pipelines;
create policy "pipelines read for org members" on public.pipelines for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', false));

drop policy if exists "pipeline_stages read for org members" on public.pipeline_stages;
create policy "pipeline_stages read for org members" on public.pipeline_stages for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', false));

drop policy if exists "crm_project_templates read for org members" on public.crm_project_templates;
create policy "crm_project_templates read for org members" on public.crm_project_templates for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', false));

-- ── LEADS ────────────────────────────────────────────────────────────────────
drop policy if exists "members_view_leads"          on public.leads;
drop policy if exists "members_insert_leads"         on public.leads;
drop policy if exists "author_or_admin_update_leads" on public.leads;
drop policy if exists "author_or_admin_delete_leads" on public.leads;

create policy "leads_view" on public.leads for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));
create policy "leads_insert" on public.leads for insert to authenticated
  with check (public.has_module_access(auth.uid(), organization_id, 'leads', true));
create policy "leads_update" on public.leads for update to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', true))
  with check (public.has_module_access(auth.uid(), organization_id, 'leads', true));
create policy "leads_delete" on public.leads for delete to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', true));

drop policy if exists "members_view_lead_notes"          on public.lead_notes;
drop policy if exists "members_insert_lead_notes"         on public.lead_notes;
drop policy if exists "author_or_admin_update_lead_notes" on public.lead_notes;
drop policy if exists "author_or_admin_delete_lead_notes" on public.lead_notes;

create policy "lead_notes_view" on public.lead_notes for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));
create policy "lead_notes_insert" on public.lead_notes for insert to authenticated
  with check (public.has_module_access(auth.uid(), organization_id, 'leads', true));
create policy "lead_notes_update" on public.lead_notes for update to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', true))
  with check (public.has_module_access(auth.uid(), organization_id, 'leads', true));
create policy "lead_notes_delete" on public.lead_notes for delete to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', true));

-- Leads-module config / read tables: read gated by leads-view; writes unchanged
-- (admin policy / SECURITY DEFINER edge fn).
drop policy if exists "lead_forms read for org members" on public.lead_forms;
create policy "lead_forms read for org members" on public.lead_forms for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));

drop policy if exists "form_submissions read for org members" on public.form_submissions;
create policy "form_submissions read for org members" on public.form_submissions for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));

drop policy if exists "rules read for org members" on public.lead_scoring_rules;
create policy "rules read for org members" on public.lead_scoring_rules for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));

drop policy if exists "thresholds read for org members" on public.lead_scoring_thresholds;
create policy "thresholds read for org members" on public.lead_scoring_thresholds for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));

-- ── Deal-edit RPC (migration 076): gate by deals-edit grant ──────────────────
create or replace function public.crm_update_deal(
  p_organization_id uuid, p_deal_id uuid, p_patch jsonb
) returns public.deals
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.deals%rowtype;
  v_updated public.deals;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.has_module_access(v_actor, p_organization_id, 'deals', true) then
    raise exception 'You do not have edit access to deals' using errcode = '42501';
  end if;
  -- (Body unchanged from migration 076 below this point.)
```

> **IMPORTANT for the implementer:** `crm_update_deal` in migration 076 is long. Do NOT hand-retype its whole body. Instead, in this migration, `create or replace` it by copying the **entire** existing function body from `supabase/migrations/076_crm_update_deal_rpc.sql`, and replace only the guard block — i.e. delete the two checks `if not public.is_org_member(p_organization_id) then ...` and `if public.is_org_viewer(p_organization_id) then ...` and put the single `has_module_access(v_actor, p_organization_id, 'deals', true)` guard shown above in their place. Keep everything else (the `p_patch` field handling, the `update ... returning`) identical. End the function with the same `$$;` and `grant execute ... to authenticated;` line.

- [ ] **Step 2: Sanity-check policy names against the codebase**

Run a search to confirm the dropped policy names exactly match what exists (so the `drop policy if exists` actually removes them — a typo'd name would silently leave the OLD open policy in place, a security hole):
Grep the migrations for each policy name used in the drops above (e.g. `members_view_deals`, `author_or_admin_update_leads`, `rules read for org members`). Every drop must correspond to a real existing policy. Fix any mismatch.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/125_crm_module_rls.sql
git commit -m "feat(db): gate Deals + Leads RLS behind module grants"
```

## Task 3: Manual SQL verification script

**Files:** Create `supabase/migrations/_manual_test_crm_grants.sql` (a `_`-prefixed helper, not a real migration — it won't be auto-applied; it's run by hand against a Supabase DB).

- [ ] **Step 1: Write the script**

```sql
-- _manual_test_crm_grants.sql  — run by hand against a Supabase DB (psql).
-- Replace the UUIDs with a real org + two real user ids (one admin, one member).
-- Asserts has_module_access behaves correctly. Not auto-applied.
\set ORG   '00000000-0000-0000-0000-000000000000'
\set ADMIN '00000000-0000-0000-0000-000000000000'
\set MEMBER '00000000-0000-0000-0000-000000000000'

-- owner/admin bypass: both true regardless of grants
select 'admin view'  as case, public.has_module_access(:'ADMIN', :'ORG', 'deals', false) as got, true as want;
select 'admin edit'  as case, public.has_module_access(:'ADMIN', :'ORG', 'deals', true)  as got, true as want;

-- member with no grant: both false
delete from public.crm_module_grants where organization_id = :'ORG' and user_id = :'MEMBER';
select 'member none view' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', false) as got, false as want;
select 'member none edit' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', true)  as got, false as want;

-- member with view grant: view true, edit false
insert into public.crm_module_grants(organization_id,user_id,module,level)
  values (:'ORG', :'MEMBER', 'deals', 'view')
  on conflict (organization_id,user_id,module) do update set level='view';
select 'member view→view' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', false) as got, true  as want;
select 'member view→edit' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', true)  as got, false as want;

-- member with edit grant: both true
update public.crm_module_grants set level='edit'
  where organization_id = :'ORG' and user_id = :'MEMBER' and module='deals';
select 'member edit→view' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', false) as got, true as want;
select 'member edit→edit' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', true)  as got, true as want;

-- cleanup
delete from public.crm_module_grants where organization_id = :'ORG' and user_id = :'MEMBER';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/_manual_test_crm_grants.sql
git commit -m "test(db): manual psql verification for module grants"
```

## Task 4: Frontend grants service + pure access logic (TDD)

**Files:** Create `src/services/supabase/crmGrants.ts`; Test `tests/unit/crmGrants.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/crmGrants.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { computeModuleAccess } from "@/services/supabase/crmGrants";

describe("computeModuleAccess", () => {
  it("gives owner/admin full edit on every module regardless of grants", () => {
    const a = computeModuleAccess(true, []);
    expect(a.canView("deals")).toBe(true);
    expect(a.canEdit("deals")).toBe(true);
    expect(a.canEdit("leads")).toBe(true);
  });
  it("denies a non-admin with no grants", () => {
    const a = computeModuleAccess(false, []);
    expect(a.canView("deals")).toBe(false);
    expect(a.canEdit("deals")).toBe(false);
  });
  it("view grant → can view but not edit", () => {
    const a = computeModuleAccess(false, [{ module: "deals", level: "view" }]);
    expect(a.canView("deals")).toBe(true);
    expect(a.canEdit("deals")).toBe(false);
    expect(a.canView("leads")).toBe(false);
  });
  it("edit grant → can view and edit", () => {
    const a = computeModuleAccess(false, [{ module: "leads", level: "edit" }]);
    expect(a.canView("leads")).toBe(true);
    expect(a.canEdit("leads")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- crmGrants`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `crmGrants.ts`**

```typescript
// src/services/supabase/crmGrants.ts
import { supabase } from "./config";

export type CrmModule = "deals" | "leads";
export type GrantLevel = "view" | "edit";
export interface GrantRow { user_id?: string; module: CrmModule; level: GrantLevel; }

export interface ModuleAccess {
  canView: (m: CrmModule) => boolean;
  canEdit: (m: CrmModule) => boolean;
}

/** Pure: derive view/edit booleans from the admin flag + the current user's
 *  grant rows. Owner/admin → full access on everything. */
export const computeModuleAccess = (
  isAdminOrOwner: boolean,
  grants: Pick<GrantRow, "module" | "level">[],
): ModuleAccess => {
  const byModule = new Map<CrmModule, GrantLevel>();
  for (const g of grants) byModule.set(g.module, g.level);
  const canView = (m: CrmModule) => isAdminOrOwner || byModule.has(m);
  const canEdit = (m: CrmModule) => isAdminOrOwner || byModule.get(m) === "edit";
  return { canView, canEdit };
};

/** All grant rows in an org (for the Team matrix). */
export const listOrgGrants = async (orgId: string): Promise<GrantRow[]> => {
  const { data, error } = await supabase
    .from("crm_module_grants")
    .select("user_id, module, level")
    .eq("organization_id", orgId);
  if (error) throw error;
  return (data ?? []) as GrantRow[];
};

/** Set or clear a grant. level=null deletes the row (revoke / set to None). */
export const setModuleGrant = async (
  orgId: string, userId: string, module: CrmModule, level: GrantLevel | null,
): Promise<void> => {
  if (level === null) {
    const { error } = await supabase.from("crm_module_grants").delete()
      .eq("organization_id", orgId).eq("user_id", userId).eq("module", module);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("crm_module_grants")
    .upsert({ organization_id: orgId, user_id: userId, module, level, updated_at: new Date().toISOString() },
            { onConflict: "organization_id,user_id,module" });
  if (error) throw error;
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -- crmGrants`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/supabase/crmGrants.ts tests/unit/crmGrants.test.ts
git commit -m "feat(web): crm grants service + computeModuleAccess"
```

## Task 5: Wire grants into OrganizationContext

**Files:** Modify `src/context/OrganizationContext.tsx`

- [ ] **Step 1: Load grants + expose helpers**

Add the import:
```tsx
import { listOrgGrants, computeModuleAccess, type GrantRow, type CrmModule } from "@/services/supabase/crmGrants";
```
Add state near the other `useState`s:
```tsx
const [grants, setGrants] = useState<GrantRow[]>([]);
```
After the organization is set (in the same effect that resolves `organization`, once `foundOrg?.organizationId` and `user` exist), load this user's grants:
```tsx
try {
  if (organization?.organizationId && user?.userId) {
    const all = await listOrgGrants(organization.organizationId);
    setGrants(all.filter((g) => g.user_id === user.userId));
  } else {
    setGrants([]);
  }
} catch { setGrants([]); }
```
(Place this where `refreshOrganization` runs so it re-loads on refresh. If the simplest spot is a dedicated `useEffect` keyed on `[organization?.organizationId, user?.userId]`, that's fine.)

Compute access from the existing `isAdmin` and add to the context value (the `useMemo` returning the value object, lines ~286–298):
```tsx
const access = computeModuleAccess(isAdmin, grants);
```
Add to the value object + the `OrganizationContextType` interface (lines ~7–20):
```tsx
  canViewModule: (m: CrmModule) => boolean;
  canEditModule: (m: CrmModule) => boolean;
```
and in the value:
```tsx
  canViewModule: access.canView,
  canEditModule: access.canEdit,
```
(Include `grants` in the `useMemo` dependency array.)

- [ ] **Step 2: Build to verify types**

Run: `npm run build`
Expected: success. Errors must be confined to this file — fix them.

- [ ] **Step 3: Commit**

```bash
git add src/context/OrganizationContext.tsx
git commit -m "feat(web): expose canViewModule/canEditModule from OrganizationContext"
```

## Task 6: Gate Deals/Leads tabs + edit controls in Clients.tsx

**Files:** Modify `src/pages/Clients.tsx`

> Read the file first. It renders a tab strip (Clients / Deals / Leads) and per-tab content. The exact tab mechanism (state var or router) must be matched; the rules below are mechanism-agnostic.

- [ ] **Step 1: Pull the access helpers**

Where the component reads org context, add `canViewModule, canEditModule`:
```tsx
const { /* existing */ canViewModule, canEditModule } = useOrganization();
```

- [ ] **Step 2: Hide the Deals/Leads tab buttons**

Wrap the Deals tab trigger in `{canViewModule('deals') && ( ... )}` and the Leads tab trigger in `{canViewModule('leads') && ( ... )}`.

- [ ] **Step 3: Guard the active tab (deep-link / stale state)**

Where the active tab is resolved, add an effect: if the active tab is `'deals'` and `!canViewModule('deals')` (or `'leads'` / `!canViewModule('leads')`), reset the active tab to the Clients/default tab. Render a small notice in place of the tab content if somehow still selected:
```tsx
if (activeTab === 'deals' && !canViewModule('deals')) {
  return <div className="p-6 text-sm text-muted-foreground">You don't have access to Deals. Ask an admin for access.</div>;
}
if (activeTab === 'leads' && !canViewModule('leads')) {
  return <div className="p-6 text-sm text-muted-foreground">You don't have access to Leads. Ask an admin for access.</div>;
}
```
(Place these guards just before the Deals/Leads tab content renders.)

- [ ] **Step 4: Hide edit controls when view-only**

Wrap the Deal create buttons (around L983 and L1035) with `{canEditModule('deals') && ( ... )}`. Wrap the Lead create buttons (around L601, L613, L643) with `{canEditModule('leads') && ( ... )}`. In the Deal/Lead detail drawers (`DealDetailDrawer`, `LeadDetailDrawer`) pass a `readOnly={!canEditModule('deals')}` / `readOnly={!canEditModule('leads')}` prop and have the drawer hide its Save/Delete buttons when `readOnly` (add the prop + guard in those drawer components).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients.tsx src/components/**/DealDetailDrawer* src/components/**/LeadDetailDrawer*
git commit -m "feat(web): gate Deals/Leads tabs + edit controls by module grant"
```

## Task 7: Team page "Organization access" matrix

**Files:** Modify `src/pages/Team.tsx`

- [ ] **Step 1: Add the section (owner/admin only)**

Add imports:
```tsx
import { listOrgGrants, setModuleGrant, type GrantRow, type CrmModule, type GrantLevel } from "@/services/supabase/crmGrants";
```
Use the org from context (`organization`, `isAdmin`). Render the section only when `isAdmin`. Load all grants:
```tsx
const [orgGrants, setOrgGrants] = useState<GrantRow[]>([]);
useEffect(() => {
  if (organization?.organizationId && isAdmin) {
    listOrgGrants(organization.organizationId).then(setOrgGrants).catch(() => setOrgGrants([]));
  }
}, [organization?.organizationId, isAdmin]);

const levelFor = (userId: string, module: CrmModule): GrantLevel | "none" =>
  orgGrants.find((g) => g.user_id === userId && g.module === module)?.level ?? "none";

const onChangeGrant = async (userId: string, module: CrmModule, value: GrantLevel | "none") => {
  await setModuleGrant(organization!.organizationId, userId, module, value === "none" ? null : value);
  const all = await listOrgGrants(organization!.organizationId);
  setOrgGrants(all);
};
```

- [ ] **Step 2: Render the matrix**

For each member in `organization.members`, render a row with the member name and two selects (Deals, Leads). Owner/admin members show a static "Full (admin)" chip instead of selects:
```tsx
{isAdmin && (
  <section className="mt-8">
    <h3 className="text-lg font-semibold mb-1">Organization access</h3>
    <p className="text-sm text-muted-foreground mb-4">Control who can see and edit Deals and Leads. Owners and admins always have full access.</p>
    <div className="space-y-2">
      {organization?.members.map((m) => {
        const isPrivileged = m.role === "owner" || m.role === "admin";
        return (
          <div key={m.userId} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div className="text-sm"><span className="font-medium">{m.displayName || m.email}</span> <span className="text-muted-foreground">· {m.role}</span></div>
            {isPrivileged ? (
              <span className="text-xs rounded bg-muted px-2 py-1 text-muted-foreground">Full (admin)</span>
            ) : (
              <div className="flex gap-2">
                {(["deals", "leads"] as CrmModule[]).map((mod) => (
                  <label key={mod} className="flex items-center gap-1 text-xs">
                    <span className="capitalize text-muted-foreground">{mod}</span>
                    <select
                      className="rounded border border-border bg-background px-1 py-0.5"
                      value={levelFor(m.userId, mod)}
                      onChange={(e) => onChangeGrant(m.userId, mod, e.target.value as GrantLevel | "none")}
                    >
                      <option value="none">None</option>
                      <option value="view">View</option>
                      <option value="edit">Edit</option>
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </section>
)}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Team.tsx
git commit -m "feat(web): organization access (Deals/Leads grants) matrix in Team page"
```

## Task 8: Full verification

- [ ] **Step 1: Web suite + build**

Run: `npm run test` then `npm run build`
Expected: all vitest pass (incl. `crmGrants`); build succeeds.

- [ ] **Step 2: SQL (when a Supabase DB is available)**

Apply `124` + `125`, then run `psql -f supabase/migrations/_manual_test_crm_grants.sql` (with real UUIDs) → every row's `got` equals `want`.

---

## Manual verification (post-deploy)

- [ ] As **owner/admin**: Deals + Leads tabs visible, full edit, Team page shows the access matrix.
- [ ] As a **member with no grant**: Deals/Leads tabs hidden; deep-linking the deals tab shows the "no access" notice; the `deals` table returns zero rows via the API.
- [ ] Admin grants the member **View** on Deals → tab appears, read-only (no create/edit/delete buttons).
- [ ] Admin sets **Edit** on Deals → member can create/edit/delete a deal.
- [ ] Admin sets back to **None** → access gone after reload.
- [ ] The Telegram/WhatsApp bot still creates/edits deals (service-role bypass) regardless of the acting user's grant.

---

## Self-Review

**Spec coverage:** grants table + `has_module_access` + `is_org_admin_or_owner_for` (Task 1) ✓; full Deals/Leads RLS rewrite + `crm_update_deal` (Task 2, covers every table in the spec inventory) ✓; manual SQL test (Task 3) ✓; service + pure `computeModuleAccess` (Task 4) ✓; context `canViewModule`/`canEditModule` (Task 5) ✓; Clients.tsx tab + edit gating (Task 6) ✓; Team matrix (Task 7) ✓; default-deny via empty table + owner/admin bypass ✓; bot service-role unaffected (verified item in manual list) ✓.

**Placeholder scan:** No TBD/TODO. The one "copy the existing body" instruction (crm_update_deal in Task 2) is explicit about exactly what to copy and what single block to change — not a vague placeholder. Task 6 is mechanism-agnostic by necessity (Clients.tsx tab mechanism is read at implementation time) but gives exact controls + line refs.

**Type consistency:** `CrmModule`/`GrantLevel`/`GrantRow` defined once in `crmGrants.ts`, imported by the context (Task 5) and Team (Task 7). `computeModuleAccess(isAdminOrOwner, grants)` signature matches its test and the context call. `has_module_access(user, org, module, need_edit)` argument order is identical across the migration helper, every RLS policy, and the RPC. Policy `drop`/`create` names in Task 2 match the verbatim inventory from the spec (Task 2 Step 2 re-verifies them against the codebase before trusting the drops).
