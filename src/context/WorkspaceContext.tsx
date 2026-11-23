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
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import type { Workspace } from "@/types/workspace";
import type { PageKey } from "@/lib/pageCatalog";
import { isPlaceholderWorkspaceName } from "@/lib/workspaceDisplay";
import {
  ALL_WORKSPACES_ID,
  UNASSIGNED_WORKSPACE_ID,
  normalizeMenuPages,
  projectIdsForScope,
  projectsInWorkspace,
  tasksInScope,
} from "@/lib/workspaceScope";

const STORAGE_KEY = "selectedWorkspaceId";
/** The last real workspace that was chosen, kept also while "All workspaces" is chosen. */
const LAST_KEY = "selectedWorkspaceId.last";
const EVENT_NAME = "app:selected-workspace-changed";

/**
 * "Unassigned projects" used to be a choice. It is not any more: a browser
 * that still remembers it shows every workspace instead.
 */
const withoutUnassigned = (id: string | null): string | null =>
  id === UNASSIGNED_WORKSPACE_ID ? ALL_WORKSPACES_ID : id;

const readStored = (): string | null => {
  try {
    return withoutUnassigned(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
};

const writeStored = (id: string): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
    if (id !== ALL_WORKSPACES_ID) window.localStorage.setItem(LAST_KEY, id);
  } catch {
    /* ignore */
  }
};

const readLast = (): string | null => {
  try {
    return window.localStorage.getItem(LAST_KEY);
  } catch {
    return null;
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
  /** Always false: "Unassigned projects" is no longer a choice. Kept so older callers still read a value. */
  isUnassigned: boolean;
  /**
   * True once `workspaces` is the real list of the signed-in person's
   * organisation. False while signing in, during a reload, or while the
   * organisation is still being worked out: an empty list then means nothing.
   */
  workspacesKnown: boolean;
  /** Read the list again now (after making or renaming a workspace). */
  refreshWorkspaces: () => Promise<void>;
  /**
   * For a page that needs one workspace (Email, Social) while "All workspaces"
   * is chosen: the chosen one when there is one, else the one used last, else
   * one the person named themselves, else the only one there is. Never simply
   * the oldest, which is the ready-made "General". Null while the list is not
   * known, so no page picks from a half-read list.
   */
  preferredWorkspaceId: string | null;
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
  const { workspaces, loading, DEFAULT_WORKSPACE_ID, listOrgId, refresh } = useWorkspaces();
  const { projects } = useProjects();
  const { user, loading: authLoading } = useAuth();
  const { loading: orgLoading, organization } = useOrganization();
  const [id, setId] = useState<string>(() => readStored() || ALL_WORKSPACES_ID);

  // The list can be trusted only when it was read for the organisation the
  // person is in now. Everything that acts on "this workspace is not in the
  // list" waits for that, so a reload never throws the chosen workspace away.
  const organizationId = organization?.organizationId?.replace("local-", "") ?? null;
  const workspacesKnown =
    Boolean(user) && !authLoading && !orgLoading && !loading &&
    organizationId !== null && listOrgId === organizationId;

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
  // Only once the list is the real one for this organisation. On a reload the
  // account and the organisation arrive one after the other, and in between
  // the list is empty, or still being read, without saying so: acting on that
  // threw the chosen workspace away on every reload.
  useEffect(() => {
    if (!workspacesKnown) return;
    if (id === ALL_WORKSPACES_ID) return;
    const exists = workspaces.some((w) => w.workspaceId === id);
    if (!exists) {
      setId(ALL_WORKSPACES_ID);
      writeStored(ALL_WORKSPACES_ID);
    }
  }, [workspaces, workspacesKnown, id]);

  const refreshWorkspaces = useCallback(() => refresh({ silent: true }), [refresh]);

  const select = useCallback((asked: string) => {
    const newId = withoutUnassigned(asked) ?? ALL_WORKSPACES_ID;
    setId(newId);
    writeStored(newId);
    try {
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {
      /* ignore */
    }
  }, []);

  const selected = useMemo<Workspace | null>(() => {
    if (id === ALL_WORKSPACES_ID) return null;
    return workspaces.find((w) => w.workspaceId === id) || null;
  }, [workspaces, id]);

  const preferredWorkspaceId = useMemo<string | null>(() => {
    if (!workspacesKnown || workspaces.length === 0) return null;
    const has = (wanted: string | null) => Boolean(wanted) && workspaces.some((w) => w.workspaceId === wanted);
    if (has(id)) return id;
    const last = readLast();
    if (has(last)) return last;
    return (workspaces.find((w) => !isPlaceholderWorkspaceName(w.name)) ?? workspaces[0]).workspaceId;
    // `id` is read on purpose: choosing a workspace changes what was used last.
  }, [workspaces, workspacesKnown, id]);

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
      isUnassigned: false,
      workspacesKnown,
      refreshWorkspaces,
      preferredWorkspaceId,
      projectIds,
      menuPages,
      filterProjects,
      filterTasks,
    }),
    [
      workspaces, loading, id, selected, select, DEFAULT_WORKSPACE_ID,
      workspacesKnown, refreshWorkspaces, preferredWorkspaceId,
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
