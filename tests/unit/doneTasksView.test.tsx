import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DoneTasksView } from '@/components/kanban/DoneTasksView';
import type { KanbanColumn, Task } from '@/types';

afterEach(cleanup);

const columns: KanbanColumn[] = [
  { id: 'general', title: 'General', color: '#999', order: 0 },
  { id: 'leads', title: 'Leads', color: '#999', order: 1 },
];

const t = (taskId: string, status: string, title = taskId): Task =>
  ({
    taskId,
    title,
    description: '',
    status,
    assignees: [],
    completedAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Task;

const tasks = [t('a', 'done', 'Send invoice'), t('b', 'general', 'Still open'), t('c', 'leads', 'In leads')];

describe('DoneTasksView', () => {
  it('lists only finished tasks (not the last column)', () => {
    render(
      <DoneTasksView tasks={tasks} columns={columns} searchQuery="" canEdit onReopen={vi.fn()} onOpenTask={vi.fn()} />,
    );
    expect(screen.getByText('Send invoice')).toBeTruthy();
    expect(screen.queryByText('Still open')).toBeNull();
    expect(screen.queryByText('In leads')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reopen "Send invoice"' })).toBeTruthy();
  });

  it('opens a finished task when its title is clicked', () => {
    const onOpenTask = vi.fn();
    render(
      <DoneTasksView tasks={tasks} columns={columns} searchQuery="" canEdit onReopen={vi.fn()} onOpenTask={onOpenTask} />,
    );
    fireEvent.click(screen.getByText('Send invoice'));
    expect(onOpenTask).toHaveBeenCalledWith('a');
  });

  it('hides Reopen for view-only members and filters by search', () => {
    render(
      <DoneTasksView tasks={tasks} columns={columns} searchQuery="zzz" canEdit={false} onReopen={vi.fn()} onOpenTask={vi.fn()} />,
    );
    expect(screen.getByText('No finished tasks match your search')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reopen/ })).toBeNull();
  });
});
