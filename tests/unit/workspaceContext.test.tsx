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
  org: { loading: false },
  ws: {
    workspaces: [] as unknown[],
    loading: false,
    DEFAULT_WORKSPACE_ID: "__default__",
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
    state.org = { loading: false };
    state.ws = { workspaces: [], loading: false, DEFAULT_WORKSPACE_ID: "__default__" };
  });

  it("keeps the stored id while signed out (auth has not restored the session yet)", () => {
    window.localStorage.setItem(STORAGE_KEY, "w1");
    state.auth = { user: null, loading: false };
    state.ws = { workspaces: [], loading: false, DEFAULT_WORKSPACE_ID: "__default__" };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe("w1");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("w1");
  });

  it("keeps the stored id once auth/org resolved and the workspace exists", () => {
    window.localStorage.setItem(STORAGE_KEY, "w1");
    state.auth = { user: { userId: "u1" }, loading: false };
    state.org = { loading: false };
    state.ws = {
      workspaces: [workspace("w1")],
      loading: false,
      DEFAULT_WORKSPACE_ID: "__default__",
    };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe("w1");
  });

  it("falls back to All workspaces when the stored workspace is really gone", () => {
    window.localStorage.setItem(STORAGE_KEY, "w1");
    state.auth = { user: { userId: "u1" }, loading: false };
    state.org = { loading: false };
    state.ws = {
      workspaces: [workspace("w2")],
      loading: false,
      DEFAULT_WORKSPACE_ID: "__default__",
    };

    const { result } = renderHook(() => useWorkspaceScope(), { wrapper });

    expect(result.current.selectedId).toBe(ALL_WORKSPACES_ID);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(ALL_WORKSPACES_ID);
  });
});
