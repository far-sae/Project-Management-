import type { KanbanColumn } from '@/types';

function sortCols(columns: KanbanColumn[]): KanbanColumn[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

/** Last column by order, or column id/title "done" when present. */
export function resolveDoneColumnId(columns: KanbanColumn[]): string {
  if (!columns.length) return 'done';
  const sorted = sortCols(columns);
  const byId = sorted.find((c) => c.id.toLowerCase() === 'done');
  if (byId) return byId.id;
  const byTitle = sorted.find((c) => /^done$/i.test(c.title.trim()));
  if (byTitle) return byTitle.id;
  return sorted[sorted.length - 1].id;
}

/** Prefer `todo` when it is not the done column; else first non-done column by order. */
export function resolveReopenColumnId(columns: KanbanColumn[]): string {
  if (!columns.length) return 'todo';
  const sorted = sortCols(columns);
  const doneId = resolveDoneColumnId(columns);
  const byTodo = sorted.find((c) => c.id.toLowerCase() === 'todo');
  if (byTodo && byTodo.id !== doneId) return byTodo.id;
  const firstOther = sorted.find((c) => c.id !== doneId);
  return firstOther?.id ?? sorted[0].id;
}

/** True if this status should be treated as completed for this board. */
export function isCompletedTaskStatus(
  status: string,
  columns: KanbanColumn[],
): boolean {
  if (!columns.length) return status === 'done';
  if (status === 'done') return true;
  return status === resolveDoneColumnId(columns);
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

  if (st === 'done') return resolveDoneColumnId(columns);

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
