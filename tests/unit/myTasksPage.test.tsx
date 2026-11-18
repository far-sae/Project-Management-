// My Tasks page: grouped task list on the left, selected-task panel on the right.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  tasks: [] as Array<Record<string, unknown>>,
  updateTask: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), info: vi.fn() },
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'me', displayName: 'Me', organizationId: 'org1' } }),
}));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({
    organization: { organizationId: 'org1', name: 'Acme', members: [{ userId: 'me', displayName: 'Me' }] },
  }),
}));
vi.mock('@/hooks/useProjects', () => {
  const projects = [
    {
      projectId: 'p1',
      name: 'Website relaunch',
      coverColor: '#2563eb',
      // A board whose finished column is not called "done".
      columns: [
        { id: 'doing', title: 'In progress', color: '#2563eb', order: 0 },
        { id: 'shipped', title: 'Done', color: '#16a34a', order: 1 },
      ],
    },
  ];
  return { useProjects: () => ({ projects }) };
});
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const same = <T,>(x: T) => x;
  return { useSelectedWorkspace: () => ({ filterProjects: same, filterTasks: same }) };
});
vi.mock('@/hooks/useAllTasks', () => ({
  useAllTasks: () => ({
    tasksAssignedToMe: h.tasks,
    tasks: h.tasks,
    loading: false,
    refresh: h.refresh,
  }),
}));
vi.mock('@/services/supabase/database', () => ({
  updateTask: h.updateTask,
  addCommentWithGlobalSync: vi.fn(async () => undefined),
  subscribeToComments: () => () => undefined,
  verifyTaskLockPin: vi.fn(async () => true),
  notifyTaskCommentMentions: vi.fn(async () => undefined),
}));
vi.mock('@/services/supabase/storage', () => ({ uploadCommentAttachment: vi.fn() }));
vi.mock('@/components/kanban/TaskModal', () => ({ TaskModal: () => null }));
vi.mock('@/components/ai/AIDailyBrief', () => ({ AIDailyBrief: () => null }));
vi.mock('@/components/ui/emoji-picker', () => ({ EmojiPickerButton: () => null }));
vi.mock('@/components/mentions/MentionTextarea', () => ({
  MentionTextarea: ({ placeholder }: { placeholder?: string }) => <textarea placeholder={placeholder} />,
}));

import { MyTasks } from '@/pages/MyTasks';

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const task = (taskId: string, title: string, extra: Record<string, unknown> = {}) => ({
  taskId,
  projectId: 'p1',
  organizationId: 'org1',
  title,
  description: '',
  status: 'doing',
  priority: 'medium',
  assignees: [{ userId: 'me', displayName: 'Me' }],
  dueDate: today(),
  createdAt: today(),
  updatedAt: today(),
  ...extra,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <MyTasks />
    </MemoryRouter>,
  );

const rowTitles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-level]')).map(
    (row) => row.querySelector('.truncate')?.textContent,
  );

beforeEach(() => {
  h.updateTask.mockClear();
  h.refresh.mockClear();
  h.tasks = [
    task('a', 'Confirm movers'),
    task('b', 'Build the navigation menu', { urgent: true, priority: 'high' }),
    task('c', 'Old launch checklist', { urgent: true, status: 'shipped' }),
    task('d', 'Write homepage copy', { priority: 'low' }),
    task('e', 'Plan the pricing page', { dueDate: null, urgent: true }),
    task('f', 'Collect client logos', { dueDate: null }),
  ];
});
afterEach(cleanup);

describe('My Tasks page', () => {
  it('shows the page title and how many tasks are still open', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'My Tasks' })).toBeTruthy();
    // Six tasks, one of them finished.
    expect(screen.getByText(/open tasks assigned to you/).textContent).toContain('5 open tasks assigned to you');
  });

  it('keeps the due-date groups, each with its count', () => {
    renderPage();
    const todayGroup = screen.getByRole('heading', { level: 2, name: /^Today/ });
    expect(todayGroup.textContent).toBe('Today4');
    expect(screen.getByRole('heading', { level: 2, name: /^No Due Date/ }).textContent).toBe('No Due Date2');
  });

  it('lists open urgent tasks first in every group and leaves the rest in order', () => {
    const { container } = renderPage();
    expect(rowTitles(container)).toEqual([
      // Today
      'Build the navigation menu',
      'Confirm movers',
      'Old launch checklist',
      'Write homepage copy',
      // No Due Date
      'Plan the pricing page',
      'Collect client logos',
    ]);
  });

  it('tints urgent rows, and never a finished one', () => {
    renderPage();
    const urgentRow = screen.getByText('Build the navigation menu').closest('[data-level]') as HTMLElement;
    expect(urgentRow.getAttribute('data-level')).toBe('urgent');
    expect(urgentRow.className).toContain('bg-destructive-soft');
    expect(within(urgentRow).getByText('Urgent')).toBeTruthy();
    expect(within(urgentRow).getByText('High')).toBeTruthy();
    expect(within(urgentRow).getByText('Website relaunch')).toBeTruthy();

    const finishedRow = screen.getByText('Old launch checklist').closest('[data-level]') as HTMLElement;
    expect(finishedRow.getAttribute('data-level')).toBe('normal');
    expect(finishedRow.className).not.toContain('bg-destructive-soft');
    expect(within(finishedRow).getByRole('button', { name: 'Mark as incomplete' })).toBeTruthy();
  });

  it('opens the selected task in the side panel and marks the row as selected', () => {
    renderPage();
    const row = screen.getByText('Confirm movers').closest('[data-level]') as HTMLElement;
    fireEvent.click(row);
    expect(row.className).toContain('bg-secondary');

    const panel = screen.getByRole('complementary', { name: 'Selected task' });
    expect(within(panel).getByRole('heading', { level: 2, name: 'Confirm movers' })).toBeTruthy();
    expect(within(panel).getByText('Project')).toBeTruthy();
    expect(within(panel).getByText('In progress')).toBeTruthy();
    expect(within(panel).getByText('Due date').nextElementSibling?.textContent).toBe('Today');
    expect(within(panel).getByText('Subtasks')).toBeTruthy();
    expect(within(panel).getByRole('tab', { name: 'Comments' })).toBeTruthy();
    expect(within(panel).getByRole('tab', { name: 'All activity' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Open task' })).toBeTruthy();
  });

  it('marks the selected task complete from the panel', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Confirm movers'));
    const panel = screen.getByRole('complementary', { name: 'Selected task' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(h.updateTask).toHaveBeenCalledWith('a', { status: 'shipped' }, 'org1'));
  });

  it('keeps the list controls and the Recent Activity tab', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /^Group:\s*Due date/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Filter:\s*All/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /All time/ })).toBeTruthy();
    const updates = screen.getByRole('tab', { name: 'Updates' });
    fireEvent.mouseDown(updates);
    fireEvent.click(updates);
    expect(screen.getByText('Recent Activity')).toBeTruthy();
  });
});
