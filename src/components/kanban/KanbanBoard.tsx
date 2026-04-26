import React, { useState, useCallback, useEffect } from 'react';
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
import { Task, KanbanColumn, DEFAULT_COLUMNS, CreateTaskInput, Project, UpdateTaskInput } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { createNotificationsForTaskUpdate, addCommentWithGlobalSync } from '@/services/supabase/database';
import { KanbanColumnComponent } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { TaskModal } from './TaskModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Loader2, Plus } from 'lucide-react';

interface KanbanBoardProps {
  projectId: string;
  project?: Project | null;
  projectName?: string;
  columns?: KanbanColumn[];
  onColumnsChange?: (columns: KanbanColumn[]) => void;
  /** Filter: only show tasks with this status (or all if 'all') */
  filterStatus?: string;
  /** Filter: search in title/description */
  searchQuery?: string;
  tasks: Task[];
  loading?: boolean;
  addTask: (input: CreateTaskInput) => Promise<Task | null>;
  editTask: (taskId: string, input: UpdateTaskInput) => Promise<boolean>;
  removeTask: (taskId: string) => Promise<boolean>;
}

const COLUMN_COLORS = [
  '#9E9E9E', '#FF9800', '#2196F3', '#4CAF50', '#9C27B0',
  '#E91E63', '#00BCD4', '#FF5722', '#795548', '#607D8B',
];

