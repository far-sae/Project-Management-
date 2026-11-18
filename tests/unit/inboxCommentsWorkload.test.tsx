// Inbox, Comments, Workload and the notification bell: the things each page
// must keep showing after the redesign.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const now = new Date();

const h = vi.hoisted(() => ({
  notifications: [] as Array<Record<string, unknown>>,
  unreadCount: 0,
  markAsRead: vi.fn(),
  comments: [] as Array<Record<string, unknown>>,
  tasks: [] as Array<Record<string, unknown>>,
  capacity: 40,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'me', displayName: 'Me', organizationId: 'org1' } }),
}));
vi.mock('@/context/OrganizationContext', () => {
  const organization = {
    organizationId: 'org1',
    name: 'Acme',
    members: [
      { userId: 'me', displayName: 'Me Myself' },
      { userId: 'u2', displayName: 'Sara Khan' },
    ],
  };
  return { useOrganization: () => ({ organization, isAdmin: true }) };
});
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: h.notifications,
    loading: false,
    unreadCount: h.unreadCount,
    markAsRead: h.markAsRead,
    markAllAsReadLocally: vi.fn(),
    refresh: vi.fn(),
    removeLocal: vi.fn(),
  }),
}));
vi.mock('@/hooks/useComments', () => ({
  useUserComments: () => ({ comments: h.comments, loading: false, error: null }),
}));
vi.mock('@/hooks/useProjects', () => {
  const projects = [{ projectId: 'p1', name: 'Website relaunch' }];
  return { useProjects: () => ({ projects }) };
});
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const same = <T,>(x: T) => x;
  return { useSelectedWorkspace: () => ({ filterProjects: same, filterTasks: same }) };
});
vi.mock('@/hooks/useAllTasks', () => ({
  useAllTasks: () => ({ tasks: h.tasks, tasksAssignedToMe: h.tasks, loading: false, refresh: vi.fn() }),
}));
vi.mock('@/services/supabase/database', () => ({
  markAllNotificationsRead: vi.fn(async () => undefined),
  deleteNotification: vi.fn(async () => undefined),
}));
vi.mock('@/services/supabase/capacity', () => ({
  DEFAULT_HOURS_PER_WEEK: 40,
  fetchUserCapacities: async (ids: string[]) =>
    new Map(ids.map((id) => [id, { hoursPerWeek: h.capacity }])),
}));
vi.mock('@/components/ui/AttachmentPreview', () => ({ default: () => null }));

import { Inbox } from '@/pages/Inbox';
import { Comments } from '@/pages/Comments';
import { Workload } from '@/pages/Workload';
import { NotificationBell } from '@/components/notifications/NotificationBell';

const inRouter = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

beforeEach(() => {
  window.localStorage.clear();
  h.markAsRead.mockClear();
  h.unreadCount = 1;
  h.capacity = 40;
  h.notifications = [
    {
      notificationId: 'n1',
      type: 'task_assigned',
      title: 'You were assigned a task',
      body: 'Build the navigation menu',
      read: false,
      createdAt: now,
      projectId: 'p1',
      taskId: 't1',
    },
    {
      notificationId: 'n2',
      type: 'comment_mention',
      title: 'Sara mentioned you',
      body: 'Can you check this?',
      read: true,
      createdAt: now,
      projectId: 'p1',
    },
  ];
  h.comments = [
    {
      commentId: 'c1',
      userId: 'u2',
      displayName: 'Sara Khan',
      taskId: 't1',
      taskTitle: 'Build the navigation menu',
      projectId: 'p1',
      projectName: 'Website relaunch',
      text: 'Looks good @Me',
      createdAt: now,
    },
  ];
  h.tasks = [];
});
afterEach(cleanup);

