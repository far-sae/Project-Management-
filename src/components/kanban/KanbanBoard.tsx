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
  closestCenter,
} from '@dnd-kit/core';
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
import {
  createNotificationsForTaskUpdate,
  addCommentWithGlobalSync,
  bulkUpdateTasks,
  bulkDeleteTasks,
  bulkReorderTasks,
} from '@/services/supabase/database';
import { KanbanColumnComponent } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { TaskModal } from './TaskModal';
import { BulkActionBar } from './BulkActionBar';
import type { PresencePeer } from '@/hooks/usePresence';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

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
}) => {
  const { user } = useAuth();
  const projName = projectName || project?.name || 'Project';
  const orgId =
    project?.organizationId || user?.organizationId || (user ? `local-${user.userId}` : '');

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

  // Clear selection on Escape
  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionMode, clearSelection]);

  // ── Column-edit modal state ────────────────────────────────
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [showEditColumnModal, setShowEditColumnModal] = useState(false);
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

  // ── DnD handlers ───────────────────────────────────────────
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task;
    if (task) setActiveTask(task);
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    /* reserved for future cross-column reorder previews */
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);

      if (!over) return;

      const taskId = active.id as string;
      const overId = over.id as string;
      const movedTask = tasks.find((t) => t.taskId === taskId);
      if (!movedTask) return;

      const isColumn = columns.some((col) => col.id === overId);
      const overTask = !isColumn ? tasks.find((t) => t.taskId === overId) : null;

      // Determine target status
      const targetStatus = isColumn
        ? overId
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
            }).catch(() => {});
          }
        }

        if (sort === 'manual' && orgId) {
          // Renumber to sparse 10/20/30… positions
          const ordering = reordered.map((t, idx) => ({
            taskId: t.taskId,
            position: (idx + 1) * 10,
          }));
          // Skip the moved task's status field if already updated above to avoid double-write.
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
    [selectionMode, handleTaskSelect],
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
          }).catch(() => {});
        }
      } else {
        const base = cleanInput as unknown as CreateTaskInput & {
          _initialComment?: string;
        };
        const initialComment = base._initialComment;
        const parentPayload: CreateTaskInput = {
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
          projectName: base.projectName,
          createdByDisplayName: base.createdByDisplayName,
          createdByPhotoURL: base.createdByPhotoURL,
        };
        const newTask = await addTask(parentPayload);
        if (!newTask) {
          throw new Error('Failed to create task. Please try again.');
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
    [selectedTask, addTask, editTask, projectId, user, projName, project],
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      await removeTask(taskId);
    },
    [removeTask],
  );

  const handleCreateSubtasks = useCallback(
    async (subtasks: CreateTaskInput[]) => {
      for (const subtask of subtasks) {
        const newSubtask = await addTask({
          ...subtask,
          parentTaskId: selectedTask?.taskId ?? subtask.parentTaskId,
        });
        if (!newSubtask)
          throw new Error('Failed to create subtask. Please try again.');
      }
    },
    [addTask, selectedTask],
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
      try {
        await bulkUpdateTasks(ids, patch, orgId);
        toast.success(successMessage);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Bulk update failed');
      }
    },
    [orgId, ids],
  );

  const handleBulkDelete = useCallback(async () => {
    if (!orgId || ids.length === 0) return;
    try {
      await bulkDeleteTasks(ids, orgId);
      toast.success(`Deleted ${ids.length} task${ids.length > 1 ? 's' : ''}`);
      clearSelection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk delete failed');
    }
  }, [orgId, ids, clearSelection]);

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
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 pb-4 px-4 min-w-max">
          {columns
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((column) => (
              <KanbanColumnComponent
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
              />
            ))}

          <div className="flex-shrink-0 w-72">
            <Button
              variant="outline"
              className="w-full h-12 border-dashed border-2 text-muted-foreground hover:text-foreground hover:border-foreground/30"
              onClick={() => setShowAddColumnModal(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Column
            </Button>
          </div>
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
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