type SaveTaskPayload = CreateTaskInput | (Partial<Task> & { projectId?: string; subtasks?: { id: string; title: string; completed: boolean }[] });

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
  addTask,
  editTask,
  removeTask,
}) => {
  const { user } = useAuth();
  const projName = projectName || project?.name || 'Project';
  const [columns, setColumns] = useState<KanbanColumn[]>(initialColumns || DEFAULT_COLUMNS);

  const filteredTasks = React.useMemo(() => {
    let list = tasks.filter((t) => !t.parentTaskId);
    if (filterStatus && filterStatus !== 'all') {
      list = list.filter((t) => t.status === filterStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q))
      );
    }
    return list;
  }, [tasks, filterStatus, searchQuery]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState<string>('undefined');
  
  // Column management state
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const getTasksByStatus = useCallback((status: string): Task[] => {
    return filteredTasks.filter((task) => task.status === status);
  }, [filteredTasks]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task;
    if (task) {
      setActiveTask(task);
    }
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Handle drag over if needed
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);

      if (!over) return;

      const taskId = active.id as string;
      const overId = over.id as string;

      // Check if dropped on a column
      const isColumn = columns.some((col) => col.id === overId);
      if (isColumn) {
        const newStatus = overId;
        const task = tasks.find((t) => t.taskId === taskId);
        if (task && task.status !== newStatus) {
          await editTask(taskId, { status: newStatus });
          if (user) {
            createNotificationsForTaskUpdate({
              taskId,
              projectId,
              projectName: projName,
              taskTitle: task.title,
              previousAssignees: task.assignees || [],
              newAssignees: task.assignees || [],
              previousStatus: task.status,
              newStatus,
              actorUserId: user.userId,
              actorDisplayName: user.displayName || 'User',
            }).catch(() => {});
          }
        }
      }
    },
    [tasks, editTask, columns, user, projectId, projName]
  );

  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  }, []);

  const handleAddTask = useCallback((status: string) => {
    setSelectedTask(null);
    setNewTaskStatus(status);
    setIsModalOpen(true);
  }, []);

  const handleSaveTask = useCallback(
    async (input: SaveTaskPayload) => {
      const payloadSubtasks = (input as { subtasks?: { id: string; title: string; completed: boolean }[] }).subtasks;
      const cleanInput = { ...input } as Record<string, unknown>;
      delete cleanInput.subtasks;

      if (selectedTask) {
        const updatePayload = { ...cleanInput } as UpdateTaskInput & {
          activityBy?: { userId: string; displayName: string; photoURL?: string };
          assigneeChangedBy?: { userId: string; displayName: string };
        };
        if (payloadSubtasks !== undefined) updatePayload.subtasks = payloadSubtasks;
        if ((cleanInput as { activityBy?: unknown }).activityBy != null) {
          updatePayload.activityBy = (cleanInput as { activityBy: { userId: string; displayName: string; photoURL?: string } }).activityBy;
        }
        if ((cleanInput as { assigneeChangedBy?: unknown }).assigneeChangedBy != null) {
          updatePayload.assigneeChangedBy = (cleanInput as { assigneeChangedBy: { userId: string; displayName: string } }).assigneeChangedBy;
        }
        const ok = await editTask(selectedTask.taskId, updatePayload);
        if (!ok) throw new Error('Failed to update task');
        if (user) {
          const newAssignees = (updatePayload.assignees ?? selectedTask.assignees) ?? [];
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
        const base = cleanInput as unknown as CreateTaskInput & { _initialComment?: string };
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
          subtasks: payloadSubtasks && payloadSubtasks.length > 0 ? payloadSubtasks : undefined,
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
          const orgId = project?.organizationId || user.organizationId || `local-${user.userId}`;
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
            orgId,
          ).catch(() => {});
        }
      }
    },
    [selectedTask, addTask, editTask, projectId, user, projName, project]
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      await removeTask(taskId);
    },
    [removeTask]
  );

  const handleCreateSubtasks = useCallback(
    async (subtasks: CreateTaskInput[]) => {
      for (const subtask of subtasks) {
        const newSubtask = await addTask({ ...subtask, parentTaskId: selectedTask?.taskId ?? subtask.parentTaskId });
        if (!newSubtask) throw new Error('Failed to create subtask. Please try again.');
      }
    },
    [addTask, selectedTask]
  );

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedTask(null);
    setNewTaskStatus('undefined');
  }, []);

  // Column management functions
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
    
    const updatedColumns = columns.map(col => 
      col.id === editingColumn.id 
        ? { ...col, title: newColumnTitle, color: newColumnColor }
        : col
    );
    
    setColumns(updatedColumns);
    onColumnsChange?.(updatedColumns);
    
    setEditingColumn(null);
    setNewColumnTitle('');
    setShowEditColumnModal(false);
  }, [editingColumn, newColumnTitle, newColumnColor, columns, onColumnsChange]);

  const handleDeleteColumn = useCallback((columnId: string) => {
    if (columns.length <= 1) {
      alert('Cannot delete the last column');
      return;
    }
    
    const tasksInColumn = tasks.filter(t => t.status === columnId);
    if (tasksInColumn.length > 0) {
      if (!confirm(`This column has ${tasksInColumn.length} tasks. Delete anyway? Tasks will be moved to the first column.`)) {
        return;
      }
      // Move tasks to first column
      const firstColumn = columns.find(c => c.id !== columnId);
      if (firstColumn) {
        tasksInColumn.forEach(task => {
          editTask(task.taskId, { status: firstColumn.id });
        });
      }
    }
    
    const updatedColumns = columns.filter(col => col.id !== columnId);
    setColumns(updatedColumns);
    onColumnsChange?.(updatedColumns);
    setShowEditColumnModal(false);
  }, [columns, tasks, editTask, onColumnsChange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

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
          {columns.sort((a, b) => a.order - b.order).map((column) => (
            <KanbanColumnComponent
              key={column.id}
              id={column.id}
              title={column.title}
              color={column.color}
              tasks={getTasksByStatus(column.id)}
              onTaskClick={handleTaskClick}
              onAddTask={handleAddTask}
              onEditColumn={() => handleEditColumn(column)}
            />
          ))}
          
          {/* Add Column Button */}
          <div className="flex-shrink-0 w-72">
            <Button
              variant="outline"
              className="w-full h-12 border-dashed border-2 text-gray-500 hover:text-gray-700 hover:border-gray-400"
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
      />

      {/* Add Column Modal */}
      <Dialog open={showAddColumnModal} onOpenChange={setShowAddColumnModal}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Add New Column</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="columnTitle">Column Name</Label>
              <Input
                id="columnTitle"
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                placeholder="e.g., In Review, Blocked, etc."
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
                      newColumnColor === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddColumnModal(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddColumn}
              className="bg-gradient-to-r from-orange-500 to-red-500"
              disabled={!newColumnTitle.trim()}
            >
              Add Column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Column Modal */}
      <Dialog open={showEditColumnModal} onOpenChange={setShowEditColumnModal}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit Column</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editColumnTitle">Column Name</Label>
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
                      newColumnColor === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-between">
            <Button 
              variant="destructive" 
              onClick={() => editingColumn && handleDeleteColumn(editingColumn.id)}
            >
              Delete Column
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowEditColumnModal(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleSaveColumnEdit}
                className="bg-gradient-to-r from-orange-500 to-red-500"
                disabled={!newColumnTitle.trim()}
              >
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default KanbanBoard;
