// The "New task" button in the project header has to pick a column for the
// task. It follows the active column filter, otherwise the first open column.
import { describe, expect, it } from 'vitest';
import { pickNewTaskStatus } from '@/lib/newTaskStatus';

const cols = [
  { id: 'todo', title: 'To-do', color: '#999', order: 0 },
  { id: 'inprogress', title: 'In progress', color: '#00f', order: 1 },
  { id: 'done', title: 'Done', color: '#0f0', order: 2 },
];

describe('pickNewTaskStatus', () => {
  it('uses the first column when no column filter is on', () => {
    expect(pickNewTaskStatus(cols, 'all')).toBe('todo');
  });

  it('follows the column the board is filtered to', () => {
    expect(pickNewTaskStatus(cols, 'inprogress')).toBe('inprogress');
  });

  it('never starts a new task in Done', () => {
    const doneFirst = [cols[2], cols[0], cols[1]];
    expect(pickNewTaskStatus(doneFirst, 'all')).toBe('todo');
    expect(pickNewTaskStatus(cols, 'done')).toBe('todo');
  });

  it('respects column order, not array order', () => {
    const shuffled = [cols[1], cols[0], cols[2]];
    expect(pickNewTaskStatus(shuffled, 'all')).toBe('todo');
  });

  it('ignores a filter for a column that no longer exists', () => {
    expect(pickNewTaskStatus(cols, 'archived')).toBe('todo');
  });

  it('returns null when there is nowhere to put a task', () => {
    expect(pickNewTaskStatus([], 'all')).toBeNull();
    expect(pickNewTaskStatus([cols[2]], 'all')).toBe('done');
  });
});
