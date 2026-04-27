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
        isDragging &&
          'z-10 scale-[1.02] ring-2 ring-primary/50 shadow-2xl shadow-primary/10 opacity-95',
      )}
      orderHandle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={cn(
            'h-7 w-7 inline-flex items-center justify-center rounded-lg -ml-0.5',
            'text-muted-foreground hover:text-foreground hover:bg-primary/10',
            'cursor-grab active:cursor-grabbing touch-none shrink-0',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
            'transition-colors',
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
