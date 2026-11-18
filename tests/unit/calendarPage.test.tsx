// Calendar page: a month grid of tasks by due date, coloured by urgency.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const today = new Date();
const noon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString();
const row = (id: string, title: string, extra: Record<string, unknown>) => ({
  task_id: id,
  project_id: 'p1',
  organization_id: 'org1',
  title,
  status: 'todo',
  due_date: noon(today),
  created_at: noon(today),
  updated_at: noon(today),
  ...extra,
});

// The signed-in user must be the same object on every render, as in the app:
// the page reloads its tasks whenever the user changes.
const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  user: { userId: 'me', displayName: 'Me', organizationId: 'org1' },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: h.user }),
}));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({ organization: { organizationId: 'org1' } }),
}));
vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({ projects: [{ projectId: 'p1', name: 'Website' }] }),
}));
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const same = <T,>(x: T) => x;
  return { useSelectedWorkspace: () => ({ filterProjects: same, filterTasks: same }) };
});
vi.mock('@/services/supabase/database', () => ({
  getOrganizationTasks: async () => [],
  TASKS_SAFE_SELECT: '*',
  taskHasLockPin: () => false,
}));
vi.mock('@/services/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ filter: async () => ({ data: h.rows, error: null }) }),
    }),
  },
}));

import { Calendar } from '@/pages/Calendar';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const monthTitle = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

const renderCalendar = () =>
  render(
    <MemoryRouter>
      <Calendar />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.rows = [
    row('t1', 'Fix the checkout', { urgent: true, priority: 'low' }),
    row('t2', 'Write the brief', { priority: 'medium' }),
  ];
});
afterEach(cleanup);

describe('Calendar page', () => {
  it('names the month as the page title and counts this month’s tasks', async () => {
    renderCalendar();
    expect(screen.getByRole('heading', { level: 1, name: monthTitle(today) })).toBeTruthy();
    await screen.findByRole('button', { name: 'Fix the checkout' });
    expect(screen.getByText('Due this month').nextElementSibling?.textContent).toBe('2');
    const urgent = screen.getAllByText('Urgent').find((el) => el.tagName === 'DT');
    expect(urgent?.nextElementSibling?.textContent).toBe('1');
    expect(urgent?.nextElementSibling?.getAttribute('data-tone')).toBe('danger');
  });

  it('colours each task chip by its level and marks today', async () => {
    renderCalendar();
    const urgent = await screen.findByRole('button', { name: 'Fix the checkout' });
    expect(urgent.className).toContain('bg-destructive ');
    expect(screen.getByRole('button', { name: 'Write the brief' }).className).toContain('bg-warning-soft');
    const todayNumber = document.querySelector('[aria-current="date"]');
    expect(todayNumber?.textContent).toBe(String(today.getDate()));
  });

  it('shows a legend for the chip colours', async () => {
    renderCalendar();
    const legend = screen.getByRole('list', { name: 'Task colours' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Urgent', 'High', 'Medium', 'Low', 'Done',
    ]);
  });

  it('clicking a task opens its details', async () => {
    renderCalendar();
    fireEvent.click(await screen.findByRole('button', { name: 'Fix the checkout' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Fix the checkout')).toBeTruthy();
    expect(within(dialog).getByText('Website')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'View in Project' })).toBeTruthy();
  });

  it('steps between months and comes back with Today', async () => {
    renderCalendar();
    await screen.findByRole('button', { name: 'Fix the checkout' });
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    expect(screen.getByRole('heading', { level: 1, name: monthTitle(next) })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fix the checkout' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    expect(screen.getByRole('heading', { level: 1, name: monthTitle(prev) })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('button', { name: 'Fix the checkout' })).toBeTruthy();
  });
});
