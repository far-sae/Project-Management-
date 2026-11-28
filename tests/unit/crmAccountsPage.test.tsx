// The CRM's Accounts page: every client's services for a chosen month (what
// is charged, paid, unpaid and to collect), the year view, the filters, and
// recording a payment from a row.
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

const h = vi.hoisted(() => ({
  listClientAccounts: vi.fn(), listAccountPayments: vi.fn(), addAccountPayment: vi.fn(),
  createClientAccount: vi.fn(), updateClientAccount: vi.fn(),
  call: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

// One object for the whole file: the page keeps `client` in effect dependencies.
const signroom = vi.hoisted(() => ({ client: { call: (...args: unknown[]) => (globalThis as unknown as { __accountsCall: (...a: unknown[]) => unknown }).__accountsCall(...args), pdf: () => Promise.resolve(new Blob()), upload: () => Promise.resolve({}) }, workspaceId: 'ws-1' }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => signroom }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: { organizationId: 'org-1' } }) }));
vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => ({ code: 'USD', format: (n: number) => `$${n.toLocaleString('en-US')}` }) }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => ({ selected: { workspaceId: 'ws-1', name: 'Studio' } }) }));
vi.mock('@/hooks/useCrmHub', () => ({
  useCrmContacts: () => ({ items: [
    { id: 'lead-1', firstName: 'Elena', lastName: 'Rossi', email: null, companyId: 'co-1' },
    { id: 'lead-2', firstName: 'Tom', lastName: 'Okafor', email: null, companyId: null },
  ], loading: false }),
  useCrmCompanies: () => ({ items: [{ id: 'co-1', name: 'Harbour Dental' }], loading: false }),
}));
vi.mock('@/services/supabase/crmHub/accounts', () => ({
  listClientAccounts: h.listClientAccounts, listAccountPayments: h.listAccountPayments, addAccountPayment: h.addAccountPayment,
  createClientAccount: h.createClientAccount, updateClientAccount: h.updateClientAccount,
}));
// The lead's own tab is not what is tested here; only its list of methods is shared.
vi.mock('@/components/crmHub/ClientAccountsTab', () => ({ PAYMENT_METHODS: ['Bank transfer', 'Card', 'Cash'] }));
// The invoice window belongs to the documents area: here only what it is opened with is checked.
vi.mock('@/components/signroom/billing/NewInvoiceDialog', () => ({
  NewInvoiceDialog: (props: { companyId: string; service: unknown }) => <div data-testid="new-invoice">{JSON.stringify({ companyId: props.companyId, service: props.service })}</div>,
}));

import { CrmAccountsPage } from '@/pages/crmHub/Accounts';

const account = (id: string, contactId: string, serviceName: string, over: Partial<CrmClientAccount> = {}): CrmClientAccount => ({
  id, organizationId: 'org-1', workspaceId: 'ws-1', contactId, projectId: null, serviceName, billingType: 'monthly', agreedAmount: 500, openingPaid: 0,
  serviceStart: '2026-07-01', serviceEnd: null, notes: null, dueDay: 5, dueDate: null, createdAt: new Date('2026-07-01'), updatedAt: new Date('2026-07-01'), ...over,
});
const paid = (id: string, accountId: string, paidOn: string, amount: number, billingMonth: string | null = null): CrmAccountPayment => ({
  id, accountId, organizationId: 'org-1', workspaceId: 'ws-1', paidOn, amount, notes: null, billingMonth, method: null, reference: null, createdAt: new Date(paidOn),
});

const ACCOUNTS = [
  account('a1', 'lead-1', 'Digital marketing'),
  account('a2', 'lead-1', 'Website', { billingType: 'one_time', agreedAmount: 8000, openingPaid: 4000, serviceStart: null, dueDay: null, dueDate: '2026-11-15' }),
  account('a3', 'lead-2', 'LinkedIn', { agreedAmount: 100 }),
];
// Marketing: paid July to September, not October. LinkedIn: paid every month to November.
const PAYMENTS = [
  paid('p1', 'a1', '2026-07-05', 500), paid('p2', 'a1', '2026-08-05', 500), paid('p3', 'a1', '2026-09-05', 500),
  paid('p4', 'a3', '2026-07-05', 100), paid('p5', 'a3', '2026-08-05', 100), paid('p6', 'a3', '2026-09-05', 100), paid('p7', 'a3', '2026-10-05', 100), paid('p8', 'a3', '2026-11-03', 100),
];

