import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Filter, LayoutGrid, List, Loader2, Settings, GanttChartSquare, ArrowUpDown, Check, CheckCircle2, Download, KeyRound, Lock, Network, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { useAuth } from '@/context/AuthContext';
import { useTasks } from '@/hooks/useTasks';
import { useDragToScroll } from '@/hooks/useDragToScroll';
import { getProject, updateProject, verifyProjectLockPin } from '@/services/supabase/database';
import { supabase } from '@/services/supabase';
import { Project, Task, TaskStatus } from '@/types';
import { DEFAULT_COLUMNS } from '@/types/task';
import type { KanbanColumn } from '@/types';

import { usePublishProjectChrome } from '@/context/ProjectChromeContext';
import { KanbanBoard, TaskSortOption } from '@/components/kanban/KanbanBoard';
import { TrialBanner } from '@/components/subscription/TrialBanner';
import { AppHeader } from '@/components/layout/AppHeader';
import { AIProjectHealth } from '@/components/ai/AIProjectHealth';
import { ProjectRightRail } from '@/components/project/ProjectRightRail';
import { ClockButton } from '@/components/time/ClockButton';
import { useOrganization } from '@/context/OrganizationContext';
import { PresenceAvatars } from '@/components/presence/PresenceAvatars';
import { PresenceStatusAvatarMenu } from '@/components/presence/PresenceStatusMenu';
import { usePresence } from '@/hooks/usePresence';
import { usePresenceStatusPreference } from '@/hooks/usePresenceStatusPreference';
import {
  ALL_WORKSPACES_ID,
  UNASSIGNED_WORKSPACE_ID,
  useSelectedWorkspace,
} from '@/hooks/useSelectedWorkspace';
import { SavedViewsMenu } from '@/components/views/SavedViewsMenu';
import { tasksToCsv, downloadCsv } from '@/services/csv/tasksCsv';
import type { SavedView } from '@/types/savedView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  isProjectLockUnlockedInSession,
  setProjectLockUnlockedInSession,
  clearProjectLockUnlockedInSession,
} from '@/lib/projectLockPin';
import { cn } from '@/lib/utils';
import { StatusPill } from '@/components/common/StatusPill';
import { ProjectDealChip } from '@/components/crmHub/ProjectDealChip';
import { PriorityPill, UrgentBadge } from '@/components/common/TaskBadges';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import LimitReachedModal from '@/components/ui/LimitReachedModal';
import { ProjectMindMap } from '@/components/mindmap/ProjectMindMap';
import { DoneTasksView } from '@/components/kanban/DoneTasksView';
import { isCompletedTaskStatus } from '@/lib/kanbanTaskColumn';

// ── Timeline view constants ────────────────────────────────
const DAYS_WIDTH = 40;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface TimelineViewProps {
  tasks: Task[];
  searchQuery: string;
  selectedStatus: TaskStatus | 'all';
  navigate: (path: string) => void;
}

