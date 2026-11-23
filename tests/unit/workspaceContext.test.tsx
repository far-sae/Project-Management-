// tests/unit/workspaceContext.test.tsx
//
// The provider must not wipe the persisted workspace selection while auth or
// the organization are still resolving: on a hard reload `useAuth()` starts as
// `{ user: null, loading: true }`, so `useWorkspaces()` briefly reports an
// empty, non-loading list. The "stored workspace no longer exists" fallback
// may only run once that list is authoritative.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Workspace } from "@/types/workspace";

const STORAGE_KEY = "selectedWorkspaceId";
const ALL_WORKSPACES_ID = "__ALL_WORKSPACES__";

const state = vi.hoisted(() => ({
  auth: { user: null as { userId: string } | null, loading: false },
  org: { loading: false, organization: { organizationId: "o1" } as { organizationId: string } | null },
  ws: {
    workspaces: [] as unknown[],
    loading: false,
    DEFAULT_WORKSPACE_ID: "__default__",
    listOrgId: "o1" as string | null,
    refresh: async () => {},
  },
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => state.auth }));
vi.mock("@/context/OrganizationContext", () => ({ useOrganization: () => state.org }));
vi.mock("@/hooks/useWorkspaces", () => ({ useWorkspaces: () => state.ws }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ projects: [] }) }));

import { WorkspaceProvider, useWorkspaceScope } from "@/context/WorkspaceContext";

const workspace = (workspaceId: string): Workspace =>
  ({
    workspaceId,
    name: workspaceId,
    organizationId: "o1",
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Workspace;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WorkspaceProvider>{children}</WorkspaceProvider>
);

describe("WorkspaceProvider — stored selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    state.auth = { user: null, loading: false };
    state.org = { loading: false, organization: { organizationId: "o1" } };
    state.ws = { workspaces: [], loading: false, DEFAULT_WORKSPACE_ID: "__default__", listOrgId: "o1", refresh: async () => {} };
  });

  it("keeps the stored id while signed out (auth has not restored the session yet)", () => {
    window.localStorage.setItem(STORAGE_KEY, "w1");
    state.auth = { user: null, loading: false };
    state.ws = { workspaces: [], loading: false, DEFAULT_WORKSPACE_ID: "__default__", listOrgId: null, refresh: async () => {} };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe("w1");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("w1");
  });

  it("keeps the stored id once auth/org resolved and the workspace exists", () => {
    window.localStorage.setItem(STORAGE_KEY, "w1");
    state.auth = { user: { userId: "u1" }, loading: false };
    state.org = { loading: false, organization: { organizationId: "o1" } };
    state.ws = {
      workspaces: [workspace("w1")],
      loading: false,
      DEFAULT_WORKSPACE_ID: "__default__",
      listOrgId: "o1",
      refresh: async () => {},
    };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe("w1");
  });

  it("falls back to All workspaces when the stored workspace is really gone", () => {
    window.localStorage.setItem(STORAGE_KEY, "w1");
    state.auth = { user: { userId: "u1" }, loading: false };
    state.org = { loading: false, organization: { organizationId: "o1" } };
    state.ws = {
      workspaces: [workspace("w2")],
      loading: false,
      DEFAULT_WORKSPACE_ID: "__default__",
      listOrgId: "o1",
      refresh: async () => {},
    };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe(ALL_WORKSPACES_ID);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(ALL_WORKSPACES_ID);
  });

  it("keeps the stored id on a reload, while the list is empty only because it has not been read yet", () => {
    // The account is back and nothing says "loading", but no list has arrived for this organisation.
    window.localStorage.setItem(STORAGE_KEY, "w1");
    state.auth = { user: { userId: "u1" }, loading: false };
    state.org = { loading: false, organization: { organizationId: "o1" } };
    state.ws = { workspaces: [], loading: false, DEFAULT_WORKSPACE_ID: "__default__", listOrgId: null, refresh: async () => {} };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe("w1");
    expect(result.current.workspacesKnown).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("w1");
  });

  it("keeps the stored id while the list on hand is another organisation's", () => {
    window.localStorage.setItem(STORAGE_KEY, "w1");
    state.auth = { user: { userId: "u1" }, loading: false };
    state.org = { loading: false, organization: { organizationId: "o1" } };
    state.ws = { workspaces: [workspace("other")], loading: false, DEFAULT_WORKSPACE_ID: "__default__", listOrgId: "o2", refresh: async () => {} };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe("w1");
  });

  it("keeps the stored id while the organisation is not known yet", () => {
    window.localStorage.setItem(STORAGE_KEY, "w1");
    state.auth = { user: { userId: "u1" }, loading: false };
    state.org = { loading: false, organization: null };
    state.ws = { workspaces: [], loading: false, DEFAULT_WORKSPACE_ID: "__default__", listOrgId: "u1", refresh: async () => {} };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe("w1");
  });

  it("knows the list once it was read for this organisation, an empty one too", () => {
    state.auth = { user: { userId: "u1" }, loading: false };
    state.org = { loading: false, organization: { organizationId: "local-o1" } };
    state.ws = { workspaces: [], loading: false, DEFAULT_WORKSPACE_ID: "__default__", listOrgId: "o1", refresh: async () => {} };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.workspacesKnown).toBe(true);
  });

  it("shows every workspace to a browser that still remembers \"Unassigned projects\"", () => {
    window.localStorage.setItem(STORAGE_KEY, "__UNASSIGNED_PROJECTS__");
    state.auth = { user: { userId: "u1" }, loading: false };
    state.ws = { workspaces: [workspace("w1")], loading: false, DEFAULT_WORKSPACE_ID: "__default__", listOrgId: "o1", refresh: async () => {} };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe(ALL_WORKSPACES_ID);
    expect(result.current.isUnassigned).toBe(false);
  });
});
