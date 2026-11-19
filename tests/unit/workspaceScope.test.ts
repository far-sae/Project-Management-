import { describe, it, expect } from "vitest";
import {
  ALL_WORKSPACES_ID,
  UNASSIGNED_WORKSPACE_ID,
  QUICK_MENU_PAGE_KEYS,
  projectsInWorkspace,
  projectIdsForScope,
  tasksInScope,
  notificationsInScope,
  peopleInScope,
  recordIsElsewhere,
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
      "dashboard", "projects_analytics", "my_tasks", "inbox", "crm",
      "calendar", "workload", "reports", "team", "hr",
    ]);
  });
});

describe("notificationsInScope", () => {
  const list = [
    { id: "n1", projectId: "p1" },
    { id: "n2", projectId: "p2" },
    { id: "n3", projectId: undefined },
    { id: "n4", projectId: null },
  ];
  const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

  it("keeps notifications about this workspace's projects", () => {
    expect(ids(notificationsInScope(list, new Set(["p1"])))).toContain("n1");
    expect(ids(notificationsInScope(list, new Set(["p1"])))).not.toContain("n2");
  });
  it("always keeps the ones that are not about a project, like invites and billing", () => {
    expect(ids(notificationsInScope(list, new Set(["p1"])))).toEqual(["n1", "n3", "n4"]);
  });
  it("keeps everything under All workspaces", () => {
    expect(notificationsInScope(list, null)).toHaveLength(4);
  });
});

describe("peopleInScope", () => {
  const withPeople = [
    { projectId: "p1", ownerId: "u1", members: [{ userId: "u2" }, { userId: "u1" }] },
    { projectId: "p2", ownerId: "u3", members: [{ userId: "u4" }] },
    { projectId: "p3", ownerId: "u5" },
  ];
  it("is the owners and members of the projects in the workspace", () => {
    expect([...peopleInScope(withPeople, new Set(["p1", "p3"]))!].sort()).toEqual(["u1", "u2", "u5"]);
  });
  it("is everyone under All workspaces", () => {
    expect(peopleInScope(withPeople, null)).toBeNull();
  });
});

describe("recordIsElsewhere", () => {
  it("is true when a record belongs to another workspace than the one selected", () => {
    expect(recordIsElsewhere("w2", "w1")).toBe(true);
  });
  it("is false for the same workspace, a record with no workspace, or no real selection", () => {
    expect(recordIsElsewhere("w1", "w1")).toBe(false);
    expect(recordIsElsewhere(null, "w1")).toBe(false);
    expect(recordIsElsewhere("w2", ALL_WORKSPACES_ID)).toBe(false);
    expect(recordIsElsewhere("w2", UNASSIGNED_WORKSPACE_ID)).toBe(false);
  });
});
