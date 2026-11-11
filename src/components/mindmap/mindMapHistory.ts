// Tiny immutable undo/redo stack. Entries store full snapshots — the mind map
// "extras" layer is small and immutable updates share structure, so this is
// cheap and far simpler than diffing.

export interface HistoryEntry<T> {
  /** Stable id of the change that produced this entry. It survives undo/redo
   *  round-trips so a toast's "Undo" can check it still targets its change. */
  id: number;
  snapshot: T;
}

export interface History<T> {
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
  limit: number;
}

export const DEFAULT_HISTORY_LIMIT = 100;

export function createHistory<T>(limit = DEFAULT_HISTORY_LIMIT): History<T> {
  return { past: [], future: [], limit: Math.max(1, Math.floor(limit)) };
}

/** Record `previous` (the state before a change). Clears the redo stack and
 *  drops the oldest entries beyond the limit. */
export function pushHistory<T>(h: History<T>, previous: T, id: number): History<T> {
  const past = [...h.past, { id, snapshot: previous }];
  const overflow = past.length - h.limit;
  return { ...h, past: overflow > 0 ? past.slice(overflow) : past, future: [] };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;

/** Id of the change an undo would revert, or null. */
export const peekUndoId = <T>(h: History<T>): number | null =>
  h.past.length > 0 ? h.past[h.past.length - 1].id : null;

export function undoHistory<T>(
  h: History<T>,
  current: T,
): { history: History<T>; state: T } | null {
  if (h.past.length === 0) return null;
  const entry = h.past[h.past.length - 1];
  return {
    state: entry.snapshot,
    history: {
      ...h,
      past: h.past.slice(0, -1),
      future: [...h.future, { id: entry.id, snapshot: current }],
    },
  };
}

export function redoHistory<T>(
  h: History<T>,
  current: T,
): { history: History<T>; state: T } | null {
  if (h.future.length === 0) return null;
  const entry = h.future[h.future.length - 1];
  return {
    state: entry.snapshot,
    history: {
      ...h,
      future: h.future.slice(0, -1),
      past: [...h.past, { id: entry.id, snapshot: current }],
    },
  };
}
