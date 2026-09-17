# Workspace Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the selected workspace scope every work page's projects and tasks, and let owner/admin choose which Quick Menu items each workspace shows.

**Architecture:** One `WorkspaceProvider` (mounted in the router shell) owns the selected workspace, the set of project ids inside it, and that workspace's enabled menu items. Pure helpers in `src/lib/workspaceScope.ts` do all filtering and menu resolution so they are unit-testable without Supabase. Pages opt in with two one-line calls (`filterProjects`, `filterTasks`); the sidebar intersects the role menu with the workspace menu.

**Tech Stack:** React 18, TypeScript (strict), Vite, Supabase (Postgres + supabase-js), Vitest (jsdom), Radix UI `Switch`, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-18-workspace-scoping-design.md`

## Global Constraints

- `npm run lint` must pass with zero warnings (`--max-warnings 0`).
- `npm run build` runs `tsc` under `strict: true` with `noUnusedLocals` and `noUnusedParameters`; unused imports fail the build.
- Tests live in `tests/unit/*.test.ts` and run with `npm test` (Vitest, `globals: false`, so import `describe/it/expect` from `vitest`).
- Path alias `@/` maps to `src/`.
- The unassigned selection means "projects with no workspace"; "All workspaces" means no filtering. Both keep their current ids: `__ALL_WORKSPACES__` and `__UNASSIGNED_PROJECTS__`.
- `menu_pages` semantics: `null` → all Quick Menu items enabled; array of `PageKey` → only those. Unknown keys are ignored.
- Disabling a menu item hides it from the sidebar only. Never add a route block.
- Team, HR, Payroll, Time, Expenses, Contracts, Settings, Files, Inbox and CRM are NOT scoped; do not touch their data.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Deviation from the spec (read this first)

The spec says filtering happens inside `useProjects` and `useAllTasks`. During planning it turned out that eight consumers need the **unfiltered** list (the workspace switcher counts projects per workspace, the Dashboard's shared-projects fallback, the command palette, the new-project dialog, Expenses, Team, the deal handoff dialog, the onboarding checklist). Filtering inside the hooks would silently break those. So the hooks stay untouched and each scoped page applies `filterProjects` / `filterTasks` from the context. The user-visible behaviour is identical to the spec.

## File map

| File | Responsibility |
|---|---|
| `src/lib/workspaceScope.ts` (new) | Pure helpers: project/task filtering, menu resolution, `menu_pages` normalization, the list of Quick Menu page keys |
| `tests/unit/workspaceScope.test.ts` (new) | Unit tests for the helpers |
| `supabase/migrations/150_workspace_menu_pages.sql` (new) | Adds nullable `menu_pages jsonb` to `workspaces` |
| `src/types/workspace.ts` | Adds `menuPages` to the workspace types |
| `src/services/supabase/workspaces.ts` | Maps `menu_pages` in and out through one `mapWorkspaceRow` helper |
| `src/context/WorkspaceContext.tsx` (new) | `WorkspaceProvider` + `useWorkspaceScope()` |
| `src/hooks/useSelectedWorkspace.ts` | Becomes a re-export of the context so the 10 existing importers keep working |
| `src/App.tsx` | Mounts `WorkspaceProvider` in `RouterShell` (the command palette lives there, outside `AppLayout`) |
| `src/components/sidebar/Sidebar.tsx` | Quick Menu = role items ∩ workspace `menuPages` |
| `src/pages/MyTasks.tsx`, `Calendar.tsx`, `Comments.tsx`, `Reports.tsx`, `TimelineOverview.tsx`, `Workload.tsx` | Opt into scoping |
| `src/pages/kanban/Dashboard.tsx` | Menu toggles in the Edit Workspace dialog (owner/admin) |

---

### Task 1: Pure scope helpers with tests

**Files:**
- Create: `src/lib/workspaceScope.ts`
- Test: `tests/unit/workspaceScope.test.ts`

**Interfaces:**
- Consumes: `PageKey`, `ALL_PAGE_KEYS` from `@/lib/pageCatalog` (existing).
- Produces (all later tasks depend on these exact names):
  - `ALL_WORKSPACES_ID: string`, `UNASSIGNED_WORKSPACE_ID: string`
  - `QUICK_MENU_PAGE_KEYS: PageKey[]`
  - `projectsInWorkspace<P extends { workspaceId?: string | null }>(projects: P[], selectedId: string): P[]`
  - `projectIdsForScope<P extends { projectId: string; workspaceId?: string | null }>(projects: P[], selectedId: string): Set<string> | null`
  - `tasksInScope<T extends { projectId: string }>(tasks: T[], projectIds: Set<string> | null): T[]`
  - `normalizeMenuPages(raw: unknown): PageKey[] | null`
  - `resolveWorkspaceMenu<I extends { page: PageKey }>(roleItems: I[], menuPages: PageKey[] | null): I[]`
  - `menuPagesForSave(enabled: PageKey[]): PageKey[] | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/workspaceScope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ALL_WORKSPACES_ID,
  UNASSIGNED_WORKSPACE_ID,
  QUICK_MENU_PAGE_KEYS,
  projectsInWorkspace,
  projectIdsForScope,
  tasksInScope,
  normalizeMenuPages,
  resolveWorkspaceMenu,
  menuPagesForSave,
} from "@/lib/workspaceScope";
import type { PageKey } from "@/lib/pageCatalog";

const projects = [
  { projectId: "p1", workspaceId: "w1" },
  { projectId: "p2", workspaceId: "w2" },
  { projectId: "p3", workspaceId: undefined },
  { projectId: "p4", workspaceId: null },
];

describe("projectsInWorkspace", () => {
  it("returns everything for All workspaces", () => {
    expect(projectsInWorkspace(projects, ALL_WORKSPACES_ID)).toHaveLength(4);
  });
  it("returns only projects with no workspace for Unassigned", () => {
    const ids = projectsInWorkspace(projects, UNASSIGNED_WORKSPACE_ID).map((p) => p.projectId);
    expect(ids).toEqual(["p3", "p4"]);
  });
  it("returns only the selected workspace's projects", () => {
    const ids = projectsInWorkspace(projects, "w1").map((p) => p.projectId);
    expect(ids).toEqual(["p1"]);
  });
  it("returns an empty list for a workspace with no projects", () => {
    expect(projectsInWorkspace(projects, "w-empty")).toEqual([]);
  });
});

describe("projectIdsForScope", () => {
  it("is null for All workspaces (meaning: do not filter)", () => {
    expect(projectIdsForScope(projects, ALL_WORKSPACES_ID)).toBeNull();
  });
  it("is the set of ids in the selected workspace", () => {
    expect(projectIdsForScope(projects, "w2")).toEqual(new Set(["p2"]));
  });
  it("is the set of unassigned ids for Unassigned", () => {
    expect(projectIdsForScope(projects, UNASSIGNED_WORKSPACE_ID)).toEqual(new Set(["p3", "p4"]));
  });
});

describe("tasksInScope", () => {
  const tasks = [
    { taskId: "t1", projectId: "p1" },
    { taskId: "t2", projectId: "p2" },
    { taskId: "t3", projectId: "p9" },
  ];
  it("passes everything through when projectIds is null", () => {
    expect(tasksInScope(tasks, null)).toHaveLength(3);
  });
  it("keeps only tasks whose project is in the set", () => {
    expect(tasksInScope(tasks, new Set(["p1"])).map((t) => t.taskId)).toEqual(["t1"]);
  });
  it("drops tasks whose project is unknown (assigned from another workspace)", () => {
    expect(tasksInScope(tasks, new Set(["p2"])).map((t) => t.taskId)).toEqual(["t2"]);
  });
});

describe("normalizeMenuPages", () => {
  it("returns null for null / undefined / non-array", () => {
    expect(normalizeMenuPages(null)).toBeNull();
    expect(normalizeMenuPages(undefined)).toBeNull();
    expect(normalizeMenuPages("dashboard")).toBeNull();
    expect(normalizeMenuPages({})).toBeNull();
  });
  it("keeps only known page keys, in order", () => {
    expect(normalizeMenuPages(["reports", "bogus", "my_tasks", 42])).toEqual(["reports", "my_tasks"]);
  });
  it("keeps an empty array as empty (no items enabled)", () => {
    expect(normalizeMenuPages([])).toEqual([]);
  });
});

describe("resolveWorkspaceMenu", () => {
  const role = [
    { page: "dashboard" as PageKey, href: "/dashboard" },
    { page: "my_tasks" as PageKey, href: "/tasks" },
    { page: "reports" as PageKey, href: "/reports" },
  ];
  it("returns the role list untouched when menuPages is null", () => {
    expect(resolveWorkspaceMenu(role, null)).toBe(role);
  });
  it("intersects with the workspace's enabled pages", () => {
    const out = resolveWorkspaceMenu(role, ["reports", "my_tasks"]);
    expect(out.map((i) => i.page)).toEqual(["my_tasks", "reports"]);
  });
  it("never widens: a page enabled in the workspace but absent from the role list stays hidden", () => {
    const out = resolveWorkspaceMenu(role, ["team", "dashboard"]);
    expect(out.map((i) => i.page)).toEqual(["dashboard"]);
  });
  it("renders empty when the workspace enables nothing", () => {
    expect(resolveWorkspaceMenu(role, [])).toEqual([]);
  });
});

describe("menuPagesForSave", () => {
  it("returns null when every Quick Menu key is enabled (the default)", () => {
    expect(menuPagesForSave([...QUICK_MENU_PAGE_KEYS])).toBeNull();
    expect(menuPagesForSave([...QUICK_MENU_PAGE_KEYS].reverse())).toBeNull();
  });
  it("returns the list when at least one key is disabled", () => {
    const partial = QUICK_MENU_PAGE_KEYS.filter((k) => k !== "reports");
    expect(menuPagesForSave(partial)).toEqual(partial);
  });
});

describe("QUICK_MENU_PAGE_KEYS", () => {
  it("matches the items the sidebar can show", () => {
    expect(QUICK_MENU_PAGE_KEYS).toEqual([
      "dashboard", "projects_analytics", "my_tasks", "inbox",
      "calendar", "workload", "reports", "crm", "team",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/workspaceScope.test.ts`
Expected: FAIL with "Failed to resolve import "@/lib/workspaceScope"".

- [ ] **Step 3: Write the implementation**

Create `src/lib/workspaceScope.ts`:

```ts
// Pure helpers for workspace scoping. No React, no Supabase — everything here
// is unit-tested in tests/unit/workspaceScope.test.ts.
//
// Selection ids: a real workspace id, or one of the two virtual values below.
// Filter semantics mirror the CRM's applyWorkspaceFilter:
//   All        → no filtering
//   Unassigned → projects with no workspaceId
//   <id>       → projects with that workspaceId

import { ALL_PAGE_KEYS, type PageKey } from "@/lib/pageCatalog";

export const ALL_WORKSPACES_ID = "__ALL_WORKSPACES__";
/** Virtual filter: projects with no workspace assigned. */
export const UNASSIGNED_WORKSPACE_ID = "__UNASSIGNED_PROJECTS__";

