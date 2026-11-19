// Time tracking, Payroll and Expenses follow the selected workspace too, both
// as HR tabs and on their own routes (/time, /payroll, /expenses): the team
// lists and every total count only the people in the workspace. A person's own
// hours and expenses always stay visible to them.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => {
  const noop = () => {};
  const studio = new Set(['sam', 'priya']);
  const day = (d: number, hour = 9) => new Date(2031, 2, d, hour, 0, 0);

  const entry = (entryId: string, userId: string, userName: string, hours: number) => ({
    entryId,
    organizationId: 'org1',
    userId,
    userName,
    notes: null,
    clockedInAt: day(3),
    clockedOutAt: day(3, 9 + hours),
    durationSeconds: hours * 3600,
    createdAt: day(3),
    updatedAt: day(3),
  });
  const entries = [
    entry('e1', 'sam', 'Sam', 1),
    entry('e2', 'priya', 'Priya Nair', 2),
    entry('e3', 'tom', 'Tom Okafor', 4),
  ];

  const expense = (expenseId: string, userId: string, userName: string, title: string, amount: number) => ({
    expenseId,
    organizationId: 'org1',
    userId,
    userName,
    title,
    amount,
    currency: 'GBP',
    status: 'approved',
    incurredOn: day(4),
    createdAt: day(4),
    updatedAt: day(4),
  });

  const item = (itemId: string, userId: string, userName: string, net: number) => ({
    itemId,
    runId: 'r1',
    organizationId: 'org1',
    userId,
    userName,
    jobTitle: null,
    payType: 'salary',
    hourlyRate: 0,
    salaryAmount: net + 100,
    regularHours: 0,
    overtimeHours: 0,
    overtimeMultiplier: 1.5,
    grossPay: net + 100,
    expenseReimbursementTotal: 10,
    bonus: 0,
    deduction: 60,
    taxWithholding: 50,
    netPay: net,
    currency: 'GBP',
    notes: null,
    createdAt: day(1),
    updatedAt: day(1),
  });
  const items = [
    item('i1', 'sam', 'Sam', 500),
    item('i2', 'priya', 'Priya Nair', 300),
    item('i3', 'tom', 'Tom Okafor', 200),
  ];
  const run = {
    runId: 'r1',
    organizationId: 'org1',
    periodStart: day(1),
    periodEnd: day(14),
    status: 'draft',
    currency: 'GBP',
    // The saved totals cover the whole company.
    totalGross: 1300,
    totalReimbursement: 30,
    totalDeduction: 330,
    totalNet: 1000,
    createdByName: 'Sam',
    createdAt: day(14),
    updatedAt: day(14),
  };

  const scope = (over: Record<string, unknown>) => ({
    inScope: () => true,
    scopedUserIds: null as Set<string> | null,
    unassigned: [],
    assign: noop,
    assignAllUnassignedToSelected: noop,
    available: true,
    loading: false,
    waiting: false,
    workspaceOf: () => null,
    canAssign: true,
    label: null as string | null,
    figureNote: null as string | null,
    error: null,
    ...over,
  });

  return {
    // Every mocked hook hands back the same object on every call.
    scopes: {
      studio: scope({
        inScope: (userId: string) => studio.has(userId),
        scopedUserIds: studio,
        label: 'Showing Studio',
        figureNote: 'For Studio only',
      }),
      all: scope({ label: 'Showing the whole company' }),
      notSetUp: scope({ available: false }),
      waiting: scope({ available: false, loading: true, waiting: true }),
    },
    scope: 'studio' as 'studio' | 'all' | 'notSetUp' | 'waiting',
    auth: { user: { userId: 'tom', displayName: 'Tom Okafor' } },
    org: { organization: { organizationId: 'org1', members: [] }, isOwner: true, isAdmin: true },
    time: {
      loading: false,
      entries,
      ownEntries: entries.filter((e) => e.userId === 'tom'),
      openEntry: null,
      clockIn: noop,
      clockOut: noop,
      updateEntry: noop,
      deleteEntry: noop,
      canViewAll: true,
      isOwner: true,
    },
    expenses: {
      organizationId: 'org1',
      expenses: [
        expense('x1', 'sam', 'Sam', 'Camera hire', 100),
        expense('x2', 'priya', 'Priya Nair', 'Print run', 50),
        expense('x3', 'tom', 'Tom Okafor', 'Train tickets', 70),
      ],
      loading: false,
      create: noop,
      update: noop,
      remove: noop,
      canManage: true,
    },
    projects: { projects: [] },
    tasks: { tasks: [] },
    payrollRuns: {
      organizationId: 'org1',
      runs: [run],
      loading: false,
      canView: true,
      canCreate: true,
      create: noop,
      updateRun: noop,
      remove: noop,
    },
    payrollDetail: {
      run,
      items,
      loading: false,
      reload: noop,
      updateItem: noop,
      canEdit: true,
      canFinalize: true,
      canMarkPaid: false,
      canUnmarkPaid: false,
      isOwner: true,
    },
    employees: { profiles: [] },
    items,
    getPayrollRun: vi.fn(),
    money: (amount: number) => `£${amount}`,
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useHrWorkspacePeople', () => ({ useHrWorkspacePeople: () => h.scopes[h.scope] }));
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const scope = { selectedId: 'ws-studio', selected: { workspaceId: 'ws-studio', name: 'Studio' }, workspaces: [] };
  return { useSelectedWorkspace: () => scope };
});
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.org }));
vi.mock('@/hooks/useTimeTracking', () => ({ useTimeTracking: () => h.time }));
vi.mock('@/hooks/useExpenses', () => ({ useExpenses: () => h.expenses }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => h.projects }));
vi.mock('@/hooks/useAllTasks', () => ({ useAllTasks: () => h.tasks }));
vi.mock('@/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'GBP' }));
vi.mock('@/hooks/useFormatMoney', () => ({ useFormatMoney: () => h.money }));
vi.mock('@/hooks/usePayroll', () => ({
  usePayrollRuns: () => h.payrollRuns,
  usePayrollRunDetail: () => h.payrollDetail,
}));
vi.mock('@/hooks/useEmployees', () => ({ useEmployees: () => h.employees }));
vi.mock('@/services/supabase/payroll', async (orig) => {
  const actual = await orig<typeof import('@/services/supabase/payroll')>();
  return { ...actual, getPayrollRun: h.getPayrollRun };
});

import { TimeTracking } from '@/pages/TimeTracking';
import { Expenses } from '@/pages/Expenses';
import { Payroll } from '@/pages/Payroll';

const figure = (label: string) =>
  screen.getAllByText(label).find((el) => el.tagName === 'DT')?.nextElementSibling?.textContent;
const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }));

