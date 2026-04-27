import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaces } from "./useWorkspaces";
import type { Workspace } from "@/types/workspace";

const STORAGE_KEY = "selectedWorkspaceId";
const EVENT_NAME = "app:selected-workspace-changed";
export const ALL_WORKSPACES_ID = "__ALL_WORKSPACES__";

const readStored = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * Cross-component selected-workspace state, kept in sync via localStorage and
 * a same-tab custom event. The value is preserved across reloads and between
 * the sidebar, dashboard, and workspaces modal.
 */
export const useSelectedWorkspace = () => {
  const { workspaces, loading, DEFAULT_WORKSPACE_ID } = useWorkspaces();
  const [id, setId] = useState<string>(
    () => readStored() || ALL_WORKSPACES_ID,
  );

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

  // If the stored workspace is no longer visible (deleted, switched org), show all workspaces.
  useEffect(() => {
    if (loading) return;
    if (id === ALL_WORKSPACES_ID) return;
    const exists = workspaces.some((w) => w.workspaceId === id);
    if (!exists) {
      setId(ALL_WORKSPACES_ID);
      try {
        window.localStorage.setItem(STORAGE_KEY, ALL_WORKSPACES_ID);
      } catch {
        /* ignore */
      }
    }
  }, [workspaces, loading, id]);

  const select = useCallback((newId: string) => {
    setId(newId);
    try {
      window.localStorage.setItem(STORAGE_KEY, newId);
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {
      /* ignore */
    }
  }, []);

  const selected: Workspace | null = useMemo(() => {
    if (id === ALL_WORKSPACES_ID) return null;
    return workspaces.find((w) => w.workspaceId === id) || null;
  }, [workspaces, id]);

  return {
    workspaces,
    loading,
    selectedId: id,
    selected,
    select,
    DEFAULT_WORKSPACE_ID,
    isAll: id === ALL_WORKSPACES_ID,
  };
};

export default useSelectedWorkspace;