/** The PageKeys that can appear in the sidebar Quick Menu. This is the set the
 *  per-workspace toggles are rendered from, and the set "all enabled" is
 *  measured against when saving. Keep in sync with QUICK_ITEMS_FULL in
 *  Sidebar.tsx. */
export const QUICK_MENU_PAGE_KEYS: PageKey[] = [
  "dashboard",
  "projects_analytics",
  "my_tasks",
  "inbox",
  "calendar",
  "workload",
  "reports",
  "crm",
  "team",
];

export function projectsInWorkspace<P extends { workspaceId?: string | null }>(
  projects: P[],
  selectedId: string,
): P[] {
  if (selectedId === ALL_WORKSPACES_ID) return projects;
  if (selectedId === UNASSIGNED_WORKSPACE_ID) return projects.filter((p) => !p.workspaceId);
  return projects.filter((p) => p.workspaceId === selectedId);
}

/** `null` means "All workspaces — do not filter". */
export function projectIdsForScope<
  P extends { projectId: string; workspaceId?: string | null },
>(projects: P[], selectedId: string): Set<string> | null {
  if (selectedId === ALL_WORKSPACES_ID) return null;
  return new Set(projectsInWorkspace(projects, selectedId).map((p) => p.projectId));
}

export function tasksInScope<T extends { projectId: string }>(
  tasks: T[],
  projectIds: Set<string> | null,
): T[] {
  if (projectIds === null) return tasks;
  return tasks.filter((t) => projectIds.has(t.projectId));
}

