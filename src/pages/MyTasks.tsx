import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CheckSquare, Clock, Loader2, ChevronDown, ChevronLeft, Check,
  Tag, Paperclip, Calendar, FileText, ListTree,
  Link2, GripVertical, Circle, X, Users, KeyRound, Lock,
  Filter, LayoutList,
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
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { useOrganization } from '@/context/OrganizationContext';
import {
  isTaskLockUnlockedInSession,
  setTaskLockUnlockedInSession,
  clearTaskLockUnlockedInSession,
} from '@/lib/taskLockPin';
import { useAuth } from '@/context/AuthContext';
import {
  DateRangeFilter,
  DateRangeValue,
  ALL_TIME,
  inRange,
} from '@/components/common/DateRangeFilter';
import {
  Task,
  TaskComment,
  TaskSubtask,
  UpdateTaskInput,
  DEFAULT_COLUMNS,
  KanbanColumn,
} from '@/types';
import {
  isCompletedTaskStatus,
  resolveDoneColumnId,
  resolveReopenColumnId,
} from '@/lib/kanbanTaskColumn';
import { TaskModal } from '@/components/kanban/TaskModal';
import {
  updateTask,
  addCommentWithGlobalSync,
  subscribeToComments,
  verifyTaskLockPin,
  notifyTaskCommentMentions,
} from '@/services/supabase/database';
import { uploadCommentAttachment } from '@/services/supabase/storage';
import { cn } from '@/lib/utils';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { MentionTextarea } from '@/components/mentions/MentionTextarea';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { AIDailyBrief } from '@/components/ai/AIDailyBrief';
import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import {
  PriorityPill,
  TASK_LEVEL_SURFACE,
  UrgentBadge,
  taskLevel,
} from '@/components/common/TaskBadges';
import { urgentFirst } from '@/lib/myTasksOrder';

function startOfDayFromYmd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd.trim())) return null;
  const [y, m, d] = ymd.trim().split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/** Local midnight timestamp for the due calendar day (handles YYYY-MM-DD and Date values). */
function getDueCalendarDayStartMs(task: {
  dueDate?: Date | string | null;
}): number | null {
  if (task.dueDate == null) return null;
  const raw = task.dueDate;
  if (raw instanceof Date) {
    const d = new Date(raw.getTime());
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const [y, m, d] = raw.trim().split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (Number.isNaN(dt.getTime())) return null;
    dt.setHours(0, 0, 0, 0);
    return dt.getTime();
  }
  const d = new Date(raw as string | number);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Sentence-case label above a block in the detail panel. */
const SECTION_LABEL = 'text-sm font-medium text-muted-foreground';

/** The round done-check used on task rows and subtasks. */
const CheckMark: React.FC<{ checked: boolean; busy?: boolean }> = ({ checked, busy = false }) =>
  busy ? (
    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
  ) : (
    <span
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] transition-colors',
        checked
          ? 'border-success bg-success text-success-foreground'
          : 'border-muted-foreground/50 bg-background text-transparent',
      )}
    >
      <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
    </span>
  );

