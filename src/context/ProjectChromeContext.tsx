import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  const setChrome = useCallback((next: ProjectChrome | null) => {
    setChromeState(next ?? EMPTY_CHROME);
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
//   1. Push the latest chrome on every meaningful change (project / tasks /
//      filters / columns). Critically, this does NOT clear chrome on
//      cleanup — that previously caused a visible flash on every tasks
//      update, where the sidebar saw `null` chrome between cleanup and the
//      next effect run.
//   2. Reset chrome only when ProjectView itself unmounts (route leaves),
//      so navigating away from /project/:id correctly clears the sidebar.
export const usePublishProjectChrome = (chrome: ProjectChrome | null) => {
  const ctx = useContext(ProjectChromeContext);

  useEffect(() => {
    if (!ctx) return;
    ctx.setChrome(chrome);
  }, [
    ctx,
    chrome?.project,
    chrome?.tasks,
    chrome?.selectedStatus,
    chrome?.onStatusChange,
    chrome?.columns,
  ]);

  useEffect(() => {
    if (!ctx) return;
    return () => {
      ctx.setChrome(null);
    };
  }, [ctx]);
};
