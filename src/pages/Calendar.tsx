import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useProjects } from '@/hooks/useProjects';
import { getOrganizationTasks } from '@/services/supabase/database';
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
          .select('*')
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
          urgent: task.urgent,
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

  const renderCalendarDays = () => {
    const days: JSX.Element[] = [];

    for (let i = 0; i < startingDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-24 bg-gray-50" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayTasks = getTasksForDay(day);

      days.push(
        <div
          key={day}
          className={`h-24 border border-gray-100 p-2 hover:bg-gray-50 cursor-pointer overflow-y-auto ${isToday(day) ? 'bg-orange-50 border-orange-200' : ''
            }`}
        >
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm ${isToday(day)
              ? 'bg-orange-500 text-white font-bold'
              : 'text-gray-700'
              }`}
          >
            {day}
          </span>

          {dayTasks.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {dayTasks.slice(0, 2).map((task) => (
                <div
                  key={task.taskId}
                  className={`text-xs truncate px-1 py-0.5 rounded cursor-pointer flex items-center gap-1
                    ${task.status === 'done'
                      ? 'bg-green-100 text-green-700 line-through hover:bg-green-200'
                      : task.urgent
                        ? 'bg-red-100 text-red-800 hover:bg-red-200'
                        : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
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
                <div className="text-xs text-gray-500 px-1">
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
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Calendar</h1>
            <p className="text-gray-500">View tasks and projects by due date</p>
          </div>
          <Button
            variant="outline"
            onClick={() => setCurrentDate(new Date())}
          >
            <CalendarIcon className="w-4 h-4 mr-2" />
            Today
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={prevMonth}>
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <CardTitle>
                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={nextMonth}>
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
              <div className="grid grid-cols-7 gap-0">
                {DAYS.map((day) => (
                  <div
                    key={day}
                    className="h-10 flex items-center justify-center font-medium text-gray-500 text-sm border-b"
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
    </div>
  );
};

export default Calendar;
