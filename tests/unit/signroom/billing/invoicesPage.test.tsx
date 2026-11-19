// The invoice list: what is owed, what is late, and finding an invoice.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { crmCompany, crmCurrency, crmDeal, crmList, customer, invoice, issued, payment, stubBrowser } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  const pdf = vi.fn();
  // One object for the whole file: the screens keep `client` in effect dependencies.
  return { call, pdf, state: { client: { call, pdf, upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const crm = vi.hoisted(() => ({ companies: [] as unknown[], deals: [] as unknown[] }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useCrmHub', () => ({
  useCrmCompanies: () => crmList(crm.companies),
  useCrmDeals: () => crmList(crm.deals),
}));
vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => crmCurrency }));

import { InvoicesPage } from '@/pages/signroom/Invoices';

const northwind = customer();
const harbour = customer({ id: 'c2', crmCompanyId: 'co2', name: 'Harbour Dental', contactName: 'Sam', email: 'sam@harbour.example' });
const harbourCustomer = { name: 'Harbour Dental', contactName: 'Sam', email: 'sam@harbour.example', companyNumber: '' };

const all = [
  invoice({ id: 'a', number: 'INV-0001' }),
  issued({ id: 'b', number: 'INV-0002', dueDate: '2026-11-10' }),
  issued({
    id: 'c', number: 'INV-0003', clientId: 'c2', status: 'Part paid', totalMinor: 20000, subtotalMinor: 20000, taxMinor: 0,
    dueDate: '2026-12-10', customer: harbourCustomer,
    payments: [payment({ id: 'p1', amountMinor: 5000, paidOn: '2026-11-05', receiptNumber: 'INV-0003-R01' })],
  }),
  issued({
    id: 'd', number: 'INV-0004', clientId: 'c2', status: 'Paid', currency: 'USD', totalMinor: 3000, subtotalMinor: 3000, taxMinor: 0,
    customer: harbourCustomer, sentAt: '2026-10-02T08:00:00Z',
    payments: [payment({ id: 'p2', amountMinor: 3000, paidOn: '2026-10-20', receiptNumber: 'INV-0004-R01', recordedAt: '2026-10-20T10:00:00Z' })],
  }),
  issued({ id: 'e', number: 'INV-0005', status: 'Voided', dueDate: '2026-01-01' }),
];

function serve(invoices = all) {
  sr.call.mockImplementation(async (path: string) => {
    if (path === 'billing') return invoices;
    if (path === 'clients') return [northwind, harbour];
    if (path === 'billing/b/send') return { ...all[1]!, sentAt: '2026-11-19T12:00:00Z' };
    throw new Error(`unexpected ${path}`);
  });
}
const open = () => render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
const row = (number: string) => screen.getByRole('link', { name: number }).closest('tr') as HTMLElement;
const stat = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement as HTMLElement;