async function show() {
  render(<MemoryRouter><CrmAccountsPage /></MemoryRouter>);
  await screen.findByRole('table');
  // The page opens on today's month: the tests look at November 2026.
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-11' } });
}
const rowOf = (name: string) => screen.getByRole('row', { name });

beforeEach(() => {
  for (const f of [h.listClientAccounts, h.listAccountPayments, h.addAccountPayment, h.createClientAccount, h.updateClientAccount, h.toast.success, h.toast.error]) f.mockReset();
  h.createClientAccount.mockResolvedValue({});
  h.updateClientAccount.mockResolvedValue({});
  h.call.mockReset();
  h.call.mockImplementation(async (path: string) => (path === 'billing' ? [] : {}));
  (globalThis as unknown as { __accountsCall: unknown }).__accountsCall = h.call;
  h.listClientAccounts.mockResolvedValue(ACCOUNTS);
  h.listAccountPayments.mockResolvedValue(PAYMENTS);
  h.addAccountPayment.mockResolvedValue({});
});
afterEach(cleanup);

describe('the month', () => {
  it('shows each service with what is charged, paid, unpaid and to collect', async () => {
    await show();
    // October was missed, November is not paid yet.
    const marketing = rowOf('Elena Rossi, Digital marketing');
    expect(marketing.textContent).toContain('Harbour Dental');
    expect(within(marketing).getAllByRole('cell').map((c) => c.textContent).slice(2, 8)).toEqual(['5 Nov', '$500', '$0', '$500', '$500', '$1,000']);
    expect(within(marketing).getByText('Overdue')).toBeTruthy();
    // A one-time fee due this month, half of it paid before.
    const website = rowOf('Elena Rossi, Website');
    expect(within(website).getAllByRole('cell').map((c) => c.textContent).slice(2, 8)).toEqual(['15 Nov', '$8,000', '$4,000', '$4,000', '$0', '$4,000']);
    expect(within(website).getByText('Part paid')).toBeTruthy();
    expect(within(rowOf('Tom Okafor, LinkedIn')).getByText('Paid')).toBeTruthy();
  });

  it('puts what needs collecting most at the top, and adds everything up', async () => {
    await show();
    const names = screen.getAllByRole('row').slice(1, 4).map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(['Elena Rossi, Website', 'Elena Rossi, Digital marketing', 'Tom Okafor, LinkedIn']);
    // The figures at the top: November's charges, and everything still to collect.
    expect(screen.getByText('Charges in Nov 2026')).toBeTruthy();
    expect(screen.getAllByText('$5,000').length).toBeGreaterThanOrEqual(2);
    const foot = screen.getByText('Total of what is shown').closest('tr') as HTMLElement;
    expect(within(foot).getAllByRole('cell').map((c) => c.textContent).slice(1, 6)).toEqual(['$8,600', '$4,100', '$4,500', '$500', '$5,000']);
  });

  it('moves to another month with the arrows', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'The month before' }));
    expect((screen.getByLabelText('Month') as HTMLInputElement).value).toBe('2026-10');
    // In October the website was not due yet.
    expect(within(rowOf('Elena Rossi, Website')).getByText('Nothing due')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'The month after' }));
    fireEvent.click(screen.getByRole('button', { name: 'The month after' }));
    expect((screen.getByLabelText('Month') as HTMLInputElement).value).toBe('2026-12');
  });
});

describe('the filters', () => {
  it('finds a client, a company or a service', async () => {
    await show();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'harbour' } });
    expect(screen.getByText('2 of 3 services')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'linkedin' } });
    expect(screen.getAllByRole('row').slice(1, -1).map((r) => r.getAttribute('aria-label'))).toEqual(['Tom Okafor, LinkedIn']);
  });

  it('shows only monthly or one-time fees, or only what has something to collect', async () => {
    await show();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'one_time' } });
    expect(screen.getByText('1 of 3 services')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'collect' } });
    expect(screen.getByText('2 of 3 services')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'overdue' } });
    expect(screen.getByText('1 of 3 services')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('3 of 3 services')).toBeTruthy();
  });

  it('says so when nothing matches', async () => {
    await show();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nobody' } });
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy();
  });
});

