import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

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
});