const KNOWN_KEYS = new Set<string>(ALL_PAGE_KEYS);

/** Parse the raw `menu_pages` column. Non-arrays → null (all enabled).
 *  Unknown keys are dropped so a renamed page cannot blank the menu. */
export function normalizeMenuPages(raw: unknown): PageKey[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((k): k is PageKey => typeof k === "string" && KNOWN_KEYS.has(k));
}

/** Role/plan filtering has already produced `roleItems`; this can only shrink it. */
export function resolveWorkspaceMenu<I extends { page: PageKey }>(
  roleItems: I[],
  menuPages: PageKey[] | null,
): I[] {
  if (menuPages === null) return roleItems;
  const allowed = new Set<PageKey>(menuPages);
  return roleItems.filter((i) => allowed.has(i.page));
}

/** Toggle state → column value. Everything on → null (keeps the default
 *  meaning), otherwise the explicit list. */
export function menuPagesForSave(enabled: PageKey[]): PageKey[] | null {
  const set = new Set<PageKey>(enabled);
  return QUICK_MENU_PAGE_KEYS.every((k) => set.has(k)) ? null : enabled;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/workspaceScope.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspaceScope.ts tests/unit/workspaceScope.test.ts
git commit -m "feat(workspace): pure scope + menu helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Migration, types and service mapping for `menu_pages`

**Files:**
- Create: `supabase/migrations/150_workspace_menu_pages.sql`
- Modify: `src/types/workspace.ts`
- Modify: `src/services/supabase/workspaces.ts`
- Test: `tests/unit/workspacesService.test.ts` (new)

**Interfaces:**
- Consumes: `normalizeMenuPages` from Task 1.
- Produces:
  - `Workspace.menuPages?: PageKey[] | null` (both in `src/types/workspace.ts` and the service's local `Workspace`)
  - `UpdateWorkspaceInput.menuPages?: PageKey[] | null` (both files)
  - `export const mapWorkspaceRow = (row: WorkspaceRow): Workspace` in the service
  - `updateWorkspace(workspaceId, { menuPages })` writes `menu_pages`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/150_workspace_menu_pages.sql`:

```sql
-- Per-workspace Quick Menu. NULL = every item enabled (the default, and what
-- every existing row gets). A JSON array of PageKey strings = only those items.
-- See docs/superpowers/specs/2026-09-18-workspace-scoping-design.md.
alter table public.workspaces
  add column if not exists menu_pages jsonb;

comment on column public.workspaces.menu_pages is
  'Quick Menu PageKeys enabled in this workspace; NULL means all.';

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Write the failing service test**

Create `tests/unit/workspacesService.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapWorkspaceRow } from "@/services/supabase/workspaces";

const base = {
  workspace_id: "w1",
  name: "Marketing",
  organization_id: "o1",
  is_default: false,
  created_at: "2026-09-18T10:00:00.000Z",
  updated_at: "2026-09-18T10:00:00.000Z",
};

describe("mapWorkspaceRow", () => {
  it("maps a row with menu_pages null to menuPages null", () => {
    const ws = mapWorkspaceRow({ ...base, menu_pages: null });
    expect(ws.workspaceId).toBe("w1");
    expect(ws.menuPages).toBeNull();
    expect(ws.createdAt).toBeInstanceOf(Date);
  });
  it("maps a missing menu_pages (migration not yet applied) to null", () => {
    const ws = mapWorkspaceRow(base);
    expect(ws.menuPages).toBeNull();
  });
  it("keeps a valid list and drops unknown keys", () => {
    const ws = mapWorkspaceRow({ ...base, menu_pages: ["my_tasks", "nope"] });
    expect(ws.menuPages).toEqual(["my_tasks"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/workspacesService.test.ts`
Expected: FAIL, `mapWorkspaceRow` is not exported.

- [ ] **Step 4: Update the shared types**

In `src/types/workspace.ts`, replace the whole file with:

```ts
import type { PageKey } from "@/lib/pageCatalog";

export interface Workspace {
  workspaceId: string;
  name: string;
  description?: string;
  organizationId: string;
  isDefault?: boolean;
  /** Quick Menu items enabled here. `null`/`undefined` = all enabled. */
  menuPages?: PageKey[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  /** `null` resets to "all enabled". `undefined` leaves the column untouched. */
  menuPages?: PageKey[] | null;
}
```

- [ ] **Step 5: Update the service**

In `src/services/supabase/workspaces.ts`:

Replace the top of the file (imports through `UpdateWorkspaceInput`) with:

```ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";
import type { PageKey } from "@/lib/pageCatalog";
import { normalizeMenuPages } from "@/lib/workspaceScope";

export interface Workspace {
  workspaceId: string;
  name: string;
  organizationId: string;
  isDefault: boolean;
  menuPages: PageKey[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkspaceInput {
  name: string;
  organizationId: string;
  isDefault?: boolean;
}

export interface UpdateWorkspaceInput {
  name?: string;
  menuPages?: PageKey[] | null;
}

/** Raw shape of a `workspaces` row as returned by PostgREST. */
export interface WorkspaceRow {
  workspace_id: string;
  name: string;
  organization_id: string;
  is_default: boolean;
  menu_pages?: unknown;
  created_at: string;
  updated_at: string;
}

export const mapWorkspaceRow = (row: WorkspaceRow): Workspace => ({
  workspaceId: row.workspace_id,
  name: row.name,
  organizationId: row.organization_id,
  isDefault: row.is_default,
  menuPages: normalizeMenuPages(row.menu_pages),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});
```

In `createWorkspace`, replace the final `return { workspaceId: data.workspace_id, ... };` object literal with:

```ts
  return mapWorkspaceRow(data as WorkspaceRow);
```

In `getWorkspace`, replace its `return { workspaceId: data.workspace_id, ... };` object literal with:

```ts
  return mapWorkspaceRow(data as WorkspaceRow);
```

In `getOrganizationWorkspaces`, replace `return (data || []).map((workspace) => ({ ... }));` with:

```ts
  return ((data || []) as WorkspaceRow[]).map(mapWorkspaceRow);
```

In `updateWorkspace`, after the line `if (input.name) updateData.name = input.name;` add:

```ts
  if (input.menuPages !== undefined) updateData.menu_pages = input.menuPages;
```

- [ ] **Step 6: Run the test and the type check**

Run: `npx vitest run tests/unit/workspacesService.test.ts && npx tsc --noEmit`
Expected: 3 tests PASS; `tsc` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/150_workspace_menu_pages.sql src/types/workspace.ts src/services/supabase/workspaces.ts tests/unit/workspacesService.test.ts
git commit -m "feat(workspace): menu_pages column, types and row mapping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `WorkspaceProvider` and `useWorkspaceScope`

**Files:**
- Create: `src/context/WorkspaceContext.tsx`
- Modify: `src/hooks/useSelectedWorkspace.ts` (becomes a re-export)
- Modify: `src/App.tsx:123-132` (`RouterShell`)

**Interfaces:**
- Consumes: Task 1 helpers; `useWorkspaces` (existing, `src/hooks/useWorkspaces.ts`); `useProjects` (existing).
- Produces:

```ts
export interface WorkspaceScope {
  workspaces: Workspace[];
  loading: boolean;
  selectedId: string;
  selected: Workspace | null;
  select: (id: string) => void;
  DEFAULT_WORKSPACE_ID: string;
  isAll: boolean;
  isUnassigned: boolean;
  /** null = All workspaces (no filtering). */
  projectIds: Set<string> | null;
  /** null = every Quick Menu item enabled. */
  menuPages: PageKey[] | null;
  filterProjects: <P extends { projectId: string; workspaceId?: string | null }>(list: P[]) => P[];
  filterTasks: <T extends { projectId: string }>(list: T[]) => T[];
}
export const WorkspaceProvider: React.FC<{ children: React.ReactNode }>;
export const useWorkspaceScope: () => WorkspaceScope;
```

The first eight fields are exactly what `useSelectedWorkspace` returns today, so every existing caller keeps compiling.

- [ ] **Step 1: Create the context**

Create `src/context/WorkspaceContext.tsx`:

```tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useProjects } from "@/hooks/useProjects";
import type { Workspace } from "@/types/workspace";
import type { PageKey } from "@/lib/pageCatalog";
import {
  ALL_WORKSPACES_ID,
  UNASSIGNED_WORKSPACE_ID,
  normalizeMenuPages,
  projectIdsForScope,
  projectsInWorkspace,
  tasksInScope,
} from "@/lib/workspaceScope";

const STORAGE_KEY = "selectedWorkspaceId";
const EVENT_NAME = "app:selected-workspace-changed";

const readStored = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStored = (id: string): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
};

export interface WorkspaceScope {
  workspaces: Workspace[];
  loading: boolean;
  selectedId: string;
  selected: Workspace | null;
  select: (id: string) => void;
  DEFAULT_WORKSPACE_ID: string;
  isAll: boolean;
  isUnassigned: boolean;
  /** Project ids in the selected workspace. `null` = All workspaces (no filtering). */
  projectIds: Set<string> | null;
  /** Quick Menu items enabled in the selected workspace. `null` = all. */
  menuPages: PageKey[] | null;
  filterProjects: <P extends { projectId: string; workspaceId?: string | null }>(
    list: P[],
  ) => P[];
  filterTasks: <T extends { projectId: string }>(list: T[]) => T[];
}

const WorkspaceContext = createContext<WorkspaceScope | undefined>(undefined);

/**
 * Single owner of the selected workspace. Mounted once in the router shell so
 * the sidebar, the command palette and every page read the same selection.
 * The choice is persisted in localStorage and broadcast on a same-tab event,
 * exactly as the old useSelectedWorkspace hook did.
 */
export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { workspaces, loading, DEFAULT_WORKSPACE_ID } = useWorkspaces();
  const { projects } = useProjects();
  const [id, setId] = useState<string>(() => readStored() || ALL_WORKSPACES_ID);

  useEffect(() => {
    const onChange = () => {
      const stored = readStored();
      if (stored) setId(stored);
    };
    window.addEventListener(EVENT_NAME, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  // If the stored workspace is no longer visible (deleted, switched org), show all.
  useEffect(() => {
    if (loading) return;
    if (id === ALL_WORKSPACES_ID || id === UNASSIGNED_WORKSPACE_ID) return;
    const exists = workspaces.some((w) => w.workspaceId === id);
    if (!exists) {
      setId(ALL_WORKSPACES_ID);
      writeStored(ALL_WORKSPACES_ID);
    }
  }, [workspaces, loading, id]);

  const select = useCallback((newId: string) => {
    setId(newId);
    writeStored(newId);
    try {
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {
      /* ignore */
    }
  }, []);

  const selected = useMemo<Workspace | null>(() => {
    if (id === ALL_WORKSPACES_ID || id === UNASSIGNED_WORKSPACE_ID) return null;
    return workspaces.find((w) => w.workspaceId === id) || null;
  }, [workspaces, id]);

  const projectIds = useMemo(() => projectIdsForScope(projects, id), [projects, id]);

  const menuPages = useMemo(
    () => (selected ? normalizeMenuPages(selected.menuPages) : null),
    [selected],
  );

  const filterProjects = useCallback(
    function filterProjects<P extends { projectId: string; workspaceId?: string | null }>(
      list: P[],
    ): P[] {
      return projectsInWorkspace(list, id);
    },
    [id],
  );

  const filterTasks = useCallback(
    function filterTasks<T extends { projectId: string }>(list: T[]): T[] {
      return tasksInScope(list, projectIds);
    },
    [projectIds],
  );

  const value = useMemo<WorkspaceScope>(
    () => ({
      workspaces,
      loading,
      selectedId: id,
      selected,
      select,
      DEFAULT_WORKSPACE_ID,
      isAll: id === ALL_WORKSPACES_ID,
      isUnassigned: id === UNASSIGNED_WORKSPACE_ID,
      projectIds,
      menuPages,
      filterProjects,
      filterTasks,
    }),
    [
      workspaces, loading, id, selected, select, DEFAULT_WORKSPACE_ID,
      projectIds, menuPages, filterProjects, filterTasks,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
};

export const useWorkspaceScope = (): WorkspaceScope => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspaceScope must be used within a WorkspaceProvider");
  }
  return ctx;
};

export default WorkspaceContext;
```

- [ ] **Step 2: Turn the old hook into a re-export**

Replace the entire contents of `src/hooks/useSelectedWorkspace.ts` with:

```ts
// The selected-workspace state moved into WorkspaceContext so it is owned in
// one place. This module stays as the import path every existing caller uses.
export {
  ALL_WORKSPACES_ID,
  UNASSIGNED_WORKSPACE_ID,
} from "@/lib/workspaceScope";
export {
  useWorkspaceScope as useSelectedWorkspace,
  useWorkspaceScope as default,
} from "@/context/WorkspaceContext";
```

- [ ] **Step 3: Mount the provider in the router shell**

In `src/App.tsx`, add this import next to the other context imports (after the `SubscriptionProvider` import line):

```ts
import { WorkspaceProvider } from '@/context/WorkspaceContext';
```

Replace `RouterShell` (currently lines 123-132) with:

```tsx
const RouterShell: React.FC = () => {
  const { user } = useAuth();
  return (
    <WorkspaceProvider>
      <Outlet />
      {/* Command palette is global but only useful while authenticated */}
      {user && <CommandPalette />}
    </WorkspaceProvider>
  );
};
```

The provider sits here rather than in `AppLayout` because `CommandPalette` (outside `AppLayout`) calls `useSelectedWorkspace`. On public pages the provider's hooks see no user and return empty lists, which is the same cost the old per-caller hook already paid.

- [ ] **Step 4: Type-check, lint and run all tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type errors, no lint warnings, all tests pass (existing suite plus the 22 from Tasks 1-2).

- [ ] **Step 5: Smoke-check in the browser**

Run: `npm run dev`. Sign in, switch workspaces in the sidebar. The Projects list must still filter; reloading must keep the selection; the command palette (Ctrl+K) must still list workspaces. Nothing else should look different yet.

- [ ] **Step 6: Commit**

```bash
git add src/context/WorkspaceContext.tsx src/hooks/useSelectedWorkspace.ts src/App.tsx
git commit -m "feat(workspace): WorkspaceProvider owns selection, project ids and menu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Sidebar Quick Menu = role items ∩ workspace menu

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx:59-84` (item lists) and `:234-247` (QuickMenu render)

**Interfaces:**
- Consumes: `menuPages` from `useSelectedWorkspace()` (Task 3); `resolveWorkspaceMenu` (Task 1).

- [ ] **Step 1: Add the page key to the member and viewer lists**

Replace `QUICK_ITEMS_MEMBER` and `QUICK_ITEMS_VIEWER` (lines 73-84) with:

```ts
// Members get a deliberately small surface: just the personal-productivity
// pages. No Dashboard / Inbox / Reports — those are admin/owner views.
const QUICK_ITEMS_MEMBER = [
  { icon: CheckSquare, label: 'My Tasks', href: '/tasks', page: 'my_tasks' as PageKey },
  { icon: Calendar, label: 'Calendar', href: '/calendar', page: 'calendar' as PageKey },
  { icon: Activity, label: 'Workload', href: '/workload', page: 'workload' as PageKey },
];

// Viewers are read-only observers (clients, auditors). They don't get tasks
// assigned, don't clock in, don't have a workload. Just Calendar to see what's
// scheduled — the project list in the sidebar handles browsing.
const QUICK_ITEMS_VIEWER = [
  { icon: Calendar, label: 'Calendar', href: '/calendar', page: 'calendar' as PageKey },
];
```

- [ ] **Step 2: Import the resolver**

After the line `import { usePinnedProjects } from '@/hooks/usePinnedProjects';` add:

```ts
import { resolveWorkspaceMenu } from '@/lib/workspaceScope';
```

- [ ] **Step 3: Read `menuPages` from the selection**

Replace (lines 101-102):

```ts
  const { selectedId: selectedWorkspaceId, isAll, isUnassigned } =
    useSelectedWorkspace();
```

with:

```ts
  const { selectedId: selectedWorkspaceId, isAll, isUnassigned, menuPages } =
    useSelectedWorkspace();
```

- [ ] **Step 4: Compute the items once, then render**

Directly after the `projectsForNav` `useMemo` (it ends with `}, [sortedProjects, project]);`), add:

```ts
  // Quick Menu = role/plan surface (may only shrink) ∩ the workspace's enabled
  // items. Under "All workspaces" menuPages is null and the role list shows whole.
  const quickItems = useMemo(() => {
    const roleItems = canSeePeopleOps
      ? QUICK_ITEMS_FULL.filter(
          (i) =>
            (i.href !== '/team' || hasFeature('team_collaboration')) &&
            (i.href !== '/crm' || hasFeature('crm')),
        )
      : isViewer
        ? QUICK_ITEMS_VIEWER
        : QUICK_ITEMS_MEMBER;
    return resolveWorkspaceMenu(roleItems, menuPages);
  }, [canSeePeopleOps, isViewer, hasFeature, menuPages]);
```

Then replace the `<QuickMenu items={ ... } />` block (lines 234-247) with:

```tsx
        {/* Quick navigation — full / member / viewer surfaces, narrowed per workspace. */}
        <QuickMenu items={quickItems} />
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (If `tsc` complains that `QUICK_ITEMS_FULL` items have a `feature` field the others lack, that is fine: the union is still `{ page: PageKey }`-compatible.)

- [ ] **Step 6: Manual check**

Run `npm run dev`. Under "All workspaces" the menu is unchanged. There is no UI to set `menu_pages` yet, so to test the narrowing run this in the Supabase SQL Editor against a test workspace, reload, and confirm only My Tasks and Calendar show; then set it back to `null`:

```sql
update public.workspaces set menu_pages = '["my_tasks","calendar"]' where name = 'General';
-- later:
update public.workspaces set menu_pages = null where name = 'General';
```

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): narrow Quick Menu by the workspace's enabled pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Scope the work pages

**Files:**
- Modify: `src/pages/MyTasks.tsx:110-118`
- Modify: `src/pages/Calendar.tsx:41-44` and `:155-185`
- Modify: `src/pages/Comments.tsx:52`
- Modify: `src/pages/Reports.tsx:69-70`
- Modify: `src/pages/TimelineOverview.tsx:440`
- Modify: `src/pages/Workload.tsx:78`

**Interfaces:**
- Consumes: `filterProjects`, `filterTasks` from `useSelectedWorkspace()` (Task 3).

Pattern for every page: keep the existing hook call, rename its result to `all…`, and derive the scoped value with `useMemo`. `filterProjects`/`filterTasks` are stable callbacks, so they are safe in dependency arrays.

- [ ] **Step 1: MyTasks**

In `src/pages/MyTasks.tsx`, add the import (next to the other hook imports):

```ts
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
```

Replace lines 110-118:

```ts
  const { projects } = useProjects();
  const columnsByProjectId = useMemo(() => {
    const m = new Map<string, KanbanColumn[]>();
    for (const p of projects) {
      m.set(p.projectId, p.columns?.length ? p.columns : DEFAULT_COLUMNS);
    }
    return m;
  }, [projects]);
  const { tasksAssignedToMe, loading, tasks: allTasks, refresh } = useAllTasks();
```

with:

```ts
  const { projects: allProjects } = useProjects();
  const { filterProjects, filterTasks } = useSelectedWorkspace();
  const projects = useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);
  const columnsByProjectId = useMemo(() => {
    const m = new Map<string, KanbanColumn[]>();
    for (const p of projects) {
      m.set(p.projectId, p.columns?.length ? p.columns : DEFAULT_COLUMNS);
    }
    return m;
  }, [projects]);
  const {
    tasksAssignedToMe: allAssignedToMe,
    loading,
    tasks: unscopedTasks,
    refresh,
  } = useAllTasks();
  const tasksAssignedToMe = useMemo(
    () => filterTasks(allAssignedToMe),
    [allAssignedToMe, filterTasks],
  );
  const allTasks = useMemo(() => filterTasks(unscopedTasks), [unscopedTasks, filterTasks]);
```

`allTasks` keeps its old name because the rest of the file already uses it.

- [ ] **Step 2: Calendar**

In `src/pages/Calendar.tsx`, add the import:

```ts
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
```

Replace line 41 `const { projects } = useProjects();` with:

```ts
  const { projects: allProjects } = useProjects();
  const { filterProjects, filterTasks } = useSelectedWorkspace();
  const projects = useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);
