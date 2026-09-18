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
  const { user, loading: authLoading } = useAuth();
  const { loading: orgLoading } = useOrganization();
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
  // Only once the list is authoritative: on a reload AuthContext starts with
  // `user === null` and OrganizationContext hasn't resolved the org yet, so
  // useWorkspaces reports an empty, non-loading list — resetting on that would
  // wipe the persisted selection on every reload and on every public route.
  useEffect(() => {
    if (!user || authLoading || orgLoading || loading) return;
    if (id === ALL_WORKSPACES_ID || id === UNASSIGNED_WORKSPACE_ID) return;
    const exists = workspaces.some((w) => w.workspaceId === id);
    if (!exists) {
      setId(ALL_WORKSPACES_ID);
      writeStored(ALL_WORKSPACES_ID);
    }
  }, [workspaces, loading, id, user, authLoading, orgLoading]);

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
