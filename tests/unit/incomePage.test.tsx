// The Income page: what came in, what is still to come, and adding income
// that has no invoice, typed in or read from a receipt.
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { IncomeEntry } from '@/lib/income';
import { setInternalsVisible } from '@/lib/publicError';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';
import { customer, invoice, issued, payment } from './signroom/billing/fixtures';

const h = vi.hoisted(() => {
  const call = vi.fn();
  const upload = vi.fn();
  return {
    call, upload,
    signroom: { client: { call, pdf: vi.fn(), upload }, workspaceId: 'ws-1' as string | null },
    org: { organization: { organizationId: 'org-1' }, isAdmin: true },
    listClientAccounts: vi.fn(), listAccountPayments: vi.fn(),
    listIncomeEntries: vi.fn(), createIncomeEntry: vi.fn(), updateIncomeEntry: vi.fn(), deleteIncomeEntry: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
  };
});

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => h.signroom }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.org }));
vi.mock('@/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'GBP' }));
vi.mock('@/hooks/useCrmHub', () => ({
  useCrmContacts: () => ({ items: [{ id: 'lead-1', firstName: 'Elena', lastName: 'Rossi', email: null, companyId: null }], loading: false }),
}));
vi.mock('@/components/layout/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('@/services/supabase/crmHub/accounts', () => ({ listClientAccounts: h.listClientAccounts, listAccountPayments: h.listAccountPayments }));
vi.mock('@/services/supabase/income', () => ({
  listIncomeEntries: h.listIncomeEntries, createIncomeEntry: h.createIncomeEntry, updateIncomeEntry: h.updateIncomeEntry, deleteIncomeEntry: h.deleteIncomeEntry,
}));

import { Income } from '@/pages/Income';

const account: CrmClientAccount = {
  id: 'acc-1', organizationId: 'org-1', workspaceId: 'ws-1', contactId: 'lead-1', projectId: null, serviceName: 'Website care',
  billingType: 'monthly', agreedAmount: 100, openingPaid: 0, serviceStart: '2026-01-01', serviceEnd: null, notes: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
};
const servicePayment: CrmAccountPayment = {
  id: 's1', accountId: 'acc-1', organizationId: 'org-1', workspaceId: 'ws-1', paidOn: '2026-11-12', amount: 100, notes: null, method: 'Card', createdAt: new Date('2026-11-12'),
};
const cashSale: IncomeEntry = {
  id: 'e1', organizationId: 'org-1', workspaceId: 'ws-1', title: 'Cash sale', payer: 'Walk-in customer', amount: 40, currency: 'GBP',
  receivedOn: '2026-11-21', method: 'Cash', reference: null, notes: null,
};
const INVOICES = [
  invoice({ id: 'a', number: 'INV-0001' }),
  issued({ id: 'b', number: 'INV-0002', dueDate: '2026-11-10' }),
  issued({
    id: 'c', number: 'INV-0003', status: 'Part paid', totalMinor: 20000, dueDate: '2026-12-10',
    payments: [payment({ id: 'p1', amountMinor: 5000, paidOn: '2026-11-05', receiptNumber: 'INV-0003-R01', method: 'Bank transfer' })],
  }),
];

const show = async () => {
  render(<MemoryRouter><Income /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByLabelText('Loading income')).toBeNull());
};
const stat = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement?.textContent ?? '';
const openTab = (name: RegExp) => {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
};

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) (globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-28T12:00:00Z'));
  for (const fn of [h.call, h.upload, h.listClientAccounts, h.listAccountPayments, h.listIncomeEntries, h.createIncomeEntry, h.updateIncomeEntry, h.deleteIncomeEntry, h.toast.success, h.toast.error]) fn.mockReset();
  h.signroom.workspaceId = 'ws-1';
  h.org.isAdmin = true;
  h.call.mockImplementation(async (path: string) => {
    if (path === 'billing') return INVOICES;
    if (path === 'clients') return [customer()];
    throw new Error(`unexpected ${path}`);
  });
  h.listClientAccounts.mockResolvedValue([account]);
  h.listAccountPayments.mockResolvedValue([servicePayment]);
  h.listIncomeEntries.mockResolvedValue({ entries: [cashSale], ready: true });
  h.createIncomeEntry.mockResolvedValue({});
  h.updateIncomeEntry.mockResolvedValue({});
  h.deleteIncomeEntry.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); setInternalsVisible(true); });