```

Replace line 44 `const [tasks, setTasks] = useState<Task[]>([]);` with:

```ts
  const [allTasks, setTasks] = useState<Task[]>([]);
  const tasks = useMemo(() => filterTasks(allTasks), [allTasks, filterTasks]);
```

`setTasks` inside the fetch effect is unchanged. The two later `tasks.filter(...)` usages (around lines 159 and 177) now read the scoped list. If `useMemo` is not yet imported from React in this file, add it to the React import.

- [ ] **Step 3: Comments**

In `src/pages/Comments.tsx`, add the import:

```ts
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
```

Replace line 52 `const { projects } = useProjects();` with:

```ts
  const { projects: allProjects } = useProjects();
  const { filterProjects } = useSelectedWorkspace();
  const projects = useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);
```

`validProjectIds` (line 57) is built from `projects`, so comments narrow automatically.

- [ ] **Step 4: Reports**

In `src/pages/Reports.tsx`, add the import:

```ts
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
```

Replace lines 69-70:

```ts
  const { projects } = useProjects();
  const { tasks, loading } = useAllTasks();
```

with:

```ts
  const { projects: allProjects } = useProjects();
  const { tasks: allTasks, loading } = useAllTasks();
  const { filterProjects, filterTasks } = useSelectedWorkspace();
  const projects = useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);
  const tasks = useMemo(() => filterTasks(allTasks), [allTasks, filterTasks]);
