import React, { useCallback, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Task } from '@/types';
import { TaskCard } from './TaskCard';
import { InlineAddCard } from './InlineAddCard';
import { TaskCardSkeleton } from './TaskCardSkeleton';
import { Plus, MoreHorizontal, Inbox, ChevronDown } from 'lucide-react';
import { useScrollEdges } from '@/hooks/useScrollEdges';
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
  /** ✓ button on each card: mark the task done. */
  onMarkDone?: (task: Task) => void;
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
  onMarkDone,
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
  // The list is its own scroll area; show a "More tasks" button while cards
  // are hidden below, for people on a touchpad without a scroll wheel.
  const listRef = useRef<HTMLDivElement | null>(null);
  const setListRef = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );
  const { canScrollDown, scrollDown } = useScrollEdges(listRef);

  return (
    <div
      ref={boardColumnRef}
      style={boardColumnStyle}
      className={cn(
        'relative flex w-[18rem] min-w-[18rem] flex-col overflow-hidden',
        'rounded-xl bg-secondary',
        isOver && 'ring-2 ring-primary/40 ring-offset-0',
        boardColumnClassName,
      )}
    >
      <div className="px-3 pb-1.5 pt-2.5">
        <div className="flex min-h-7 items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {orderHandle}
            <div
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <h3 className="truncate text-sm font-semibold leading-tight text-foreground">
              {title}
            </h3>
            <span className="text-sm tabular-nums text-muted-foreground">
              {tasks.length}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {onAddTask && (
              <Button
                variant="ghost"
                size="icon"
                className="rounded-md text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground md:h-7 md:w-7 md:min-h-7 md:min-w-7"
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
                className="rounded-md text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground md:h-7 md:w-7 md:min-h-7 md:min-w-7"
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
        ref={setListRef}
        data-column-scroll
        className={cn(
          'kanban-scroll flex-1 min-h-0 px-2 pb-2 overflow-y-auto overscroll-contain',
          'rounded-b-xl',
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
                onMarkDone={onMarkDone}
              />
            ))}
          </SortableContext>
        )}

        {!loading && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-foreground/15 px-3 py-8 text-center">
            <Inbox className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">
              No tasks here
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add the first one above.
            </p>
          </div>
        )}
      </div>

      {canScrollDown && !loading && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center rounded-b-xl bg-gradient-to-t from-secondary via-secondary/85 to-transparent px-3 pb-2.5 pt-10">
          <button
            type="button"
            onClick={scrollDown}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-[transform,background-color] duration-150 ease-out hover:bg-secondary active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            More tasks
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
};

export const KanbanColumn = KanbanColumnComponent;

export default KanbanColumnComponent;
