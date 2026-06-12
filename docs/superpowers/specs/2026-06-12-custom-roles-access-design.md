# Custom roles + per-page access (owner-defined RBAC)

**Date:** 2026-06-12
**Status:** Proposed — awaiting user review
**Branch (planned):** `crm-custom-roles` (off `main`)

## Goal

Let the **owner** create named roles (e.g. "Sales", "Developer", "Auditor") and, for **each page**, grant **No access / View / Edit**. Assign a role to any member. Today access is fixed by tier (owner/admin = everything, member = small surface, viewer = read-only); this replaces that with owner-defined, per-page control.

Confirmed decisions:
- **Three access levels per page: No access / View / Edit.** "View" = read-only (page opens, mutations disabled). "Edit" = full write (create/update/delete) on that page. (We treat the user's "write" and "edit" as one **Edit** level for v1 — a separate create-but-not-delete tier adds complexity for little gain; can be split later.)
- **Only the Owner is permanently full.** Admins are now assignable/restrictable like anyone else.
- **Enforcement = UI + routing for v1.** Sidebar hides pages a role can't access; the route redirects; on a View-only page, create/edit/delete controls are disabled. Underlying data keeps its existing org/row-level rules unchanged. **Per-page database RLS is out of scope for v1** (noted hardening): a determined user hitting the API directly is still bounded by today's RLS, but View-only is not yet tamper-proof at the DB for every table.

## Data model

### New table — `custom_roles` (migration 135)
```
role_id          uuid pk default gen_random_uuid()
organization_id  uuid not null  -> organizations
name             text not null
description      text
permissions      jsonb not null default '{}'   -- { "<pageKey>": "view" | "edit" }  (absent key = no access)
created_by       uuid
created_at       timestamptz default now()
updated_at       timestamptz default now()
unique (organization_id, name)
```
RLS: any org member may **read** their org's roles (needed to resolve their own permissions); **insert/update/delete** require `is_org_admin_or_owner(organization_id)` (reuses the existing helper from migration 124). Realtime-safe (the org-update channel already refreshes context; role edits also bump `organizations.updated_at` via the Team save, see below).

### Member → role assignment (no migration — reuse `organizations.members` jsonb)
Add an optional field to `OrganizationMember`:
```ts
customRoleId?: string | null;   // when set, governs this member's page access
```
The existing built-in `role` ("owner"|"admin"|"member"|"viewer") stays for backward compat and as the fallback when `customRoleId` is null. Assignment is persisted through the existing `updateOrganization({ members })` path the Team page already uses.

## Page catalog (the unit the owner toggles)

A single source of truth `src/lib/pageCatalog.ts` enumerates the app's pages. Each entry maps a stable `PageKey` to: a label, the route path(s) it governs, the sidebar item(s) it controls, the existing plan `feature` gate (unchanged), and a group for the editor UI.

```ts
export type PageKey =
  | 'dashboard' | 'projects_analytics' | 'crm_analytics' | 'insights'
  | 'project_management' | 'my_tasks' | 'calendar' | 'workload' | 'inbox'
  | 'team' | 'files' | 'comments' | 'contracts'
  | 'crm' | 'ai_agent' | 'timeline' | 'reports'
  | 'hr' | 'billing' | 'settings';
```
Route → page mapping (drives `ProtectedRoute` + redirects):
| PageKey | Routes | Sidebar item(s) | Plan feature |
|---|---|---|---|
| dashboard | /dashboard | Dashboard | — |
| projects_analytics | /dashboard/projects | Projects analytics | — |
| crm_analytics | /dashboard/clients | CRM analytics | crm |
| insights | /dashboard/insights | Insights | — |
| project_management | /project/:id | (project list) | — |
| my_tasks | /tasks | My Tasks | — |
| calendar | /calendar | Calendar | — |
| workload | /workload | Workload | — |
| inbox | /inbox | Inbox | — |
| team | /team | Team | team_collaboration |
| files | /files | (footer) | — |
| comments | /comments | Comments | — |
| contracts | /contracts | — | contracts |
| crm | /clients, /clients/activity | CRM | crm |
| ai_agent | /ai-agent | AI Agent | crm |
| timeline | /timeline | Timeline | timeline_overview |
| reports | /reports | Reports | — |
| hr | /hr, /time, /payroll, /expenses | HR | — |
| billing | /billing | (HR tab) | — |
| settings | /settings | (footer) | — |

`my_tasks`, `calendar`, and `settings` are flagged `alwaysAvailable: true` — they're a user's own basic workspace/account surface and can't be fully removed (a role with them unset still gets View) so nobody can be locked out of their own profile/tasks. (Everything else is fully owner-controlled.)

## Effective permissions (resolution order)
For the current user, compute `pagePermissions: Record<PageKey, 'none'|'view'|'edit'>`:
1. **Owner** → every page `edit`.
2. Else if `customRoleId` set and the role exists → its `permissions` map (missing key ⇒ `none`, except `alwaysAvailable` pages ⇒ at least `view`).
3. Else **built-in fallback** (preserves today's behavior for un-migrated members): `admin` → all `edit`; `member` → the current member surface as `view`/`edit`; `viewer` → `view` on its current pages, `none` elsewhere.
4. Plan-feature gate still applies on top (a page whose `feature` the plan lacks is `none` regardless).

## Context API (`OrganizationContext`)
Add and expose:
- `customRoles: CustomRole[]` (org's roles, loaded alongside grants).
- `pageLevel(key: PageKey): 'none' | 'view' | 'edit'`.
- `canAccessPage(key): boolean` (= level !== 'none').
- `canEditPage(key): boolean` (= level === 'edit').
Load `custom_roles` in the same effect that loads CRM grants. `isAdmin` etc. stay for existing call-sites.

## Enforcement
1. **`ProtectedRoute`** — add `requirePage?: PageKey`. When set: if `!canAccessPage(page)` → redirect to the first page the user *can* access, or to a new lightweight `/no-access` screen if none. Wire `requirePage` onto every app route per the catalog (keeping `requireSubscription`/`requireFeature`; dropping the blanket `requireOrgAdmin` in favor of page access, with owner/admin still passing via their effective perms).
2. **Sidebar** — replace the tier-based `QUICK_ITEMS_FULL/MEMBER/VIEWER` + `bottomMenuItems` split with a single list tagged by `PageKey`, filtered through `canAccessPage` (and the existing `hasFeature`). Owner/admin still see everything via their effective perms; custom-role members see exactly their granted pages.
3. **View vs Edit (in-page)** — provide `canEditPage(key)`; gate the primary create/edit/delete controls on the highest-traffic pages (CRM, Projects/boards, HR, Billing, Reports, Insights). Lower-traffic pages get route+sidebar gating in v1 and inherit the hook for follow-up. (Honestly scoped: route/sidebar gating is complete; per-control View-only disabling is applied to the listed pages, not exhaustively every button app-wide.)

## Team page — "Roles & Access"
New section on `src/pages/Team.tsx` (visible to owner + admins who still have Team edit):
- **Roles list**: each custom role with member count; create / edit / delete.
- **Role editor** (dialog): name + description + a grouped page matrix, each page row with a **None / View / Edit** segmented control. A "Start from preset" (Admin-like / Member-like / Viewer-like) seeds the matrix.
- **Assignment**: each member row gets a role selector — built-in (Admin/Member/Viewer) **or** a custom role. Saving persists `customRoleId` (and clears it when a built-in role is picked) via `updateOrganization`. The existing per-module deals/leads grant dropdowns remain for now (CRM data-level RLS is unchanged); CRM page View/Edit layers on top for navigation/UI.

## Build slices
1. **Foundation** — migration 135 + `customRoles.ts` service + `pageCatalog.ts` + `OrganizationContext` permission resolution + types. No behavior change yet (owner/admin full; others fall back to today's behavior). Unit-test the resolver.
2. **Team UI** — Roles & Access section: create/edit/delete roles + assign to members.
3. **Enforcement** — `ProtectedRoute requirePage` + `/no-access` + Sidebar permission filtering + View/Edit gating on the listed high-traffic pages.

Each slice: `npm run build` + `npm run test` green, merged to main.

## Non-goals (v1)
- Per-page database RLS (data stays under existing org/row rules). Noted as future hardening.
- A distinct "write but not delete" level (View/Edit only).
- Per-record / per-workspace scoping of roles (org-wide roles only).
- Touching the existing deals/leads `crm_module_grants` RLS (it keeps working; page access is additive).

## Testing
- Unit: the permission resolver (owner → all edit; custom role map; built-in fallbacks; alwaysAvailable floor; plan-feature gate). Page-catalog route↔key mapping is total.
- Build + full suite green per slice.
- Manual: owner creates a "Developer" role = Project Management Edit, everything else None; assign to a member; that member sees only Projects in the sidebar, /billing redirects, and a View-only page hides its create buttons.

## Self-review
Reuses the existing members-jsonb + `updateOrganization` for assignment (no member-table migration); one small `custom_roles` table mirroring the `crm_module_grants` RLS pattern. Permission resolution is centralized in `OrganizationContext`; `ProtectedRoute`/Sidebar consume one `canAccessPage` helper so there's a single gate. Honest v1 boundary: enforcement is app-layer (route + nav + listed edit controls), not per-table DB RLS.
