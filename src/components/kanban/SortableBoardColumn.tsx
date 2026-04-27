import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KanbanColumnComponent, type KanbanColumnProps } from './KanbanColumn';
import { boardColumnSortId } from './boardColumnSortIds';

type Omitted = 'boardColumnRef' | 'boardColumnStyle' | 'boardColumnClassName' | 'orderHandle';
export type SortableBoardColumnRest = Omit<KanbanColumnProps, Omitted>;

export interface SortableBoardColumnProps extends SortableBoardColumnRest {
  id: string;
}

/** Horizontal column reorder; drag the grip in the column header. */
export const SortableBoardColumn: React.FC<SortableBoardColumnProps> = ({
  id,
  ...columnProps
}) => {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: boardColumnSortId(id),
    data: { type: 'column' as const, columnId: id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <KanbanColumnComponent
      {...columnProps}
      id={id}
      boardColumnRef={setNodeRef}
      boardColumnStyle={style}
      boardColumnClassName={cn(
        isDragging && 'ring-2 ring-primary/40 shadow-lg opacity-90',
      )}
      orderHandle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={cn(
            'h-6 w-6 inline-flex items-center justify-center rounded-md -ml-0.5',
            'text-muted-foreground hover:text-foreground hover:bg-secondary',
            'cursor-grab active:cursor-grabbing touch-none shrink-0',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
          )}
          aria-label="Drag to reorder column"
          title="Drag to reorder column"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      }
    />
  );
};