```

Reports already imports `useWorkspaces`; leave that as is.

- [ ] **Step 5: TimelineOverview**

In `src/pages/TimelineOverview.tsx`, add the import:

```ts
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
```

Replace line 440 `const { projects, loading: projectsLoading } = useProjects();` with:

```ts
  const { projects: allProjects, loading: projectsLoading } = useProjects();
  const { filterProjects } = useSelectedWorkspace();
  const projects = useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);
```

- [ ] **Step 6: Workload**

In `src/pages/Workload.tsx`, add the import:

```ts
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
```

Replace line 78 `const { tasks, loading: tasksLoading } = useAllTasks();` with:

```ts
  const { tasks: allTasks, loading: tasksLoading } = useAllTasks();
  const { filterTasks } = useSelectedWorkspace();
  const tasks = useMemo(() => filterTasks(allTasks), [allTasks, filterTasks]);
```

- [ ] **Step 7: Type-check, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean. Common failure: `useMemo` not imported in a page — add it to that file's React import.

- [ ] **Step 8: Manual check**

Run `npm run dev` with two workspaces that each own at least one project with tasks. Select workspace A: My Tasks, Calendar, Reports, Timeline, Workload and Comments show only A's projects and tasks. Select "All workspaces": everything returns. Team, Expenses and Files are unchanged in both states.

- [ ] **Step 9: Commit**

```bash
git add src/pages/MyTasks.tsx src/pages/Calendar.tsx src/pages/Comments.tsx src/pages/Reports.tsx src/pages/TimelineOverview.tsx src/pages/Workload.tsx
git commit -m "feat(workspace): scope work pages to the selected workspace

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Menu toggles in the Edit Workspace dialog

