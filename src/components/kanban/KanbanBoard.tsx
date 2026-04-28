import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  Task,
  KanbanColumn,
  DEFAULT_COLUMNS,
  CreateTaskInput,
  Project,
  UpdateTaskInput,
  TaskPriority,
} from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  createNotification,
  createNotificationsForTaskUpdate,
  addCommentWithGlobalSync,
  bulkUpdateTasks,
  bulkDeleteTasks,
  bulkReorderTasks,
} from '@/services/supabase/database';
import { logger } from '@/lib/logger';
import { SortableBoardColumn } from './SortableBoardColumn';
import {
  boardColumnSortId,
  parseBoardColumnSortId,
  kanbanBoardCollisionDetection,
} from './boardColumnSortIds';
import { TaskCard } from './TaskCard';
import { TaskModal } from './TaskModal';
import { BulkActionBar } from './BulkActionBar';
import type { PresencePeer } from '@/hooks/usePresence';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openCommandPalette } from '@/components/layout/AppHeader';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, ArrowLeftRight, Wand2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { isTaskLockUnlockedInSession } from '@/lib/taskLockPin';
import { AIQuickAddModal } from '@/components/ai/AIQuickAddModal';
import { AIMeetingNotesModal } from '@/components/ai/AIMeetingNotesModal';

export type TaskSortOption = 'manual' | 'priority' | 'due' | 'recent';

interface KanbanBoardProps {
  projectId: string;
  project?: Project | null;
  projectName?: string;
  columns?: KanbanColumn[];
  onColumnsChange?: (columns: KanbanColumn[]) => void;
  filterStatus?: string;
  searchQuery?: string;
  tasks: Task[];
  loading?: boolean;
  /** External sort selection (managed by ProjectView). */
  sort?: TaskSortOption;
  /** When set, the task modal opens for this task id (deep link). */
  openTaskId?: string | null;
  /** Called when the deep-linked task has been opened (so the parent
   * can clear its `?taskId` query param). */
  onOpenedTask?: () => void;
  addTask: (input: CreateTaskInput) => Promise<Task | null>;
  editTask: (taskId: string, input: UpdateTaskInput) => Promise<boolean>;
  removeTask: (taskId: string) => Promise<boolean>;
  /** Realtime peers connected to the same project channel. */
  presencePeers?: PresencePeer[];
  /** Notifies the parent which task the current user is viewing (modal). */
  onActiveTaskChange?: (taskId: string | null) => void;
  /** Broadcasts a typing event for a comment input on `taskId`. */
  broadcastTyping?: (taskId: string) => void;
  /** Returns peers currently typing on `taskId`. */
  typingPeers?: (taskId: string) => PresencePeer[];
  /** Refresh task list from the server (e.g. after bulk actions). */
  onTasksRefresh?: () => void | Promise<void>;
  /** When the user drags while a non-manual sort is active, parent can switch to manual. */
  onRequestManualSort?: () => void;
}

const COLUMN_COLORS = [
  '#9E9E9E', '#FF9800', '#2196F3', '#4CAF50', '#9C27B0',
  '#E91E63', '#00BCD4', '#FF5722', '#795548', '#607D8B',
];

const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

