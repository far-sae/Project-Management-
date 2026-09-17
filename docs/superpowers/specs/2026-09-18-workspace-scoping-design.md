# Workspace scoping: per-workspace sidebar, menu and data

**Date:** 2026-09-18
**Status:** Approved, ready for implementation plan

## Problem

A workspace is selectable in the sidebar today, and the choice survives a
reload, but it only filters the sidebar's Projects list. Every other surface
ignores it:

- The Quick Menu is chosen by role alone, identical in every workspace.
- My Tasks, Calendar, Reports, Timeline, Workload and the Dashboard show all
  projects in the organization regardless of the selected workspace.

Switching workspace therefore changes one list and nothing else, which makes
workspaces feel decorative rather than real.

## Goal

Switching workspace changes the whole working surface:

1. Every work page shows only the selected workspace's projects and their
   tasks.
2. Owner and admin choose which Quick Menu items appear in each workspace.

## Decisions taken

| Question | Decision |
|---|---|
| Menu meaning | Both: data scoping AND a configurable item list per workspace |
| Pages in scope | Work pages only; people and money pages stay org-wide |
| Menu config owner | Owner and admin, in the workspace edit dialog |
| Default menu | All items enabled, so existing workspaces are unchanged |
| "All workspaces" | Kept exactly as it behaves today |

### Scoped (follow the selected workspace)

Dashboard, Projects list, My Tasks, Calendar, Comments, Reports, Timeline,
Workload.

### Not scoped (stay organization-wide)

Team, HR, Payroll, Time tracking, Expenses, Contracts, Settings — staff and
pay do not belong to a workspace. Files is per-user personal storage with no
project link, so it is unaffected. Inbox is notification-driven; it is left
org-wide in this change.

CRM already has its own workspace filter and is not touched.

## Architecture

### Chosen approach

Scope in one shared context and filter inside the data hooks. Rejected
alternatives: adding a workspace argument to every service function (touches
dozens of call sites), and putting the workspace in the URL (rewrites routing
and every link).

Projects already carry `workspace_id`. Tasks, comments and reports all hang
off a project, so one set of project ids is enough to filter them all.

### Components

**1. `WorkspaceContext` (new, `src/context/WorkspaceContext.tsx`)**

Single owner of the selection, mounted inside `AppLayout` above the sidebar
and the routed pages. It exposes:

- `selectedId`, `selected`, `select(id)`, `isAll`, `isUnassigned` — the
  existing `useSelectedWorkspace` surface, so current callers keep working.
- `projectIds: Set<string> | null` — project ids in the selected workspace;
  `null` means "All workspaces", meaning do not filter.
- `menuPages: PageKey[] | null` — the workspace's enabled menu items; `null`
  means all enabled.

Persistence stays as it is today: `localStorage` plus a same-tab event, so a
reload restores the last workspace.

`useSelectedWorkspace` becomes a thin re-export reading this context, so no
existing import path breaks.

**2. Hook-level filtering**

`useProjects` and `useAllTasks` feed nearly every scoped page. Filtering there
scopes the pages without editing them one by one:

- `useProjects` returns only projects whose `workspaceId` matches.
- `useAllTasks` returns only tasks whose `projectId` is in `projectIds`.

Both return unfiltered data when `projectIds` is `null`.

The unassigned selection keeps its current meaning: projects with no
workspace.

My Tasks today merges tasks assigned to you from any project in the
organization. Under this design those assigned tasks are filtered by the same
project set, so a task in another workspace is hidden while that workspace is
not selected and reappears under "All workspaces". This was raised and
accepted.

**3. Per-workspace menu storage**

One new nullable column on `workspaces`:

```sql
alter table public.workspaces
  add column if not exists menu_pages jsonb;
```

Semantics, mirroring the existing workspace-filter convention:

- `null` → every menu item is enabled (the default, and what every existing
  row gets).
- `["dashboard","my_tasks",...]` → only these `PageKey` values are enabled.

`Workspace`, `CreateWorkspaceInput` and `UpdateWorkspaceInput` gain an
optional `menuPages?: PageKey[] | null`, mapped in the workspaces service.

**4. Sidebar menu resolution**

The sidebar's Quick Menu items are currently picked by role. They become the
intersection of three filters, applied in this order:

1. Role and plan, exactly as today (this list may only shrink).
2. The workspace's `menuPages`, when not `null`.
3. Nothing when "All workspaces" is selected — the role list is shown whole.

Each menu entry maps to a `PageKey` through the existing `PAGE_CATALOG`
route resolver, so there is no second source of truth for page identity.

Disabling an item hides it from the menu only. It does not block the route,
so a link from elsewhere in the app still works and nobody can be locked out
of a page their role grants.

**5. Workspace settings UI**

The workspace edit dialog in `src/pages/kanban/Dashboard.tsx` gains a list of
menu items with toggles, rendered from `PAGE_CATALOG` and grouped by its
`group` field. Visible to owner and admin only; other roles do not see the
section. Saving writes `menuPages`; clearing every toggle back on writes
`null` rather than a full list, keeping the default meaning intact.

## Data flow

```
workspaces table (menu_pages)
        │
        ▼
WorkspaceContext ── selectedId, projectIds, menuPages
        │                    │
        │                    └──────────────┐
        ▼                                   ▼
useProjects / useAllTasks            Sidebar QuickMenu
        │                                   │
        ▼                                   ▼
Dashboard, My Tasks, Calendar,      items = role ∩ workspace
Comments, Reports, Timeline,
Workload
```

## Error handling

- Selected workspace deleted or not visible: fall back to "All workspaces",
  which is the existing behaviour and stays unchanged.
- `menu_pages` holding an unknown key: ignored when resolving, so a renamed
  page cannot blank the menu.
- `menu_pages` present but empty (`[]`): treated as "no items enabled" and the
  menu renders empty; the settings UI prevents reaching this state by writing
  `null` when everything is toggled on.
- Column missing because the migration has not run: the service maps a missing
  field to `null`, which means all items enabled, so the app behaves exactly as
  it does today.

## Testing

Two pure functions carry the logic and are unit tested first, in the existing
`tests/unit` Vitest suite:

1. `projectsInWorkspace(projects, selectedId)` — all, unassigned, specific
   workspace, and a workspace with no projects.
2. `resolveWorkspaceMenu(roleItems, menuPages)` — `null` passes the role list
   through; a subset intersects; an unknown key is ignored; role restrictions
   are never widened.

Hook behaviour (tasks filtered by project set) is covered through the same
pure helpers so the tests stay free of Supabase mocking.

## Out of scope

- Members assigned per workspace; Team, HR and Payroll stay org-wide.
- Per-user menu preferences.
- Workspace in the URL.
- Scoping Files and Inbox.
