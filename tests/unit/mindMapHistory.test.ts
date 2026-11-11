import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  peekUndoId,
  pushHistory,
  redoHistory,
  undoHistory,
} from '@/components/mindmap/mindMapHistory';

describe('mind map history', () => {
  it('starts empty', () => {
    const h = createHistory<number>();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undoHistory(h, 0)).toBeNull();
    expect(redoHistory(h, 0)).toBeNull();
    expect(peekUndoId(h)).toBeNull();
  });

  it('undoes and redoes in order', () => {
    let h = createHistory<string>();
    let state = 'a';
    h = pushHistory(h, state, 1);
    state = 'b';
    h = pushHistory(h, state, 2);
    state = 'c';

    const u1 = undoHistory(h, state)!;
    expect(u1.state).toBe('b');
    const u2 = undoHistory(u1.history, u1.state)!;
    expect(u2.state).toBe('a');
    expect(canUndo(u2.history)).toBe(false);
    expect(canRedo(u2.history)).toBe(true);

    const r1 = redoHistory(u2.history, u2.state)!;
    expect(r1.state).toBe('b');
    const r2 = redoHistory(r1.history, r1.state)!;
    expect(r2.state).toBe('c');
    expect(canRedo(r2.history)).toBe(false);
  });

  it('keeps change ids attached through undo / redo', () => {
    let h = createHistory<string>();
    h = pushHistory(h, 'a', 7);
    expect(peekUndoId(h)).toBe(7);
    const u = undoHistory(h, 'b')!;
    expect(peekUndoId(u.history)).toBeNull();
    const r = redoHistory(u.history, u.state)!;
    expect(peekUndoId(r.history)).toBe(7);
  });

  it('a new change clears the redo stack', () => {
    let h = createHistory<string>();
    h = pushHistory(h, 'a', 1);
    const u = undoHistory(h, 'b')!;
    expect(canRedo(u.history)).toBe(true);
    const h2 = pushHistory(u.history, 'a', 2);
    expect(canRedo(h2)).toBe(false);
  });

  it('drops the oldest entries beyond the limit', () => {
    let h = createHistory<number>(3);
    for (let i = 0; i < 5; i++) h = pushHistory(h, i, i + 1);
    expect(h.past.map((e) => e.snapshot)).toEqual([2, 3, 4]);
    let cur = 5;
    let steps = 0;
    for (let r = undoHistory(h, cur); r; r = undoHistory(h, cur)) {
      h = r.history;
      cur = r.state;
      steps++;
    }
    expect(steps).toBe(3);
    expect(cur).toBe(2);
  });

  it('clamps silly limits to at least one entry', () => {
    let h = createHistory<number>(0);
    h = pushHistory(h, 1, 1);
    h = pushHistory(h, 2, 2);
    expect(h.past).toHaveLength(1);
    expect(h.past[0].snapshot).toBe(2);
  });
});
