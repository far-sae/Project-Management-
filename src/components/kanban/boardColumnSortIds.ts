import { closestCenter, type CollisionDetection } from '@dnd-kit/core';

/** Sortable id for horizontal column reorder (distinct from task ids and column droppable ids). */
export const BOARD_COLUMN_SORT_PREFIX = 'board-col:';

export const boardColumnSortId = (columnId: string): string =>
  `${BOARD_COLUMN_SORT_PREFIX}${columnId}`;

export const parseBoardColumnSortId = (raw: string | number): string | null => {
  const s = String(raw);
  return s.startsWith(BOARD_COLUMN_SORT_PREFIX)
    ? s.slice(BOARD_COLUMN_SORT_PREFIX.length)
    : null;
};

/**
 * When dragging a board column, ignore task card droppables — otherwise
 * `closestCenter` often picks a task and column reorder only "works" against the first column.
 */
export const kanbanBoardCollisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type === 'column') {
    const onlyColumns = args.droppableContainers.filter((c) =>
      String(c.id).startsWith(BOARD_COLUMN_SORT_PREFIX),
    );
    if (onlyColumns.length === 0) return [];
    return closestCenter({ ...args, droppableContainers: onlyColumns });
  }
  return closestCenter(args);
};