describe('Inbox page', () => {
  it('has the page title, the unread summary and Mark all read', () => {
    inRouter(<Inbox />);
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeTruthy();
    expect(screen.getByText(/1 unread · stay on top of mentions/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search notifications' })).toBeTruthy();
  });

  it('keeps the four tabs with their counts', () => {
    inRouter(<Inbox />);
    const names = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(names).toEqual(['All2', 'Mentions1', 'Assigned1', 'Unread1']);
    // Default underline tabs, not the old pill row.
    expect(screen.getByRole('tablist').className).not.toContain('bg-secondary');
  });

  it('marks unread rows with weight and a dot instead of a tinted row', () => {
    inRouter(<Inbox />);
    const unread = screen.getByText('You were assigned a task');
    const unreadRow = unread.closest('li') as HTMLElement;
    expect(unread.className).toContain('font-medium');
    expect(unreadRow.querySelector('.bg-primary')).toBeTruthy();
    expect(unreadRow.className).not.toContain('bg-primary');

    const read = screen.getByText('Sara mentioned you');
    const readRow = read.closest('li') as HTMLElement;
    expect(read.className).toContain('font-normal');
    expect(readRow.querySelector('.bg-primary')).toBeNull();
  });

  it('gives every row action a name', () => {
    inRouter(<Inbox />);
    const unreadRow = screen.getByText('You were assigned a task').closest('li') as HTMLElement;
    expect(within(unreadRow).getByRole('button', { name: 'Snooze' })).toBeTruthy();
    expect(within(unreadRow).getByRole('button', { name: 'Delete' })).toBeTruthy();
    fireEvent.click(within(unreadRow).getByRole('button', { name: 'Mark as read' }));
    expect(h.markAsRead).toHaveBeenCalledWith('n1');
  });
});

describe('Comments page', () => {
  it('has the page title, search and the three tabs with counts', () => {
    inRouter(<Comments />);
    expect(screen.getByRole('heading', { level: 1, name: 'Comments' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search comments' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All1', 'Mentions1', 'Mine0']);
  });

  it('lists a comment and opens it on click', () => {
    inRouter(<Comments />);
    const row = screen.getByText('Looks good @Me').closest('li') as HTMLElement;
    expect(within(row).getByText('Sara Khan')).toBeTruthy();
    expect(within(row).getByText('Build the navigation menu')).toBeTruthy();
    fireEvent.click(row);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'View task' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

describe('Workload page', () => {
  const dueToday = (id: string, userId: string) => ({
    taskId: id,
    projectId: 'p1',
    title: `Task ${id}`,
    status: 'todo',
    dueDate: now,
    assignees: [{ userId, displayName: userId }],
  });

  it('has the page title, week controls and one row per member', async () => {
    inRouter(<Workload />);
    expect(screen.getByRole('heading', { level: 1, name: 'Workload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Team capacity' })).toBeTruthy();
    expect(await screen.findByText('Me Myself')).toBeTruthy();
    expect(screen.getByText('Sara Khan')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings → Capacity' })).toBeTruthy();
  });

  it('draws load bars in neutral grey and turns red only over capacity', async () => {
    // 4h per task, 8h weeks. Sara has 3 tasks due (12h = 150%); I have none.
    h.capacity = 8;
    h.tasks = [dueToday('1', 'u2'), dueToday('2', 'u2'), dueToday('3', 'u2')];
    inRouter(<Workload />);
    const saraRow = (await screen.findByText('Sara Khan')).closest('tr') as HTMLElement;
    expect(within(saraRow).getByText('150%').parentElement?.className).toContain('text-destructive');
    expect(saraRow.querySelector('.bg-destructive')).toBeTruthy();

    const myRow = screen.getByText('Me Myself').closest('tr') as HTMLElement;
    expect(within(myRow).getByText('0%')).toBeTruthy();
    expect(myRow.querySelector('.bg-destructive')).toBeNull();
    expect(myRow.querySelector('.bg-foreground\\/70')).toBeTruthy();
    expect(myRow.querySelector('.bg-foreground\\/10')).toBeTruthy();
  });

  it('leaves finished tasks out of the load and shows overdue and undated work in their own columns', async () => {
    // 4h per task, 8h weeks. Sara: one finished today (ignored), one overdue
    // from last month (counts), one with no date (listed, not counted) = 50%.
    h.capacity = 8;
    const longAgo = new Date(now.getTime() - 40 * 86_400_000);
    h.tasks = [
      { ...dueToday('1', 'u2'), status: 'done' },
      { ...dueToday('2', 'u2'), dueDate: longAgo },
      { ...dueToday('3', 'u2'), dueDate: null },
    ];
    inRouter(<Workload />);
    const saraRow = (await screen.findByText('Sara Khan')).closest('tr') as HTMLElement;
    expect(within(saraRow).getByText('50%')).toBeTruthy();
    expect(within(saraRow).getByLabelText('Sara Khan: 1 overdue task').textContent).toBe('1');
    expect(within(saraRow).getByLabelText('Sara Khan: 1 task with no due date').textContent).toBe('1');
    expect(screen.getByRole('columnheader', { name: 'Overdue' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'No date' })).toBeTruthy();
  });

  it('shows the week once, with one set of week controls', async () => {
    inRouter(<Workload />);
    await screen.findByText('Me Myself');
    expect(screen.getAllByRole('button', { name: 'Previous week' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'This week' })).toBeTruthy();
    expect(screen.getAllByText(/^[A-Z][a-z]{2} \d+ – [A-Z][a-z]{2} \d+$/)).toHaveLength(1);
  });
});

describe('Notification bell', () => {
  it('is a named icon button with a red unread count', () => {
    h.unreadCount = 3;
    inRouter(<NotificationBell />);
    const bell = screen.getByRole('button', { name: /Notifications/ });
    const badge = within(bell).getByText('3');
    expect(badge.className).toContain('bg-destructive');
    expect(badge.className).toContain('h-[18px]');
  });

  it('caps the count at 99+ and hides the badge when nothing is unread', () => {
    h.unreadCount = 120;
    const first = inRouter(<NotificationBell />);
    expect(screen.getByText('99+')).toBeTruthy();
    first.unmount();

    h.unreadCount = 0;
    inRouter(<NotificationBell />);
    expect(screen.getByRole('button', { name: 'Notifications' }).textContent).toBe('');
  });
});