describe('what the page adds up', () => {
  it('shows what came in this month and this year, what is still to come and what is late', async () => {
    await show();
    // £50 on an invoice, £100 on a service, £40 other income.
    await waitFor(() => expect(stat('Received this month')).toContain('£190'));
    expect(stat('Received in 2026')).toContain('£190');
    // INV-0002 £18 (late) and what is left of INV-0003, £150.
    expect(stat('Upcoming')).toContain('£168');
    expect(stat('Upcoming')).toContain('2 invoices issued, not paid yet');
    expect(stat('Overdue')).toContain('£18');
  });

  it('shows the year month by month', async () => {
    await show();
    const year = screen.getByRole('region', { name: 'Income in 2026, month by month' });
    await waitFor(() => expect(within(year).getAllByRole('listitem')[10].textContent).toBe('Nov£190'));
    expect(within(year).getAllByRole('listitem')[0].textContent).toBe('Jan£0');
  });
});

describe('what came in', () => {
  it('lists every amount with where it came from, the newest first', async () => {
    await show();
    const table = await screen.findByRole('table', { name: 'Money received in 2026' });
    const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows.map((r) => r.slice(0, 7))).toEqual([
      ['21 Nov 2026', 'Cash sale', 'Walk-in customer', 'Other income', 'Cash', '—', '£40.00'],
      ['12 Nov 2026', 'Website care', 'Elena Rossi', 'Client service', 'Card', '—', '£100.00'],
      ['5 Nov 2026', 'Invoice INV-0003', 'Northwind Studio', 'Invoice', 'Bank transfer', 'INV-0003-R01', '£50.00'],
    ]);
    expect(within(table).getByRole('link', { name: 'Invoice INV-0003' }).getAttribute('href')).toBe('/crm/invoices/c');
    expect(within(table).getByRole('link', { name: 'Website care' }).getAttribute('href')).toBe('/crm/contacts/lead-1');
  });

  it('can be narrowed to one kind', async () => {
    await show();
    await screen.findByRole('table', { name: 'Money received in 2026' });
    fireEvent.change(screen.getByLabelText('Where it came from'), { target: { value: 'other' } });
    expect(within(screen.getByRole('table', { name: 'Money received in 2026' })).getAllByRole('row')).toHaveLength(2);
  });
});

describe('what is still to come', () => {
  it('lists the invoices that are issued and not paid, with what is left', async () => {
    await show();
    openTab(/^Upcoming/);
    const table = await screen.findByRole('table', { name: 'Money still to come' });
    const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows).toEqual([
      ['INV-0002', 'Northwind Studio', '10 Nov 2026', 'Overdue', '£18.00'],
      ['INV-0003', 'Northwind Studio', '10 Dec 2026', 'Due', '£150.00'],
    ]);
  });
});

