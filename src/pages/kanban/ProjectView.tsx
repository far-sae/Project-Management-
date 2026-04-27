import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, Filter, LayoutGrid, List, Loader2, Settings, GanttChartSquare, ArrowUpDown, Check, Download, Upload, KeyRound, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { useAuth } from '@/context/AuthContext';
import { useTasks } from '@/hooks/useTasks';
import { getProject, updateProject, verifyProjectLockPin } from '@/services/supabase/database';
import { supabase } from '@/services/supabase';
import { Project, Task, TaskStatus } from '@/types';
import { DEFAULT_COLUMNS } from '@/types/task';
import type { KanbanColumn } from '@/types';

import { Sidebar } from '@/components/sidebar/Sidebar';
import { KanbanBoard, TaskSortOption } from '@/components/kanban/KanbanBoard';
import { TrialBanner } from '@/components/subscription/TrialBanner';
import { AppHeader } from '@/components/layout/AppHeader';
import { ProjectRightRail } from '@/components/project/ProjectRightRail';
import { PresenceAvatars } from '@/components/presence/PresenceAvatars';
import { PresenceStatusAvatarMenu } from '@/components/presence/PresenceStatusMenu';
import { usePresence } from '@/hooks/usePresence';
import { usePresenceStatusPreference } from '@/hooks/usePresenceStatusPreference';
import {
  ALL_WORKSPACES_ID,
  useSelectedWorkspace,
} from '@/hooks/useSelectedWorkspace';
import { CsvImportDialog } from '@/components/import/CsvImportDialog';
import { SavedViewsMenu } from '@/components/views/SavedViewsMenu';
import { tasksToCsv, downloadCsv } from '@/services/csv/tasksCsv';
import type { SavedView } from '@/types/savedView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  isProjectLockUnlockedInSession,
  setProjectLockUnlockedInSession,
} from '@/lib/projectLockPin';
import { cn } from '@/lib/utils';
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
    <div className="bg-card rounded-lg border border-border overflow-x-auto">
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
                className="flex items-center border-b border-border/60 hover:bg-secondary/50 cursor-pointer"
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
                          ? '#22c55e'
                          : task.status === 'inprogress'
                            ? '#3b82f6'
                            : '#f97316',
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