const TimelineView: React.FC<TimelineViewProps> = ({
  tasks,
  searchQuery,
  selectedStatus,
  navigate,
}) => {
  const filtered = tasks
    .filter((t) => selectedStatus === 'all' || t.status === selectedStatus)
    .filter((t) =>
      searchQuery.trim()
        ? t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
        : true
    )
    .filter((t) => t.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = filtered.length > 0
    ? new Date(filtered[0].dueDate!)
    : new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const endDate = filtered.length > 0
    ? new Date(filtered[filtered.length - 1].dueDate!)
    : new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  startDate.setDate(1);
  endDate.setMonth(endDate.getMonth() + 2);

  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  const todayOffset = Math.ceil((today.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

  const getTaskPosition = (dueDate: Date) => {
    const dayOffset = Math.ceil((dueDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    return Math.max(0, Math.min(dayOffset, totalDays)) * DAYS_WIDTH;
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="min-w-[600px]">
        <div className="flex border-b border-border">
          <div className="w-64 shrink-0 p-3 font-medium text-foreground border-r border-border">
            Task
          </div>
          <div className="flex-1 relative" style={{ minWidth: totalDays * DAYS_WIDTH }}>
            {Array.from({ length: Math.ceil(totalDays / 7) }, (_, i) => {
              const d = new Date(startDate);
              d.setDate(d.getDate() + i * 7);
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-r border-border/60 text-xs text-muted-foreground px-1 py-2"
                  style={{ left: i * 7 * DAYS_WIDTH, width: 7 * DAYS_WIDTH }}
                >
                  {MONTHS[d.getMonth()]} {d.getFullYear()}
                </div>
              );
            })}

            {todayOffset >= 0 && todayOffset < totalDays && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary z-10"
                style={{ left: todayOffset * DAYS_WIDTH }}
              />
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p>No tasks with due dates. Add due dates to tasks to see them on the timeline.</p>
          </div>
        ) : (
          filtered.map((task) => {
            const dueDate = new Date(task.dueDate!);
            const left = getTaskPosition(dueDate);

            return (
              <div
                key={task.taskId}
                className="flex cursor-pointer items-center border-b border-border/60 hover:bg-surface-2"
                onClick={() => navigate(`/project/${task.projectId}`)}
              >
                <div className="w-64 shrink-0 p-3 border-r border-border">
                  <p className="font-medium truncate text-foreground">{task.title}</p>
                  <p className="text-xs text-muted-foreground capitalize">{task.status}</p>
                </div>
                <div className="flex-1 relative h-12" style={{ minWidth: totalDays * DAYS_WIDTH }}>
                  <div
                    className="absolute h-6 top-1/2 -translate-y-1/2 rounded px-2 flex items-center text-xs font-medium truncate"
                    style={{
                      left: `${left}px`,
                      width: '120px',
                      backgroundColor:
                        task.status === 'done'
                          ? 'hsl(var(--success))'
                          : task.status === 'inprogress'
                            ? 'hsl(var(--info))'
                            : 'hsl(var(--primary))',
                      color: 'white',
                    }}
                  >
                    {dueDate.toLocaleDateString()}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/** Underlined view tab in the project header (Board / List / Timeline …). */
const viewTabClass = (active: boolean) =>
  cn(
    'inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    active
      ? 'border-foreground text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground',
  );

export const ProjectView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string; }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isViewer } = useOrganization();
  const { selectedId: selectedWorkspaceId, isAll, isUnassigned } =
    useSelectedWorkspace();
  const { preference: presencePreference, setPreference: setPresencePreference } =
    usePresenceStatusPreference();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkTaskId = searchParams.get('taskId');
  const dueDayParam = searchParams.get('dueDay');
  const handleOpenedTask = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('taskId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const [project, setProject] = useState<Project | null>(null);
  /**
   * Only shown on the very first load (or when the project id changes). Subsequent re-fetches
   * — e.g. when the tab regains focus and the organization context refreshes — must NOT flip
   * this back to true, otherwise the entire `<KanbanBoard>` (and any open task modal) unmounts
   * and the user loses their place mid-edit.
   */
  const [loading, setLoading] = useState(true);
  /** True until the project has been successfully fetched once for this projectId. */
  const initialFetchDoneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  /** Blurred when opening a task modal so keystrokes (PIN) do not go into the header search. */
  const boardTaskSearchRef = useRef<HTMLInputElement>(null);
  /** Snapshots searchQuery while a task modal is open. Restored on close so any keystrokes that
   *  leaked into the still-mounted search input (e.g., PIN typed before the dialog grabbed
   *  focus) get cleaned up automatically. */
  const searchQuerySnapshotRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'timeline' | 'mindmap' | 'done'>('kanban');
  /** Bumped by the header's "New task" button; the board opens its editor. */
  const [addTaskRequest, setAddTaskRequest] = useState(0);
  // Click-and-drag on empty board space slides the board (touchpad-friendly).
  const boardScrollRef = useDragToScroll<HTMLDivElement>();
  const [sortOption, setSortOption] = useState<TaskSortOption>(() => {
    try {
      return (window.localStorage.getItem('project_sort_v1') as TaskSortOption) || 'manual';
    } catch {
      return 'manual';
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('project_sort_v1', sortOption);
    } catch {
      /* ignore */
    }
  }, [sortOption]);
  const [showTrialBanner, setShowTrialBanner] = useState(true);
  const [rightRailOpen, setRightRailOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('project_right_rail_open') !== '0';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'project_right_rail_open',
        rightRailOpen ? '1' : '0',
      );
    } catch {
      /* ignore */
    }
  }, [rightRailOpen]);

  const [projectUnlockNonce, setProjectUnlockNonce] = useState(0);
  const [projectPin, setProjectPin] = useState('');
  const [projectPinError, setProjectPinError] = useState(false);

  /** Everyone (including the project owner) must enter the PIN for this session. */
  const needsProjectLockGate = useMemo(
    () =>
      Boolean(
        project &&
          user &&
          project.isLocked &&
          project.hasLockPin &&
          !isProjectLockUnlockedInSession(
            project.projectId,
            project.lockPinVersion ?? 0,
          ),
      ),
    [project, user, projectUnlockNonce],
  );

  useEffect(() => {
    setProjectPin('');
    setProjectPinError(false);
  }, [projectId, project?.lockPinVersion]);

  const handleProjectUnlock = useCallback(async () => {
    if (!project?.hasLockPin || !projectId) return;
    try {
      const ok = await verifyProjectLockPin(projectId, projectPin);
      if (ok) {
        setProjectLockUnlockedInSession(projectId, project.lockPinVersion ?? 0);
        setProjectPin('');
        setProjectPinError(false);
        setProjectUnlockNonce((n) => n + 1);
        toast.success('Project unlocked for this session');
      } else {
        setProjectPinError(true);
        toast.error('Incorrect PIN');
      }
    } catch (err) {
      setProjectPinError(true);
      const detail = err instanceof Error ? err.message : '';
      toast.error(
        detail
          ? `Could not verify your PIN. ${detail}`
          : 'Could not verify your PIN. Check your connection and try again.',
      );
    }
  }, [project, projectId, projectPin]);

  /** Leaving the project view (or switching projects) ends the session unlock. Avoid depending on `project` identity so refetches do not clear the session. */
  useEffect(() => {
    if (!projectId || !project || project.projectId !== projectId) {
      return;
    }
    const v = project.lockPinVersion ?? 0;
    return () => {
      clearProjectLockUnlockedInSession(projectId, v);
    };
  }, [projectId, project?.lockPinVersion]);

  const { peers, broadcastTyping, typingPeers } = usePresence({
    channelKey: project && !needsProjectLockGate ? projectId ?? null : null,
    currentTaskId: activeTaskId,
    presencePreference,
  });
  const presenceByUserId = useMemo(
    () => new Map(peers.map((p) => [p.userId, p])),
    [peers],
  );
  const peerAvatarsOthers = useMemo(
    () => (user?.userId ? peers.filter((p) => p.userId !== user.userId) : peers),
    [peers, user?.userId],
  );

  /** Chat dock only on the main Kanban board — not list/timeline/mind map or due-day deep links. */
  const showProjectChatRail = viewMode === 'kanban' && !dueDayParam;

  // If user switches sidebar workspace to one that does not contain this project,
  // the board would look "unchanged" while the filter updates — redirect to dashboard.
  useEffect(() => {
    if (!project || isAll || selectedWorkspaceId === ALL_WORKSPACES_ID) {
      return;
    }
    if (isUnassigned || selectedWorkspaceId === UNASSIGNED_WORKSPACE_ID) {
      if (project.workspaceId) {
        toast.info(
          'This project is assigned to a workspace. Opening the dashboard.',
        );
        navigate('/dashboard');
      }
      return;
    }

    // Unassigned projects stay open in any workspace view (sidebar lists them everywhere).
    if (!project.workspaceId) {
      return;
    }

    if (project.workspaceId !== selectedWorkspaceId) {
      toast.info('Switched workspace — this project belongs elsewhere. Opening the dashboard.');
      navigate('/dashboard');
    }
  }, [
    project,
    project?.workspaceId,
    selectedWorkspaceId,
    isAll,
    isUnassigned,
    navigate,
  ]);

  const {
    tasks,
    loading: tasksLoading,
    addTask,
    editTask,
    removeTask,
    refreshTasks,
    limitModal,
    closeLimitModal,
  } = useTasks(
    project && !needsProjectLockGate ? projectId ?? null : null,
    project?.organizationId || null,
  );

  const boardTasks = useMemo(() => {
    if (!dueDayParam) return tasks;
    return tasks.filter((t) => {
      if (!t.dueDate) return false;
      return format(new Date(t.dueDate), 'yyyy-MM-dd') === dueDayParam;
    });
  }, [tasks, dueDayParam]);

  const clearDueDayFilter = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('dueDay');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const boardColumns = useMemo(
    () =>
      project?.columns && project.columns.length > 0
        ? project.columns
        : DEFAULT_COLUMNS,
    [project?.columns]
  );

  const doneCount = useMemo(
    () => tasks.filter((t) => !t.parentTaskId && isCompletedTaskStatus(t.status, boardColumns)).length,
    [tasks, boardColumns],
  );

  /** Open a task in the board's task window (used by Mind map and Done). */
  const openTaskOnBoard = useCallback(
    (taskId: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('taskId', taskId);
        return next;
      }, { replace: true });
      setViewMode('kanban');
    },
    [setSearchParams],
  );

  /** Open a task's window without leaving the current tab (Done). */
  const openTaskInPlace = useCallback(
    (taskId: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('taskId', taskId);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const handleReopenTask = useCallback(
    async (task: Task, columnId: string) => {
      const ok = await editTask(task.taskId, { status: columnId });
      const title = boardColumns.find((c) => c.id === columnId)?.title ?? 'the board';
      if (ok) toast.success(`Reopened — moved to ${title}`);
      else toast.error("Couldn't reopen the task");
    },
    [editTask, boardColumns],
  );

  const handleColumnsChange = useCallback(
    async (next: KanbanColumn[]) => {
      if (!project) return;
      try {
        await updateProject(project.projectId, { columns: next }, project.organizationId);
        setProject((prev) => (prev ? { ...prev, columns: next } : null));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to update columns');
      }
    },
    [project]
  );

  const handleExportCsv = useCallback(() => {
    if (!project) return;
    const csv = tasksToCsv(tasks);
    const safeName = project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    downloadCsv(`${safeName || 'tasks'}.csv`, csv);
    toast.success(`Exported ${tasks.length} task${tasks.length === 1 ? '' : 's'}`);
  }, [project, tasks]);

  const applySavedView = useCallback((view: SavedView) => {
    setSearchQuery(view.filters.searchQuery ?? '');
    setSelectedStatus(
      (view.filters.status as TaskStatus | 'all') ?? 'all',
    );
    if (view.sort.by) setSortOption(view.sort.by);
    toast.success(`Applied "${view.name}"`);
  }, []);

  // Publish project chrome (status filters + per-project columns + task counts)
  // up to the layout-mounted sidebar. While locked we publish project=null so
  // the sidebar shows its no-project view rather than leaking task counts.
  const sidebarProject = needsProjectLockGate ? null : project;
  const sidebarTasks = needsProjectLockGate ? [] : tasks;
  usePublishProjectChrome({
    project: sidebarProject,
    tasks: sidebarTasks,
    selectedStatus,
    onStatusChange: setSelectedStatus,
    columns: boardColumns,
  });

  // Reset the "first load" guard when the projectId changes — moving between projects should
  // show the full-page loader for the new project.
  useEffect(() => {
    initialFetchDoneRef.current = false;
    setLoading(true);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    const fetchProject = async () => {
      if (!projectId || !user) {
        setLoading(false);
        return;
      }

      const isInitial = !initialFetchDoneRef.current;
      try {
        // Only the very first fetch toggles the page-level loader. Subsequent fetches (tab
        // regains focus, user/org context refreshes) refetch silently so the open task modal
        // and current view state survive.
        if (isInitial) setLoading(true);

        const effectiveOrgId = (user.organizationId || user.userId || '').replace('local-', '');
        let projectData: Project | null = null;

        // Keep retries short so load doesn't feel stuck for 10s+
        const maxAttempts = 6;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          projectData = await getProject(projectId, effectiveOrgId, user.userId, user.email);
          if (projectData) break;
          if (attempt < maxAttempts - 1) {
            const delayMs = Math.min(250 * (attempt + 1), 700);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }

        if (cancelled) return;

        if (projectData) {
          // const isOwner = projectData.ownerId === user.userId;
          // const isMember = (projectData.members || []).some(
          //   (m: any) => m.userId === user.userId
          // );

          // if (!isOwner && !isMember) {
          //   const msg = 'You do not have access to this project';
          //   setError(msg);
          //   toast.error(msg);
          //   setTimeout(() => navigate('/dashboard'), 2000);
          //   return;
          // }

          setProject(projectData);
          setError(null);
          initialFetchDoneRef.current = true;
        } else if (isInitial) {
          const message =
            'This project could not be loaded yet. Redirecting to your dashboard…';
          setError(message);
          toast.error(message);
          setTimeout(() => navigate('/dashboard'), 2000);
        }
      } catch (err) {
        if (cancelled) return;
        if (!isInitial) {
          // Silent background refetch failed — keep the existing project rendered and just log.
          console.warn('ProjectView: silent refetch failed:', err);
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load project';
        setError(message);
        toast.error(message);
        setTimeout(() => navigate('/dashboard'), 2000);
      } finally {
        if (!cancelled && isInitial) setLoading(false);
      }
    };

    fetchProject();
    return () => {
      cancelled = true;
    };
  }, [projectId, user?.userId, user?.organizationId, navigate]);

  // Refetch project when it's updated (e.g. member removed from Team page)
  useEffect(() => {
    if (!projectId || !user) return;
    let cancelled = false;
    const effectiveOrgId = (user.organizationId || user.userId || '').replace('local-', '');
    const refetch = async () => {
      try {
        const projectData = await getProject(projectId, effectiveOrgId, user.userId, user.email);
        if (!cancelled && projectData) setProject(projectData);
      } catch (err) {
        if (!cancelled) {
          console.error('ProjectView: project refetch failed:', err);
        }
      }
    };
    const channel = supabase
      .channel(`project-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `project_id=eq.${projectId}` },
        refetch
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [projectId, user?.userId, user?.organizationId, user?.email]);

  if (loading) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive font-medium">{error}</p>
          <p className="text-muted-foreground mt-2">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  if (needsProjectLockGate) {
    return (
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center p-6">
        <Lock className="w-12 h-12 text-muted-foreground mb-4" aria-hidden />
        <h1 className="text-xl font-semibold text-foreground text-center">This project is locked</h1>
        <p className="text-sm text-muted-foreground text-center max-w-md mt-2">
          Enter the project PIN to open the board, tasks, and chat. Everyone with access—including the
          owner—needs the PIN each session. Only the owner can set or change this PIN in project
          settings.
        </p>
        <Input
          type="password"
          name="project-unlock-pin"
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          placeholder="PIN"
          value={projectPin}
          onChange={(e) => {
            setProjectPin(e.target.value);
            setProjectPinError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleProjectUnlock();
          }}
          className={cn('mt-6 max-w-xs bg-background', projectPinError && 'border-destructive')}
        />
        <div className="flex flex-wrap gap-2 mt-4 justify-center">
          <Button type="button" onClick={() => void handleProjectUnlock()} className="gap-2">
            <KeyRound className="w-4 h-4" />
            Unlock
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/dashboard')}>
            Back to projects
          </Button>
        </div>
      </div>
    );
  }

  // One board config for the Kanban view and for the Done tab, which uses
  // it only to open the task window (hideBoard).
  const renderKanbanBoard = (hideBoard: boolean) => (
    <KanbanBoard
      hideBoard={hideBoard}
      addTaskRequest={addTaskRequest}
      projectId={project.projectId}
      project={project}
      projectName={project.name}
      columns={boardColumns}
      onColumnsChange={handleColumnsChange}
      filterStatus={selectedStatus}
      searchQuery={searchQuery}
      sort={sortOption}
      openTaskId={deepLinkTaskId}
      onOpenedTask={handleOpenedTask}
      tasks={tasks}
      loading={tasksLoading}
      addTask={addTask}
      editTask={editTask}
      removeTask={removeTask}
      presencePeers={peers}
      onActiveTaskChange={setActiveTaskId}
      broadcastTyping={broadcastTyping}
      typingPeers={typingPeers}
      onTasksRefresh={refreshTasks}
      onRequestManualSort={() => {
        setSortOption('manual');
        toast('Switched to manual order so drag-and-drop stays put.');
      }}
      onBeforeOpenTaskModal={() => {
        searchQuerySnapshotRef.current = searchQuery;
        boardTaskSearchRef.current?.blur();
      }}
      onAfterCloseTaskModal={() => {
        if (searchQuerySnapshotRef.current !== null) {
          setSearchQuery(searchQuerySnapshotRef.current);
          searchQuerySnapshotRef.current = null;
        }
      }}
    />
  );

  return (
    <>
      <main className="h-full min-h-0 flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
        {showTrialBanner && (
          <TrialBanner variant="full" onDismiss={() => setShowTrialBanner(false)} />
        )}

        <AppHeader
          left={
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="flex-nowrap">
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/dashboard">Projects</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ background: project.coverColor || 'hsl(var(--primary))' }}
                  />
                  <BreadcrumbPage
                    className="max-w-[14rem] truncate font-semibold sm:max-w-[22rem]"
                    title={project.description || project.name}
                  >
                    <h1 className="inline">{project.name}</h1>
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
          right={
            <div className="flex items-center gap-2 flex-shrink-0">
              <ProjectDealChip projectId={project.projectId} />
              <PresenceStatusAvatarMenu
                preference={presencePreference}
                onChange={setPresencePreference}
              />
              {peerAvatarsOthers.length > 0 ? (
                <PresenceAvatars peers={peerAvatarsOthers} className="mr-0" />
              ) : null}
            </div>
          }
        />

        {dueDayParam && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm lg:px-6">
            <p className="text-muted-foreground">
              Showing tasks due{' '}
              <span className="font-medium text-foreground">{dueDayParam}</span>
            </p>
            <Button variant="outline" size="sm" onClick={clearDueDayFilter}>
              Clear filter
            </Button>
          </div>
        )}

        <div className="border-b border-border bg-background px-4 lg:px-6">
          <div className="flex flex-col">
            <div className="flex flex-wrap items-end justify-between gap-x-4">
            <div
              className="-mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto"
              role="group"
              aria-label="Project views"
            >
              <button
                type="button"
                className={viewTabClass(viewMode === 'kanban')}
                onClick={() => setViewMode('kanban')}
                title="Kanban"
                aria-pressed={viewMode === 'kanban'}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden />
                Board
              </button>
              <button
                type="button"
                className={viewTabClass(viewMode === 'list')}
                onClick={() => setViewMode('list')}
                title="List"
                aria-pressed={viewMode === 'list'}
              >
                <List className="h-4 w-4" aria-hidden />
                List
              </button>
              <button
                type="button"
                className={viewTabClass(viewMode === 'timeline')}
                onClick={() => setViewMode('timeline')}
                title="Timeline"
                aria-pressed={viewMode === 'timeline'}
              >
                <GanttChartSquare className="h-4 w-4" aria-hidden />
                Timeline
              </button>
              <button
                type="button"
                className={viewTabClass(viewMode === 'mindmap')}
                onClick={() => setViewMode('mindmap')}
                title="Mind map"
                aria-pressed={viewMode === 'mindmap'}
              >
                <Network className="h-4 w-4" aria-hidden />
                Mind map
              </button>
              <button
                type="button"
                className={viewTabClass(viewMode === 'done')}
                onClick={() => setViewMode('done')}
                title="Done tasks"
                aria-pressed={viewMode === 'done'}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Done
                {doneCount > 0 && (
                  <span className="tabular-nums font-normal text-muted-foreground">
                    {doneCount}
                  </span>
                )}
              </button>
            </div>

            <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-2">
              {!isViewer && (
                <ClockButton
                  projectId={project.projectId}
                  projectName={project.name}
                />
              )}

              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={boardTaskSearchRef}
                  aria-label="Search tasks"
                  placeholder="Search tasks…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-44 pl-8 md:w-56"
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Filter className="w-4 h-4" />
                    Filter
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSelectedStatus('all')}>
                    All Tasks
                  </DropdownMenuItem>
                  {boardColumns.map((col) => (
                    <DropdownMenuItem
                      key={col.id}
                      onClick={() => setSelectedStatus(col.id)}
                    >
                      <span
                        className="w-2 h-2 rounded-full mr-2"
                        style={{ background: col.color }}
                      />
                      {col.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <ArrowUpDown className="w-4 h-4" />
                    Sort
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(
                    [
                      { id: 'manual', label: 'Manual order' },
                      { id: 'priority', label: 'Priority' },
                      { id: 'due', label: 'Due date' },
                      { id: 'recent', label: 'Recently updated' },
                    ] as { id: TaskSortOption; label: string }[]
                  ).map((opt) => (
                    <DropdownMenuItem
                      key={opt.id}
                      onClick={() => setSortOption(opt.id)}
                      className="justify-between"
                    >
                      {opt.label}
                      {sortOption === opt.id && <Check className="w-4 h-4" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <SavedViewsMenu
                ownerId={user?.userId ?? null}
                organizationId={project?.organizationId ?? null}
                projectId={project?.projectId ?? null}
                currentFilters={{
                  status: selectedStatus,
                  searchQuery,
                }}
                currentSort={{ by: sortOption }}
                onApply={applySavedView}
              />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" title="Import / Export" aria-label="Import / Export" className="shrink-0">
                    <Download className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExportCsv}>
                    <Download className="w-4 h-4 mr-2" />
                    Export tasks to CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate('/settings')}
                aria-label="Settings"
                title="Settings"
                className="shrink-0"
              >
                <Settings className="w-4 h-4" />
              </Button>

              {!isViewer && viewMode === 'kanban' && (
                <Button
                  className="shrink-0"
                  onClick={() => setAddTaskRequest((n) => n + 1)}
                >
                  <Plus className="w-4 h-4" />
                  New task
                </Button>
              )}
            </div>
            </div>
            {user?.userId ? (
              <div className="pb-3 pt-1">
                <AIProjectHealth
                  projectId={project.projectId}
                  projectName={project.name}
                  userId={user.userId}
                  tasks={tasks}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
          <div className={`flex-1 min-w-0 px-4 pt-4 lg:px-6 ${viewMode === 'kanban' ? 'overflow-hidden pb-2' : 'overflow-auto pb-24'}`}>
            {viewMode === 'kanban' ? (
              <div ref={boardScrollRef} className="kanban-scroll flex h-full flex-col overflow-x-auto overflow-y-auto">
                {/* Columns fill the height; the sideways scrollbar sits at the very bottom. */}
                {renderKanbanBoard(false)}
              </div>
            ) : viewMode === 'timeline' ? (
              <TimelineView
                tasks={boardTasks}
                searchQuery={searchQuery}
                selectedStatus={selectedStatus}
                navigate={navigate}
              />
            ) : viewMode === 'done' ? (
              <>
              <DoneTasksView
                tasks={tasks}
                columns={boardColumns}
                searchQuery={searchQuery}
                canEdit={!isViewer}
                onReopen={handleReopenTask}
                onOpenTask={openTaskInPlace}
              />
              {/* Opens done tasks right here, without switching to the board. */}
              {renderKanbanBoard(true)}
              </>
            ) : viewMode === 'mindmap' ? (
              <div className="h-[calc(100vh-12rem)] min-h-[480px]">
                <ProjectMindMap
                  project={project}
                  tasks={boardTasks}
                  columns={boardColumns}
                  onOpenTask={openTaskOnBoard}
                />
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-border bg-surface-2 text-xs text-muted-foreground">
                    <tr>
                      <th className="h-10 px-4 font-medium">Title</th>
                      <th className="h-10 px-4 font-medium">Status</th>
                      <th className="h-10 px-4 font-medium">Priority</th>
                      <th className="h-10 px-4 font-medium">Due Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {boardTasks
                      .filter((t) => selectedStatus === 'all' || t.status === selectedStatus)
                      .filter((t) =>
                        searchQuery.trim()
                          ? t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
                          : true
                      )
                      .map((task) => (
                        <tr key={task.taskId} className="hover:bg-surface-2">
                          <td className="px-4 py-2.5">
                            <span className="font-medium text-foreground">{task.title}</span>
                            {task.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                                {task.description}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusPill tone="neutral" dot={false}>
                              {boardColumns.find((c) => c.id === task.status)?.title ??
                                (task.status === 'undefined' ? 'To-do' : task.status)}
                            </StatusPill>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="flex flex-wrap items-center gap-1">
                              {task.urgent && <UrgentBadge muted={task.status === 'done'} />}
                              <PriorityPill
                                priority={task.priority}
                                color={task.priorityColor}
                                muted={task.status === 'done'}
                              />
                            </span>
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                            {task.dueDate
                              ? new Date(task.dueDate).toLocaleDateString()
                              : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>

                {boardTasks
                  .filter((t) => selectedStatus === 'all' || t.status === selectedStatus)
                  .filter((t) =>
                    searchQuery.trim()
                      ? t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
                      : true
                  ).length === 0 && (
                    <div className="text-center text-muted-foreground py-12">
                      {boardTasks.length === 0
                        ? dueDayParam && tasks.length > 0
                          ? 'No tasks due on this date in this project.'
                          : 'No tasks yet. Create one from the Kanban view.'
                        : 'No tasks match your filters.'}
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>

        {showProjectChatRail ? (
        <ProjectRightRail
          project={project}
          open={rightRailOpen}
          onOpenChange={setRightRailOpen}
          presenceByUserId={presenceByUserId}
        />
        ) : null}
      </main>

      <LimitReachedModal
        open={limitModal.open}
        onClose={closeLimitModal}
        title="Task Limit Reached"
        message={limitModal.message}
      />

    </>
  );
};

export default ProjectView;
