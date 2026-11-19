// HR page: the full HR area. Eight tabs (Overview, People, Attendance, Leave,
// Time tracking, Payroll, Expenses, Documents); the tab is kept in the address
// so a page can be linked to. Leave and Documents show a setup notice until
// the database update (migration 179) has been run.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ setupMissing: false }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'ana', displayName: 'Ana' } }),
}));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({
    organization: {
      organizationId: 'o1',
      members: [
        { userId: 'ana', displayName: 'Ana', email: 'a@x.io', status: 'active', role: 'owner' },
        { userId: 'bob', displayName: 'Bob', email: 'b@x.io', status: 'active', role: 'member' },
      ],
    },
  }),
}));
// HR follows the workspace picked in the sidebar (see hrPageWorkspace.test.tsx).
// Here "All workspaces" is selected and the assignments table is not set up
// yet, so the page shows the whole company as it always did.
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const scope = {
    selectedId: '__ALL_WORKSPACES__', selected: null, isAll: true, isUnassigned: false, workspaces: [],
  };
  return { useSelectedWorkspace: () => scope };
});
vi.mock('@/services/supabase/hrWorkspaces', () => ({
  subscribeToPersonWorkspaces: (
    _org: string,
    cb: (r: { available: boolean; assignments: unknown[] }) => void,
  ) => {
    cb({ available: false, assignments: [] });
    return () => {};
  },
  setPersonWorkspace: vi.fn(),
  assignPeopleToWorkspace: vi.fn(),
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
vi.mock('@/hooks/useLeave', () => ({
  useLeave: () => ({
    requests: [],
    allowances: [],
    holidays: [],
    holidayDates: [],
    allowanceFor: (userId: string) => ({ userId, annualDays: 20, sickDays: 10 }),
    loading: false,
    setupMissing: h.setupMissing,
    error: null,
    refresh: vi.fn(),
    create: vi.fn(),
    decide: vi.fn(),
    remove: vi.fn(),
    saveAllowance: vi.fn(),
    addHoliday: vi.fn(),
    removeHoliday: vi.fn(),
  }),
}));
vi.mock('@/hooks/useEmployeeDocuments', () => ({
  useEmployeeDocuments: () => ({
    documents: [],
    loading: false,
    setupMissing: h.setupMissing,
    error: null,
    refresh: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    open: vi.fn(),
  }),
}));
vi.mock('@/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/hooks/useFormatMoney', () => ({ useFormatMoney: () => (n: number) => `$${n}` }));
vi.mock('@/pages/TimeTracking', () => ({ TimeTracking: () => <p>time-tracking-screen</p> }));
vi.mock('@/pages/Payroll', () => ({ Payroll: () => <p>payroll-screen</p> }));
vi.mock('@/pages/Expenses', () => ({ Expenses: () => <p>expenses-screen</p> }));
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

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <HR />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.setupMissing = false;
});
afterEach(cleanup);

describe('HR page', () => {
  it('has the eight HR tabs and opens on Overview', () => {
    renderAt('/hr');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'People',
      'Attendance',
      'Leave',
      'Time tracking',
      'Payroll',
      'Expenses',
      'Documents',
    ]);
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'HR overview' })).toBeTruthy();
  });

  it('opens the tab named in the address', () => {
    renderAt('/hr?tab=people');
    expect(screen.getByRole('tab', { name: 'People' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'People' })).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Ana')).toBeTruthy();
    expect(within(table).getByText('Bob')).toBeTruthy();
  });

  it('shows team attendance on the Attendance tab', () => {
    renderAt('/hr?tab=attendance');
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeTruthy();
  });

  it('shows the existing time, payroll and expenses screens as tabs', () => {
    renderAt('/hr?tab=payroll');
    expect(screen.getByText('payroll-screen')).toBeTruthy();
    cleanup();
    renderAt('/hr?tab=time-tracking');
    expect(screen.getByText('time-tracking-screen')).toBeTruthy();
    cleanup();
    renderAt('/hr?tab=expenses');
    expect(screen.getByText('expenses-screen')).toBeTruthy();
  });

  it('falls back to Overview for an unknown tab name', () => {
    renderAt('/hr?tab=nonsense');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
  });

  it('tells the owner to run the database update before Leave and Documents work', () => {
    h.setupMissing = true;
    renderAt('/hr?tab=leave');
    expect(screen.getByText(/one-time database update/i)).toBeTruthy();
    expect(screen.getByText(/179_hr_leave_and_documents\.sql/)).toBeTruthy();
    cleanup();
    renderAt('/hr?tab=documents');
    expect(screen.getByText(/one-time database update/i)).toBeTruthy();
  });
});
