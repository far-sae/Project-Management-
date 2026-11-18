// My Tasks lists urgent tasks first inside every group (Today, Tomorrow, …),
// without otherwise reshuffling the list.
import { describe, expect, it } from 'vitest';
import { urgentFirst } from '@/lib/myTasksOrder';

interface Row {
  id: string;
  urgent?: boolean | null;
  done?: boolean;
}

const isDone = (t: Row) => Boolean(t.done);
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe('urgentFirst', () => {
  it('moves urgent tasks to the top of the group', () => {
    const rows: Row[] = [
      { id: 'a' },
      { id: 'b', urgent: true },
      { id: 'c' },
      { id: 'd', urgent: true },
    ];
    expect(ids(urgentFirst(rows, isDone))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('keeps the existing order among urgent tasks and among the rest', () => {
    const rows: Row[] = [
      { id: '1' },
      { id: '2' },
      { id: '3', urgent: true },
      { id: '4' },
      { id: '5', urgent: true },
      { id: '6' },
    ];
    const out = ids(urgentFirst(rows, isDone));
    expect(out.slice(0, 2)).toEqual(['3', '5']);
    expect(out.slice(2)).toEqual(['1', '2', '4', '6']);
  });

  it('never treats a finished task as urgent', () => {
    const rows: Row[] = [
      { id: 'open' },
      { id: 'finished-urgent', urgent: true, done: true },
      { id: 'open-urgent', urgent: true },
    ];
    expect(ids(urgentFirst(rows, isDone))).toEqual(['open-urgent', 'open', 'finished-urgent']);
  });

  it('treats a missing or null urgent flag as not urgent', () => {
    const rows: Row[] = [{ id: 'a', urgent: null }, { id: 'b' }, { id: 'c', urgent: false }];
    expect(ids(urgentFirst(rows, isDone))).toEqual(['a', 'b', 'c']);
  });

  it('returns a new list and leaves the input untouched', () => {
    const rows: Row[] = [{ id: 'a' }, { id: 'b', urgent: true }];
    const out = urgentFirst(rows, isDone);
    expect(out).not.toBe(rows);
    expect(ids(rows)).toEqual(['a', 'b']);
  });

  it('handles an empty group', () => {
    expect(urgentFirst([], isDone)).toEqual([]);
  });
});