**Files:**
- Modify: `src/pages/kanban/Dashboard.tsx:107` (org context), `:169-170` (state), `:478-486` (`openEditWorkspace`), `:487-500` (`handleEditWorkspace`), `:1594-1634` (dialog JSX)

**Interfaces:**
- Consumes: `QUICK_MENU_PAGE_KEYS`, `menuPagesForSave` (Task 1); `getPageDef` from `@/lib/pageCatalog`; `editWorkspace(id, { name, menuPages })` (Task 2); `Switch` and `Label` (already imported in this file).

- [ ] **Step 1: Imports**

Add after the existing `import { Switch } from '@/components/ui/switch';` (line 86):

```ts
import { getPageDef, type PageKey } from '@/lib/pageCatalog';
import { QUICK_MENU_PAGE_KEYS, menuPagesForSave } from '@/lib/workspaceScope';
```

- [ ] **Step 2: Read the admin flag**

Replace line 107 `const { organization } = useOrganization();` with:

```ts
  const { organization, isAdmin: canEditWorkspaceMenu } = useOrganization();
```

(`isAdmin` in `OrganizationContext` already includes the owner.)

- [ ] **Step 3: Add toggle state**

After line 170 `const [editingWorkspaceName, setEditingWorkspaceName] = useState('');` add:

