import { publicMessage } from '@/lib/publicError';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { UrgentBadge } from '@/components/common/TaskBadges';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useProjects } from '@/hooks/useProjects';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
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
import { CALENDAR_CHIP_CLASS, CALENDAR_CHIP_LEGEND, calendarChipClass } from './calendarTaskChip';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Previous / next button inside the joined month navigator. */
const STEP_BUTTON =
  'flex w-11 shrink-0 items-center justify-center bg-background text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:w-8';

/** Shared chip shape for tasks in the grid and the legend. */
const CHIP = 'h-5 rounded border px-1.5 text-xs font-medium leading-[18px]';

export const Calendar: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { projects: allProjects } = useProjects();
  const { filterProjects, filterTasks } = useSelectedWorkspace();
  const projects = useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [allTasks, setTasks] = useState<Task[]>([]);
  const tasks = useMemo(() => filterTasks(allTasks), [allTasks, filterTasks]);
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
        const errorMsg = publicMessage(err, 'Failed to load calendar tasks');
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

  /** A greyed-out day from the month before or after, to square off the grid. */
  const outsideDay = (key: string, day: number) => (
    <div key={key} className="min-h-[104px] bg-surface-2 p-1.5" aria-hidden>
      <span className="flex h-6 w-6 items-center justify-center text-xs font-medium tabular-nums text-muted-foreground/70">
        {day}
      </span>
    </div>
  );

  const renderCalendarDays = () => {
    const days: JSX.Element[] = [];

    const daysInPrevMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0).getDate();
    for (let i = 0; i < startingDay; i++) {
      days.push(outsideDay(`before-${i}`, daysInPrevMonth - startingDay + 1 + i));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayTasks = getTasksForDay(day);

      days.push(
        <div key={day} className="flex min-h-[104px] min-w-0 flex-col gap-1 bg-background p-1.5">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums',
              isToday(day) ? 'bg-foreground font-semibold text-background' : 'font-medium text-foreground',
            )}
            aria-current={isToday(day) ? 'date' : undefined}
          >
            {day}
          </span>

          {dayTasks.slice(0, 2).map((task) => (
            <button
              key={task.taskId}
              type="button"
              className={cn(
                CHIP,
                'block w-full truncate text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                calendarChipClass(task),
              )}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedTask(task);
              }}
              title={`${task.title} - ${getProjectName(task.projectId)} (${task.status})`}
            >
              {task.title}
            </button>
          ))}

          {dayTasks.length > 2 && (
            <span className="px-1.5 text-xs text-muted-foreground">
              +{dayTasks.length - 2} more
            </span>
          )}
        </div>
      );
    }

    const trailing = (7 - ((startingDay + daysInMonth) % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      days.push(outsideDay(`after-${i}`, i));
    }

    return days;
  };

  return (
    <>
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <AppHeader left={<span className="text-sm font-semibold">Calendar</span>} />

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
            <PageHeader
              title={`${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
              description="View tasks by due date"
              actions={
                <>
                  <Button variant="ghost" onClick={() => setCurrentDate(new Date())}>
                    Today
                  </Button>
                  <div className="flex h-11 items-stretch overflow-hidden rounded-md border border-input bg-background md:h-8">
                    <button
                      type="button"
                      className={cn(STEP_BUTTON, 'border-r border-input')}
                      onClick={prevMonth}
                      aria-label="Previous month"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={STEP_BUTTON}
                      onClick={nextMonth}
                      aria-label="Next month"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </>
              }
            />

            <StatStrip
              items={[
                { label: 'Due this month', value: monthTasks.length },
                { label: 'Completed', value: completedMonthTasks },
                { label: 'Urgent', value: urgentMonthTasks, tone: 'danger' },
              ]}
            />

            <div className="flex flex-col gap-3">
              <ul className="flex flex-wrap items-center gap-2" aria-label="Task colours">
                {CALENDAR_CHIP_LEGEND.map(({ level, label }) => (
                  <li key={level} className={cn(CHIP, 'px-2 font-semibold', CALENDAR_CHIP_CLASS[level])}>
                    {label}
                  </li>
                ))}
              </ul>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error loading tasks</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="overflow-hidden rounded-lg border border-border">
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading tasks" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="min-w-[760px]">
                      <div className="grid h-9 grid-cols-7 items-center border-b border-border bg-surface-2 text-xs font-medium text-muted-foreground">
                        {DAYS.map((day) => (
                          <span key={day} className="px-2.5">
                            {day}
                          </span>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-px bg-border">{renderCalendarDays()}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Task Details Dialog */}
      <AlertDialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedTask?.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Project:</span>{' '}
                  {selectedTask ? getProjectName(selectedTask.projectId) : '-'}
                </p>
                <p>
                  <span className="font-medium text-foreground">Status:</span>{' '}
                  <span className="capitalize">{selectedTask?.status}</span>
                </p>
                {selectedTask?.dueDate && (
                  <p>
                    <span className="font-medium text-foreground">Due Date:</span>{' '}
                    <span className="tabular-nums">{new Date(selectedTask.dueDate).toLocaleDateString()}</span>
                  </p>
                )}
                {selectedTask?.priority && (
                  <p>
                    <span className="font-medium text-foreground">Priority:</span> {selectedTask.priority}
                  </p>
                )}
                {selectedTask?.urgent && (
                  <p className="pt-1">
                    <UrgentBadge />
                  </p>
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
