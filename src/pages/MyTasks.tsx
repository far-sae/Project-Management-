import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import {
  CheckSquare, Clock, Loader2, ChevronDown, Check,
  Tag, Paperclip, Calendar, FileText, ListTree,
  Link2, GripVertical, Circle, X, Users,
} from 'lucide-react';
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
import { useAllTasks } from '@/hooks/useAllTasks';
import { useProjects } from '@/hooks/useProjects';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { Task, TaskComment, TaskSubtask, UpdateTaskInput } from '@/types';
import { TaskModal } from '@/components/kanban/TaskModal';
import { updateTask, addCommentWithGlobalSync, subscribeToComments, createDueReminderNotifications } from '@/services/supabase/database';
import { uploadCommentAttachment } from '@/services/supabase/storage';
import { cn } from '@/lib/utils';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

export const MyTasks: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { projects } = useProjects();
  const { tasksAssignedToMe, loading, tasks: allTasks, refresh } = useAllTasks();

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<'mytasks' | 'updates'>('mytasks');
  const [activeDetailTab, setActiveDetailTab] = useState<'comments' | 'activity'>('comments');
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newComment, setNewComment] = useState('');
  const [commentTimeSpent, setCommentTimeSpent] = useState<number | ''>('');
  const [showTimeSpent, setShowTimeSpent] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [taskComments, setTaskComments] = useState<TaskComment[]>([]);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [commentAttachmentFiles, setCommentAttachmentFiles] = useState<File[]>([]);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [groupBy, setGroupBy] = useState<'dueDate' | 'project' | 'status' | 'priority'>('dueDate');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', onConfirm: () => { } });

  const orgId = useMemo(() =>
    organization?.organizationId || user?.organizationId || (user ? `local-${user.userId}` : ''),
    [organization?.organizationId, user?.organizationId, user?.userId]
  );

  const getProjectName = useCallback((projectId: string) =>
    projects.find((p) => p.projectId === projectId)?.name || 'Unknown',
    [projects]
  );

  const getWorkspaceName = useCallback((projectId: string) => {
    const project = projects.find((p) => p.projectId === projectId);
    if (!project) return 'Workspace';
    return orgId.startsWith('local-') ? 'Local workspace' : (organization?.name || 'Workspace');
  }, [projects, orgId, organization]);

  const getProject = useCallback((projectId: string) =>
    projects.find((p) => p.projectId === projectId),
    [projects]
  );

  // Subscribe to comments for selected task
  useEffect(() => {
    if (!selectedTask?.taskId || !orgId) { setTaskComments([]); return; }
    const unsub = subscribeToComments(selectedTask.taskId, orgId, setTaskComments);
    return () => unsub();
  }, [selectedTask?.taskId, orgId]);

  // Automate: due-date reminders for tasks due within 24h (once per task/user per 24h)
  useEffect(() => {
    if (!tasksAssignedToMe.length || !projects.length) return;
    const projectNames: Record<string, string> = {};
    projects.forEach((p) => { projectNames[p.projectId] = p.name; });
    createDueReminderNotifications({
      tasks: tasksAssignedToMe.map((t) => ({
        taskId: t.taskId,
        projectId: t.projectId,
        title: t.title,
        dueDate: t.dueDate != null ? (typeof t.dueDate === 'string' ? t.dueDate : new Date(t.dueDate).toISOString()) : null,
        assignees: (t.assignees ?? []).map((a) => ({ userId: a.userId })),
        status: t.status,
      })),
      projectNames,
      hoursAhead: 24,
    }).catch(() => {});
  }, [tasksAssignedToMe, projects]);

  // Toggle task status
  const handleToggleStatus = useCallback(async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const taskOrgId = task.organizationId || orgId;
    setUpdatingTaskId(task.taskId);
    try {
      const newStatus = task.status === 'done' ? 'todo' : 'done';
      await updateTask(task.taskId, { status: newStatus }, taskOrgId);
      await refresh();
      if (selectedTask?.taskId === task.taskId) {
        setSelectedTask({ ...selectedTask, status: newStatus });
      }
      toast.success(newStatus === 'done' ? 'Task completed!' : 'Task reopened');
    } catch {
      toast.error('Failed to update task');
    } finally {
      setUpdatingTaskId(null);
    }
  }, [user, orgId, refresh, selectedTask]);

  // Save task (tags, description, etc.)
  const handleSaveTask = useCallback(async (input: Record<string, unknown>) => {
    if (!selectedTask || !user) return;
    const taskOrgId = selectedTask.organizationId || orgId;
    setUpdatingTaskId(selectedTask.taskId);
    try {
      await updateTask(selectedTask.taskId, input as UpdateTaskInput, taskOrgId);
      await refresh();
      setSelectedTask({ ...selectedTask, ...(input as Partial<Task>) });
      setShowTagInput(false);
      setTagInput('');
      toast.success('Task updated');
    } catch {
      toast.error('Failed to update task');
    } finally {
      setUpdatingTaskId(null);
    }
  }, [selectedTask, user, orgId, refresh]);

  // Add subtask
  const handleAddSubtask = useCallback(async () => {
    if (!newSubtaskTitle.trim() || !selectedTask || !user) return;
    const taskOrgId = selectedTask.organizationId || orgId;
    const currentSubtasks = selectedTask.subtasks ?? [];
    const newSubtask: TaskSubtask = {
      id: crypto.randomUUID(),
      title: newSubtaskTitle.trim(),
      completed: false,
    };
    try {
      await updateTask(selectedTask.taskId, { subtasks: [...currentSubtasks, newSubtask] }, taskOrgId);
      setNewSubtaskTitle('');
      await refresh();
      setSelectedTask({ ...selectedTask, subtasks: [...currentSubtasks, newSubtask] });
      toast.success('Subtask added');
    } catch {
      toast.error('Failed to add subtask');
    }
  }, [newSubtaskTitle, selectedTask, user, orgId, refresh]);

  // Toggle inline subtask
  const handleToggleInlineSubtask = useCallback(async (subtaskId: string) => {
    if (!selectedTask) return;
    const taskOrgId = selectedTask.organizationId || orgId;
    setUpdatingTaskId(selectedTask.taskId);
    const current = selectedTask.subtasks ?? [];
    const updated = current.map((s) =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    );
    try {
      await updateTask(selectedTask.taskId, { subtasks: updated }, taskOrgId);
      await refresh();
      setSelectedTask({ ...selectedTask, subtasks: updated });
    } catch {
      toast.error('Failed to update subtask');
    } finally {
      setUpdatingTaskId(null);
    }
  }, [selectedTask, orgId, refresh]);

  // Add tag
  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (!tag || !selectedTask) return;
    const existingTags = selectedTask.tags || [];
    if (!existingTags.includes(tag)) {
      handleSaveTask({ tags: [...existingTags, tag] });
      setTagInput('');
    }
  }, [tagInput, selectedTask, handleSaveTask]);

  // Add comment
  const handleAddComment = useCallback(async () => {
    if ((!newComment.trim() && commentAttachmentFiles.length === 0) || !selectedTask || !user || !orgId) return;
    setCommentLoading(true);
    const toastId = toast.loading('Posting comment...');
    try {
      let attachments: { fileId: string; fileName: string; fileUrl: string; fileType: string; }[] = [];

      for (const file of commentAttachmentFiles) {
        try {
          const uploaded = await uploadCommentAttachment(file, selectedTask.taskId, orgId, {
            projectId: selectedTask.projectId,
            userId: user.userId,
            userName: user.displayName || user.email || 'User',
          });
          attachments.push(uploaded);
        } catch (err) {
          toast.error(`Upload failed: ${file.name}`);
        }
      }

      const timeSpent = typeof commentTimeSpent === 'number' ? commentTimeSpent : undefined;
      const visibleToUserIds = (organization?.members?.map(m => m.userId) || [user.userId])
        .filter((id, i, arr) => arr.indexOf(id) === i);

      await addCommentWithGlobalSync(
        selectedTask.taskId,
        selectedTask.projectId,
        getProjectName(selectedTask.projectId),
        selectedTask.title,
        user.userId,
        user.displayName || user.email || 'User',
        user.photoURL || '',
        newComment.trim() || '',
        visibleToUserIds,
        orgId,
        attachments.length > 0 ? attachments : undefined,
        timeSpent,
      );

      setNewComment('');
      setCommentTimeSpent('');
      setShowTimeSpent(false);
      setCommentAttachmentFiles([]);
      toast.success('Comment posted', { id: toastId });
    } catch {
      toast.error('Failed to post comment', { id: toastId });
    } finally {
      setCommentLoading(false);
    }
  }, [newComment, commentTimeSpent, commentAttachmentFiles, selectedTask, user, orgId, getProjectName, organization]);

  // Subtask counts
  const getSubtaskCount = useCallback((task: Task) => {
    const subtasks = allTasks.filter(t => t.parentTaskId === task.taskId);
    return { total: subtasks.length, completed: subtasks.filter(t => t.status === 'done').length };
  }, [allTasks]);

  // Filter and group tasks
  const taskGroups = useMemo(() => {
    let filteredTasks = tasksAssignedToMe;
    if (filterStatus === 'active') filteredTasks = tasksAssignedToMe.filter(t => t.status !== 'done');
    else if (filterStatus === 'completed') filteredTasks = tasksAssignedToMe.filter(t => t.status === 'done');

    const groups: { label: string; tasks: Task[]; }[] = [];

    if (groupBy === 'dueDate') {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);

      const todayTasks = filteredTasks.filter(t => { if (!t.dueDate) return false; const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0); return d.getTime() === today.getTime(); });
      const tomorrowTasks = filteredTasks.filter(t => { if (!t.dueDate) return false; const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0); return d.getTime() === tomorrow.getTime(); });
      const thisWeekTasks = filteredTasks.filter(t => { if (!t.dueDate) return false; const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0); return d > tomorrow && d <= nextWeek; });
      const laterTasks = filteredTasks.filter(t => { if (!t.dueDate) return false; const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0); return d > nextWeek; });
      const noDueTasks = filteredTasks.filter(t => !t.dueDate);

      if (todayTasks.length) groups.push({ label: 'Today', tasks: todayTasks });
      if (tomorrowTasks.length) groups.push({ label: 'Tomorrow', tasks: tomorrowTasks });
      if (thisWeekTasks.length) groups.push({ label: 'This Week', tasks: thisWeekTasks });
      if (laterTasks.length) groups.push({ label: 'Later', tasks: laterTasks });
      if (noDueTasks.length) groups.push({ label: 'No Due Date', tasks: noDueTasks });

    } else if (groupBy === 'project') {
      const byProject = new Map<string, Task[]>();
      filteredTasks.forEach(t => {
        if (!byProject.has(t.projectId)) byProject.set(t.projectId, []);
        byProject.get(t.projectId)!.push(t);
      });
      byProject.forEach((tasks, pid) => groups.push({ label: getProjectName(pid), tasks }));

    } else if (groupBy === 'status') {
      const byStatus = new Map<string, Task[]>();
      filteredTasks.forEach(t => {
        const st = t.status || 'todo';
        if (!byStatus.has(st)) byStatus.set(st, []);
        byStatus.get(st)!.push(t);
      });
      byStatus.forEach((tasks, st) => groups.push({ label: st.charAt(0).toUpperCase() + st.slice(1), tasks }));

    } else if (groupBy === 'priority') {
      const byPriority = new Map<string, Task[]>();
      filteredTasks.forEach(t => {
        const pr = t.priority || 'medium';
        if (!byPriority.has(pr)) byPriority.set(pr, []);
        byPriority.get(pr)!.push(t);
      });
      ['high', 'medium', 'low'].forEach(pr => {
        const tasks = byPriority.get(pr);
        if (tasks?.length) groups.push({ label: pr.charAt(0).toUpperCase() + pr.slice(1) + ' Priority', tasks });
      });
    }

    return groups;
  }, [tasksAssignedToMe, groupBy, filterStatus, getProjectName]);

  const getDueDateLabel = (task: Task) => {
    if (!task.dueDate) return '';
    const d = new Date(task.dueDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const subtasksForSelected = useMemo(() => {
    if (!selectedTask) return [];
    return allTasks.filter(t => t.parentTaskId === selectedTask.taskId);
  }, [selectedTask, allTasks]);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Hi, <span className="font-medium">{user?.email || 'User'}.</span>{' '}
              You have {tasksAssignedToMe.length} task{tasksAssignedToMe.length !== 1 ? 's' : ''},{' '}
              {taskGroups.find(g => g.label === 'Today')?.tasks.length || 0} due today.
            </p>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel */}
          <div className="w-1/2 border-r overflow-y-auto bg-white">
            <div className="sticky top-0 bg-white border-b z-10">
              <Tabs value={activeMainTab} onValueChange={(v) => setActiveMainTab(v as 'mytasks' | 'updates')}>
                <div className="px-4 pt-2">
                  <TabsList className="h-9 bg-transparent p-0 gap-4">
                    <TabsTrigger value="mytasks" className="px-0 py-2 h-auto rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none font-medium">
                      MY TASKS
                    </TabsTrigger>
                    <TabsTrigger value="updates" className="px-0 py-2 h-auto rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none font-medium">
                      UPDATES
                    </TabsTrigger>
                  </TabsList>
                </div>
                <div className="flex items-center justify-between px-4 py-2 border-t">
                  <div className="flex items-center gap-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-gray-600">
                          Group By <ChevronDown className="w-4 h-4 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {(['dueDate', 'project', 'status', 'priority'] as const).map(g => (
                          <DropdownMenuItem key={g} onClick={() => setGroupBy(g)} className={groupBy === g ? 'bg-blue-50' : ''}>
                            {g === 'dueDate' ? 'Due Date' : g.charAt(0).toUpperCase() + g.slice(1)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-gray-600">
                          Filter <ChevronDown className="w-4 h-4 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {([['all', 'All Tasks'], ['active', 'Active Only'], ['completed', 'Completed Only']] as const).map(([val, label]) => (
                          <DropdownMenuItem key={val} onClick={() => setFilterStatus(val)} className={filterStatus === val ? 'bg-blue-50' : ''}>
                            {label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Tabs>
            </div>

            {activeMainTab === 'mytasks' ? (
              loading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                </div>
              ) : (
                <div className="divide-y">
                  {taskGroups.map((group) => (
                    <div key={group.label}>
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 sticky top-[88px] z-10">
                        <div className="flex items-center gap-2">
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                          <span className="font-medium text-gray-700">{group.label}</span>
                        </div>
                        <span className="text-sm text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">{group.tasks.length}</span>
                      </div>
                      {group.tasks.map((task) => {
                        const isSelected = selectedTask?.taskId === task.taskId;
                        const isDone = task.status === 'done';
                        const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isDone;
                        const { total: subtaskTotal, completed: subtaskCompleted } = getSubtaskCount(task);
                        return (
                          <div
                            key={task.taskId}
                            onClick={() => setSelectedTask(task)}
                            className={cn(
                              'flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors',
                              isSelected && 'bg-blue-50 border-l-4 border-l-blue-500'
                            )}
                          >
                            <button
                              type="button"
                              onClick={(e) => handleToggleStatus(task, e)}
                              disabled={updatingTaskId === task.taskId}
                              className={cn(
                                'w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 shrink-0',
                                isDone ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'
                              )}
                            >
                              {updatingTaskId === task.taskId ? <Loader2 className="w-3 h-3 animate-spin" /> : isDone ? <Check className="w-3 h-3" /> : null}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className={cn('font-medium text-gray-900 truncate', isDone && 'line-through text-gray-400')}>
                                    {task.title}
                                  </p>
                                  {subtaskTotal > 0 && (
                                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                                      <CheckSquare className="w-3 h-3" />
                                      <span>{subtaskCompleted}/{subtaskTotal}</span>
                                    </div>
                                  )}
                                  <p className="text-xs text-gray-500 mt-1">
                                    {getWorkspaceName(task.projectId)} » {getProjectName(task.projectId)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {task.urgent && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Urgent</span>
                                  )}
                                  {task.assignees?.[0] && (
                                    <Avatar className="w-7 h-7">
                                      <AvatarImage src={task.assignees[0].photoURL} />
                                      <AvatarFallback className="bg-teal-500 text-white text-xs">
                                        {task.assignees[0].displayName?.charAt(0).toUpperCase() || '?'}
                                      </AvatarFallback>
                                    </Avatar>
                                  )}
                                  <span className={cn('text-sm', isOverdue ? 'text-red-500 font-medium' : 'text-gray-500')}>
                                    {getDueDateLabel(task)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {tasksAssignedToMe.length === 0 && (
                    <div className="text-center py-16 text-gray-500">
                      <CheckSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="font-medium">No tasks assigned to you</p>
                      <p className="text-sm">Tasks assigned to you will appear here</p>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="p-4 space-y-4">
                {allTasks.filter(t => t.assignees?.some(a => a.userId === user?.userId)).length > 0 ? (
                  <div className="space-y-4">
                    <h3 className="font-medium text-gray-700">Recent Activity</h3>
                    {allTasks
                      .filter(t => t.assignees?.some(a => a.userId === user?.userId))
                      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                      .slice(0, 10)
                      .map(task => (
                        <div
                          key={task.taskId}
                          className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100"
                          onClick={() => { setSelectedTask(task); setActiveMainTab('mytasks'); }}
                        >
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
                            <p className="text-xs text-gray-500">
                              {task.status === 'done' ? 'Completed' : 'Updated'} · {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              {getWorkspaceName(task.projectId)} » {getProjectName(task.projectId)}
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="text-center py-16 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p className="font-medium">No recent updates</p>
                    <p className="text-sm">Activity on your tasks will appear here</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Panel - Task Detail */}
          <div className="w-1/2 overflow-y-auto bg-white">
            {selectedTask ? (
              <div className="p-6 space-y-6">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={(e) => handleToggleStatus(selectedTask, e)}
                    disabled={updatingTaskId === selectedTask.taskId}
                    className={cn(
                      'w-6 h-6 rounded border-2 flex items-center justify-center mt-0.5 shrink-0',
                      selectedTask.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'
                    )}
                  >
                    {updatingTaskId === selectedTask.taskId ? <Loader2 className="w-4 h-4 animate-spin" /> : selectedTask.status === 'done' && <Check className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-semibold text-gray-900">{selectedTask.title}</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      {getWorkspaceName(selectedTask.projectId)} » {getProjectName(selectedTask.projectId)}
                    </p>
                  </div>
                  {selectedTask.assignees && selectedTask.assignees.length > 0 && (
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <Users className="w-4 h-4" />
                      <span>{selectedTask.assignees.length}</span>
                    </div>
                  )}
                </div>

                {/* Tags */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowTagInput(!showTagInput)}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                  >
                    <Tag className="w-4 h-4" />
                    Tag task
                  </button>
                  {(showTagInput || (selectedTask.tags && selectedTask.tags.length > 0)) && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(selectedTask.tags || []).map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-sm">
                          {tag}
                          <button type="button" onClick={() => handleSaveTask({ tags: (selectedTask.tags || []).filter(t => t !== tag) })} className="hover:text-red-600">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {showTagInput && (
                        <div className="flex gap-1">
                          <Input
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            placeholder="Add tag..."
                            className="w-24 h-8 text-sm"
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                          />
                          <Button type="button" size="sm" onClick={handleAddTag} className="h-8">Add</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {selectedTask.assignees?.[0] && (
                  <div className="flex items-center gap-3">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={selectedTask.assignees[0].photoURL} />
                      <AvatarFallback className="bg-teal-500 text-white text-sm">
                        {selectedTask.assignees[0].displayName?.charAt(0).toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-gray-700">{selectedTask.assignees[0].displayName}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="w-4 h-4" />
                  <span>{getDueDateLabel(selectedTask) || 'No due date'}</span>
                </div>

                <div className="flex items-center gap-3 border-y py-3">
                  <button type="button" onClick={() => setTaskModalOpen(true)} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
                    <FileText className="w-4 h-4" />Edit description
                  </button>
                  <button type="button" onClick={() => setTaskModalOpen(true)} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
                    <ListTree className="w-4 h-4" />Add subtasks
                  </button>
                  <span className="flex items-center gap-1.5 text-sm text-gray-400 cursor-not-allowed">
                    <Link2 className="w-4 h-4" />Add dependencies
                  </span>
                </div>

                {selectedTask.description && (
                  <div>
                    <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                      {selectedTask.description.split('\n').filter(Boolean).map((line, i) => (
                        <li key={i}>{line.replace(/^[-•]\s*/, '')}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-gray-400 mt-2">
                      Added by {selectedTask.createdBy || 'Unknown'} · {selectedTask.createdAt ? formatDistanceToNow(new Date(selectedTask.createdAt), { addSuffix: true }) : ''}
                    </p>
                  </div>
                )}

                {/* Subtasks */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Subtasks</h4>
                  <div className="space-y-1">
                    {(selectedTask.subtasks && selectedTask.subtasks.length > 0) ? (
                      selectedTask.subtasks.map((subtask) => (
                        <div key={subtask.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 group">
                          <GripVertical className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100" />
                          <button
                            type="button"
                            onClick={() => handleToggleInlineSubtask(subtask.id)}
                            disabled={updatingTaskId === selectedTask.taskId}
                            className={cn('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0', subtask.completed ? 'bg-green-500 border-green-500' : 'border-gray-300')}
                          >
                            {subtask.completed && <Check className="w-3 h-3 text-white" />}
                          </button>
                          <span className={cn('text-sm flex-1', subtask.completed && 'line-through text-gray-400')}>{subtask.title}</span>
                        </div>
                      ))
                    ) : subtasksForSelected.length > 0 ? (
                      subtasksForSelected.map((subtask) => (
                        <div key={subtask.taskId} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 group">
                          <GripVertical className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100" />
                          <button
                            type="button"
                            onClick={(e) => handleToggleStatus(subtask, e)}
                            disabled={updatingTaskId === subtask.taskId}
                            className={cn('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0', subtask.status === 'done' ? 'bg-green-500 border-green-500' : 'border-gray-300')}
                          >
                            {subtask.status === 'done' && <Check className="w-3 h-3 text-white" />}
                          </button>
                          <span className={cn('text-sm flex-1', subtask.status === 'done' && 'line-through text-gray-400')}>{subtask.title}</span>
                        </div>
                      ))
                    ) : null}
                    <div className="flex items-center gap-2 py-1.5 px-2">
                      <div className="w-4" />
                      <Circle className="w-5 h-5 text-gray-300 shrink-0" />
                      <input
                        type="text"
                        value={newSubtaskTitle}
                        onChange={(e) => setNewSubtaskTitle(e.target.value)}
                        placeholder="Add a subtask..."
                        className="flex-1 text-sm outline-none bg-transparent placeholder:text-gray-400"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask(); } }}
                      />
                      <Button type="button" size="sm" onClick={handleAddSubtask} disabled={!newSubtaskTitle.trim()} className="h-7 text-xs">Add</Button>
                    </div>
                  </div>
                </div>

                {/* Comments / Activity */}
                <div className="border-t pt-4">
                  <Tabs value={activeDetailTab} onValueChange={(v) => setActiveDetailTab(v as 'comments' | 'activity')}>
                    <TabsList className="h-9 bg-transparent p-0 gap-4 mb-4">
                      <TabsTrigger value="comments" className="px-0 py-2 h-auto rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none font-medium text-sm">
                        COMMENTS
                      </TabsTrigger>
                      <TabsTrigger value="activity" className="px-0 py-2 h-auto rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none font-medium text-sm">
                        ALL ACTIVITY
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="comments" className="space-y-4">
                      <div className="border rounded-lg">
                        <Textarea
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Write a comment..."
                          rows={2}
                          className="border-0 resize-none focus-visible:ring-0"
                        />
                        <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50">
                          <div className="flex items-center gap-2">
                            <EmojiPickerButton value={newComment} onChange={setNewComment} />
                            <input
                              ref={commentFileInputRef}
                              type="file"
                              multiple
                              accept="*/*"
                              className="hidden"
                              onChange={(e) => {
                                const files = e.target.files;
                                if (files?.length) setCommentAttachmentFiles(prev => [...prev, ...Array.from(files)]);
                                e.target.value = '';
                              }}
                            />
                            <button type="button" onClick={() => commentFileInputRef.current?.click()} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 p-1.5 rounded hover:bg-gray-200">
                              <Paperclip className="w-4 h-4" />Attach files
                            </button>
                            <button type="button" onClick={() => setShowTimeSpent(!showTimeSpent)} className={cn('text-sm flex items-center gap-1', showTimeSpent ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700')}>
                              <Clock className="w-4 h-4" />Time spent
                            </button>
                          </div>
                          <Button size="sm" onClick={handleAddComment} disabled={(!newComment.trim() && commentAttachmentFiles.length === 0) || commentLoading}>
                            {commentLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Comment'}
                          </Button>
                        </div>
                        {showTimeSpent && (
                          <div className="flex items-center gap-2 px-3 py-2 border-t bg-gray-50">
                            <Input
                              type="number"
                              min={0}
                              value={commentTimeSpent === '' ? '' : commentTimeSpent}
                              onChange={(e) => setCommentTimeSpent(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                              placeholder="Minutes"
                              className="w-20 h-8"
                            />
                            <span className="text-sm text-gray-500">min</span>
                          </div>
                        )}
                        {commentAttachmentFiles.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t">
                            {commentAttachmentFiles.map((f, i) => (
                              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs">
                                {f.name}
                                <button type="button" onClick={() => setCommentAttachmentFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-500 hover:text-red-600">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {taskComments.map((comment) => (
                        <div key={comment.commentId} className="flex gap-3">
                          <Avatar className="w-8 h-8 shrink-0">
                            <AvatarImage src={comment.photoURL} />
                            <AvatarFallback className="bg-teal-500 text-white text-xs">
                              {comment.displayName?.charAt(0).toUpperCase() || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{comment.displayName}</span>
                              <span className="text-xs text-gray-500">{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</span>
                            </div>
                            {comment.timeSpentMinutes != null && comment.timeSpentMinutes > 0 && (
                              <span className="inline-block mt-1 px-2 py-0.5 bg-green-700 text-white text-xs rounded">
                                {Math.floor(comment.timeSpentMinutes / 60)}h {comment.timeSpentMinutes % 60}m
                              </span>
                            )}
                            {comment.text?.trim() && (
                              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{comment.text}</p>
                            )}
                            {comment.attachments && comment.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {comment.attachments.map((att) => (
                                  <a key={att.fileId} href={att.fileUrl} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-sm text-blue-600 hover:text-blue-800 border border-gray-200">
                                    <Paperclip className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate max-w-[180px]">{att.fileName}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </TabsContent>

                    <TabsContent value="activity" className="space-y-3">
                      <div className="space-y-2">
                        {taskComments.map((c) => (
                          <div key={c.commentId} className="flex items-start gap-3 text-sm">
                            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                              <span className="text-xs">{c.displayName?.charAt(0) || '?'}</span>
                            </div>
                            <div>
                              <span className="font-medium">{c.displayName}</span>
                              <span className="text-gray-500"> commented</span>
                              <span className="text-gray-400"> · {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
                              {c.timeSpentMinutes != null && c.timeSpentMinutes > 0 && (
                                <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded">
                                  +{Math.floor(c.timeSpentMinutes / 60)}h {c.timeSpentMinutes % 60}m
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        <div className="flex items-start gap-3 text-sm">
                          <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3 text-green-600" />
                          </div>
                          <div>
                            <span className="font-medium">{organization?.name || 'User'}</span>
                            <span className="text-gray-500"> created this task</span>
                            <span className="text-gray-400"> · {selectedTask.createdAt ? formatDistanceToNow(new Date(selectedTask.createdAt), { addSuffix: true }) : ''}</span>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <CheckSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="font-medium">Select a task</p>
                  <p className="text-sm">Click on a task to see details</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {selectedTask && (
          <TaskModal
            open={taskModalOpen}
            onClose={() => setTaskModalOpen(false)}
            task={selectedTask}
            projectId={selectedTask.projectId}
            projectName={getProjectName(selectedTask.projectId)}
            project={getProject(selectedTask.projectId) ?? null}
            onSave={async (input) => { await handleSaveTask(input as Record<string, unknown>); setTaskModalOpen(false); }}
            onDelete={undefined}
          />
        )}
      </main>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog({ ...confirmDialog, open: false })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmDialog.onConfirm();
                setConfirmDialog({ ...confirmDialog, open: false });
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MyTasks;