beforeEach(() => {
  h.scope = 'studio';
  h.getPayrollRun.mockReset().mockResolvedValue({ run: null, items: h.items });
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

describe('Time tracking follows the selected workspace', () => {
  it('"Everyone" lists and totals only the people in the workspace', () => {
    render(<TimeTracking />);
    openTab('Everyone');
    expect(screen.getByText('Showing Studio')).toBeTruthy();
    const totals = screen.getByRole('list');
    expect(within(totals).getAllByRole('listitem')).toHaveLength(2);
    expect(within(totals).getByText('Priya Nair')).toBeTruthy();
    expect(within(totals).queryByText('Tom Okafor')).toBeNull();
    // Header row + Sam + Priya.
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
  });

  it('"All workspaces" lists everyone', () => {
    h.scope = 'all';
    render(<TimeTracking />);
    openTab('Everyone');
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
  });

  it('a person always sees their own hours, whichever workspace is selected', () => {
    // Tom is signed in and is not in Studio.
    render(<TimeTracking />);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText(/Tom Okafor/)).toBeTruthy();
  });

  it('says when nobody in the workspace has clocked time', () => {
    const before = h.scopes.studio.inScope;
    h.scopes.studio.inScope = () => false;
    try {
      render(<TimeTracking />);
      openTab('Everyone');
      expect(screen.getByText('Nobody has clocked time yet.')).toBeTruthy();
      expect(screen.getByText('No entries yet.')).toBeTruthy();
    } finally {
      h.scopes.studio.inScope = before;
    }
  });

  it('before the database update it shows the whole team and no workspace line', () => {
    h.scope = 'notSetUp';
    render(<TimeTracking />);
    openTab('Everyone');
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });

  it('waits for the workspace before showing the team', () => {
    h.scope = 'waiting';
    render(<TimeTracking />);
    openTab('Everyone');
    expect(screen.getByLabelText('Loading team hours')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('Priya Nair')).toBeNull();
  });
});

describe('Expenses follow the selected workspace', () => {
  const renderExpenses = () =>
    render(
      <MemoryRouter>
        <Expenses />
      </MemoryRouter>,
    );

  it('"All expenses" lists and totals only the people in the workspace', () => {
    renderExpenses();
    openTab('All expenses');
    expect(screen.getByText('Showing Studio')).toBeTruthy();
    expect(screen.getByText('Camera hire')).toBeTruthy();
    expect(screen.getByText('Print run')).toBeTruthy();
    expect(screen.queryByText('Train tickets')).toBeNull();
    expect(figure('GBP total')).toBe('£150');
  });

  it('"All workspaces" lists and totals everyone', () => {
    h.scope = 'all';
    renderExpenses();
    openTab('All expenses');
    expect(screen.getByText('Train tickets')).toBeTruthy();
    expect(figure('GBP total')).toBe('£220');
  });

  it('a person always sees their own expenses, whichever workspace is selected', () => {
    // Tom is signed in and is not in Studio.
    renderExpenses();
    expect(screen.getByText('Train tickets')).toBeTruthy();
    expect(screen.queryByText('Camera hire')).toBeNull();
    expect(figure('GBP total')).toBe('£70');
    // The workspace line belongs to the team list, not to "My expenses".
    expect(screen.queryByText('Showing Studio')).toBeNull();
  });

  it('before the database update it shows the whole company', () => {
    h.scope = 'notSetUp';
    renderExpenses();
    openTab('All expenses');
    expect(figure('GBP total')).toBe('£220');
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });

  it('waits for the workspace before showing the team list or its total', () => {
    h.scope = 'waiting';
    renderExpenses();
    openTab('All expenses');
    expect(screen.getByLabelText('Loading expenses')).toBeTruthy();
    expect(screen.queryByText('Camera hire')).toBeNull();
    expect(screen.queryByText('GBP total')).toBeNull();
  });
});

describe('Payroll follows the selected workspace', () => {
  const openRun = () => fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'));

  it("a run shows only the workspace's payslips, and totals worked out from them", () => {
    render(<Payroll />);
    openRun();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Sam')).toBeTruthy();
    expect(within(table).getByText('Priya Nair')).toBeTruthy();
    expect(within(table).queryByText('Tom Okafor')).toBeNull();
    // Sam 500 + Priya 300, not the run's saved 1,000.
    expect(figure('Net pay')).toBe('£800');
    expect(figure('Gross')).toBe('£1000');
    expect(figure('Reimbursements')).toBe('£20');
    expect(figure('Deductions')).toBe('£220');
  });

  it('makes it clear the figures are for this workspace and the actions are not', () => {
    render(<Payroll />);
    openRun();
    expect(
      screen.getByText('For Studio only. Finalizing, marking as paid or deleting applies to the whole run.'),
    ).toBeTruthy();
  });

  it('"All workspaces" shows the whole run with its saved totals', () => {
    h.scope = 'all';
    render(<Payroll />);
    openRun();
    expect(within(screen.getByRole('table')).getByText('Tom Okafor')).toBeTruthy();
    expect(figure('Net pay')).toBe('£1000');
    expect(figure('Gross')).toBe('£1300');
    expect(screen.queryByText(/applies to the whole run/)).toBeNull();
  });

  it('says when nobody in the workspace is on the run', () => {
    const before = h.scopes.studio.inScope;
    h.scopes.studio.inScope = () => false;
    try {
      render(<Payroll />);
      openRun();
      expect(screen.getByText('Nobody here is on this run.')).toBeTruthy();
      expect(figure('Net pay')).toBe('£0');
    } finally {
      h.scopes.studio.inScope = before;
    }
  });

  it("the list of runs shows each run's net pay for the workspace", async () => {
    render(<Payroll />);
    expect(screen.getByText('Showing Studio')).toBeTruthy();
    expect(screen.getByText('Each run covers the whole company. Net pay here is for the people showing.')).toBeTruthy();
    const row = screen.getAllByRole('listitem')[0];
    // Not the whole company's 1,000, not even for a moment.
    expect(within(row).queryByText('£1000')).toBeNull();
    await waitFor(() => expect(within(row).getByText('£800')).toBeTruthy());
    expect(h.getPayrollRun).toHaveBeenCalledWith('org1', 'r1');
  });

  it('"All workspaces" lists the runs with their saved net pay and loads nothing extra', () => {
    h.scope = 'all';
    render(<Payroll />);
    expect(within(screen.getAllByRole('listitem')[0]).getByText('£1000')).toBeTruthy();
    expect(h.getPayrollRun).not.toHaveBeenCalled();
    expect(screen.queryByText(/Each run covers the whole company/)).toBeNull();
  });

  it('before the database update it shows the whole company as it always did', () => {
    h.scope = 'notSetUp';
    render(<Payroll />);
    expect(within(screen.getAllByRole('listitem')[0]).getByText('£1000')).toBeTruthy();
    expect(screen.queryByText(/^Showing /)).toBeNull();
    openRun();
    expect(figure('Net pay')).toBe('£1000');
    expect(within(screen.getByRole('table')).getByText('Tom Okafor')).toBeTruthy();
    expect(h.getPayrollRun).not.toHaveBeenCalled();
  });

  it('waits for the workspace before showing any pay figures', () => {
    h.scope = 'waiting';
    render(<Payroll />);
    expect(screen.getByLabelText('Loading payroll runs')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('tells whoever starts a run that it covers the whole company', () => {
    render(<Payroll />);
    fireEvent.click(screen.getByRole('button', { name: /new payroll/i }));
    expect(
      within(screen.getByRole('dialog')).getByText(/covers the whole company, not only the people showing/),
    ).toBeTruthy();
  });
});