```ts
  const [editingMenuPages, setEditingMenuPages] = useState<PageKey[]>(QUICK_MENU_PAGE_KEYS);
```

- [ ] **Step 4: Seed the toggles when the dialog opens**

Replace `openEditWorkspace` (lines 478-486) with:

```ts
  const openEditWorkspace = (workspaceId: string) => {
    const w = workspaces.find((x) => x.workspaceId === workspaceId);
    if (w) {
      setEditingWorkspaceId(workspaceId);
      setEditingWorkspaceName(w.name);
      // null = all enabled → every toggle on.
      setEditingMenuPages(w.menuPages ?? QUICK_MENU_PAGE_KEYS);
      setShowEditWorkspaceModal(true);
    }
  };
```

- [ ] **Step 5: Save the toggles**

In `handleEditWorkspace`, replace:

```ts
      await editWorkspace(editingWorkspaceId, { name: editingWorkspaceName.trim() });
```

with:

```ts
      await editWorkspace(editingWorkspaceId, {
        name: editingWorkspaceName.trim(),
        ...(canEditWorkspaceMenu
          ? { menuPages: menuPagesForSave(editingMenuPages) }
          : {}),
      });
```

Non-admins never send `menuPages`, so the column is left untouched for them.

- [ ] **Step 6: Render the toggles**

