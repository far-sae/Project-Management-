import { describe, expect, it } from 'vitest';
import { buildBaseGraph, isDoneColumn, isOverdue } from '@/components/mindmap/mindMapGraph';
import type { KanbanColumn, Project, Task } from '@/types';

const project = { projectId: 'p1', name: 'Site', description: 'Relaunch' } as unknown as Project;
const columns: KanbanColumn[] = [
  { id: 'todo', title: 'To do', color: '#888', order: 0 },
  { id: 'done', title: 'Done', color: '#0a0', order: 1 },
];
const task = (taskId: string, status: string, extra: Partial<Task> = {}) =>
  ({
    taskId,
    status,
    title: `Task ${taskId}`,
    priority: 'medium',
    dueDate: null,
    assignees: [],
    subtasks: [],
    ...extra,
  }) as unknown as Task;

describe('isOverdue / isDoneColumn', () => {
  const now = new Date(2026, 10, 11, 15, 0);
  it('flags past dates only when not done', () => {
    expect(isOverdue(new Date(2026, 10, 10), now, false)).toBe(true);
    expect(isOverdue(new Date(2026, 10, 11, 8), now, false)).toBe(false); // today
    expect(isOverdue(new Date(2026, 10, 10), now, true)).toBe(false);
    expect(isOverdue(null, now, false)).toBe(false);
    expect(isOverdue('not a date', now, false)).toBe(false);
  });
  it('recognises done-like columns', () => {
    expect(isDoneColumn({ id: 'done', title: 'Whatever' })).toBe(true);
    expect(isDoneColumn({ id: 'c9', title: 'Completed' })).toBe(true);
    expect(isDoneColumn({ id: 'c1', title: 'Doing' })).toBe(false);
  });
});

describe('buildBaseGraph', () => {
  const tasks = [
    task('t1', 'todo', {
      subtasks: [
        { id: 's1', title: 'A', completed: false },
        { id: '', title: 'B', completed: true },
      ],
      dueDate: new Date(2020, 0, 1),
    }),
    task('t2', 'done', { dueDate: new Date(2020, 0, 1) }),
    task('t3', 'ghost-column'),
  ];

  it('keeps the original node and edge ids (saved positions / hidden links still match)', () => {
    const g = buildBaseGraph(project, tasks, columns);
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining(['project', 'col-todo', 'col-done', 'col-__unsorted', 'task-t1', 'sub-t1-s1', 'sub-t1-1', 'task-t2', 'task-t3']),
    );
    const edgeIds = g.edges.map((e) => e.id);
    expect(edgeIds).toEqual(
      expect.arrayContaining([
        'auto-edge-project-col-todo',
        'auto-edge-col-todo-task-t1',
        'auto-edge-task-t1-sub-t1-s1',
      ]),
    );
  });

  it('marks overdue only outside done columns', () => {
    const g = buildBaseGraph(project, tasks, columns, { now: new Date(2026, 0, 1) });
    const data = (id: string) => g.nodes.find((n) => n.id === id)!.data as { overdue?: boolean };
    expect(data('task-t1').overdue).toBe(true);
    expect(data('task-t2').overdue).toBe(false);
  });

  it('hides a collapsed column’s tasks and subtasks', () => {
    const g = buildBaseGraph(project, tasks, columns, { collapsed: new Set(['col-todo']) });
    const ids = g.nodes.map((n) => n.id);
    expect(ids).not.toContain('task-t1');
    expect(ids).not.toContain('sub-t1-s1');
    expect(g.hiddenNodeIds.has('task-t1')).toBe(true);
    expect(g.columnOf.get('sub-t1-s1')).toBe('col-todo');
    const col = g.nodes.find((n) => n.id === 'col-todo')!.data as { collapsed?: boolean; count: number };
    expect(col.collapsed).toBe(true);
    expect(col.count).toBe(1);
    expect(g.edges.some((e) => e.target === 'task-t1')).toBe(false);
  });
});