describe('the year, laid out like a payments sheet', () => {
  const sheet = async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'The year 2026' }));
    return screen.getByRole('table', { name: 'Payments in 2026' });
  };
  const cellsOf = (table: HTMLElement, name: string) => within(within(table).getByRole('row', { name })).getAllByRole('cell').map((c) => c.textContent);

  it('has the columns of the sheet, in its order', async () => {
    const table = await sheet();
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Project', 'Client', 'Type', 'Fee', 'Total cost', 'Opening paid', 'Start', 'End',
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Total paid', 'Amount due', 'Notes', 'Actions',
    ]);
  });

  it('shows a monthly service: its fee, when it runs, each month paid, the total paid and what is due', async () => {
    const cells = cellsOf(await sheet(), 'Elena Rossi, Digital marketing');
    expect(cells.slice(0, 8)).toEqual(['Digital marketing', 'Elena RossiHarbour Dental', 'Monthly', '$500', 'Ongoing', '$0', 'Jul 2026', '–']);
    expect(cells.slice(8, 22)).toEqual(['–', '–', '–', '–', '–', '–', '$500', '$500', '$500', '–', '–', '–', '$1,500', '$1,000']);
  });

  it('shows a one-time service with its whole cost and what was paid at the start', async () => {
    const cells = cellsOf(await sheet(), 'Elena Rossi, Website');
    expect(cells.slice(2, 8)).toEqual(['One-time', '$8,000', '$8,000', '$4,000', '–', '–']);
  });

  it('works out the whole cost of a monthly service that has an end, and shows its notes', async () => {
    h.listClientAccounts.mockResolvedValue([account('a1', 'lead-1', 'Digital marketing', { serviceEnd: '2026-12-31', notes: 'Pays by card' })]);
    const cells = cellsOf(await sheet(), 'Elena Rossi, Digital marketing');
    expect(cells[4]).toBe('$3,000');
    expect(cells[7]).toBe('Dec 2026');
    expect(cells[22]).toBe('Pays by card');
  });

  it('records a payment for a month by pressing that month', async () => {
    const table = await sheet();
    fireEvent.click(within(table).getByRole('button', { name: 'Record a payment for Elena Rossi, Digital marketing, October 2026' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    expect((within(dialog).getByLabelText('Pays for the month') as HTMLInputElement).value).toBe('2026-10');
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('500');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(h.addAccountPayment).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'a1', amount: 500, billingMonth: '2026-10' })));
  });

  it('makes an invoice from a row of the sheet', async () => {
    const table = await sheet();
    fireEvent.click(within(table).getByRole('button', { name: 'Create an invoice for Elena Rossi, Digital marketing' }));
    expect(JSON.parse(screen.getByTestId('new-invoice').textContent ?? '{}')).toMatchObject({ companyId: 'co-1', service: { accountId: 'a1', monthly: true } });
  });

  it('changes a service from its row', async () => {
    const table = await sheet();
    fireEvent.click(within(table).getByRole('button', { name: 'Edit Digital marketing of Elena Rossi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit service' });
    fireEvent.change(within(dialog).getByLabelText('Monthly amount'), { target: { value: '650' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateClientAccount).toHaveBeenCalledWith('a1', expect.objectContaining({ agreedAmount: 650, serviceName: 'Digital marketing' })));
    await waitFor(() => expect(h.listClientAccounts).toHaveBeenCalledTimes(2));
  });
});

