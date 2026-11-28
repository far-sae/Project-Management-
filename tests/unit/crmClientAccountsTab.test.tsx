// The Accounts tab on a lead: this lead's own numbers, for a year, a month or
// one day, with every service and payment editable and removable in place.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

const h = vi.hoisted(() => ({
  listClientAccounts: vi.fn(),
  listAccountPayments: vi.fn(),
  createClientAccount: vi.fn(),
  updateClientAccount: vi.fn(),
  deleteClientAccount: vi.fn(),
  addAccountPayment: vi.fn(),
  updateAccountPayment: vi.fn(),
  deleteAccountPayment: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1' } }) }));
vi.mock('@/context/CrmCurrencyContext', () => ({
  useCrmCurrency: () => ({ code: 'GBP', format: (n: number) => `£${n.toLocaleString('en-GB')}` }),
}));
vi.mock('@/services/supabase/crmHub/accounts', () => ({
  listClientAccounts: h.listClientAccounts,
  listAccountPayments: h.listAccountPayments,
  createClientAccount: h.createClientAccount,
  updateClientAccount: h.updateClientAccount,
  deleteClientAccount: h.deleteClientAccount,
  addAccountPayment: h.addAccountPayment,
  updateAccountPayment: h.updateAccountPayment,
  deleteAccountPayment: h.deleteAccountPayment,
}));

import { ClientAccountsTab } from '@/components/crmHub/ClientAccountsTab';

const account = (over: Partial<CrmClientAccount> = {}): CrmClientAccount => ({
  id: 'a1', organizationId: 'org-1', workspaceId: 'ws-1', contactId: 'lead-1', projectId: null,
  serviceName: 'Website care', billingType: 'monthly', agreedAmount: 100, openingPaid: 0,
  serviceStart: '2026-01-01', serviceEnd: null, notes: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...over,
});
const payment = (id: string, paidOn: string, amount: number, over: Partial<CrmAccountPayment> = {}): CrmAccountPayment => ({
  id, accountId: 'a1', organizationId: 'org-1', workspaceId: 'ws-1', paidOn, amount, notes: null,
  createdAt: new Date(paidOn), ...over,
});

const state = {
  accounts: [] as CrmClientAccount[],
  payments: [] as CrmAccountPayment[],
};

const show = async () => {
  render(<ClientAccountsTab organizationId="org-1" workspaceId="ws-1" contactId="lead-1" />);
  await waitFor(() => expect(screen.queryByLabelText('Loading accounts')).toBeNull());
};
/** The amount under one label of the totals at the top. */
const total = (label: string) => {
  const strip = screen.getByRole('group', { name: 'Totals for this lead' });
  return within(strip).getByText(label).parentElement?.textContent ?? '';
};
const choose = async (label: string, option: string) => {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-15T10:00:00Z'));
  for (const fn of Object.values(h)) if (typeof fn === 'function') fn.mockReset();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  state.accounts = [account()];
  state.payments = [
    payment('p1', '2026-03-10', 100, { notes: 'Bank transfer' }),
    payment('p2', '2026-03-24', 50),
    payment('p3', '2026-05-02', 100),
    payment('p0', '2025-12-01', 999),
  ];
  h.listClientAccounts.mockImplementation(async () => state.accounts);
  h.listAccountPayments.mockImplementation(async () => state.payments);
  for (const fn of [h.updateClientAccount, h.deleteClientAccount, h.updateAccountPayment, h.deleteAccountPayment, h.addAccountPayment, h.createClientAccount]) {
    fn.mockResolvedValue(undefined);
  }
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('whose numbers these are', () => {
  it('asks only for this lead’s services, and only for their payments', async () => {
    await show();
    expect(h.listClientAccounts).toHaveBeenCalledWith('ws-1', 'lead-1');
    expect(h.listAccountPayments).toHaveBeenCalledWith('ws-1', undefined, ['a1']);
  });

  it('adds up this lead only: nothing is said about the workspace', async () => {
    await show();
    // 12 months at £100, £250 paid this year (the 2025 payment is another year's).
    expect(total('Agreed')).toContain('£1,200');
    expect(total('Paid')).toContain('£250');
    expect(total('Outstanding')).toContain('£950');
    expect(document.body.textContent).not.toMatch(/Workspace/);
  });

  it('never reads the payments of other leads when this lead has no services', async () => {
    state.accounts = [];
    await show();
    expect(h.listAccountPayments).not.toHaveBeenCalled();
    expect(screen.getByText('No services or billing records yet.')).toBeTruthy();
    expect(total('Agreed')).toContain('£0');
  });
});

describe('year, month and day', () => {
  it('lists the year’s payments, newest first, with their dates', async () => {
    await show();
    const list = screen.getByRole('list', { name: 'Payments for Website care in 2026' });
    const rows = within(list).getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('2 May 2026');
    expect(rows[2]).toContain('10 Mar 2026');
    expect(rows[2]).toContain('Bank transfer');
  });

  it('shows one month when a month is pressed, and the whole year again on a second press', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: /^Mar/ }));
    const list = screen.getByRole('list', { name: 'Payments for Website care in March 2026' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(total('Due')).toContain('£100');
    expect(total('Paid')).toContain('£150');
    expect(total('Outstanding')).toContain('£0');
    fireEvent.click(screen.getByRole('button', { name: /^Mar/ }));
    expect(screen.getByRole('list', { name: 'Payments for Website care in 2026' })).toBeTruthy();
  });

  it('shows one day when a day is chosen', async () => {
    await show();
    await choose('Month', 'March');
    await choose('Day', '24');
    const list = screen.getByRole('list', { name: 'Payments for Website care on 24 March 2026' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(total('Paid')).toContain('£50');
    expect(total('Payments')).toContain('1');
  });

  it('says so when nothing was paid in the time chosen', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: /^Jan/ }));
    expect(screen.getByText('No payments in January 2026.')).toBeTruthy();
  });
});

