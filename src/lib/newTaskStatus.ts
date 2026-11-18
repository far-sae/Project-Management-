import type { KanbanColumn } from '@/types/task';

/**
 * Which column a task created from the project header's "New task" button
 * starts in: the column the board is filtered to, otherwise the first column
 * in board order. Done is skipped unless it is the only column.
 */
export function pickNewTaskStatus(
  columns: Pick<KanbanColumn, 'id' | 'order'>[],
  filterStatus: string,
): string | null {
  if (columns.length === 0) return null;
  const ordered = [...columns].sort((a, b) => a.order - b.order);
  const open = ordered.filter((c) => c.id !== 'done');
  if (filterStatus !== 'all' && open.some((c) => c.id === filterStatus)) return filterStatus;
  return (open[0] ?? ordered[0]).id;
}
