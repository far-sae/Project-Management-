import type { KanbanColumn } from '@/types';

function sortCols(columns: KanbanColumn[]): KanbanColumn[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

/** A column that means "finished": id `done`, or titled Done / Complete(d). */
export function isDoneColumn(column: Pick<KanbanColumn, 'id' | 'title'>): boolean {
  return column.id.toLowerCase() === 'done' || /^(done|complete|completed)$/i.test(column.title.trim());
}

/**
 * Status to store when a task is marked done: the board's own Done column if
 * it has one, otherwise `done`. Never the last column — on custom boards
 * (e.g. "General … Leads") that silently filed finished work under Leads.
 */
export function resolveDoneColumnId(columns: KanbanColumn[]): string {
  return sortCols(columns).find(isDoneColumn)?.id ?? 'done';
}

/** First column that isn't a Done column (where a reopened task goes). */
export function resolveReopenColumnId(columns: KanbanColumn[]): string {
  if (!columns.length) return 'todo';
  const sorted = sortCols(columns);
  const byTodo = sorted.find((c) => c.id.toLowerCase() === 'todo' && !isDoneColumn(c));
  if (byTodo) return byTodo.id;
  return sorted.find((c) => !isDoneColumn(c))?.id ?? sorted[0].id;
}

/** True if this status means the task is finished on this board. */
export function isCompletedTaskStatus(status: string, columns: KanbanColumn[]): boolean {
  if (status === 'done') return true;
  return columns.some((c) => c.id === status && isDoneColumn(c));
}

/** Board columns minus Done columns — finished tasks live in the Done tab. */
export function boardColumnsWithoutDone(columns: KanbanColumn[]): KanbanColumn[] {
  return columns.filter((c) => !isDoneColumn(c));
}

/**
 * Maps a task's stored status to a visible column id when legacy/default ids
 * do not match the project's custom column ids.
 */
export function resolveTaskDisplayColumnId(
  status: string,
  columns: KanbanColumn[],
): string {
  if (!columns.length) return status;
  const sorted = sortCols(columns);
  const ids = new Set(sorted.map((c) => c.id));
  if (ids.has(status)) return status;

  const st = status.toLowerCase();

  if (st === 'done') return sorted.find(isDoneColumn)?.id ?? sorted[sorted.length - 1].id;

  if (st === 'needreview') {
    const byTitle = sorted.find((c) => /review/i.test(c.title));
    if (byTitle) return byTitle.id;
    if (sorted.length > 1) return sorted[1].id;
  }

  if (st === 'inprogress') {
    const byTitle = sorted.find((c) =>
      /progress|production|producing|active/i.test(c.title),
    );
    if (byTitle) return byTitle.id;
    const mid = sorted[Math.min(2, sorted.length - 1)];
    return mid?.id ?? sorted[0].id;
  }

  if (st === 'todo' || st === 'undefined') {
    return sorted[0].id;
  }

  return sorted[0].id;
}