beforeEach(() => {
  stubBrowser();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  sr.pdf.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  crm.companies = [crmCompany('co1', 'Northwind Studio'), crmCompany('co2', 'Harbour Dental')];
  crm.deals = [crmDeal('d1', 'Northwind website', 'co1', 9500)];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Invoices list', () => {
  it('shows each invoice with its company, status and amounts in its own currency', async () => {
    serve();
    open();
    const overdue = within(await waitFor(() => row('INV-0002')));
    expect(overdue.getByRole('link', { name: 'Northwind Studio' }).getAttribute('href')).toBe('/crm/companies/co1');
    expect(overdue.getByText('Issued')).toBeTruthy();
    expect(overdue.getByText('Overdue')).toBeTruthy();
    expect(overdue.getByText('10 Nov 2026')).toBeTruthy();
    expect(overdue.getAllByText('£18.00')).toHaveLength(2);
    expect(overdue.getByText('Not sent')).toBeTruthy();

    const part = within(row('INV-0003'));
    expect(part.getByText('Part paid')).toBeTruthy();
    expect(part.getByText('£200.00')).toBeTruthy();
    expect(part.getByText('£50.00')).toBeTruthy();
    expect(part.getByText('£150.00')).toBeTruthy();
    expect(part.queryByText('Overdue')).toBeNull();

    expect(within(row('INV-0004')).getAllByText('$30.00')).toHaveLength(2);
    expect(within(row('INV-0004')).getByText('2 Oct 2026')).toBeTruthy();
    expect(within(row('INV-0005')).getAllByText('Voided')).toHaveLength(2);
    expect(within(row('INV-0001')).getByText('Draft')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'INV-0002' }).getAttribute('href')).toBe('/crm/invoices/b');
  });

  it('adds up what is outstanding, overdue and paid this month, without mixing currencies', async () => {
    serve();
    open();
    await waitFor(() => row('INV-0002'));
    expect(within(stat('Outstanding')).getByText('£168.00')).toBeTruthy();
    expect(within(stat('Outstanding')).getByText('2 invoices waiting to be paid')).toBeTruthy();
    expect(within(stat('Overdue')).getByText('£18.00').getAttribute('data-tone')).toBe('danger');
    expect(within(stat('Paid this month')).getByText('£50.00')).toBeTruthy();
  });

  it('filters by status, with a count on each, and by words', async () => {
    serve();
    open();
    await waitFor(() => row('INV-0002'));
    const filters = screen.getByRole('group', { name: 'Filter by status' });
    expect(within(filters).getByRole('button', { name: /^All 5$/ })).toBeTruthy();
    fireEvent.click(within(filters).getByRole('button', { name: /^Overdue 1$/ }));
    expect(screen.getByRole('link', { name: 'INV-0002' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'INV-0003' })).toBeNull();

    fireEvent.click(within(filters).getByRole('button', { name: /^All 5$/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search invoices' }), { target: { value: 'harbour' } });
    expect(screen.getByRole('link', { name: 'INV-0003' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'INV-0004' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'INV-0002' })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search invoices' }), { target: { value: 'nothing like this' } });
    expect(screen.getByText('No invoices match these filters.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(screen.getByRole('link', { name: 'INV-0002' })).toBeTruthy();
  });

  it('lists the receipts on their own tab', async () => {
    serve();
    open();
    await waitFor(() => row('INV-0002'));
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Receipts 2/ }));
    const receipt = within((await screen.findByText('INV-0003-R01')).closest('tr') as HTMLElement);
    expect(receipt.getByRole('link', { name: 'INV-0003' })).toBeTruthy();
    expect(receipt.getByText('Harbour Dental')).toBeTruthy();
    expect(receipt.getByText('5 Nov 2026')).toBeTruthy();
    expect(receipt.getByText('£50.00')).toBeTruthy();
    expect(screen.getByText('INV-0004-R01')).toBeTruthy();
  });

  it('sends an issued invoice from its row', async () => {
    serve();
    open();
    await waitFor(() => row('INV-0002'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for INV-0002' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Send invoice' }));
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('billing/b/send', {}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Email sent to elena@northwind.example.'));
  });

  it('says so when there are no invoices yet, and opens the start dialog', async () => {
    serve([]);
    open();
    expect(await screen.findByText('No invoices yet. Create the first one for a company in your CRM.')).toBeTruthy();
    expect(within(stat('Outstanding')).getByText('—')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /New invoice/ })[0]!);
    expect(within(screen.getByRole('dialog')).getByText('Company')).toBeTruthy();
  });

  it('links to the accounts overview from its header', async () => {
    serve();
    open();
    expect(screen.getByRole('link', { name: 'Accounts overview' }).getAttribute('href')).toBe('/crm/accounts-overview');
    await waitFor(() => row('INV-0002'));
  });

  it('shows the server sentence when the list cannot be loaded', async () => {
    sr.call.mockRejectedValue(new Error('You do not have access to this workspace.'));
    open();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this workspace.');
  });

  it('asks for a workspace, and calls nothing, while none is selected', async () => {
    sr.state.workspaceId = null;
    serve();
    open();
    expect(screen.getByText('Pick a workspace in the sidebar to see its invoices.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /New invoice/ }) as HTMLButtonElement).disabled).toBe(true);
    await Promise.resolve();
    expect(sr.call).not.toHaveBeenCalled();
  });
});
