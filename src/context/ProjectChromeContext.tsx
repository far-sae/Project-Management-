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

// ProjectView calls this with its current chrome on every render. The effect
// publishes to context and the cleanup clears it when the page unmounts, so
// other routes never see a stale project header / status filters.
export const usePublishProjectChrome = (chrome: ProjectChrome | null) => {
  const ctx = useContext(ProjectChromeContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setChrome(chrome);
    return () => ctx.setChrome(null);
  }, [
    ctx,
    chrome?.project,
    chrome?.tasks,
    chrome?.selectedStatus,
    chrome?.onStatusChange,
    chrome?.columns,
  ]);
};