describe('adding a service on this page', () => {
  it('asks which client it is for, and saves it for that lead', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add service' });
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(within(dialog).getByRole('combobox', { name: 'Client' }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Tom Okafor' }), { key: 'Enter' });
    fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: 'SEO' } });
    fireEvent.change(within(dialog).getByLabelText('Monthly amount'), { target: { value: '250' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.createClientAccount).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', workspaceId: 'ws-1', contactId: 'lead-2', serviceName: 'SEO', agreedAmount: 250, billingType: 'monthly',
    })));
    expect(h.toast.success).toHaveBeenCalledWith('Service added');
  });

  it('is offered when there is no service at all yet', async () => {
    h.listClientAccounts.mockResolvedValue([]);
    render(<MemoryRouter><CrmAccountsPage /></MemoryRouter>);
    await screen.findByText(/No client has a service yet/);
    expect(screen.getAllByRole('button', { name: 'Add service' }).length).toBeGreaterThan(0);
  });
});

describe('recording a payment from a row', () => {
  it('starts from what is unpaid for the month, and saves it for that service', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment for Elena Rossi, Digital marketing' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record a payment' });
    expect(dialog.textContent).toContain('$1,000 is still to collect.');
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('500');
    expect((within(dialog).getByLabelText('Pays for the month') as HTMLInputElement).value).toBe('2026-11');
    fireEvent.change(within(dialog).getByLabelText('Payment date'), { target: { value: '2026-11-06' } });
    fireEvent.change(within(dialog).getByLabelText('Method'), { target: { value: 'Bank transfer' } });
    fireEvent.change(within(dialog).getByLabelText('Reference'), { target: { value: ' R-2041 ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(h.addAccountPayment).toHaveBeenCalledTimes(1));
    // The month is not named when it is the month the payment arrived in.
    expect(h.addAccountPayment.mock.calls[0][0]).toEqual({
      accountId: 'a1', organizationId: 'org-1', workspaceId: 'ws-1', createdBy: 'u1',
      amount: 500, paidOn: '2026-11-06', billingMonth: null, method: 'Bank transfer', reference: 'R-2041', notes: null,
    });
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Payment recorded'));
    await waitFor(() => expect(h.listClientAccounts).toHaveBeenCalledTimes(2));
  });

  it('names the month when the payment pays for another one', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment for Elena Rossi, Digital marketing' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Payment date'), { target: { value: '2026-11-06' } });
    fireEvent.change(within(dialog).getByLabelText('Pays for the month'), { target: { value: '2026-10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(h.addAccountPayment.mock.calls[0]?.[0]).toMatchObject({ billingMonth: '2026-10' }));
  });

  it('keeps the window open and says so in plain words when it could not be saved', async () => {
    h.addAccountPayment.mockRejectedValue(new Error('new row violates row-level security policy for table "crm_account_payments"'));
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment for Tom Okafor, LinkedIn' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '100' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
    expect(String(h.toast.error.mock.calls[0][0])).not.toMatch(/row-level|crm_account/);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('making an invoice from a row', () => {
  it('opens the invoice window for the lead\'s company, with the service and the month on screen', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Create an invoice for Elena Rossi, Digital marketing' }));
    expect(JSON.parse(screen.getByTestId('new-invoice').textContent ?? '{}')).toEqual({
      companyId: 'co-1', service: { accountId: 'a1', name: 'Digital marketing', amount: 500, billingMonth: '2026-11', monthly: true, currency: 'USD' },
    });
  });

  it('bills a one-time fee for what is still owed, with no month', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Create an invoice for Elena Rossi, Website' }));
    expect(JSON.parse(screen.getByTestId('new-invoice').textContent ?? '{}').service).toEqual({ accountId: 'a2', name: 'Website', amount: 4000, billingMonth: null, monthly: false, currency: 'USD' });
  });

  it('asks for a company first when the lead has none: an invoice is made out to a company', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Create an invoice for Tom Okafor, LinkedIn' }));
    expect(screen.queryByTestId('new-invoice')).toBeNull();
    expect(h.toast.error).toHaveBeenCalledWith('Give this lead a company first (open the lead and press Edit). An invoice is made out to a company.');
  });
});

describe('with nothing to show', () => {
  it('says where services are added', async () => {
    h.listClientAccounts.mockResolvedValue([]);
    render(<MemoryRouter><CrmAccountsPage /></MemoryRouter>);
    expect(await screen.findByText(/No client has a service yet/)).toBeTruthy();
    expect(h.listAccountPayments).not.toHaveBeenCalled();
  });
});

describe('services in more than one currency', () => {
  it('writes each service in its own currency, and never adds two currencies together', async () => {
    h.listClientAccounts.mockResolvedValue([
      account('a1', 'lead-1', 'Website'),
      account('a9', 'lead-2', 'Paid ads', { agreedAmount: 200, currency: 'GBP' }),
    ]);
    h.listAccountPayments.mockResolvedValue([]);
    await show();
    const row = rowOf('Tom Okafor, Paid ads');
    expect(row.textContent).toContain('£200 a month');
    expect(rowOf('Elena Rossi, Website').textContent).toContain('$500 a month');
    expect(screen.getByText('Monthly fees').parentElement?.textContent).toContain('$500 + £200');
    // The foot of the table as well.
    expect(screen.getByText('Total of what is shown').closest('tr')?.textContent).toContain('$500 + £200');
  });
});

describe('billing and invoices, joined', () => {
  const made = (over: Record<string, unknown> = {}) => ({
    id: 'inv-7', number: 'INV-0007', status: 'Issued', dueDate: '2026-12-01', issueDate: '2026-11-01', accountId: 'a1', billingMonth: '2026-11',
    clientId: 'c1', currency: 'USD', lines: [], payments: [], totalMinor: 50000, sentAt: null, ...over,
  });
  const withInvoices = (list: unknown[]) => h.call.mockImplementation(async (path: string) => (path === 'billing' ? list : {}));

  it('shows the invoice already made for a service and month, with its status, where "Invoice" was', async () => {
    withInvoices([made()]);
    await show();
    const row = rowOf('Elena Rossi, Digital marketing');
    const link = await within(row).findByRole('link', { name: 'Open invoice INV-0007 for Elena Rossi, Digital marketing' });
    expect(link.getAttribute('href')).toBe('/crm/invoices/inv-7');
    expect(within(row).getByText('Issued')).toBeTruthy();
    // It is not made twice.
    expect(within(row).queryByRole('button', { name: 'Create an invoice for Elena Rossi, Digital marketing' })).toBeNull();
    // Another service still offers it.
    expect(within(rowOf('Tom Okafor, LinkedIn')).getByRole('button', { name: 'Create an invoice for Tom Okafor, LinkedIn' })).toBeTruthy();
  });

  it('sends an issued invoice to the client from the row', async () => {
    withInvoices([made()]);
    await show();
    fireEvent.click(await within(rowOf('Elena Rossi, Digital marketing')).findByRole('button', { name: 'Send invoice INV-0007 to the client' }));
    await waitFor(() => expect(h.call).toHaveBeenCalledWith('billing/inv-7/send', {}));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Invoice INV-0007 was sent.'));
  });

  it('says to finish a draft first: a draft cannot be sent', async () => {
    withInvoices([made({ status: 'Draft' })]);
    await show();
    const row = rowOf('Elena Rossi, Digital marketing');
    await within(row).findByRole('link', { name: 'Open invoice INV-0007 for Elena Rossi, Digital marketing' });
    expect(within(row).queryByRole('button', { name: /Send invoice/ })).toBeNull();
    expect(within(row).getByText('Draft')).toBeTruthy();
  });

  it('offers a new invoice again when the one made was voided, and for another month', async () => {
    withInvoices([made({ status: 'Voided' }), made({ id: 'inv-6', number: 'INV-0006', billingMonth: '2026-10' })]);
    await show();
    expect(within(rowOf('Elena Rossi, Digital marketing')).getByRole('button', { name: 'Create an invoice for Elena Rossi, Digital marketing' })).toBeTruthy();
  });

  it('says it in plain words when the invoice could not be sent', async () => {
    h.call.mockImplementation(async (path: string) => {
      if (path === 'billing') return [made()];
      throw new Error('This invoice has no customer email address.');
    });
    await show();
    fireEvent.click(await within(rowOf('Elena Rossi, Digital marketing')).findByRole('button', { name: 'Send invoice INV-0007 to the client' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('This invoice has no customer email address.'));
  });
});
