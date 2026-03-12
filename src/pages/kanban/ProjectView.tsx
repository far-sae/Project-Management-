import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Filter, LayoutGrid, List, Loader2, Settings, GanttChartSquare } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/context/AuthContext';
import { useTasks } from '@/hooks/useTasks';
import { getProject, updateProject } from '@/services/supabase/database';
import { supabase } from '@/services/supabase';
import { Project, Task, TaskStatus } from '@/types';
import { DEFAULT_COLUMNS } from '@/types/task';
import type { KanbanColumn } from '@/types';

import { Sidebar } from '@/components/sidebar/Sidebar';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { TrialBanner } from '@/components/subscription/TrialBanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <div className="min-w-[600px]">
        <div className="flex border-b border-gray-200">
          <div className="w-64 shrink-0 p-3 font-medium text-gray-700 border-r border-gray-200">
            Task
          </div>
          <div className="flex-1 relative" style={{ minWidth: totalDays * DAYS_WIDTH }}>
            {Array.from({ length: Math.ceil(totalDays / 7) }, (_, i) => {
              const d = new Date(startDate);
              d.setDate(d.getDate() + i * 7);
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-r border-gray-100 text-xs text-gray-500 px-1 py-2"
                  style={{ left: i * 7 * DAYS_WIDTH, width: 7 * DAYS_WIDTH }}
                >
                  {MONTHS[d.getMonth()]} {d.getFullYear()}
                </div>
              );
            })}

            {todayOffset >= 0 && todayOffset < totalDays && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-orange-500 z-10"
                style={{ left: todayOffset * DAYS_WIDTH }}
              />
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p>No tasks with due dates. Add due dates to tasks to see them on the timeline.</p>
          </div>
        ) : (
          filtered.map((task) => {
            const dueDate = new Date(task.dueDate!);
            const left = getTaskPosition(dueDate);

            return (
              <div
                key={task.taskId}
                className="flex items-center border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                onClick={() => navigate(`/project/${task.projectId}`)}
              >
                <div className="w-64 shrink-0 p-3 border-r border-gray-200">
                  <p className="font-medium truncate">{task.title}</p>
                  <p className="text-xs text-gray-500 capitalize">{task.status}</p>
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

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'timeline'>('kanban');
  const [showTrialBanner, setShowTrialBanner] = useState(true);
  const { tasks, limitModal, closeLimitModal } = useTasks(
    projectId || null,
    project?.organizationId || null,
  );

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
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500 mx-auto" />
          <p className="mt-4 text-gray-600">Loading project...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-gray-500 mt-2">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">Project not found</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
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

        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/dashboard">Projects</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{project.name}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>

              <div>
                <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
                {project.description && (
                  <p className="text-sm text-gray-500">{project.description}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64"
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
                  <DropdownMenuItem onClick={() => setSelectedStatus('todo')}>
                    To-do
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedStatus('inprogress')}>
                    In Progress
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedStatus('done')}>
                    Done
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedStatus('needreview')}>
                    Need Review
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex border rounded-lg overflow-hidden">
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
            </div>
          </div>
        </header>

        <div className={`flex-1 p-4 ${viewMode === 'kanban' ? 'overflow-hidden' : 'overflow-auto'}`}>
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
              />
            </div>
          ) : viewMode === 'timeline' ? (
            <TimelineView
              tasks={tasks}
              searchQuery={searchQuery}
              selectedStatus={selectedStatus}
              navigate={navigate}
            />
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-sm font-medium text-gray-700">Title</th>
                    <th className="px-4 py-3 text-sm font-medium text-gray-700">Status</th>
                    <th className="px-4 py-3 text-sm font-medium text-gray-700">Priority</th>
                    <th className="px-4 py-3 text-sm font-medium text-gray-700">Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tasks
                    .filter((t) => selectedStatus === 'all' || t.status === selectedStatus)
                    .filter((t) =>
                      searchQuery.trim()
                        ? t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
                        : true
                    )
                    .map((task) => (
                      <tr key={task.taskId} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{task.title}</span>
                          {task.description && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                              {task.description}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            {task.status === 'undefined' ? 'To-do' : task.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="capitalize text-sm text-gray-700">{task.priority}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {task.dueDate
                            ? new Date(task.dueDate).toLocaleDateString()
                            : '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {tasks
                .filter((t) => selectedStatus === 'all' || t.status === selectedStatus)
                .filter((t) =>
                  searchQuery.trim()
                    ? t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
                    : true
                ).length === 0 && (
                  <div className="text-center text-gray-500 py-12">
                    {tasks.length === 0
                      ? 'No tasks yet. Create one from the Kanban view.'
                      : 'No tasks match your filters.'}
                  </div>
                )}
            </div>
          )}
        </div>
      </main>

      <LimitReachedModal
        open={limitModal.open}
        onClose={closeLimitModal}
        title="Task Limit Reached"
        message={limitModal.message}
      />
    </div>
  );
};

export default ProjectView;