describe('changing and removing', () => {
  it('edits a service in place', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Website care' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit service' });
    expect((within(dialog).getByLabelText('Service') as HTMLInputElement).value).toBe('Website care');
    fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: 'Website care plus' } });
    fireEvent.change(within(dialog).getByLabelText('Monthly amount'), { target: { value: '120' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateClientAccount).toHaveBeenCalledWith('a1', expect.objectContaining({
      serviceName: 'Website care plus', agreedAmount: 120, billingType: 'monthly', serviceStart: '2026-01-01',
    })));
    expect(h.createClientAccount).not.toHaveBeenCalled();
    await waitFor(() => expect(h.listClientAccounts).toHaveBeenCalledTimes(2));
  });

  it('deletes a service only after it is confirmed, and says its payments go too', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Website care' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('4 payments');
    expect(h.deleteClientAccount).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete service' }));
    await waitFor(() => expect(h.deleteClientAccount).toHaveBeenCalledWith('a1'));
  });

  it('edits a payment in place', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the payment of 10 Mar 2026' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit payment' });
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('100');
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '80' } });
    fireEvent.change(within(dialog).getByLabelText('Payment date'), { target: { value: '2026-03-11' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(h.updateAccountPayment).toHaveBeenCalledWith('p1', { paidOn: '2026-03-11', amount: 80, notes: 'Bank transfer' }));
    expect(h.addAccountPayment).not.toHaveBeenCalled();
  });

  it('deletes a payment only after it is confirmed', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete the payment of 24 Mar 2026' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('£50');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(h.deleteAccountPayment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete the payment of 24 Mar 2026' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete payment' }));
    await waitFor(() => expect(h.deleteAccountPayment).toHaveBeenCalledWith('p2'));
  });

  it('still adds a payment', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '40' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(h.addAccountPayment).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'a1', amount: 40, paidOn: '2026-06-15' })));
  });

  it('says it in our own words when the server refuses', async () => {
    h.deleteAccountPayment.mockRejectedValue({ message: 'new row violates row-level security policy for table "crm_account_payments"' });
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete the payment of 24 Mar 2026' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete payment' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(String(h.toast.error.mock.calls[0][0])).not.toMatch(/row-level|crm_account/);
  });
});

describe('the service window', () => {
  const openNew = async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    return screen.getByRole('dialog', { name: 'Add service' });
  };
  const fill = (dialog: HTMLElement) => {
    fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: 'Paid ads' } });
    fireEvent.change(within(dialog).getByLabelText('Monthly amount'), { target: { value: '300' } });
  };

  it('does not ask for a project', async () => {
    const dialog = await openNew();
    expect(within(dialog).queryByLabelText('Linked project')).toBeNull();
    expect(document.body.textContent).not.toMatch(/linked project/i);
  });

  it('starts in the company’s currency, and saves nothing about it when that is kept', async () => {
    const dialog = await openNew();
    expect(within(dialog).getByRole('combobox', { name: 'Currency' }).textContent).toContain('GBP');
    fill(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.createClientAccount).toHaveBeenCalledTimes(1));
    const sent = h.createClientAccount.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ serviceName: 'Paid ads', agreedAmount: 300, projectId: null });
    expect(Object.keys(sent)).not.toContain('currency');
  });

  it('keeps another currency when one is chosen', async () => {
    const dialog = await openNew();
    fill(dialog);
    await choose('Currency', 'USD');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.createClientAccount).toHaveBeenCalledWith(expect.objectContaining({ serviceName: 'Paid ads', currency: 'USD' })));
  });

  it('opens a service on its own currency, and leaves the project it had alone', async () => {
    state.accounts = [account({ currency: 'USD', projectId: 'p1' })];
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Website care' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit service' });
    expect(within(dialog).getByRole('combobox', { name: 'Currency' }).textContent).toContain('USD');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateClientAccount).toHaveBeenCalledTimes(1));
    const sent = h.updateClientAccount.mock.calls[0][1] as Record<string, unknown>;
    expect(sent.projectId).toBe('p1');
    // Unchanged, so it is not sent again.
    expect(Object.keys(sent)).not.toContain('currency');
  });
});

describe('a service in another currency', () => {
  beforeEach(() => {
    state.accounts = [account(), account({ id: 'a2', serviceName: 'Paid ads', currency: 'USD', agreedAmount: 200 })];
    state.payments = [payment('p1', '2026-03-10', 100), payment('p9', '2026-04-01', 50, { accountId: 'a2' })];
  });

  it('writes its own amounts in its own currency', async () => {
    await show();
    const list = screen.getByRole('list', { name: /Payments for Paid ads/ });
    expect(list.textContent).toContain('$50');
    expect(screen.getByText('$200/month')).toBeTruthy();
    expect(screen.getByText('£100/month')).toBeTruthy();
  });

  it('never adds two currencies together in the totals', async () => {
    await show();
    // Website care: 12 × £100, £100 paid. Paid ads: 12 × $200, $50 paid.
    expect(total('Agreed')).toContain('£1,200 + $2,400');
    expect(total('Paid')).toContain('£100 + $50');
    expect(total('Outstanding')).toContain('£1,100 + $2,350');
  });
});
