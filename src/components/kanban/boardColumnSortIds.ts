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