export const MyTasks: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { projects: allProjects } = useProjects();
  const { filterProjects, filterTasks } = useSelectedWorkspace();
  const projects = useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);
  const columnsByProjectId = useMemo(() => {
    const m = new Map<string, KanbanColumn[]>();
    for (const p of projects) {
      m.set(p.projectId, p.columns?.length ? p.columns : DEFAULT_COLUMNS);
    }
    return m;
  }, [projects]);
  const {
    tasksAssignedToMe: allAssignedToMe,
    loading,
    tasks: unscopedTasks,
    refresh,
  } = useAllTasks();
  const tasksAssignedToMe = useMemo(
    () => filterTasks(allAssignedToMe),
    [allAssignedToMe, filterTasks],
  );
  const allTasks = useMemo(() => filterTasks(unscopedTasks), [unscopedTasks, filterTasks]);
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<'mytasks' | 'updates'>('mytasks');
  const [activeDetailTab, setActiveDetailTab] = useState<'comments' | 'activity'>('comments');
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const closeTaskModal = useCallback(() => {
    if (selectedTask?.taskId && selectedTask.isLocked && selectedTask.hasLockPin) {
      clearTaskLockUnlockedInSession(selectedTask.taskId);
    }
    setTaskModalOpen(false);
  }, [selectedTask]);
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
  // Filter tasks by their due date when set. "All time" keeps tasks without a
  // due date visible; any preset/custom window only shows tasks whose dueDate
  // falls inside it.
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);

  const [myTasksPin, setMyTasksPin] = useState('');
  const [myTasksPinError, setMyTasksPinError] = useState(false);

  /**
   * PIN-locked tasks always require the PIN to view, even for the owner/creator/admin —
   * the PIN is the explicit security gate. (No-PIN locked tasks aren't surfaced via this
   * gate; they're managed via permissions in the kanban board.)
   */
  const taskNeedsPinToView = useCallback(
    (t: Task) =>
      Boolean(
        t.isLocked &&
          t.hasLockPin &&
          !isTaskLockUnlockedInSession(t.taskId),
      ),
    [],
  );

  useEffect(() => {
    setMyTasksPin('');
    setMyTasksPinError(false);
  }, [selectedTask?.taskId]);

  const handleMyTasksUnlock = useCallback(async () => {
    if (!selectedTask?.hasLockPin) return;
    const ok = await verifyTaskLockPin(selectedTask.taskId, myTasksPin);
    if (ok) {
      setTaskLockUnlockedInSession(selectedTask.taskId);
      setMyTasksPin('');
      setMyTasksPinError(false);
      toast.success('Unlocked — you can view and edit this task');
    } else {
      setMyTasksPinError(true);
      toast.error('Incorrect PIN');
    }
  }, [selectedTask, myTasksPin]);

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

  const commentMentionMembers = useMemo(() => {
    if (!user) return [];
    const fromOrg = organization?.members?.length
      ? organization.members.map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          email: m.email || '',
          photoURL: m.photoURL,
        }))
      : null;
    if (fromOrg?.length) return fromOrg;
    const p = selectedTask ? getProject(selectedTask.projectId) : null;
    return (p?.members ?? []).map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      email: m.email || '',
      photoURL: m.photoURL,
    }));
  }, [user, organization?.members, selectedTask, getProject]);

  const workloadDueDay = searchParams.get('dueDay')?.trim() || null;
  const workloadAssigneeId = searchParams.get('assigneeId')?.trim() || null;
  const workloadDeepLink =
    !!(workloadDueDay || workloadAssigneeId);

  const getAssigneeLabel = useCallback(
    (userId: string) => {
      if (userId === user?.userId) return 'You';
      const m = organization?.members?.find((x) => x.userId === userId);
      return m?.displayName || m?.email || 'Teammate';
    },
    [user?.userId, organization?.members],
  );

  const tasksForList = useMemo(() => {
    const targetDay = workloadDueDay ? startOfDayFromYmd(workloadDueDay) : null;

    let base: Task[];
    if (workloadAssigneeId && user?.userId && workloadAssigneeId !== user.userId) {
      base = allTasks.filter((t) => t.assignees?.some((a) => a.userId === workloadAssigneeId));
    } else {
      base = tasksAssignedToMe;
    }

    if (!targetDay) return base;

    return base.filter((t) => {
      const ms = getDueCalendarDayStartMs(t);
      if (ms == null || !targetDay) return false;
      return ms === targetDay.getTime();
    });
  }, [workloadDueDay, workloadAssigneeId, allTasks, tasksAssignedToMe, user?.userId]);

  const clearWorkloadQuery = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('dueDay');
      next.delete('assigneeId');
      return next;
    });
  }, [setSearchParams]);

  const commentsBlockedByTaskPin = Boolean(
    selectedTask && taskNeedsPinToView(selectedTask),
  );

  // Subscribe to comments for selected task (not while PIN-locked for this user)
  useEffect(() => {
    if (!selectedTask?.taskId || !orgId) {
      setTaskComments([]);
      return;
    }
    if (commentsBlockedByTaskPin) {
      setTaskComments([]);
      return;
    }
    const unsub = subscribeToComments(selectedTask.taskId, orgId, setTaskComments);
    return () => unsub();
  }, [selectedTask?.taskId, orgId, commentsBlockedByTaskPin]);

  // Toggle task status
  const handleToggleStatus = useCallback(async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const taskOrgId = task.organizationId || orgId;
    const cols = columnsByProjectId.get(task.projectId) ?? DEFAULT_COLUMNS;
    const completed = isCompletedTaskStatus(task.status, cols);
    const newStatus = completed
      ? resolveReopenColumnId(cols)
      : resolveDoneColumnId(cols);
    setUpdatingTaskId(task.taskId);
    try {
      await updateTask(task.taskId, { status: newStatus }, taskOrgId);
      await refresh();
      if (selectedTask?.taskId === task.taskId) {
        setSelectedTask({ ...selectedTask, status: newStatus });
      }
      toast.success(completed ? 'Task reopened' : 'Task completed!');
    } catch {
      toast.error('Failed to update task');
    } finally {
      setUpdatingTaskId(null);
    }
  }, [user, orgId, refresh, selectedTask, columnsByProjectId]);

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
      const attachments: { fileId: string; fileName: string; fileUrl: string; fileType: string; }[] = [];

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

      const commentBody = newComment.trim() || '';
      await addCommentWithGlobalSync(
        selectedTask.taskId,
        selectedTask.projectId,
        getProjectName(selectedTask.projectId),
        selectedTask.title,
        user.userId,
        user.displayName || user.email || 'User',
        user.photoURL || '',
        commentBody,
        visibleToUserIds,
        orgId,
        attachments.length > 0 ? attachments : undefined,
        timeSpent,
      );

      if (commentBody) {
        void notifyTaskCommentMentions({
          text: commentBody,
          members: commentMentionMembers.map((m) => ({
            userId: m.userId,
            displayName: m.displayName,
            email: m.email,
          })),
          actorUserId: user.userId,
          actorDisplayName: user.displayName || user.email || 'User',
          taskId: selectedTask.taskId,
          projectId: selectedTask.projectId,
          projectName: getProjectName(selectedTask.projectId),
          taskTitle: selectedTask.title,
        });
      }

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
  }, [newComment, commentTimeSpent, commentAttachmentFiles, selectedTask, user, orgId, getProjectName, organization, commentMentionMembers]);

  // Subtask counts
  const getSubtaskCount = useCallback((task: Task) => {
    const subtasks = allTasks.filter(t => t.parentTaskId === task.taskId);
    return {
      total: subtasks.length,
      completed: subtasks.filter((t) =>
        isCompletedTaskStatus(
          t.status,
          columnsByProjectId.get(t.projectId) ?? DEFAULT_COLUMNS,
        ),
      ).length,
    };
  }, [allTasks, columnsByProjectId]);

  // Filter and group tasks
  const taskGroups = useMemo(() => {
    let filteredTasks = tasksForList;
    if (filterStatus === 'active') {
      filteredTasks = tasksForList.filter(
        (t) =>
          !isCompletedTaskStatus(
            t.status,
            columnsByProjectId.get(t.projectId) ?? DEFAULT_COLUMNS,
          ),
      );
    } else if (filterStatus === 'completed') {
      filteredTasks = tasksForList.filter((t) =>
        isCompletedTaskStatus(
          t.status,
          columnsByProjectId.get(t.projectId) ?? DEFAULT_COLUMNS,
        ),
      );
    }

    // Date-range filter on dueDate (local calendar day). ALL_TIME passes everything through.
    if (dateRange.preset !== 'all') {
      filteredTasks = filteredTasks.filter((t) => {
        const ms = getDueCalendarDayStartMs(t);
        return ms != null && inRange(new Date(ms), dateRange);
      });
    }

    const groups: { label: string; tasks: Task[]; }[] = [];

    if (groupBy === 'dueDate') {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);
      const todayMs = today.getTime();
      const tomorrowMs = tomorrow.getTime();
      const nextWeekMs = nextWeek.getTime();

      const todayTasks = filteredTasks.filter((t) => getDueCalendarDayStartMs(t) === todayMs);
      const tomorrowTasks = filteredTasks.filter((t) => getDueCalendarDayStartMs(t) === tomorrowMs);
      const thisWeekTasks = filteredTasks.filter((t) => {
        const ms = getDueCalendarDayStartMs(t);
        return ms != null && ms > tomorrowMs && ms <= nextWeekMs;
      });
      const laterTasks = filteredTasks.filter((t) => {
        const ms = getDueCalendarDayStartMs(t);
        return ms != null && ms > nextWeekMs;
      });
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

    // Urgent tasks lead each group; everything else keeps its order.
    const isDone = (t: Task) =>
      isCompletedTaskStatus(t.status, columnsByProjectId.get(t.projectId) ?? DEFAULT_COLUMNS);
    return groups.map((g) => ({ ...g, tasks: urgentFirst(g.tasks, isDone) }));
  }, [tasksForList, groupBy, filterStatus, getProjectName, columnsByProjectId, dateRange]);

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

  const openCount = useMemo(
    () =>
      tasksAssignedToMe.filter(
        (t) =>
          !isCompletedTaskStatus(
            t.status,
            columnsByProjectId.get(t.projectId) ?? DEFAULT_COLUMNS,
          ),
      ).length,
    [tasksAssignedToMe, columnsByProjectId],
  );

  const dueTodayCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    return tasksAssignedToMe.filter((t) => {
      const cols = columnsByProjectId.get(t.projectId) ?? DEFAULT_COLUMNS;
      if (isCompletedTaskStatus(t.status, cols)) return false;
      const dueMs = getDueCalendarDayStartMs(t);
      if (dueMs === null) return false;
      return dueMs === todayMs;
    }).length;
  }, [tasksAssignedToMe, columnsByProjectId]);

  const overdueCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    return tasksAssignedToMe.filter((t) => {
      const cols = columnsByProjectId.get(t.projectId) ?? DEFAULT_COLUMNS;
      if (isCompletedTaskStatus(t.status, cols)) return false;
      const dueMs = getDueCalendarDayStartMs(t);
      if (dueMs === null) return false;
      return dueMs < todayMs;
    }).length;
  }, [tasksAssignedToMe, columnsByProjectId]);

  const selectedIsComplete = Boolean(
    selectedTask &&
      isCompletedTaskStatus(
        selectedTask.status,
        columnsByProjectId.get(selectedTask.projectId) ?? DEFAULT_COLUMNS,
      ),
  );

  const pageTitle = workloadDeepLink ? 'Workload' : 'My Tasks';
  const visibleCount = taskGroups.reduce((n, g) => n + g.tasks.length, 0);

  const selectedColumns = selectedTask
    ? columnsByProjectId.get(selectedTask.projectId) ?? DEFAULT_COLUMNS
    : DEFAULT_COLUMNS;
  const selectedStatusColumn = selectedTask
    ? selectedColumns.find((c) => c.id === selectedTask.status)
    : undefined;
  const selectedProject = selectedTask ? getProject(selectedTask.projectId) : undefined;
  const selectedIsOverdue = Boolean(
    selectedTask?.dueDate && new Date(selectedTask.dueDate) < new Date() && !selectedIsComplete,
  );
  const selectedInlineSubtasks = selectedTask?.subtasks ?? [];
  const selectedSubtaskProgress =
    selectedInlineSubtasks.length > 0
      ? {
          done: selectedInlineSubtasks.filter((s) => s.completed).length,
          total: selectedInlineSubtasks.length,
        }
      : subtasksForSelected.length > 0
        ? {
            done: subtasksForSelected.filter((t) => t.status === 'done').length,
            total: subtasksForSelected.length,
          }
        : null;

  const recentActivity = allTasks
    .filter((t) => t.assignees?.some((a) => a.userId === user?.userId))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <AppHeader left={<span className="text-sm font-semibold">{pageTitle}</span>} />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Task list. Full width on small screens; when a task is selected
              there, the list steps aside so the detail panel gets the whole
              screen (with a Back button to return). */}
          <div
            className={cn(
              'min-w-0 flex-1 overflow-y-auto lg:flex-[2_1_0%]',
              selectedTask && 'hidden lg:block',
            )}
          >
            <div className="flex flex-col gap-5 px-4 py-6 lg:px-6">
              <PageHeader
                title={pageTitle}
                description={
                  workloadDeepLink ? (
                    <>
                      Showing {tasksForList.length} task{tasksForList.length !== 1 ? 's' : ''}
                      {workloadAssigneeId ? (
                        <> for <span className="font-medium text-foreground">{getAssigneeLabel(workloadAssigneeId)}</span></>
                      ) : null}
                      {workloadDueDay && startOfDayFromYmd(workloadDueDay) ? (
                        <>
                          {' '}due{' '}
                          <span className="font-medium text-foreground">
                            {format(startOfDayFromYmd(workloadDueDay)!, 'MMM d, yyyy')}
                          </span>
                        </>
                      ) : workloadDueDay ? (
                        <> (invalid date filter)</>
                      ) : null}
                      .
                    </>
                  ) : (
                    <>
                      <span className="tabular-nums">{openCount}</span> open task{openCount !== 1 ? 's' : ''} assigned to you. Urgent tasks are always listed first.
                    </>
                  )
                }
                actions={
                  workloadDeepLink ? (
                    <Button type="button" variant="outline" size="sm" onClick={clearWorkloadQuery}>
                      Clear filter
                    </Button>
                  ) : (
                    <>
                      <StatusPill tone="neutral" dot={false}>
                        <span className="font-semibold tabular-nums">{tasksAssignedToMe.length}</span>
                        total
                      </StatusPill>
                      <StatusPill tone="neutral" dot={false}>
                        <span className="font-semibold tabular-nums">{dueTodayCount}</span>
                        due today
                      </StatusPill>
                      {overdueCount > 0 && (
                        <StatusPill tone="danger" dot={false}>
                          <span className="font-semibold tabular-nums">{overdueCount}</span>
                          overdue
                        </StatusPill>
                      )}
                    </>
                  )
                }
              />

              {user?.userId && !workloadDeepLink && (
                <AIDailyBrief
                  userId={user.userId}
                  userDisplayName={user.displayName || user.email || 'there'}
                  tasks={tasksAssignedToMe}
                  projectNames={Object.fromEntries(
                    projects.map((p) => [p.projectId, p.name]),
                  )}
                  onOpenTask={(taskId) => {
                    const t = tasksAssignedToMe.find((x) => x.taskId === taskId);
                    if (t) setSelectedTask(t);
                  }}
                />
              )}

              <div className="flex flex-col gap-4">
                <div className="sticky top-0 z-10 -mx-4 bg-background px-4 lg:-mx-6 lg:px-6">
                  <Tabs value={activeMainTab} onValueChange={(v) => setActiveMainTab(v as 'mytasks' | 'updates')}>
                    <TabsList className="flex w-full">
                      <TabsTrigger value="mytasks">My Tasks</TabsTrigger>
                      <TabsTrigger value="updates">Updates</TabsTrigger>
                    </TabsList>
                    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                              <LayoutList aria-hidden />
                              <span className="hidden font-normal text-muted-foreground sm:inline">Group:</span>
                              <span>
                                {groupBy === 'dueDate' ? 'Due date' : groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
                              </span>
                              <ChevronDown className="text-muted-foreground" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-48">
                            {(['dueDate', 'project', 'status', 'priority'] as const).map(g => {
                              const active = groupBy === g;
                              return (
                                <DropdownMenuItem
                                  key={g}
                                  onClick={() => setGroupBy(g)}
                                  className={cn(
                                    'flex items-center justify-between gap-2',
                                    active && 'font-medium',
                                  )}
                                >
                                  <span>{g === 'dueDate' ? 'Due Date' : g.charAt(0).toUpperCase() + g.slice(1)}</span>
                                  {active && <Check className="h-3.5 w-3.5" />}
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                              <Filter aria-hidden />
                              <span className="hidden font-normal text-muted-foreground sm:inline">Filter:</span>
                              <span className="capitalize">
                                {filterStatus === 'all' ? 'All' : filterStatus}
                              </span>
                              <ChevronDown className="text-muted-foreground" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-48">
                            {([['all', 'All Tasks'], ['active', 'Active Only'], ['completed', 'Completed Only']] as const).map(([val, label]) => {
                              const active = filterStatus === val;
                              return (
                                <DropdownMenuItem
                                  key={val}
                                  onClick={() => setFilterStatus(val)}
                                  className={cn(
                                    'flex items-center justify-between gap-2',
                                    active && 'font-medium',
                                  )}
                                >
                                  <span>{label}</span>
                                  {active && <Check className="h-3.5 w-3.5" />}
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <DateRangeFilter value={dateRange} onChange={setDateRange} />
                      </div>
                      <div className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
                        <span className="text-foreground">{visibleCount}</span>
                        <span>/{tasksForList.length}</span>
                      </div>
                    </div>
                  </Tabs>
                </div>

                {activeMainTab === 'mytasks' ? (
                  loading ? (
                    <div className="flex h-64 items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {taskGroups.map((group) => (
                        <section key={group.label} className="flex flex-col gap-2">
                          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            {group.label}
                            <span className="font-normal tabular-nums text-muted-foreground">
                              {group.tasks.length}
                            </span>
                          </h2>
                          <div className="overflow-hidden rounded-lg border border-border bg-background">
                            {group.tasks.map((task) => {
                              const isSelected = selectedTask?.taskId === task.taskId;
                              const cols = columnsByProjectId.get(task.projectId) ?? DEFAULT_COLUMNS;
                              const isDone = isCompletedTaskStatus(task.status, cols);
                              const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isDone;
                              const { total: subtaskTotal, completed: subtaskCompleted } = getSubtaskCount(task);
                              // Boards can name their done column anything, so tell
                              // taskLevel about "finished" in the one way it understands.
                              const level = taskLevel(isDone ? { ...task, status: 'done' } : task);
                              const dueLabel = getDueDateLabel(task);
                              return (
                                <div
                                  key={task.taskId}
                                  onClick={() => setSelectedTask(task)}
                                  data-level={level}
                                  className={cn(
                                    'flex min-h-11 cursor-pointer items-center gap-2.5 border-b px-3 py-1.5 text-sm transition-colors last:border-b-0',
                                    TASK_LEVEL_SURFACE[level],
                                    // Rows share one hairline; only the surface carries the level.
                                    'border-border/60',
                                    level !== 'urgent' && 'hover:bg-surface-2',
                                    isSelected && 'bg-secondary hover:bg-secondary',
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => handleToggleStatus(task, e)}
                                    disabled={updatingTaskId === task.taskId}
                                    className="-m-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label={isDone ? 'Mark as incomplete' : 'Mark as complete'}
                                  >
                                    <CheckMark checked={isDone} busy={updatingTaskId === task.taskId} />
                                  </button>
                                  {/* Title and meta share a line when there is room and
                                      fall onto two lines when there is not. */}
                                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                                    <div className="flex min-w-[9rem] flex-1 items-center gap-1.5">
                                      {task.isLocked && (
                                        <Lock className="h-3.5 w-3.5 shrink-0 text-warning-soft-foreground" aria-label="Locked" />
                                      )}
                                      <span
                                        className={cn(
                                          'truncate font-medium',
                                          isDone ? 'text-muted-foreground line-through' : 'text-foreground',
                                        )}
                                      >
                                        {task.title}
                                      </span>
                                      {subtaskTotal > 0 && (
                                        <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                                          <CheckSquare className="h-3 w-3" aria-hidden />
                                          {subtaskCompleted}/{subtaskTotal}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex min-w-0 max-w-full items-center gap-2">
                                      {task.urgent && <UrgentBadge muted={isDone} />}
                                      <PriorityPill priority={task.priority} color={task.priorityColor} muted={isDone} />
                                      <span
                                        className="w-[124px] min-w-0 shrink truncate text-xs text-muted-foreground"
                                        title={`${getWorkspaceName(task.projectId)} › ${getProjectName(task.projectId)}`}
                                      >
                                        {getProjectName(task.projectId)}
                                      </span>
                                      {task.tags?.slice(0, 2).map((t) => (
                                        <span
                                          key={t}
                                          className="hidden h-5 max-w-[88px] shrink-0 items-center rounded border border-border bg-background px-1.5 text-xs text-muted-foreground 2xl:inline-flex"
                                        >
                                          <span className="truncate">{t}</span>
                                        </span>
                                      ))}
                                      {task.assignees && task.assignees.length > 0 && (
                                        <div className="hidden shrink-0 -space-x-1.5 xl:flex">
                                          {task.assignees.slice(0, 3).map((a) => (
                                            <Avatar key={a.userId} className="h-5 w-5 border-2 border-background" title={a.displayName}>
                                              <AvatarImage src={a.photoURL} />
                                              <AvatarFallback className="bg-primary-soft text-[0.6875rem] font-medium text-primary-soft-foreground">
                                                {a.displayName?.charAt(0).toUpperCase() || '?'}
                                              </AvatarFallback>
                                            </Avatar>
                                          ))}
                                          {task.assignees.length > 3 && (
                                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-secondary px-1 text-[0.6875rem] font-medium text-secondary-foreground">
                                              +{task.assignees.length - 3}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <span
                                        className={cn(
                                          'min-w-16 shrink-0 whitespace-nowrap text-right text-xs font-medium tabular-nums',
                                          isOverdue ? 'text-destructive' : 'text-muted-foreground',
                                        )}
                                        title={dueLabel ? undefined : 'No due date'}
                                      >
                                        {dueLabel || '—'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                      {visibleCount === 0 && (
                        <div className="flex flex-col items-center gap-1 rounded-lg border border-border px-4 py-12 text-center">
                          <CheckSquare className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                          {workloadDeepLink ? (
                            <>
                              <p className="text-sm font-medium text-foreground">No tasks match this view</p>
                              <p className="text-xs text-muted-foreground">Try another day or clear the workload filter.</p>
                              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={clearWorkloadQuery}>
                                Clear filter
                              </Button>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-medium text-foreground">No tasks assigned to you</p>
                              <p className="text-xs text-muted-foreground">Tasks assigned to you will appear here</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                ) : recentActivity.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
                    <div className="overflow-hidden rounded-lg border border-border bg-background">
                      {recentActivity.map((task) => (
                        <div
                          key={task.taskId}
                          className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-border/60 px-4 py-2 text-sm transition-colors last:border-b-0 hover:bg-surface-2"
                          onClick={() => { setSelectedTask(task); setActiveMainTab('mytasks'); }}
                        >
                          <CheckSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-foreground">{task.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {isCompletedTaskStatus(task.status, columnsByProjectId.get(task.projectId) ?? DEFAULT_COLUMNS) ? 'Completed' : 'Updated'} · {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
                              {' · '}
                              {getWorkspaceName(task.projectId)} › {getProjectName(task.projectId)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : (
                  <div className="flex flex-col items-center gap-1 rounded-lg border border-border px-4 py-12 text-center">
                    <Calendar className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                    <p className="text-sm font-medium text-foreground">No recent updates</p>
                    <p className="text-xs text-muted-foreground">Activity on your tasks will appear here</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Selected-task panel. Sits beside the list on wide screens; on
              small ones it takes over the screen while a task is selected. */}
          <aside
            aria-label="Selected task"
            className={cn(
              'min-w-0 flex-1 overflow-y-auto bg-surface-2 lg:min-w-[340px] lg:max-w-[480px] lg:flex-[1_1_0%] lg:border-l lg:border-border',
              !selectedTask && 'hidden lg:block',
            )}
          >
            <div className="flex min-h-full flex-col">
              {selectedTask && (
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface-2 px-2 py-1.5 lg:hidden">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedTask(null)}
                    aria-label="Back to task list"
                  >
                    <ChevronLeft aria-hidden />
                    Back
                  </Button>
                  <span className="flex-1 truncate text-sm font-medium text-foreground">
                    {selectedTask.title}
                  </span>
                </div>
              )}
              {selectedTask ? (
                taskNeedsPinToView(selectedTask) ? (
                  <div className="mx-auto flex min-h-[320px] w-full max-w-sm flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                    <Lock className="h-5 w-5 text-muted-foreground" aria-hidden />
                    <h2 className="text-base font-semibold text-foreground">This task is locked</h2>
                    <p className="text-sm text-muted-foreground">
                      Enter the PIN to view details, comments, and activity on this panel.
                    </p>
                    <Input
                      type="password"
                      name="my-tasks-unlock-pin"
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                      data-form-type="other"
                      placeholder="PIN"
                      value={myTasksPin}
                      onChange={(e) => {
                        setMyTasksPin(e.target.value);
                        setMyTasksPinError(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleMyTasksUnlock();
                      }}
                      className={cn('max-w-xs', myTasksPinError && 'border-destructive')}
                    />
                    <Button type="button" onClick={() => void handleMyTasksUnlock()}>
                      <KeyRound aria-hidden />
                      Unlock
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
                      {(selectedTask.urgent ||
                        selectedTask.priority ||
                        (selectedTask.assignees && selectedTask.assignees.length > 0)) && (
                        <div className="flex flex-wrap items-center gap-1">
                          {selectedTask.urgent && <UrgentBadge muted={selectedIsComplete} />}
                          <PriorityPill
                            priority={selectedTask.priority}
                            color={selectedTask.priorityColor}
                            muted={selectedIsComplete}
                          />
                          {selectedTask.assignees && selectedTask.assignees.length > 0 && (
                            <span className="ml-auto inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                              <Users className="h-3.5 w-3.5" aria-hidden />
                              <span>{selectedTask.assignees.length}</span>
                            </span>
                          )}
                        </div>
                      )}

                      <h2 className="text-lg font-semibold tracking-tight text-foreground">{selectedTask.title}</h2>

                      <dl className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-y-2 text-sm">
                        <dt className="text-muted-foreground">Project</dt>
                        <dd className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-[2px]"
                            style={{ background: selectedProject?.coverColor || 'hsl(var(--primary))' }}
                          />
                          <span className="truncate">
                            <span className="font-normal text-muted-foreground">
                              {getWorkspaceName(selectedTask.projectId)} ›{' '}
                            </span>
                            {getProjectName(selectedTask.projectId)}
                          </span>
                        </dd>

                        <dt className="text-muted-foreground">Status</dt>
                        <dd className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/60"
                            style={selectedStatusColumn?.color ? { background: selectedStatusColumn.color } : undefined}
                          />
                          <span className="truncate">
                            {selectedStatusColumn?.title ?? (selectedIsComplete ? 'Done' : selectedTask.status)}
                          </span>
                        </dd>

                        {selectedTask.assignees?.[0] && (
                          <>
                            <dt className="text-muted-foreground">Assignee</dt>
                            <dd className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                              <Avatar className="h-5 w-5 shrink-0">
                                <AvatarImage src={selectedTask.assignees[0].photoURL} />
                                <AvatarFallback className="bg-primary-soft text-[0.6875rem] font-medium text-primary-soft-foreground">
                                  {selectedTask.assignees[0].displayName?.charAt(0).toUpperCase() || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate">{selectedTask.assignees[0].displayName}</span>
                            </dd>
                          </>
                        )}

                        <dt className="text-muted-foreground">Due date</dt>
                        <dd
                          className={cn(
                            'font-medium',
                            selectedIsOverdue
                              ? 'text-destructive'
                              : selectedTask.dueDate
                                ? 'text-foreground'
                                : 'font-normal text-muted-foreground',
                          )}
                        >
                          {getDueDateLabel(selectedTask) || 'No due date'}
                        </dd>
                      </dl>

                      {/* Tags */}
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowTagInput(!showTagInput)}
                          className="-ml-2.5 w-fit text-muted-foreground"
                        >
                          <Tag aria-hidden />
                          Tag task
                        </Button>
                        {(showTagInput || (selectedTask.tags && selectedTask.tags.length > 0)) && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(selectedTask.tags || []).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex h-5 items-center gap-1 rounded border border-border bg-background pl-1.5 pr-0.5 text-xs text-muted-foreground"
                              >
                                {tag}
                                <button
                                  type="button"
                                  onClick={() => handleSaveTask({ tags: (selectedTask.tags || []).filter((t) => t !== tag) })}
                                  className="flex h-4 w-4 items-center justify-center rounded-sm hover:bg-secondary hover:text-destructive"
                                  aria-label={`Remove tag ${tag}`}
                                >
                                  <X className="h-3 w-3" aria-hidden />
                                </button>
                              </span>
                            ))}
                            {showTagInput && (
                              <div className="flex items-center gap-1.5">
                                <Input
                                  value={tagInput}
                                  onChange={(e) => setTagInput(e.target.value)}
                                  placeholder="Add tag..."
                                  className="w-28"
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                                />
                                <Button type="button" variant="outline" onClick={handleAddTag}>Add</Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 border-t border-border pt-3">
                        <div className="-ml-2.5 flex flex-wrap items-center gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setTaskModalOpen(true)} className="text-muted-foreground">
                            <FileText aria-hidden />Edit description
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setTaskModalOpen(true)} className="text-muted-foreground">
                            <ListTree aria-hidden />Add subtasks
                          </Button>
                          <span className="inline-flex min-h-7 cursor-not-allowed items-center gap-1.5 px-2.5 text-xs font-medium text-muted-foreground/70">
                            <Link2 className="h-4 w-4" aria-hidden />Add dependencies
                          </span>
                        </div>

                        {selectedTask.description && (
                          <div>
                            <ul className="list-inside list-disc space-y-1 text-pretty text-sm leading-5 text-foreground">
                              {selectedTask.description.split('\n').filter(Boolean).map((line, i) => (
                                <li key={i}>{line.replace(/^[-•]\s*/, '')}</li>
                              ))}
                            </ul>
                            <p className="mt-2 text-xs text-muted-foreground">
                              Added by {selectedTask.createdBy ? getAssigneeLabel(selectedTask.createdBy) : 'Unknown'} · {selectedTask.createdAt ? formatDistanceToNow(new Date(selectedTask.createdAt), { addSuffix: true }) : ''}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Subtasks */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3 text-sm">
                          <h4 className={SECTION_LABEL}>Subtasks</h4>
                          {selectedSubtaskProgress && (
                            <>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {selectedSubtaskProgress.done} of {selectedSubtaskProgress.total}
                              </span>
                              <div className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10">
                                <div
                                  className="h-full rounded-full bg-foreground/70 transition-all"
                                  style={{ width: `${(selectedSubtaskProgress.done / selectedSubtaskProgress.total) * 100}%` }}
                                />
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex flex-col">
                          {(selectedTask.subtasks && selectedTask.subtasks.length > 0) ? (
                            selectedTask.subtasks.map((subtask) => (
                              <div key={subtask.id} className="group -mx-2 flex min-h-7 items-center gap-2 rounded-md px-2 text-sm hover:bg-secondary">
                                <button
                                  type="button"
                                  onClick={() => handleToggleInlineSubtask(subtask.id)}
                                  disabled={updatingTaskId === selectedTask.taskId}
                                  className="-m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={subtask.completed ? `Mark subtask "${subtask.title}" as incomplete` : `Mark subtask "${subtask.title}" as complete`}
                                >
                                  <CheckMark checked={subtask.completed} />
                                </button>
                                <span className={cn('min-w-0 flex-1', subtask.completed && 'text-muted-foreground line-through')}>{subtask.title}</span>
                                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 opacity-0 group-hover:opacity-100" aria-hidden />
                              </div>
                            ))
                          ) : subtasksForSelected.length > 0 ? (
                            subtasksForSelected.map((subtask) => (
                              <div key={subtask.taskId} className="group -mx-2 flex min-h-7 items-center gap-2 rounded-md px-2 text-sm hover:bg-secondary">
                                <button
                                  type="button"
                                  onClick={(e) => handleToggleStatus(subtask, e)}
                                  disabled={updatingTaskId === subtask.taskId}
                                  className="-m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={subtask.status === 'done' ? `Mark subtask "${subtask.title}" as incomplete` : `Mark subtask "${subtask.title}" as complete`}
                                >
                                  <CheckMark checked={subtask.status === 'done'} />
                                </button>
                                <span className={cn('min-w-0 flex-1', subtask.status === 'done' && 'text-muted-foreground line-through')}>{subtask.title}</span>
                                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 opacity-0 group-hover:opacity-100" aria-hidden />
                              </div>
                            ))
                          ) : null}
                          <div className="flex min-h-7 items-center gap-2 pt-1 text-sm">
                            <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                            <input
                              type="text"
                              value={newSubtaskTitle}
                              onChange={(e) => setNewSubtaskTitle(e.target.value)}
                              placeholder="Add a subtask..."
                              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask(); } }}
                            />
                            <Button type="button" variant="outline" size="sm" onClick={handleAddSubtask} disabled={!newSubtaskTitle.trim()}>Add</Button>
                          </div>
                        </div>
                      </div>

                      {/* Comments / Activity */}
                      <div className="border-t border-border pt-2">
                        <Tabs value={activeDetailTab} onValueChange={(v) => setActiveDetailTab(v as 'comments' | 'activity')}>
                          <TabsList className="flex w-full">
                            <TabsTrigger value="comments">Comments</TabsTrigger>
                            <TabsTrigger value="activity">All activity</TabsTrigger>
                          </TabsList>

                          <TabsContent value="comments" className="space-y-4">
                            <div className="rounded-lg border border-border bg-background">
                              <MentionTextarea
                                value={newComment}
                                onChange={setNewComment}
                                members={commentMentionMembers}
                                excludeUserId={user?.userId}
                                placeholder="Write a comment… (@ to mention)"
                                rows={2}
                                className="border-0 resize-none focus-visible:ring-0"
                              />
                              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-2 py-1.5">
                                <div className="flex flex-wrap items-center gap-1">
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
                                  <Button type="button" variant="ghost" size="sm" onClick={() => commentFileInputRef.current?.click()} className="text-muted-foreground">
                                    <Paperclip aria-hidden />Attach files
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowTimeSpent(!showTimeSpent)}
                                    aria-pressed={showTimeSpent}
                                    className={cn(showTimeSpent ? 'bg-secondary text-foreground' : 'text-muted-foreground')}
                                  >
                                    <Clock aria-hidden />Time spent
                                  </Button>
                                </div>
                                <Button size="sm" onClick={handleAddComment} disabled={(!newComment.trim() && commentAttachmentFiles.length === 0) || commentLoading}>
                                  {commentLoading ? <Loader2 className="animate-spin" /> : 'Comment'}
                                </Button>
                              </div>
                              {showTimeSpent && (
                                <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={commentTimeSpent === '' ? '' : commentTimeSpent}
                                    onChange={(e) => setCommentTimeSpent(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                                    placeholder="Minutes"
                                    aria-label="Time spent in minutes"
                                    className="w-24"
                                  />
                                  <span className="text-sm text-muted-foreground">min</span>
                                </div>
                              )}
                              {commentAttachmentFiles.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
                                  {commentAttachmentFiles.map((f, i) => (
                                    <span key={i} className="inline-flex h-5 max-w-full items-center gap-1 rounded border border-border bg-background pl-1.5 pr-0.5 text-xs text-muted-foreground">
                                      <span className="truncate">{f.name}</span>
                                      <button
                                        type="button"
                                        onClick={() => setCommentAttachmentFiles(prev => prev.filter((_, idx) => idx !== i))}
                                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-secondary hover:text-destructive"
                                        aria-label={`Remove attachment ${f.name}`}
                                      >
                                        <X className="h-3 w-3" aria-hidden />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {taskComments.map((comment) => (
                              <div key={comment.commentId} className="flex gap-2.5">
                                <Avatar className="h-7 w-7 shrink-0">
                                  <AvatarImage src={comment.photoURL} />
                                  <AvatarFallback className="bg-primary-soft text-xs font-medium text-primary-soft-foreground">
                                    {comment.displayName?.charAt(0).toUpperCase() || '?'}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-x-2">
                                    <span className="text-sm font-medium text-foreground">{comment.displayName}</span>
                                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</span>
                                  </div>
                                  {comment.timeSpentMinutes != null && comment.timeSpentMinutes > 0 && (
                                    <StatusPill tone="success" dot={false} className="mt-1 tabular-nums">
                                      {Math.floor(comment.timeSpentMinutes / 60)}h {comment.timeSpentMinutes % 60}m
                                    </StatusPill>
                                  )}
                                  {comment.text?.trim() && (
                                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-foreground">{comment.text}</p>
                                  )}
                                  {comment.attachments && comment.attachments.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {comment.attachments.map((att) => (
                                        <a key={att.fileId} href={att.fileUrl} target="_blank" rel="noopener noreferrer"
                                          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
                                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                          <span className="max-w-[180px] truncate">{att.fileName}</span>
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </TabsContent>

                          <TabsContent value="activity">
                            <div className="flex flex-col gap-2.5">
                              {taskComments.map((c) => (
                                <div key={c.commentId} className="flex items-start gap-2.5 text-sm">
                                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[0.6875rem] font-medium text-secondary-foreground">
                                    {c.displayName?.charAt(0) || '?'}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <span className="font-medium text-foreground">{c.displayName}</span>
                                    <span className="text-muted-foreground"> commented</span>
                                    <span className="text-muted-foreground"> · {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
                                    {c.timeSpentMinutes != null && c.timeSpentMinutes > 0 && (
                                      <StatusPill tone="success" dot={false} className="ml-2 align-middle tabular-nums">
                                        +{Math.floor(c.timeSpentMinutes / 60)}h {c.timeSpentMinutes % 60}m
                                      </StatusPill>
                                    )}
                                  </div>
                                </div>
                              ))}
                              <div className="flex items-start gap-2.5 text-sm">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                                  <Check className="h-3 w-3" aria-hidden />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="font-medium text-foreground">{organization?.name || 'User'}</span>
                                  <span className="text-muted-foreground"> created this task</span>
                                  <span className="text-muted-foreground"> · {selectedTask.createdAt ? formatDistanceToNow(new Date(selectedTask.createdAt), { addSuffix: true }) : ''}</span>
                                </div>
                              </div>
                            </div>
                          </TabsContent>
                        </Tabs>
                      </div>
                    </div>

                    <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-border bg-surface-2 px-4 py-3 lg:px-6">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 basis-[120px]"
                        onClick={() => setTaskModalOpen(true)}
                      >
                        Open task
                      </Button>
                      <Button
                        type="button"
                        className="flex-1 basis-[120px]"
                        onClick={(e) => handleToggleStatus(selectedTask, e)}
                        disabled={updatingTaskId === selectedTask.taskId}
                      >
                        {updatingTaskId === selectedTask.taskId ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                          <Check aria-hidden />
                        )}
                        {selectedIsComplete ? 'Mark incomplete' : 'Mark complete'}
                      </Button>
                    </div>
                  </>
                )
              ) : (
                <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
                  <CheckSquare className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium text-foreground">Select a task</p>
                  <p className="text-xs text-muted-foreground">Click on a task to see details</p>
                </div>
              )}
            </div>
          </aside>
        </div>

        {selectedTask && (
          <TaskModal
            open={taskModalOpen}
            onClose={closeTaskModal}
            task={selectedTask}
            projectId={selectedTask.projectId}
            projectName={getProjectName(selectedTask.projectId)}
            project={getProject(selectedTask.projectId) ?? null}
            onSave={async (input) => {
              await handleSaveTask(input as Record<string, unknown>);
              closeTaskModal();
            }}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default MyTasks;
