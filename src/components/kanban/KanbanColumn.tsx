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

export interface KanbanColumnProps {
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
  /** First task selected in "swap two tasks" mode (for highlight). */
  swapPickId?: string | null;
  /** When using horizontal column reorder, ref + style on the column shell. */
  boardColumnRef?: React.Ref<HTMLDivElement>;
  boardColumnStyle?: React.CSSProperties;
  boardColumnClassName?: string;
  /** Rendered in the header (e.g. column reorder grip). */
  orderHandle?: React.ReactNode;
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
  swapPickId = null,
  boardColumnRef,
  boardColumnStyle,
  boardColumnClassName,
  orderHandle,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { status: id },
  });

  return (
    <div
      ref={boardColumnRef}
      style={boardColumnStyle}
      className={cn(
        'flex w-[18.5rem] min-w-[18.5rem] flex-col overflow-hidden',
        'rounded-lg border border-border/70 bg-card/90',
        'shadow-sm shadow-black/10 ring-1 ring-inset ring-white/5 backdrop-blur',
        isOver && 'ring-2 ring-primary/40 ring-offset-0 border-primary/25',
        boardColumnClassName,
      )}
    >
      <div className="h-1 w-full" style={{ backgroundColor: color }} />
      <div className="px-3.5 pt-3 pb-2.5">
        <div className="flex items-center justify-between gap-1 mb-1">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {orderHandle}
            <div
              className="w-2 h-2 rounded-full shrink-0 ring-2 ring-background shadow-sm"
              style={{ backgroundColor: color }}
            />
            <h3 className="font-semibold text-[14px] leading-tight tracking-tight text-foreground truncate">
              {title}
            </h3>
            <span className="text-[11px] tabular-nums text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded font-medium">
              {tasks.length}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {onAddTask && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
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
                className="h-7 w-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
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
          'flex-1 px-3 pb-3 overflow-y-auto min-h-[220px] max-h-[calc(100vh-260px)]',
          'rounded-b-lg',
          isOver && 'bg-primary/[0.06]',
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
                swapHighlight={Boolean(swapPickId && swapPickId === task.taskId)}
              />
            ))}
          </SortableContext>
        )}

        {!loading && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-9 text-center">
            <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-lg bg-background/60">
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
