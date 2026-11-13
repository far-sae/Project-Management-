import { describe, expect, it } from 'vitest';
import {
  isDoneColumn,
  isCompletedTaskStatus,
  resolveDoneColumnId,
  resolveReopenColumnId,
  boardColumnsWithoutDone,
} from '@/lib/kanbanTaskColumn';
import { groupDoneTasks } from '@/lib/doneTasks';
import type { KanbanColumn, Task } from '@/types';

const col = (id: string, title: string, order: number): KanbanColumn => ({ id, title, color: '#999', order });

// A custom board like "General / Training / ... / Leads" — no Done column.
const custom = [col('general', 'General', 0), col('training', 'Training', 1), col('leads', 'Leads', 2)];
// The default board, with its own Done column.
const withDone = [col('todo', 'To-do', 0), col('done', 'Done', 1), col('review', 'Need review', 2)];

describe('done rules', () => {
  it('recognises a Done column by id or title', () => {
    expect(isDoneColumn(col('done', 'Done', 0))).toBe(true);
    expect(isDoneColumn(col('c-1', 'Completed', 0))).toBe(true);
    expect(isDoneColumn(col('c-2', ' done ', 0))).toBe(true);
    expect(isDoneColumn(col('leads', 'Leads', 0))).toBe(false);
  });

  it('never treats the last column as done', () => {
    expect(resolveDoneColumnId(custom)).toBe('done');
    expect(isCompletedTaskStatus('leads', custom)).toBe(false);
    expect(isCompletedTaskStatus('done', custom)).toBe(true);
  });

  it('uses the board’s own Done column when it has one', () => {
    const board = [col('a', 'Backlog', 0), col('c-9', 'Done', 1)];
    expect(resolveDoneColumnId(board)).toBe('c-9');
    expect(isCompletedTaskStatus('c-9', board)).toBe(true);
    expect(isCompletedTaskStatus('done', board)).toBe(true);
  });

  it('reopens into the first column that is not Done', () => {
    expect(resolveReopenColumnId(custom)).toBe('general');
    expect(resolveReopenColumnId([col('done', 'Done', 0), col('b', 'B', 1)])).toBe('b');
  });

  it('hides Done columns from the board (done tasks live in the Done tab)', () => {
    expect(boardColumnsWithoutDone(withDone).map((c) => c.id)).toEqual(['todo', 'review']);
    expect(boardColumnsWithoutDone(custom)).toHaveLength(3);
  });
});

const task = (id: string, completedAt: Date | null, updatedAt = new Date(2026, 0, 1)): Task =>
  ({ taskId: id, title: id, status: 'done', completedAt, updatedAt } as unknown as Task);

describe('groupDoneTasks', () => {
  const now = new Date(2026, 10, 13, 15, 0); // Fri 13 Nov 2026
  it('groups by when they were finished, newest first', () => {
    const groups = groupDoneTasks(
      [
        task('old', new Date(2026, 9, 1)),
        task('today-early', new Date(2026, 10, 13, 9)),
        task('today-late', new Date(2026, 10, 13, 14)),
        task('yesterday', new Date(2026, 10, 12, 18)),
        task('monday', new Date(2026, 10, 9, 10)),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Earlier this week', 'Earlier']);
    expect(groups[0].tasks.map((t) => t.taskId)).toEqual(['today-late', 'today-early']);
    expect(groups[3].tasks.map((t) => t.taskId)).toEqual(['old']);
  });

  it('falls back to the last update when the finish time is missing', () => {
    const groups = groupDoneTasks([task('legacy', null, new Date(2026, 10, 13, 8))], now);
    expect(groups).toEqual([{ label: 'Today', tasks: [expect.objectContaining({ taskId: 'legacy' })] }]);
  });

  it('returns nothing for no tasks', () => {
    expect(groupDoneTasks([], now)).toEqual([]);
  });
});
