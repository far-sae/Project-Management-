import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Project, Task, TaskStatus, KanbanColumn } from '@/types';

// Project-aware bits the sidebar wants to render (status filters with task counts,
// per-project column names) only exist while ProjectView is on screen. The
// sidebar itself now lives in a layout route and outlives any single page —
// this context lets ProjectView push that data up and the sidebar read it
// without having to thread props through the layout boundary.
export interface ProjectChrome {
  project: Project | null;
  tasks: Task[];
  selectedStatus: TaskStatus | 'all';
  onStatusChange: ((status: TaskStatus | 'all') => void) | null;
  columns: KanbanColumn[] | undefined;
}

const EMPTY_CHROME: ProjectChrome = {
  project: null,
  tasks: [],
  selectedStatus: 'all',
  onStatusChange: null,
  columns: undefined,
};

interface ProjectChromeContextValue {
  chrome: ProjectChrome;
  setChrome: (next: ProjectChrome | null) => void;
}

const ProjectChromeContext = createContext<ProjectChromeContextValue | null>(null);

export const ProjectChromeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [chrome, setChromeState] = useState<ProjectChrome>(EMPTY_CHROME);

  // Field-equal short-circuit. Critical: ProjectView passes a fresh
  // `{ project, tasks, ... }` object literal every render, so a naive
  // `setChromeState(next)` always triggers a re-render even when nothing
  // really changed. That re-render bumps the context value, which makes
  // every `useContext` consumer (including `usePublishProjectChrome`
  // itself) re-run — and because `ctx` is in that effect's deps, the
  // effect fires and calls setChrome again. Result: infinite render loop,
  // pinned main thread, the page goes unresponsive on slower devices.
  // Comparing by reference per field keeps state identity stable when the
  // payload is semantically unchanged, so the chain stops.
  const setChrome = useCallback((next: ProjectChrome | null) => {
    setChromeState((prev) => {
      const candidate = next ?? EMPTY_CHROME;
      if (
        prev.project === candidate.project &&
        prev.tasks === candidate.tasks &&
        prev.selectedStatus === candidate.selectedStatus &&
        prev.onStatusChange === candidate.onStatusChange &&
        prev.columns === candidate.columns
      ) {
        return prev;
      }
      return candidate;
    });
  }, []);

  const value = useMemo(() => ({ chrome, setChrome }), [chrome, setChrome]);

  return (
    <ProjectChromeContext.Provider value={value}>
      {children}
    </ProjectChromeContext.Provider>
  );
};

export const useProjectChrome = (): ProjectChrome => {
  const ctx = useContext(ProjectChromeContext);
  return ctx?.chrome ?? EMPTY_CHROME;
};

// ProjectView calls this with its current chrome on every render. Two
// separate effects:
//   1. Push the latest chrome on every meaningful field change (project /
//      tasks / filters / columns). Note: `ctx` is intentionally NOT in the
//      deps. The setter is stable across renders (useCallback in the
//      provider) and including `ctx` would re-fire this effect every time
//      the provider's value object updates — which itself happens *because*
//      we just called setChrome — feeding back into an infinite loop. We
//      capture the setter via a ref instead.
//   2. Reset chrome only when ProjectView itself unmounts (route leaves),
//      so navigating away from /project/:id correctly clears the sidebar.
export const usePublishProjectChrome = (chrome: ProjectChrome | null) => {
  const ctx = useContext(ProjectChromeContext);
  const setChromeRef = useRef(ctx?.setChrome);
  setChromeRef.current = ctx?.setChrome;

  useEffect(() => {
    setChromeRef.current?.(chrome);
  }, [
    chrome?.project,
    chrome?.tasks,
    chrome?.selectedStatus,
    chrome?.onStatusChange,
    chrome?.columns,
  ]);

  useEffect(() => {
    return () => {
      setChromeRef.current?.(null);
    };
  }, []);
};
