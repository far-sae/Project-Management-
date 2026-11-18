// Workload: what counts as someone's load in a week. Finished work never
// counts; overdue work carried into this week does; undated work is shown
// but not counted against a day.
import { describe, expect, it } from 'vitest';
import { buildMemberWorkload } from '@/lib/workload';
import type { Task } from '@/types';

const weekStart = new Date(2026, 10, 16); // Monday 16 Nov 2026
const now = new Date(2026, 10, 18, 12); // Wednesday midday

let n = 0;
const task = (due: Date | null, o: Record<string, unknown> = {}): Task =>
  ({
    taskId: `t${++n}`,
    title: `Task ${n}`,
    status: 'todo',
    dueDate: due,
    assignees: [{ userId: 'me', displayName: 'Me' }],
    ...o,
  }) as unknown as Task;

describe('buildMemberWorkload', () => {
  it('puts each open task on the day it is due', () => {
    const w = buildMemberWorkload(
      [task(new Date(2026, 10, 16, 9)), task(new Date(2026, 10, 18, 17)), task(new Date(2026, 10, 18, 9))],
      'me',
      weekStart,
      now,
    );
    expect(w.cells.map((c) => c.count)).toEqual([1, 0, 2, 0, 0, 0, 0]);
    expect(w.weekOpen).toBe(3);
  });

  it('ignores tasks assigned to other people', () => {
    const w = buildMemberWorkload(
      [task(new Date(2026, 10, 17), { assignees: [{ userId: 'sara' }] })],
      'me',
      weekStart,
      now,
    );
    expect(w.weekOpen).toBe(0);
  });

  it('does not count finished tasks as load, but reports how many were finished', () => {
    const w = buildMemberWorkload(
      [task(new Date(2026, 10, 17), { status: 'done' }), task(new Date(2026, 10, 17))],
      'me',
      weekStart,
      now,
    );
    expect(w.cells[1].count).toBe(1);
    expect(w.weekOpen).toBe(1);
    expect(w.doneThisWeek).toBe(1);
    expect(w.loadTasks).toBe(1);
  });

  it('carries open tasks from before the week into this week\'s load', () => {
    const late = task(new Date(2026, 10, 10));
    const w = buildMemberWorkload([late, task(new Date(2026, 10, 19))], 'me', weekStart, now);
    expect(w.overdue).toEqual([late]);
    expect(w.loadTasks).toBe(2);
  });

  it('does not add old overdue work to a week that is not the current one', () => {
    const nextWeek = new Date(2026, 10, 23);
    const w = buildMemberWorkload([task(new Date(2026, 10, 10)), task(new Date(2026, 10, 24))], 'me', nextWeek, now);
    expect(w.overdue).toHaveLength(1);
    expect(w.loadTasks).toBe(1);
  });

  it('lists open tasks with no due date separately and keeps them out of the load', () => {
    const undated = task(null);
    const w = buildMemberWorkload([undated, task(null, { status: 'done' })], 'me', weekStart, now);
    expect(w.unscheduled).toEqual([undated]);
    expect(w.loadTasks).toBe(0);
  });

  it('marks a day as overdue when an open task on it is already late', () => {
    const w = buildMemberWorkload(
      [task(new Date(2026, 10, 16, 9)), task(new Date(2026, 10, 18, 9)), task(new Date(2026, 10, 20, 9))],
      'me',
      weekStart,
      now,
    );
    expect(w.cells.map((c) => c.isOverdue)).toEqual([true, false, false, false, false, false, false]);
  });
});
