import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const now = new Date();
const h = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({
    organization: {
      organizationId: 'o1',
      members: [
        { userId: 'ana', displayName: 'Ana', email: 'a@x.io', status: 'active', role: 'member' },
        { userId: 'ben', displayName: 'Ben', email: 'b@x.io', status: 'active', role: 'member' },
        { userId: 'old', displayName: 'Gone', email: 'g@x.io', status: 'removed', role: 'member' },
      ],
    },
  }),
}));
vi.mock('@/services/supabase/timeEntries', async (orig) => {
  const actual = await orig<typeof import('@/services/supabase/timeEntries')>();
  return {
    ...actual,
    subscribeToTimeEntries: (_org: string, cb: (e: unknown[]) => void) => {
      cb(h.entries);
      return () => {};
    },
  };
});

import { TeamAttendance } from '@/components/hr/TeamAttendance';

afterEach(cleanup);

describe('TeamAttendance', () => {
  it("shows who is on the clock and who hasn't clocked in today", () => {
    const start = new Date(now.getTime() - 2 * 3600_000);
    h.entries = [
      {
        entryId: 'e1', organizationId: 'o1', userId: 'ana',
        clockedInAt: start, clockedOutAt: null, durationSeconds: null,
        createdAt: start, updatedAt: start,
      },
    ];
    render(<TeamAttendance />);
    const rows = screen.getAllByRole('row');
    const ana = rows.find((r) => within(r).queryByText('Ana'))!;
    const ben = rows.find((r) => within(r).queryByText('Ben'))!;
    expect(within(ana).getByText('On the clock')).toBeTruthy();
    expect(within(ben).getByText('Not clocked in')).toBeTruthy();
    expect(screen.queryByText('Gone')).toBeNull();
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('shows each status as a pill in its own tone', () => {
    const start = new Date(now.getTime() - 2 * 3600_000);
    h.entries = [
      {
        entryId: 'e1', organizationId: 'o1', userId: 'ana',
        clockedInAt: start, clockedOutAt: null, durationSeconds: null,
        createdAt: start, updatedAt: start,
      },
    ];
    render(<TeamAttendance />);
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeTruthy();
    expect(screen.getByText('On the clock').getAttribute('data-tone')).toBe('success');
    expect(screen.getByText('Not clocked in').getAttribute('data-tone')).toBe('muted');
  });

  it('shows someone on approved leave as "On leave" instead of "Not clocked in"', () => {
    h.entries = [];
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    render(
      <TeamAttendance
        leaveRequests={[
          { id: 'l1', userId: 'ben', leaveType: 'sick', startDate: today, endDate: today, days: 1, status: 'approved' },
          { id: 'l2', userId: 'ana', leaveType: 'annual', startDate: today, endDate: today, days: 1, status: 'pending' },
        ]}
      />,
    );
    const rows = screen.getAllByRole('row');
    const ana = rows.find((r) => within(r).queryByText('Ana'))!;
    const ben = rows.find((r) => within(r).queryByText('Ben'))!;
    expect(within(ben).getByText('On leave').getAttribute('data-tone')).toBe('info');
    expect(within(ben).getByTitle('Sick leave')).toBeTruthy();
    expect(within(ben).queryByText('Not clocked in')).toBeNull();
    // A request that is not approved yet changes nothing.
    expect(within(ana).getByText('Not clocked in')).toBeTruthy();
  });

  it('steps through days with one joined control, and Today only shows on another day', () => {
    h.entries = [];
    render(<TeamAttendance />);
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
    const next = screen.getByRole('button', { name: 'Next day' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    const dayField = screen.getByLabelText('Day') as HTMLInputElement;
    const todayValue = dayField.value;

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(dayField.value).not.toBe(todayValue);
    expect(next.disabled).toBe(false);
    expect(screen.getByText('On the clock now').nextElementSibling?.textContent).toBe('—');

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(dayField.value).toBe(todayValue);
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });
});