type SaveTaskPayload =
  | CreateTaskInput
  | (Partial<Task> & {
      projectId?: string;
      subtasks?: { id: string; title: string; completed: boolean }[];
    });

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  projectId,
  project,
  projectName,
  columns: initialColumns,
  onColumnsChange,
  filterStatus = 'all',
  searchQuery = '',
  tasks,
  loading = false,
  sort = 'manual',
  openTaskId,
  onOpenedTask,
  addTask,
  editTask,
  removeTask,
  presencePeers = [],
  onActiveTaskChange,
  broadcastTyping,
  typingPeers,
  onTasksRefresh,
  onRequestManualSort,
}) => {
  const { user } = useAuth();
  const projName = projectName || project?.name || 'Project';
  const orgId =
    project?.organizationId || user?.organizationId || (user ? `local-${user.userId}` : '');

  const { organization, isAdmin } = useOrganization();

  /** Project owner or org admin may edit/move locked tasks. */
  const canOverrideTaskLock = useMemo(() => {
    if (!user) return false;
    if (project?.ownerId === user.userId) return true;
    return isAdmin;
  }, [user, project?.ownerId, isAdmin]);

  const canMoveTask = useCallback(
    (t: Task) => {
      if (!t.isLocked) return true;
      if (canOverrideTaskLock) return true;
      if (t.hasLockPin && isTaskLockUnlockedInSession(t.taskId)) return true;
      return false;
    },
    [canOverrideTaskLock],
  );

  const isTaskDragDisabled = useCallback((t: Task) => !canMoveTask(t), [canMoveTask]);

  const getAssigneeEmail = useCallback(
    (userId: string) => organization?.members.find((m) => m.userId === userId)?.email,
    [organization?.members],
  );

  const [columns, setColumns] = useState<KanbanColumn[]>(
    initialColumns || DEFAULT_COLUMNS,
  );

  // ── Filtering + sorting ────────────────────────────────────
  const filteredTasks = useMemo(() => {
    let list = tasks.filter((t) => !t.parentTaskId);
    if (filterStatus && filterStatus !== 'all') {
      list = list.filter((t) => t.status === filterStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [tasks, filterStatus, searchQuery]);

  // ── DnD + modal state ─────────────────────────────────────
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeColumn, setActiveColumn] = useState<KanbanColumn | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState<string>('undefined');

  // ── Multi-select state ─────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const selectionMode = selectedIds.size > 0;

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, []);

  const [taskSwapMode, setTaskSwapMode] = useState(false);
  const [swapPickId, setSwapPickId] = useState<string | null>(null);

  // Clear selection on Escape
  useEffect(() => {
    if (!selectionMode && !taskSwapMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelection();
        setTaskSwapMode(false);
        setSwapPickId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionMode, taskSwapMode, clearSelection]);

  const handleSwapPair = useCallback(
    async (idA: string, idB: string) => {
      const a = tasks.find((t) => t.taskId === idA);
      const b = tasks.find((t) => t.taskId === idB);

      const finish = () => {
        setSwapPickId(null);
        setTaskSwapMode(false);
      };

      if (!a || !b) {
        finish();
        return;
      }
      if (!canMoveTask(a) || !canMoveTask(b)) {
        toast.error(
          'One of these tasks is locked. Unlock with PIN, or ask the project owner or an admin.',
        );
        finish();
        return;
      }

      const origA = { status: a.status, position: a.position ?? 0 };
      const origB = { status: b.status, position: b.position ?? 0 };

      const firstOk = await editTask(idA, {
        status: origB.status,
        position: origB.position,
      });
      if (!firstOk) {
        toast.error('Could not move the first task. Swap cancelled.');
        finish();
        await onTasksRefresh?.();
        return;
      }

      const secondOk = await editTask(idB, {
        status: origA.status,
        position: origA.position,
      });
      if (!secondOk) {
        const rolledBack = await editTask(idA, {
          status: origA.status,
          position: origA.position,
        });
        if (!rolledBack) {
          toast.error(
            'Swap failed partway through and the first task could not be restored. Refresh the page or try again.',
          );
        } else {
          toast.error(
            'Could not complete the swap; the first task was restored to its original place.',
          );
        }
        finish();
        await onTasksRefresh?.();
        return;
      }

      toast.success('Swapped task places');
      finish();
      await onTasksRefresh?.();
    },
    [tasks, editTask, canMoveTask, onTasksRefresh],
  );

  // ── Column-edit modal state ────────────────────────────────
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [showEditColumnModal, setShowEditColumnModal] = useState(false);
  const [showAIQuickAdd, setShowAIQuickAdd] = useState(false);
  const [showAIMeetingNotes, setShowAIMeetingNotes] = useState(false);
  const [editingColumn, setEditingColumn] = useState<KanbanColumn | null>(null);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [newColumnColor, setNewColumnColor] = useState(COLUMN_COLORS[0]);

  useEffect(() => {
    if (initialColumns) {
      setColumns(initialColumns);
    }
  }, [initialColumns]);

  /** Ensures `onOpenedTask` runs at most once per deep-linked `openTaskId`. */
  const handledDeepLinkTaskIdRef = useRef<string | null>(null);

  // Deep-link: when ProjectView passes ?taskId, open the modal for that task
  useEffect(() => {
    if (!openTaskId) {
      handledDeepLinkTaskIdRef.current = null;
      return;
    }
    if (handledDeepLinkTaskIdRef.current === openTaskId) return;
    const target = tasks.find((t) => t.taskId === openTaskId);
    if (target) {
      handledDeepLinkTaskIdRef.current = openTaskId;
      setSelectedTask(target);
      setIsModalOpen(true);
      onOpenedTask?.();
    }
  }, [openTaskId, tasks, onOpenedTask]);

  // Tell parent which task the user is currently viewing so it can broadcast
  // it via presence; clear when the modal closes.
  useEffect(() => {
    if (!onActiveTaskChange) return;
    if (isModalOpen && selectedTask) {
      onActiveTaskChange(selectedTask.taskId);
    } else {
      onActiveTaskChange(null);
    }
  }, [isModalOpen, selectedTask, onActiveTaskChange]);

  // Map taskId -> peers currently focused on that task. Excludes self because
  // usePresence already tracks self separately.
  const peersByTask = useMemo(() => {
    const map = new Map<string, PresencePeer[]>();
    for (const peer of presencePeers) {
      if (!peer.currentTaskId) continue;
      if (peer.userId === user?.userId) continue;
      const list = map.get(peer.currentTaskId) ?? [];
      list.push(peer);
      map.set(peer.currentTaskId, list);
    }
    return map;
  }, [presencePeers, user?.userId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  // Apply sort + group by status. Manual sort uses `position`.
  const tasksByStatus = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const col of columns) map.set(col.id, []);
    for (const t of filteredTasks) {
      if (!map.has(t.status)) map.set(t.status, []);
      map.get(t.status)!.push(t);
    }
    const sorter = (a: Task, b: Task): number => {
      switch (sort) {
        case 'priority':
          return (
            (PRIORITY_RANK[a.priority] ?? 99) -
            (PRIORITY_RANK[b.priority] ?? 99)
          );
        case 'due': {
          const av = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bv = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return av - bv;
        }
        case 'recent': {
          const av = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bv = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bv - av;
        }
        case 'manual':
        default:
          return (a.position ?? 0) - (b.position ?? 0);
      }
    };
    for (const [k, list] of map.entries()) {
      list.sort(sorter);
      map.set(k, list);
    }
    return map;
  }, [filteredTasks, columns, sort]);

  const getTasksByStatus = useCallback(
    (status: string): Task[] => tasksByStatus.get(status) ?? [],
    [tasksByStatus],
  );

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns],
  );
  const columnSortIds = useMemo(
    () => sortedColumns.map((c) => boardColumnSortId(c.id)),
    [sortedColumns],
  );

  // ── DnD handlers ───────────────────────────────────────────
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (event.active.data.current?.type === 'column') {
        const columnId = event.active.data.current.columnId as string;
        const col = columns.find((c) => c.id === columnId);
        setActiveColumn(col ?? null);
        setActiveTask(null);
        return;
      }
      const task = event.active.data.current?.task as Task | undefined;
      if (task) {
        setActiveTask(task);
        setActiveColumn(null);
      }
    },
    [columns],
  );

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    /* reserved for future cross-column reorder previews */
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);
      setActiveColumn(null);

      if (!over) return;

      // Horizontal column reorder (grip in header; ids use board-col: prefix)
      if (active.data.current?.type === 'column') {
        const fromId = active.data.current.columnId as string;
        const toParsed = parseBoardColumnSortId(over.id);
        const toId =
          toParsed ||
          (typeof over.id === 'string' && columns.some((c) => c.id === over.id)
            ? over.id
            : null);
        if (toId && fromId && fromId !== toId) {
          const colIds = sortedColumns.map((c) => c.id);
          const oldIndex = colIds.indexOf(fromId);
          const newIndex = colIds.indexOf(toId);
          if (oldIndex >= 0 && newIndex >= 0) {
            const newOrderIds = arrayMove(colIds, oldIndex, newIndex);
            const reordered: KanbanColumn[] = newOrderIds.map((cid, i) => {
              const c = columns.find((x) => x.id === cid)!;
              return { ...c, order: i };
            });
            setColumns(reordered);
            onColumnsChange?.(reordered);
          }
        }
        return;
      }

      const taskId = active.id as string;
      const overId = over.id as string;
      const movedTask = tasks.find((t) => t.taskId === taskId);
      if (!movedTask) return;

      if (!canMoveTask(movedTask)) {
        toast.error(
          'This task is locked. Unlock with PIN, or ask the project owner or an admin.',
        );
        return;
      }

      if (sort !== 'manual') {
        onRequestManualSort?.();
      }

      // Dropping on column header uses board-col:… sortable id; map to real column
      const overColFromSort = parseBoardColumnSortId(overId);
      const effectiveOverId =
        overColFromSort && columns.some((c) => c.id === overColFromSort)
          ? overColFromSort
          : overId;

      const isColumn = columns.some((col) => col.id === effectiveOverId);
      const overTask = !isColumn
        ? tasks.find((t) => t.taskId === effectiveOverId)
        : null;

      // Determine target status
      const targetStatus = isColumn
        ? effectiveOverId
        : overTask?.status ?? movedTask.status;
      const statusChanged = targetStatus !== movedTask.status;

      // Compute new ordering inside target column
      const targetList = (tasksByStatus.get(targetStatus) ?? []).filter(
        (t) => t.taskId !== taskId,
      );
      let insertIndex = targetList.length;
      if (overTask && overTask.taskId !== taskId) {
        insertIndex = targetList.findIndex(
          (t) => t.taskId === overTask.taskId,
        );
        if (insertIndex < 0) insertIndex = targetList.length;
      }
      const reordered = [
        ...targetList.slice(0, insertIndex),
        movedTask,
        ...targetList.slice(insertIndex),
      ];

      // Persist status change first (if any), then reorder positions.
      try {
        if (statusChanged) {
          await editTask(taskId, { status: targetStatus });
          if (user) {
            createNotificationsForTaskUpdate({
              taskId,
              projectId,
              projectName: projName,
              taskTitle: movedTask.title,
              previousAssignees: movedTask.assignees || [],
              newAssignees: movedTask.assignees || [],
              previousStatus: movedTask.status,
              newStatus: targetStatus,
              actorUserId: user.userId,
              actorDisplayName: user.displayName || 'User',
              getAssigneeEmail,
            }).catch(() => {});
          }
        }

        if (orgId) {
          // Renumber to sparse 10/20/30… positions
          const ordering = reordered.map((t, idx) => ({
            taskId: t.taskId,
            position: (idx + 1) * 10,
          }));
          await bulkReorderTasks(ordering, orgId);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to reorder tasks',
        );
      }
    },
    [
      tasks,
      editTask,
      columns,
      user,
      projectId,
      projName,
      sort,
      orgId,
      tasksByStatus,
      canMoveTask,
      onRequestManualSort,
      getAssigneeEmail,
      sortedColumns,
      columns,
      onColumnsChange,
    ],
  );

  // ── Selection handlers ─────────────────────────────────────
  const handleTaskSelect = useCallback(
    (taskId: string, event: React.MouseEvent) => {
      const isShift = event.shiftKey;

      setSelectedIds((prev) => {
        const next = new Set(prev);

        if (isShift && lastSelectedId) {
          // Range select within all visible filtered tasks
          const flat = filteredTasks;
          const a = flat.findIndex((t) => t.taskId === lastSelectedId);
          const b = flat.findIndex((t) => t.taskId === taskId);
          if (a >= 0 && b >= 0) {
            const [s, e] = a < b ? [a, b] : [b, a];
            for (let i = s; i <= e; i += 1) next.add(flat[i].taskId);
            return next;
          }
        }

        if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
        }
        return next;
      });
      setLastSelectedId(taskId);
    },
    [filteredTasks, lastSelectedId],
  );

  // ── Card click ────────────────────────────────────────────
  const handleTaskClick = useCallback(
    (task: Task, event?: React.MouseEvent) => {
      if (taskSwapMode) {
        event?.preventDefault();
        event?.stopPropagation();
        if (!canMoveTask(task)) {
          toast.error(
            'This task is locked. Unlock with PIN, or ask the project owner or an admin.',
          );
          return;
        }
        if (!swapPickId) {
          setSwapPickId(task.taskId);
          toast.message('Choose the second task to swap places with.');
          return;
        }
        if (swapPickId === task.taskId) {
          setSwapPickId(null);
          toast.message('Selection cleared. Pick a task again.');
          return;
        }
        void handleSwapPair(swapPickId, task.taskId);
        return;
      }
      // In selection mode a click toggles selection instead of opening modal
      if (selectionMode) {
        if (event) handleTaskSelect(task.taskId, event);
        return;
      }
      // Cmd/Ctrl-click enters selection mode
      if (event && (event.metaKey || event.ctrlKey)) {
        handleTaskSelect(task.taskId, event);
        return;
      }
      setSelectedTask(task);
      setIsModalOpen(true);
    },
    [
      taskSwapMode,
      swapPickId,
      canMoveTask,
      handleSwapPair,
      selectionMode,
      handleTaskSelect,
    ],
  );

  const handleAddTask = useCallback((status: string) => {
    setSelectedTask(null);
    setNewTaskStatus(status);
    setIsModalOpen(true);
  }, []);

  // ── Inline add ────────────────────────────────────────────
  const handleInlineAdd = useCallback(
    async (status: string, title: string) => {
      try {
        const newTask = await addTask({
          projectId,
          title,
          status,
          projectName: projName,
          createdByDisplayName: user?.displayName,
          createdByPhotoURL: user?.photoURL,
        });
        if (!newTask) {
          toast.error('Could not create task. Please try again.');
        } else {
          queueMicrotask(() => openCommandPalette());
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to create task',
        );
      }
    },
    [addTask, projectId, projName, user],
  );

  // ── Modal save / delete (unchanged behavior) ──────────────
  const handleSaveTask = useCallback(
    async (input: SaveTaskPayload) => {
      const payloadSubtasks = (
        input as { subtasks?: { id: string; title: string; completed: boolean }[] }
      ).subtasks;
      const cleanInput = { ...input } as Record<string, unknown>;
      delete cleanInput.subtasks;

      if (selectedTask) {
        if (
          selectedTask.isLocked &&
          !canOverrideTaskLock &&
          (!selectedTask.hasLockPin ||
            !isTaskLockUnlockedInSession(selectedTask.taskId))
        ) {
          throw new Error(
            'This task is locked. Unlock with PIN, or ask the project owner or an admin.',
          );
        }
        const updatePayload = { ...cleanInput } as UpdateTaskInput & {
          activityBy?: { userId: string; displayName: string; photoURL?: string };
          assigneeChangedBy?: { userId: string; displayName: string };
        };
        if (payloadSubtasks !== undefined) updatePayload.subtasks = payloadSubtasks;
        if ((cleanInput as { activityBy?: unknown }).activityBy != null) {
          updatePayload.activityBy = (cleanInput as {
            activityBy: { userId: string; displayName: string; photoURL?: string };
          }).activityBy;
        }
        if ((cleanInput as { assigneeChangedBy?: unknown }).assigneeChangedBy != null) {
          updatePayload.assigneeChangedBy = (cleanInput as {
            assigneeChangedBy: { userId: string; displayName: string };
          }).assigneeChangedBy;
        }
        const ok = await editTask(selectedTask.taskId, updatePayload);
        if (!ok) throw new Error('Failed to update task');
        if (user) {
          const newAssignees =
            (updatePayload.assignees ?? selectedTask.assignees) ?? [];
          createNotificationsForTaskUpdate({
            taskId: selectedTask.taskId,
            projectId,
            projectName: projName,
            taskTitle: (updatePayload.title ?? selectedTask.title) ?? '',
            previousAssignees: selectedTask.assignees ?? [],
            newAssignees: Array.isArray(newAssignees) ? newAssignees : [],
            previousStatus: selectedTask.status,
            newStatus: updatePayload.status ?? selectedTask.status,
            actorUserId: user.userId,
            actorDisplayName: user.displayName || 'User',
            getAssigneeEmail,
          }).catch(() => {});
        }
      } else {
        const base = cleanInput as unknown as CreateTaskInput & {
          _initialComment?: string;
        };
        const initialComment = base._initialComment;
        const parentPayload: CreateTaskInput = {
          // Forward client-generated id when the modal pre-hashed a PIN against it.
          // Without this, the inserted row gets a different uuid and the PIN never matches.
          ...(base.taskId ? { taskId: base.taskId } : {}),
          projectId: base.projectId || projectId,
          title: base.title || '',
          description: base.description,
          status: base.status,
          priority: base.priority,
          dueDate: base.dueDate,
          assignees: base.assignees,
          tags: base.tags,
          subtasks:
            payloadSubtasks && payloadSubtasks.length > 0 ? payloadSubtasks : undefined,
          urgent: base.urgent,
          isLocked: base.isLocked,
          lockPinHash: base.lockPinHash,
          projectName: base.projectName,
          createdByDisplayName: base.createdByDisplayName,
          createdByPhotoURL: base.createdByPhotoURL,
        };
        const newTask = await addTask(parentPayload);
        if (!newTask) {
          throw new Error('Failed to create task. Please try again.');
        }
        queueMicrotask(() => openCommandPalette());

        if (user) {
          const assignees = parentPayload.assignees ?? [];
          void (async () => {
            try {
              if (assignees.length > 0) {
                await createNotificationsForTaskUpdate({
                  taskId: newTask.taskId,
                  projectId,
                  projectName: projName,
                  taskTitle: newTask.title,
                  previousAssignees: [],
                  newAssignees: assignees,
                  previousStatus: undefined,
                  newStatus: parentPayload.status,
                  actorUserId: user.userId,
                  actorDisplayName: user.displayName || 'User',
                  getAssigneeEmail,
                  includeActor: true,
                });
              } else {
                // New tasks start with empty assignees; without this, nothing is inserted and the bell stays empty.
                await createNotification({
                  userId: user.userId,
                  type: 'task_created',
                  title: 'Task created',
                  body: `You created "${newTask.title}" in ${projName}`,
                  taskId: newTask.taskId,
                  projectId,
                  actorUserId: user.userId,
                  actorDisplayName: user.displayName || 'User',
                });
              }
            } catch (e) {
              logger.warn('Notification after create failed:', e);
              toast.error(
                e instanceof Error
                  ? e.message
                  : 'Could not save notification. Apply Supabase migrations (notifications table + RLS).',
                { id: 'task-create-notification' },
              );
            }
          })();
        }
        if (newTask && initialComment?.trim() && user) {
          const orgIdLocal =
            project?.organizationId || user.organizationId || `local-${user.userId}`;
          const visibleToUserIds = Array.from(
            new Set([
              user.userId,
              ...(parentPayload.assignees || []).map((a) => a.userId),
            ]),
          );
          addCommentWithGlobalSync(
            newTask.taskId,
            projectId,
            projName,
            newTask.title,
            user.userId,
            user.displayName || 'User',
            user.photoURL || '',
            initialComment.trim(),
            visibleToUserIds,
            orgIdLocal,
          ).catch(() => {});
        }
      }
    },
    [
      selectedTask,
      addTask,
      editTask,
      projectId,
      user,
      projName,
      project,
      canOverrideTaskLock,
      getAssigneeEmail,
    ],
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      const t = tasks.find((x) => x.taskId === taskId);
      if (t?.isLocked && !canOverrideTaskLock) {
        toast.error('This task is locked. Only the project owner or an admin can delete it.');
        return;
      }
      await removeTask(taskId);
    },
    [removeTask, tasks, canOverrideTaskLock],
  );

  const handleCreateSubtasks = useCallback(
    async (subtasks: CreateTaskInput[]) => {
      if (selectedTask?.isLocked && !canOverrideTaskLock) {
        toast.error('This task is locked.');
        return;
      }
      for (const subtask of subtasks) {
        const newSubtask = await addTask({
          ...subtask,
          parentTaskId: selectedTask?.taskId ?? subtask.parentTaskId,
        });
        if (!newSubtask)
          throw new Error('Failed to create subtask. Please try again.');
      }
    },
    [addTask, selectedTask, canOverrideTaskLock],
  );

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedTask(null);
    setNewTaskStatus('undefined');
  }, []);

  // ── Bulk action helpers ────────────────────────────────────
  const ids = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const runBulk = useCallback(
    async (patch: UpdateTaskInput, successMessage: string) => {
      if (!orgId || ids.length === 0) return;
      const blocked = ids.filter((id) => {
        const t = tasks.find((x) => x.taskId === id);
        return t?.isLocked && !canOverrideTaskLock;
      });
      if (blocked.length > 0) {
        toast.error(
          'Some selected tasks are locked. Deselect them or ask a project owner or admin.',
        );
        return;
      }
      try {
        await bulkUpdateTasks(ids, patch, orgId);
        toast.success(successMessage);
        await onTasksRefresh?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Bulk update failed');
      }
    },
    [orgId, ids, onTasksRefresh, tasks, canOverrideTaskLock],
  );

  const handleBulkDelete = useCallback(async () => {
    if (!orgId || ids.length === 0) return;
    const blocked = ids.filter((id) => {
      const t = tasks.find((x) => x.taskId === id);
      return t?.isLocked && !canOverrideTaskLock;
    });
    if (blocked.length > 0) {
      toast.error(
        'Some selected tasks are locked. Deselect them or ask a project owner or admin.',
      );
      return;
    }
    try {
      await bulkDeleteTasks(ids, orgId);
      toast.success(`Deleted ${ids.length} task${ids.length > 1 ? 's' : ''}`);
      clearSelection();
      await onTasksRefresh?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk delete failed');
    }
  }, [orgId, ids, clearSelection, onTasksRefresh, tasks, canOverrideTaskLock]);

  // ── Column CRUD handlers (unchanged) ──────────────────────
  const handleAddColumn = useCallback(() => {
    if (!newColumnTitle.trim()) return;

    const newColumn: KanbanColumn = {
      id: `custom_${Date.now()}`,
      title: newColumnTitle,
      color: newColumnColor,
      order: columns.length,
    };

    const updatedColumns = [...columns, newColumn];
    setColumns(updatedColumns);
    onColumnsChange?.(updatedColumns);

    setNewColumnTitle('');
    setNewColumnColor(COLUMN_COLORS[0]);
    setShowAddColumnModal(false);
  }, [newColumnTitle, newColumnColor, columns, onColumnsChange]);

  const handleEditColumn = useCallback((column: KanbanColumn) => {
    setEditingColumn(column);
    setNewColumnTitle(column.title);
    setNewColumnColor(column.color);
    setShowEditColumnModal(true);
  }, []);

  const handleSaveColumnEdit = useCallback(() => {
    if (!editingColumn || !newColumnTitle.trim()) return;

    const updatedColumns = columns.map((col) =>
      col.id === editingColumn.id
        ? { ...col, title: newColumnTitle, color: newColumnColor }
        : col,
    );

    setColumns(updatedColumns);
    onColumnsChange?.(updatedColumns);

    setEditingColumn(null);
    setNewColumnTitle('');
    setShowEditColumnModal(false);
  }, [editingColumn, newColumnTitle, newColumnColor, columns, onColumnsChange]);

  const handleDeleteColumn = useCallback(
    async (columnId: string) => {
      if (columns.length <= 1) {
        alert('Cannot delete the last column');
        return;
      }

      const tasksInColumn = tasks.filter((t) => t.status === columnId);
      if (tasksInColumn.length > 0) {
        if (
          !confirm(
            `This column has ${tasksInColumn.length} tasks. Delete anyway? Tasks will be moved to the first column.`,
          )
        ) {
          return;
        }
        const firstColumn = columns.find((c) => c.id !== columnId);
        if (firstColumn) {
          await Promise.all(
            tasksInColumn.map((task) =>
              editTask(task.taskId, { status: firstColumn.id }),
            ),
          );
        }
      }

      const updatedColumns = columns.filter((col) => col.id !== columnId);
      setColumns(updatedColumns);
      onColumnsChange?.(updatedColumns);
      setShowEditColumnModal(false);
    },
    [columns, tasks, editTask, onColumnsChange],
  );

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={kanbanBoardCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {taskSwapMode && (
          <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-sm text-foreground">
            <span>
              {swapPickId
                ? 'Click another task to swap positions (status + order).'
                : 'Click one task, then another, to swap their places.'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setTaskSwapMode(false);
                setSwapPickId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        )}
        <div className="flex min-w-max gap-4 px-1 pb-5">
          <SortableContext
            items={columnSortIds}
            strategy={horizontalListSortingStrategy}
          >
            {sortedColumns.map((column) => (
              <SortableBoardColumn
                key={column.id}
                id={column.id}
                title={column.title}
                color={column.color}
                tasks={getTasksByStatus(column.id)}
                onTaskClick={handleTaskClick}
                onAddTask={handleAddTask}
                onEditColumn={() => handleEditColumn(column)}
                onInlineAdd={handleInlineAdd}
                loading={loading && tasks.length === 0}
                selectedIds={selectedIds}
                selectionMode={selectionMode}
                onTaskSelectChange={handleTaskSelect}
                peersByTask={peersByTask}
                isTaskDragDisabled={(t) => isTaskDragDisabled(t) || taskSwapMode}
                swapPickId={taskSwapMode ? swapPickId : null}
              />
            ))}
          </SortableContext>

          <div className="flex w-[18.5rem] flex-shrink-0 flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full justify-start rounded-lg border-violet-500/35 bg-violet-500/[0.08] text-violet-700 shadow-sm hover:bg-violet-500/[0.13] hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
              onClick={() => setShowAIQuickAdd(true)}
            >
              <Wand2 className="w-4 h-4 mr-2" />
              AI Quick Add
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full justify-start rounded-lg border-blue-500/35 bg-blue-500/[0.08] text-blue-700 shadow-sm hover:bg-blue-500/[0.13] hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
              onClick={() => setShowAIMeetingNotes(true)}
            >
              <FileText className="w-4 h-4 mr-2" />
              Notes → Tasks
            </Button>
            <Button
              type="button"
              variant={taskSwapMode ? 'secondary' : 'outline'}
              className="h-10 w-full justify-start rounded-lg border-dashed text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              onClick={() => {
                if (taskSwapMode) {
                  setTaskSwapMode(false);
                  setSwapPickId(null);
                } else {
                  clearSelection();
                  setTaskSwapMode(true);
                }
              }}
            >
              <ArrowLeftRight className="w-4 h-4 mr-2" />
              {taskSwapMode ? 'Cancel swap' : 'Swap two tasks'}
            </Button>
            <Button
              variant="outline"
              className="h-10 w-full justify-start rounded-lg border-dashed text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              onClick={() => setShowAddColumnModal(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Column
            </Button>
          </div>
        </div>

        <DragOverlay className="z-[600]">
          {activeTask ? (
            <TaskCard task={activeTask} isDragging />
          ) : activeColumn ? (
            <div className="flex w-[18.5rem] min-w-[18.5rem] flex-col rounded-lg border border-primary/35 bg-surface-2 p-3.5 shadow-2xl shadow-primary/15 ring-2 ring-primary/20">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-background"
                  style={{ backgroundColor: activeColumn.color }}
                />
                <p className="font-semibold text-[15px] tracking-tight truncate">
                  {activeColumn.title}
                </p>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <BulkActionBar
        selectedIds={selectedIds}
        tasks={filteredTasks}
        columns={columns}
        onClear={clearSelection}
        onSelectAll={() =>
          setSelectedIds(new Set(filteredTasks.map((t) => t.taskId)))
        }
        onSetStatus={async (status) =>
          runBulk({ status }, `Moved ${ids.length} task${ids.length > 1 ? 's' : ''}`)
        }
        onSetPriority={async (priority) =>
          runBulk(
            { priority },
            `Set priority on ${ids.length} task${ids.length > 1 ? 's' : ''}`,
          )
        }
        onSetDue={async (date) =>
          runBulk(
            { dueDate: date },
            date
              ? `Set due date on ${ids.length} task${ids.length > 1 ? 's' : ''}`
              : `Cleared due date on ${ids.length} task${ids.length > 1 ? 's' : ''}`,
          )
        }
        onDelete={handleBulkDelete}
      />

      <TaskModal
        key={selectedTask?.taskId ?? `new-${newTaskStatus}`}
        open={isModalOpen}
        onClose={handleCloseModal}
        task={selectedTask}
        projectId={projectId}
        projectName={projectName}
        project={project}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        onCreateSubtasks={handleCreateSubtasks}
        initialStatus={newTaskStatus}
        columns={columns}
        peersOnTask={
          selectedTask ? peersByTask.get(selectedTask.taskId) ?? [] : []
        }
        broadcastTyping={broadcastTyping}
        typingPeers={typingPeers}
      />

      {user && (
        <>
          <AIQuickAddModal
            open={showAIQuickAdd}
            onOpenChange={setShowAIQuickAdd}
            currentUserId={user.userId}
            projectId={projectId}
            projectName={projName}
            defaultStatus={sortedColumns[0]?.id || 'todo'}
            columns={columns.map((c) => ({ id: c.id, title: c.title }))}
            members={(organization?.members || [])
              .filter((m, i, arr) => arr.findIndex((x) => x.userId === m.userId) === i)
              .map((m) => ({
                userId: m.userId,
                displayName: m.displayName,
                email: m.email,
                photoURL: m.photoURL,
              }))}
            onCreate={async (input) => {
              const created = await addTask(input);
              if (!created) {
                throw new Error('Could not create task. Please try again.');
              }
              return created;
            }}
          />
          <AIMeetingNotesModal
            open={showAIMeetingNotes}
            onOpenChange={setShowAIMeetingNotes}
            currentUserId={user.userId}
            projectId={projectId}
            projectName={projName}
            defaultStatus={sortedColumns[0]?.id || 'todo'}
            columns={columns.map((c) => ({ id: c.id, title: c.title }))}
            members={(organization?.members || [])
              .filter((m, i, arr) => arr.findIndex((x) => x.userId === m.userId) === i)
              .map((m) => ({
                userId: m.userId,
                displayName: m.displayName,
                email: m.email,
                photoURL: m.photoURL,
              }))}
            onCreate={async (input) => {
              const created = await addTask(input);
              if (!created) {
                throw new Error('Could not create task');
              }
              return created;
            }}
          />
        </>
      )}

      {/* Add column modal */}
      <Dialog open={showAddColumnModal} onOpenChange={setShowAddColumnModal}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Add new column</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="columnTitle">Column name</Label>
              <Input
                id="columnTitle"
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                placeholder="e.g., In review, Blocked"
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {COLUMN_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewColumnColor(color)}
                    className={`w-8 h-8 rounded-full transition-transform ${
                      newColumnColor === color
                        ? 'ring-2 ring-offset-2 ring-foreground/40 scale-110'
                        : ''
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`Color ${color}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddColumnModal(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleAddColumn} disabled={!newColumnTitle.trim()}>
              Add column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit column modal */}
      <Dialog open={showEditColumnModal} onOpenChange={setShowEditColumnModal}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit column</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editColumnTitle">Column name</Label>
              <Input
                id="editColumnTitle"
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                placeholder="Column name"
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {COLUMN_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewColumnColor(color)}
                    className={`w-8 h-8 rounded-full transition-transform ${
                      newColumnColor === color
                        ? 'ring-2 ring-offset-2 ring-foreground/40 scale-110'
                        : ''
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`Color ${color}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-between">
            <Button
              variant="destructive"
              onClick={() =>
                editingColumn && handleDeleteColumn(editingColumn.id)
              }
            >
              Delete column
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowEditColumnModal(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveColumnEdit}
                disabled={!newColumnTitle.trim()}
              >
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default KanbanBoard;