describe('adding income that has no invoice', () => {
  const openDialog = async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Add income' }));
    return screen.findByRole('dialog', { name: 'Add income' });
  };

  it('saves what was typed, in the company’s currency unless another is chosen', async () => {
    const dialog = await openDialog();
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('What for'), { target: { value: ' Refund from supplier ' } });
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: 'Fieldway Logistics' } });
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '75.5' } });
    fireEvent.change(within(dialog).getByLabelText('Received on'), { target: { value: '2026-11-27' } });
    fireEvent.change(within(dialog).getByLabelText('Method'), { target: { value: 'Bank transfer' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.createIncomeEntry).toHaveBeenCalledWith({
      organizationId: 'org-1', workspaceId: 'ws-1', title: 'Refund from supplier', payer: 'Fieldway Logistics', amount: 75.5, currency: 'GBP',
      receivedOn: '2026-11-27', method: 'Bank transfer', reference: null, notes: null,
    }));
    expect(h.toast.success).toHaveBeenCalledWith('Income added');
    await waitFor(() => expect(h.listIncomeEntries).toHaveBeenCalledTimes(2));
  });

  it('reads a receipt and fills the boxes in, for the person to check', async () => {
    h.upload.mockResolvedValue({ found: true, amount: '1250.50', currency: 'USD', receivedOn: '2026-11-20', payer: 'Harbour Dental', reference: 'BACS 4471', method: 'Bank transfer', title: 'Website care' });
    const dialog = await openDialog();
    const file = new File(['%PDF-1.7'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog).getByLabelText('Receipt (photo or PDF)'), { target: { files: [file] } });
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('Filled in from the receipt. Check it before you save.'));
    expect(h.upload).toHaveBeenCalledWith('income/read-receipt', file);
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('1250.50');
    expect((within(dialog).getByLabelText('From') as HTMLInputElement).value).toBe('Harbour Dental');
    expect((within(dialog).getByLabelText('Received on') as HTMLInputElement).value).toBe('2026-11-20');
    expect((within(dialog).getByLabelText('Reference') as HTMLInputElement).value).toBe('BACS 4471');
    expect(within(dialog).getByRole('combobox', { name: 'Currency' }).textContent).toContain('USD');
    // Nothing is saved by reading: the person presses Save.
    expect(h.createIncomeEntry).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.createIncomeEntry).toHaveBeenCalledWith(expect.objectContaining({ amount: 1250.5, currency: 'USD', payer: 'Harbour Dental' })));
  });

  it('keeps what was typed where the receipt says nothing', async () => {
    h.upload.mockResolvedValue({ found: true, amount: '', currency: '', receivedOn: '', payer: 'Harbour Dental', reference: '', method: '', title: '' });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('What for'), { target: { value: 'Deposit' } });
    fireEvent.change(within(dialog).getByLabelText('Receipt (photo or PDF)'), { target: { files: [new File(['x'], 'r.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toMatch(/Fill in the amount/));
    expect((within(dialog).getByLabelText('What for') as HTMLInputElement).value).toBe('Deposit');
    expect((within(dialog).getByLabelText('From') as HTMLInputElement).value).toBe('Harbour Dental');
  });

  it('says so in plain words when the receipt cannot be read, and the boxes can still be filled in', async () => {
    // A person who does not run the site: how it is set up is not theirs to read.
    setInternalsVisible(false);
    h.upload.mockRejectedValue(new Error('Reading receipts is not set up yet: ANTHROPIC_API_KEY is missing in Vercel\'s environment variables.'));
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Receipt (photo or PDF)'), { target: { files: [new File(['x'], 'r.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(within(dialog).getByRole('status')).toBeTruthy());
    expect(within(dialog).getByRole('status').textContent).not.toMatch(/ANTHROPIC|Vercel|environment/);
    fireEvent.change(within(dialog).getByLabelText('What for'), { target: { value: 'Deposit' } });
    expect((within(dialog).getByLabelText('What for') as HTMLInputElement).value).toBe('Deposit');
  });

  it('says so when the file shows no payment', async () => {
    h.upload.mockResolvedValue({ found: false, amount: '', currency: '', receivedOn: '', payer: '', reference: '', method: '', title: '' });
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Receipt (photo or PDF)'), { target: { files: [new File(['x'], 'cat.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('No payment could be read from this file. Type it in below.'));
  });
});

describe('changing and removing other income', () => {
  it('opens an entry on what it holds, and saves the change', async () => {
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cash sale' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit income' });
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('40');
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateIncomeEntry).toHaveBeenCalledWith('e1', expect.objectContaining({ amount: 45, title: 'Cash sale' })));
  });

  it('deletes one only after it is confirmed', async () => {
    await show();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Cash sale' }));
    expect(h.deleteIncomeEntry).not.toHaveBeenCalled();
    const ask = await screen.findByRole('alertdialog');
    expect(ask.textContent).toContain('£40.00 for “Cash sale” on 21 Nov 2026');
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete income' }));
    await waitFor(() => expect(h.deleteIncomeEntry).toHaveBeenCalledWith('e1'));
  });

  it('has no edit or delete on money from an invoice or a service: those are changed where they are', async () => {
    await show();
    const table = await screen.findByRole('table', { name: 'Money received in 2026' });
    expect(within(table).getAllByRole('button', { name: /^Edit / })).toHaveLength(1);
  });
});

describe('who and when', () => {
  it('is for the owner and admins only, and asks for nothing otherwise', async () => {
    h.org.isAdmin = false;
    render(<MemoryRouter><Income /></MemoryRouter>);
    expect(screen.getByText('Only the owner and admins can see income.')).toBeTruthy();
    expect(h.call).not.toHaveBeenCalled();
    expect(h.listIncomeEntries).not.toHaveBeenCalled();
  });

  it('asks for a workspace while none is selected', async () => {
    h.signroom.workspaceId = null;
    render(<MemoryRouter><Income /></MemoryRouter>);
    expect(screen.getByText(/Pick a workspace in the sidebar/)).toBeTruthy();
    expect(h.listIncomeEntries).not.toHaveBeenCalled();
  });

  it('still shows invoices and services when other income cannot be kept yet, and says so without set-up words', async () => {
    setInternalsVisible(false);
    h.listIncomeEntries.mockResolvedValue({ entries: [], ready: false });
    await show();
    await waitFor(() => expect(stat('Received this month')).toContain('£150'));
    expect((screen.getByRole('button', { name: 'Add income' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Adding other income is not switched on yet/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/crm_setup|SQL editor/);
  });
});
