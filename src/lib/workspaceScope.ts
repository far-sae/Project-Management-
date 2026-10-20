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
  "email",
  "social",
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
