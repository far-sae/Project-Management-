import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Task } from '@/types';
import { TaskCard } from './TaskCard';
import { InlineAddCard } from './InlineAddCard';
import { TaskCardSkeleton } from './TaskCardSkeleton';
import { Plus, MoreHorizontal, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PresencePeer } from '@/hooks/usePresence';

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  tasks: Task[];
  onTaskClick?: (task: Task, event?: React.MouseEvent) => void;
  onAddTask?: (status: string) => void;
  onEditColumn?: () => void;
  onInlineAdd?: (status: string, title: string) => Promise<void> | void;
  loading?: boolean;
  /** Set of task ids currently selected in multi-select mode. */
  selectedIds?: Set<string>;
  selectionMode?: boolean;
  onTaskSelectChange?: (taskId: string, event: React.MouseEvent) => void;
  /** Map of taskId -> peers currently focused on that task. */
  peersByTask?: Map<string, PresencePeer[]>;
  /** Per-task: disable drag when true (locked + no permission). */
  isTaskDragDisabled?: (task: Task) => boolean;
}

export const KanbanColumnComponent: React.FC<KanbanColumnProps> = ({
  id,
  title,
  color,
  tasks,
  onTaskClick,
  onAddTask,
  onEditColumn,
  onInlineAdd,
  loading = false,
  selectedIds,
  selectionMode = false,
  onTaskSelectChange,
  peersByTask,
  isTaskDragDisabled,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { status: id },
  });

  return (
    <div
      className={cn(
        'flex flex-col w-72 min-w-72 bg-surface-2 rounded-xl border border-border',
        isOver && 'ring-2 ring-primary/50',
      )}
    >
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <h3 className="font-semibold text-sm text-foreground truncate">
              {title}
            </h3>
            <span className="text-[11px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full font-medium">
              {tasks.length}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {onAddTask && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => onAddTask(id)}
                aria-label="Add task with full editor"
                title="Open full editor"
              >
                <Plus className="w-4 h-4" />
              </Button>
            )}
            {onEditColumn && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={onEditColumn}
                aria-label="Edit column"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 px-3 pb-3 overflow-y-auto min-h-[200px] max-h-[calc(100vh-260px)]',
          isOver && 'bg-primary/5',
        )}
      >
        {onInlineAdd && (
          <InlineAddCard onSubmit={(title) => onInlineAdd(id, title)} />
        )}

        {loading ? (
          <TaskCardSkeleton count={3} />
        ) : (
          <SortableContext
            items={tasks.map((t) => t.taskId)}
            strategy={verticalListSortingStrategy}
          >
            {tasks.map((task) => (
              <TaskCard
                key={task.taskId}
                task={task}
                onClick={onTaskClick}
                selectable={selectionMode}
                selected={selectedIds?.has(task.taskId)}
                onSelectChange={onTaskSelectChange}
                peersOnTask={peersByTask?.get(task.taskId)}
                dragDisabled={isTaskDragDisabled?.(task) ?? false}
              />
            ))}
          </SortableContext>
        )}

        {!loading && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-8 px-3 rounded-lg border-2 border-dashed border-border/70">
            <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center mb-2">
              <Inbox className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">
              No tasks here
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add the first one above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export const KanbanColumn = KanbanColumnComponent;

export default KanbanColumnComponent;