In the Edit Workspace dialog JSX, directly after the closing `</div>` of the `editWorkspaceName` field block (the one containing `<Label htmlFor="editWorkspaceName">`) and before `<DialogFooter>`, insert:

```tsx
            {canEditWorkspaceMenu && (
              <div className="space-y-2">
                <Label>Menu items in this workspace</Label>
                <p className="text-xs text-muted-foreground">
                  Hidden items disappear from the sidebar for everyone in this
                  workspace. Role permissions still apply on top.
                </p>
                <div className="rounded-md border divide-y">
                  {QUICK_MENU_PAGE_KEYS.map((key) => {
                    const def = getPageDef(key);
                    const on = editingMenuPages.includes(key);
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {def?.label ?? key}
                          </p>
                          {def?.group && (
                            <p className="text-xs text-muted-foreground">{def.group}</p>
                          )}
                        </div>
                        <Switch
                          checked={on}
                          onCheckedChange={(checked) =>
                            setEditingMenuPages((prev) =>
                              checked
                                ? QUICK_MENU_PAGE_KEYS.filter(
                                    (k) => k === key || prev.includes(k),
                                  )
                                : prev.filter((k) => k !== key),
                            )
                          }
                          aria-label={`Show ${def?.label ?? key}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
```

Turning a toggle on rebuilds the list in catalog order, so the saved array is always in a stable order.

- [ ] **Step 7: Type-check, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

- [ ] **Step 8: Manual check**

Run `npm run dev` as an owner. Dashboard → workspace menu (⋯) → Edit workspace. The toggle list shows nine items, all on. Turn Reports off, save, and the sidebar loses Reports while that workspace is selected. Switch to "All workspaces": Reports is back. Turn everything back on and save: the DB column returns to `null` (check with `select name, menu_pages from workspaces;`). Sign in as a member: the section is not rendered.

- [ ] **Step 9: Commit**

```bash
git add src/pages/kanban/Dashboard.tsx
git commit -m "feat(workspace): owner/admin choose Quick Menu items per workspace

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Apply the migration and final verification

**Files:** none new.

- [ ] **Step 1: Apply the migration to the live project**

The repo is linked to Supabase project `cotrbcnouzcjdruiqmly`. Either run:

```bash
supabase db push
```

or paste `supabase/migrations/150_workspace_menu_pages.sql` into the Supabase SQL Editor. Until this runs, the service maps the missing column to `null` and the app behaves exactly as before, so the frontend can ship first.

- [ ] **Step 2: Full verification**

Run: `npm run lint && npm run build && npm test`
Expected: lint clean, build succeeds, all tests pass.

- [ ] **Step 3: Push**

```bash
git push origin main
```

Vercel builds from `main`. Confirm the preview shows the workspace switch narrowing My Tasks and the sidebar.

---

## Self-review

**Spec coverage.** Data scoping for Dashboard (already filters; unchanged), Projects list (Sidebar already filters), My Tasks, Calendar, Comments, Reports, Timeline, Workload → Task 5. Per-workspace menu storage → Task 2. Menu resolution as role ∩ workspace, hide-not-block → Task 4. Owner/admin toggles in the edit dialog, default all-on, `null` when everything is on → Task 6. Context with `projectIds` and `menuPages`, localStorage persistence, All-workspaces unchanged → Task 3. Error handling: deleted workspace falls back to All (Task 3 effect), unknown keys ignored (`normalizeMenuPages`), missing column → `null` (`mapWorkspaceRow`). Tests for the two pure surfaces → Task 1 (plus a mapping test in Task 2). Out-of-scope pages untouched.

**Placeholder scan.** None.

**Type consistency.** `filterProjects` / `filterTasks` / `menuPages` / `projectIds` names match between Task 3's interface and Tasks 4-5. `menuPagesForSave`, `QUICK_MENU_PAGE_KEYS`, `resolveWorkspaceMenu`, `normalizeMenuPages` match between Task 1 and Tasks 2, 4, 6. `editWorkspace` accepts `{ name, menuPages }` per Task 2's `UpdateWorkspaceInput`; the hook `useWorkspaces.editWorkspace` passes the input straight through, so no hook change is needed.
