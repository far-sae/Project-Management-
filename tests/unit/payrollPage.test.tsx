// Payroll page: the list of runs with their status, and one run's payslips.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const run = (runId: string, status: string, end: string, net: number) => ({
  runId,
  organizationId: 'org1',
  periodStart: new Date(`${end}T00:00:00`),
  periodEnd: new Date(`${end}T00:00:00`),
  status,
  currency: 'USD',
  totalGross: net + 50,
  totalReimbursement: 10,
  totalDeduction: 60,
  totalNet: net,
  createdByName: 'Mia',
  createdAt: new Date(`${end}T00:00:00`),
  updatedAt: new Date(`${end}T00:00:00`),
});

const h = vi.hoisted(() => ({
  canView: true,
  runs: [] as Array<Record<string, unknown>>,
  detail: null as Record<string, unknown> | null,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/usePayroll', () => ({
  usePayrollRuns: () => ({
    runs: h.runs,
    loading: false,
    canView: h.canView,
    canCreate: true,
    create: vi.fn(),
    updateRun: vi.fn(),
    remove: vi.fn(),
  }),
  usePayrollRunDetail: () => ({
    run: h.detail,
    items: [
      {
        itemId: 'i1', runId: 'r1', userName: 'Alice', jobTitle: 'Designer', payType: 'hourly',
        regularHours: 40, overtimeHours: 2, hourlyRate: 20, salaryAmount: 0, bonus: 0,
        deduction: 5, taxWithholding: 5, expenseReimbursementTotal: 10, grossPay: 860,
        netPay: 860, currency: 'USD', notes: null,
      },
    ],
    loading: false,
    reload: vi.fn(),
    updateItem: vi.fn(),
    canEdit: true,
    canFinalize: true,
    canMarkPaid: false,
    canUnmarkPaid: false,
    isOwner: true,
  }),
}));
vi.mock('@/hooks/useEmployees', () => ({ useEmployees: () => ({ profiles: [] }) }));
// Payroll follows the workspace picked in the sidebar (see
// hrPagesWorkspace.test.tsx). Here "All workspaces" is selected, so every
// payslip and the run's own totals show. Both objects are made once: a mock
// that returns a new object on every call makes effects re-run forever.
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const scope = {
    selectedId: '__ALL_WORKSPACES__', selected: null, isAll: true, isUnassigned: false, workspaces: [],
  };
  return { useSelectedWorkspace: () => scope };
});
vi.mock('@/hooks/useHrWorkspacePeople', () => {
  const everyone = {
    inScope: () => true,
    scopedUserIds: null,
    unassigned: [],
    assign: async () => {},
    assignAllUnassignedToSelected: async () => 0,
    available: false,
    loading: false,
    waiting: false,
    workspaceOf: () => null,
    canAssign: true,
    label: null,
    figureNote: null,
    error: null,
  };
  return { useHrWorkspacePeople: () => everyone };
});
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => (amount: number) => `$${amount.toFixed(2)}`,
}));

import { Payroll } from '@/pages/Payroll';

beforeEach(() => {
  h.canView = true;
  h.runs = [
    run('r1', 'draft', '2026-11-14', 800),
    run('r2', 'finalized', '2026-10-31', 700),
    run('r3', 'paid', '2026-10-17', 600),
  ];
  h.detail = run('r1', 'draft', '2026-11-14', 800);
  window.history.replaceState(null, '', '/payroll');
});
afterEach(cleanup);

describe('Payroll page', () => {
  it('lists the runs, newest first, each with its status', () => {
    render(<Payroll />);
    expect(screen.getByRole('heading', { level: 1, name: 'Payroll' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /new payroll/i })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Draft').getAttribute('data-tone')).toBe('warning');
    expect(within(rows[1]).getByText('Finalized').getAttribute('data-tone')).toBe('info');
    expect(within(rows[2]).getByText('Paid').getAttribute('data-tone')).toBe('success');
    expect(within(rows[0]).getByText('$800.00')).toBeTruthy();
  });

  it('opening a run shows its totals, payslips and actions', () => {
    render(<Payroll />);
    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button'));
    expect(screen.getByRole('button', { name: /runs/i })).toBeTruthy();
    const figure = (label: string) =>
      screen.getAllByText(label).find((el) => el.tagName === 'DT')?.nextElementSibling?.textContent;
    expect(figure('Net pay')).toBe('$800.00');
    expect(figure('Gross')).toBe('$850.00');
    const alice = screen.getAllByRole('row').find((r) => within(r).queryByText('Alice'))!;
    expect(within(alice).getByText('40.00 + 2.00 OT')).toBeTruthy();
    expect(within(alice).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Finalize' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /runs/i }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('tells people without access that payroll is owner and admin only', () => {
    h.canView = false;
    render(<Payroll />);
    expect(screen.getByText('Payroll is visible to organization owners and admins only.')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('inside the HR tabs it has no header bar of its own', () => {
    render(<Payroll embedded />);
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Payroll' })).toBeTruthy();
  });
});
