// HR page: for now it shows team attendance only, under an "HR / Attendance"
// breadcrumb. The full HR tabs stay switched off.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'ana', displayName: 'Ana' } }),
}));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({
    organization: {
      organizationId: 'o1',
      members: [{ userId: 'ana', displayName: 'Ana', email: 'a@x.io', status: 'active', role: 'owner' }],
    },
  }),
}));
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({
    profilesByUserId: new Map(),
    loading: false,
    upsert: vi.fn(),
    remove: vi.fn(),
    canManage: true,
    canView: true,
  }),
}));
vi.mock('@/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/hooks/useFormatMoney', () => ({ useFormatMoney: () => (n: number) => `$${n}` }));
vi.mock('@/pages/TimeTracking', () => ({ TimeTracking: () => null }));
vi.mock('@/pages/Payroll', () => ({ Payroll: () => null }));
vi.mock('@/pages/Expenses', () => ({ Expenses: () => null }));
vi.mock('@/services/supabase/timeEntries', async (orig) => {
  const actual = await orig<typeof import('@/services/supabase/timeEntries')>();
  return {
    ...actual,
    subscribeToTimeEntries: (_org: string, cb: (e: unknown[]) => void) => {
      cb([]);
      return () => {};
    },
  };
});

import { HR } from '@/pages/HR';

afterEach(cleanup);

describe('HR page', () => {
  it('shows attendance under an "HR / Attendance" breadcrumb', () => {
    render(<HR />);
    const crumbs = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(within(crumbs).getByText('HR')).toBeTruthy();
    expect(within(crumbs).getByText('Attendance')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('keeps the full HR tabs (People, Payroll, …) switched off', () => {
    render(<HR />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('HR Directory')).toBeNull();
  });
});