export const ProjectView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string; }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedId: selectedWorkspaceId, isAll } = useSelectedWorkspace();
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'timeline'>('kanban');
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
  const [showCsvImport, setShowCsvImport] = useState(false);
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
  }, [project, projectId, projectPin]);

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

  // If user switches sidebar workspace to one that does not contain this project,
  // the board would look "unchanged" while the filter updates — redirect to dashboard.
  useEffect(() => {
    if (!project?.workspaceId || isAll || selectedWorkspaceId === ALL_WORKSPACES_ID) {
      return;
    }
    if (project.workspaceId !== selectedWorkspaceId) {
      toast.info('Switched workspace — this project belongs elsewhere. Opening the dashboard.');
      navigate('/dashboard');
    }
  }, [project?.workspaceId, selectedWorkspaceId, isAll, navigate, project]);

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

  useEffect(() => {
    let cancelled = false;

    const fetchProject = async () => {
      if (!projectId || !user) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

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
        } else {
          setError('Project is still being shared. Please wait a moment and retry.');
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load project';
        setError(message);
        toast.error(message);
        setTimeout(() => navigate('/dashboard'), 2000);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchProject();
    return () => {
      cancelled = true;
    };
  }, [projectId, user?.userId, user?.organizationId, navigate]);

  useEffect(() => {
    let cancelled = false;
    const refetchProject = async () => {
      if (!projectId || !user || document.visibilityState !== 'visible') return;
      const effectiveOrgId = (user.organizationId || user.userId || '').replace('local-', '');
      try {
        const projectData = await getProject(projectId, effectiveOrgId, user.userId, user.email);
        if (!cancelled && projectData) setProject(projectData);
      } catch {
        // Silent fail on visibility refetch
      }
    };
    const onVisibility = () => refetchProject();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [projectId, user?.userId, user?.organizationId, user?.email]);

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
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive font-medium">{error}</p>
          <p className="text-muted-foreground mt-2">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  if (needsProjectLockGate) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar
          project={null}
          tasks={[]}
          selectedStatus={selectedStatus}
          onStatusChange={setSelectedStatus}
          columns={boardColumns}
        />
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <Lock className="w-12 h-12 text-muted-foreground mb-4" aria-hidden />
          <h1 className="text-xl font-semibold text-foreground text-center">This project is locked</h1>
          <p className="text-sm text-muted-foreground text-center max-w-md mt-2">
            Enter the project PIN to open the board, tasks, and chat. Everyone with access—including the
            owner—needs the PIN each session. Only the owner can set or change this PIN in project
            settings.
          </p>
          <Input
            type="password"
            autoComplete="off"
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
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        project={project}
        tasks={tasks}
        selectedStatus={selectedStatus}
        onStatusChange={setSelectedStatus}
        columns={boardColumns}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {showTrialBanner && (
          <TrialBanner variant="full" onDismiss={() => setShowTrialBanner(false)} />
        )}

        <AppHeader
          left={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/dashboard">Projects</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate max-w-[14rem]">
                    {project.name}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
          right={
            <div className="flex items-center gap-2 flex-shrink-0">
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
          <div className="flex items-center justify-between gap-3 px-4 lg:px-6 py-2 border-b border-border bg-secondary/40 text-sm">
            <p className="text-muted-foreground">
              Showing tasks due{' '}
              <span className="font-medium text-foreground">{dueDayParam}</span>
            </p>
            <Button variant="outline" size="sm" onClick={clearDueDayFilter}>
              Clear filter
            </Button>
          </div>
        )}

        <div className="bg-card border-b border-border px-4 lg:px-6 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
                aria-label="Back to projects"
                className="shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: project.coverColor || 'hsl(var(--primary))' }}
              />
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-foreground truncate">
                  {project.name}
                </h1>
                {project.description && (
                  <p className="text-xs text-muted-foreground truncate">
                    {project.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search tasks…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-56 md:w-64 h-9"
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="w-4 h-4 mr-2" />
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
                  <Button variant="outline" size="sm">
                    <ArrowUpDown className="w-4 h-4 mr-2" />
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
                  <Button variant="outline" size="sm" title="Import / Export">
                    <Download className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowCsvImport(true)}>
                    <Upload className="w-4 h-4 mr-2" />
                    Import CSV…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportCsv}>
                    <Download className="w-4 h-4 mr-2" />
                    Export tasks to CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex border border-border rounded-lg overflow-hidden">
                <Button
                  variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-none"
                  onClick={() => setViewMode('kanban')}
                  title="Kanban"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-none"
                  onClick={() => setViewMode('list')}
                  title="List"
                >
                  <List className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'timeline' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-none"
                  onClick={() => setViewMode('timeline')}
                  title="Timeline"
                >
                  <GanttChartSquare className="w-4 h-4" />
                </Button>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/settings')}
              >
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
          <div className={`flex-1 min-w-0 p-4 ${viewMode === 'kanban' ? 'overflow-hidden' : 'overflow-auto'}`}>
            {viewMode === 'kanban' ? (
              <div className="h-full overflow-x-auto overflow-y-auto pb-2">
                <KanbanBoard
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
                />
              </div>
            ) : viewMode === 'timeline' ? (
              <TimelineView
                tasks={boardTasks}
                searchQuery={searchQuery}
                selectedStatus={selectedStatus}
                navigate={navigate}
              />
            ) : (
              <div className="bg-card rounded-lg border border-border overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-secondary border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-sm font-medium text-muted-foreground">Title</th>
                      <th className="px-4 py-3 text-sm font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-3 text-sm font-medium text-muted-foreground">Priority</th>
                      <th className="px-4 py-3 text-sm font-medium text-muted-foreground">Due Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {boardTasks
                      .filter((t) => selectedStatus === 'all' || t.status === selectedStatus)
                      .filter((t) =>
                        searchQuery.trim()
                          ? t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
                          : true
                      )
                      .map((task) => (
                        <tr key={task.taskId} className="hover:bg-secondary/50">
                          <td className="px-4 py-3">
                            <span className="font-medium text-foreground">{task.title}</span>
                            {task.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                                {task.description}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
                              {task.status === 'undefined' ? 'To-do' : task.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="capitalize text-sm text-foreground">{task.priority}</span>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
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

        <ProjectRightRail
          project={project}
          open={rightRailOpen}
          onOpenChange={setRightRailOpen}
          presenceByUserId={presenceByUserId}
        />
      </main>

      <LimitReachedModal
        open={limitModal.open}
        onClose={closeLimitModal}
        title="Task Limit Reached"
        message={limitModal.message}
      />

      <CsvImportDialog
        open={showCsvImport}
        onOpenChange={setShowCsvImport}
        projectId={project.projectId}
        projectName={project.name}
        columns={boardColumns}
        addTask={addTask}
      />
    </div>
  );
};

export default ProjectView;
