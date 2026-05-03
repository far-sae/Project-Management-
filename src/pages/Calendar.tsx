import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

import { TaskCalendarLogo } from '@/components/brand/TaskCalendarLogo';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useProjects } from '@/hooks/useProjects';
import {
  getOrganizationTasks,
  TASKS_SAFE_SELECT,
  taskHasLockPin,
} from '@/services/supabase/database';
import { Task } from '@/types';
import { supabase } from '@/services/supabase';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const Calendar: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { projects } = useProjects();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const orgId =
    organization?.organizationId ||
    user?.organizationId ||
    (user ? `local-${user.userId}` : '');

  useEffect(() => {
    const fetchTasks = async () => {
      if (!user) {
        setTasks([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // 1) Tasks assigned to this user across all orgs
        const { data: assignedData, error: assignedError } = await supabase
          .from('tasks')
          .select(TASKS_SAFE_SELECT)
          .filter('assignees', 'cs', `[{"userId":"${user.userId}"}]`);

        if (assignedError) throw assignedError;

        // 2) Org tasks if orgId is real (non-local)
        let orgTasks: Task[] = [];
        if (orgId && !orgId.startsWith('local-')) {
          orgTasks = await getOrganizationTasks(orgId);
        }

        // 3) Map Supabase rows to Task
        const assignedTasks: Task[] = (assignedData || []).map((task) => ({
          taskId: task.task_id,
          projectId: task.project_id,
          organizationId: task.organization_id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          priorityColor: task.priority_color,
          dueDate: task.due_date ? new Date(task.due_date) : null,
          assignees: task.assignees || [],
          tags: task.tags || [],
          subtasks: task.subtasks || [],
          parentTaskId: task.parent_task_id,
          urgent: task.urgent,
          isLocked: task.is_locked || false,
          hasLockPin: taskHasLockPin(task),
          position: task.position,
          attachments: task.attachments || [],
          commentsCount: task.comments_count || 0,
          createdBy: task.created_by,
          createdAt: new Date(task.created_at),
          updatedAt: new Date(task.updated_at),
          completedAt: task.completed_at ? new Date(task.completed_at) : null,
        }));

        // 4) Merge + dedupe
        const merged = [...assignedTasks, ...orgTasks].filter(
          (t, i, arr) => arr.findIndex((x) => x.taskId === t.taskId) === i
        );

        setTasks(merged);
        toast.success(`Loaded ${merged.length} tasks`, {
          description: 'Calendar is ready',
        });
      } catch (err) {
        setTasks([]);
        const errorMsg = err instanceof Error ? err.message : 'Failed to load calendar tasks';
        setError(errorMsg);
        toast.error('Failed to load tasks', {
          description: errorMsg,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, [orgId, user]);

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();
    return { daysInMonth, startingDay };
  };

  const { daysInMonth, startingDay } = getDaysInMonth(currentDate);

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const today = new Date();
  const isToday = (day: number) =>
    day === today.getDate() &&
    currentDate.getMonth() === today.getMonth() &&
    currentDate.getFullYear() === today.getFullYear();

  const getTasksForDay = (day: number) => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    return tasks.filter((task) => {
      if (!task.dueDate) return false;
      const d = new Date(task.dueDate);
      return (
        d.getDate() === date.getDate() &&
        d.getMonth() === date.getMonth() &&
        d.getFullYear() === date.getFullYear()
      );
    });
  };

  const getProjectName = (projectId: string) => {
    const p = projects.find((x) => x.projectId === projectId);
    return p?.name || 'Unknown';
  };

  const monthTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (!task.dueDate) return false;
        const d = new Date(task.dueDate);
        return (
          d.getMonth() === currentDate.getMonth() &&
          d.getFullYear() === currentDate.getFullYear()
        );
      }),
    [currentDate, tasks],
  );

  const completedMonthTasks = monthTasks.filter((task) => task.status === 'done').length;
  const urgentMonthTasks = monthTasks.filter((task) => task.urgent).length;

  const renderCalendarDays = () => {
    const days: JSX.Element[] = [];

    for (let i = 0; i < startingDay; i++) {
      days.push(<div key={`empty-${i}`} className="min-h-28 rounded-lg border border-border/40 bg-muted/15" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayTasks = getTasksForDay(day);

      days.push(
        <div
          key={day}
          className={`min-h-28 cursor-pointer overflow-y-auto rounded-lg border p-2.5 transition-colors hover:bg-muted/40 ${isToday(day) ? 'border-primary/40 bg-primary/10 shadow-sm' : 'border-border/60 bg-card/85'
            }`}
        >
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm ${isToday(day)
              ? 'bg-primary text-primary-foreground font-bold shadow-sm'
              : 'text-foreground'
              }`}
          >
            {day}
          </span>

          {dayTasks.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {dayTasks.slice(0, 2).map((task) => (
                <div
                  key={task.taskId}
                  className={`flex cursor-pointer items-center gap-1 truncate rounded-md px-1.5 py-1 text-xs
                    ${task.status === 'done'
                      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 line-through hover:bg-emerald-500/30'
                      : task.urgent
                        ? 'bg-destructive/25 text-destructive ring-1 ring-destructive/40 border border-destructive/35 hover:bg-destructive/35 font-medium'
                        : 'bg-primary/20 text-primary hover:bg-primary/30'
                    }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTask(task);
                  }}
                  title={`${task.title} - ${getProjectName(task.projectId)} (${task.status})`}
                >
                  {task.status === 'done' && <span>✓</span>}
                  {task.title}
                </div>
              ))}

              {dayTasks.length > 2 && (
                <div className="px-1 text-xs text-muted-foreground">
                  +{dayTasks.length - 2} more
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return days;
  };

  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-[linear-gradient(180deg,hsl(var(--background)),hsl(var(--surface-2))_34rem,hsl(var(--background)))] p-4 sm:p-6 lg:p-8">
        <div className="mb-6 rounded-lg border border-border/70 bg-card/80 p-5 shadow-sm shadow-black/5 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 leading-none">
            <TaskCalendarLogo sizeClass="h-9 w-9 sm:h-10 sm:w-10" />
            <div className="min-w-0 pt-0.5">
              <h1 className="text-3xl font-bold text-foreground">TaskCalendar</h1>
              <p className="mt-1 text-muted-foreground">View tasks by due date</p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => setCurrentDate(new Date())}
            className="rounded-lg bg-background/80"
          >
            <CalendarIcon className="w-4 h-4 mr-2" />
            Today
          </Button>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-background/70 p-3">
            <p className="text-xs font-medium text-muted-foreground">Due this month</p>
            <p className="mt-1 text-2xl font-semibold">{monthTasks.length}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/70 p-3">
            <p className="text-xs font-medium text-muted-foreground">Completed</p>
            <p className="mt-1 text-2xl font-semibold text-success">{completedMonthTasks}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/70 p-3">
            <p className="text-xs font-medium text-muted-foreground">Urgent</p>
            <p className="mt-1 text-2xl font-semibold text-destructive">{urgentMonthTasks}</p>
          </div>
        </div>
        </div>

        <Card className="overflow-hidden rounded-lg border-border/70 bg-card/85 shadow-sm shadow-black/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" className="rounded-lg" onClick={prevMonth}>
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <CardTitle>
                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
              </CardTitle>
              <Button variant="ghost" size="icon" className="rounded-lg" onClick={nextMonth}>
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error loading tasks</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {DAYS.map((day) => (
                  <div
                    key={day}
                    className="flex h-10 items-center justify-center rounded-lg bg-muted/30 text-sm font-medium text-muted-foreground"
                  >
                    {day}
                  </div>
                ))}
                {renderCalendarDays()}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Task Details Dialog */}
      <AlertDialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedTask?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-2 mt-2">
                <p><strong>Project:</strong> {selectedTask ? getProjectName(selectedTask.projectId) : '-'}</p>
                <p><strong>Status:</strong> <span className="capitalize">{selectedTask?.status}</span></p>
                {selectedTask?.dueDate && (
                  <p><strong>Due Date:</strong> {new Date(selectedTask.dueDate).toLocaleDateString()}</p>
                )}
                {selectedTask?.priority && (
                  <p><strong>Priority:</strong> {selectedTask.priority}</p>
                )}
                {selectedTask?.urgent && (
                  <p className="text-red-600 font-semibold">⚠️ Urgent</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedTask(null)}>Close</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (selectedTask) {
                navigate(`/project/${selectedTask.projectId}`);
              }
            }}>
              View in Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default Calendar;
