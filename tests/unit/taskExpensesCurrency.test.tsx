// Expenses on a task show in the company currency, like every other money amount.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({ organization: { organizationId: 'o', settings: { currency: 'GBP' } } }),
}));
vi.mock('@/lib/fxRates', () => ({
  useFxRates: () => ({ rates: { USD: 1, GBP: 0.5 } }),
  convertAmount: (amount: number, from: string, to: string, rates: Record<string, number>) =>
    (amount / rates[from]!) * rates[to]!,
}));
vi.mock('@/hooks/useExpenses', () => ({
  useTaskExpenses: () => ({
    loading: false,
    reload: vi.fn(),
    canManage: false,
    expenses: [
      { expenseId: 'e1', title: 'Stock photos', status: 'approved', amount: 100, currency: 'USD', incurredOn: new Date(2026, 10, 3), userName: 'Sam' },
      { expenseId: 'e2', title: 'Print run', status: 'pending', amount: 80, currency: 'GBP', incurredOn: new Date(2026, 10, 4), userName: 'Sam' },
    ],
  }),
  useExpenses: () => ({ update: vi.fn() }),
}));
vi.mock('@/components/expenses/AddExpenseDialog', () => ({ AddExpenseDialog: () => null }));

import { TaskExpensesPanel } from '@/components/expenses/TaskExpensesPanel';

afterEach(cleanup);

describe('Task expenses', () => {
  it('shows every amount in the company currency, converting the ones entered in another', () => {
    render(<TaskExpensesPanel taskId="t1" taskTitle="Launch site" />);
    expect(screen.getByText('£50.00')).toBeTruthy();
    expect(screen.getByText('£80.00')).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});
