// A company's billing plans on its CRM page: the year grid, adding and changing a plan, and editing a month.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { projectYear } from '../../../../api/_signroom/shared/accounts';
import type { ClientProject, Invoice } from '../../../../api/_signroom/shared/types';
import { crmCurrency, customer, issued, monthEntry, payment, plan, stubBrowser } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  // One object for the whole file: the screens keep `client` in effect dependencies.
  return { call, state: { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

// The first render loads every dialog and menu: give it room on a busy machine.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => crmCurrency }));

import { BillingPlansPanel } from '@/components/signroom/billing/BillingPlansPanel';

type Body = Record<string, unknown>;
const stale = () => Object.assign(new Error('Billing plan changed. Reload before editing.'), { status: 409 });

/** What the pretend server holds. A change answers with `change`, or is refused with what `refuse` returns. */
const server = {
  customers: [customer()],
  plans: [] as ClientProject[],
  invoices: [] as Invoice[],
  refuse: null as null | (() => Error),
  down: null as null | Error,
};

function serve() {
  sr.call.mockImplementation(async (path: string, body?: Body, method?: string) => {
    if (path === 'clients') return server.customers;
    if (path === 'clients/from-company') {
      server.customers = [customer()];
      return customer();
    }
    if (path === 'billing?companyId=co1') return server.invoices;
    const list = /^client-projects\/c1\?year=(\d{4})$/.exec(path);
    if (list) {
      if (server.down) throw server.down;
      const year = Number(list[1]);
      return { year, clientName: 'Northwind Studio', projects: server.plans.map((p) => projectYear(p, server.invoices, year)) };
    }
    if (path === 'client-projects/c1' && method === 'POST') {
      if (server.refuse) throw server.refuse();
      const made = plan({ id: 'new', name: String(body?.name) });
      server.plans = [...server.plans, made];
      return made;
    }
    const one = /^client-projects\/c1\/(\w+)$/.exec(path);
    if (one && method === 'PATCH') {
      if (server.refuse) throw server.refuse();
      const found = server.plans.find((p) => p.id === one[1])!;
      const next = { ...found, revision: found.revision + 1 };
      if (body?.action === 'archive') next.archived = true;
      else if (body?.action === 'restore') next.archived = false;
      else if (!body?.action) next.name = String(body?.name);
      server.plans = server.plans.map((p) => (p.id === next.id ? next : p));
      return next;
    }
    throw new Error(`unexpected ${method ?? 'GET'} ${path}`);
  });
}

const open = () => render(<MemoryRouter><BillingPlansPanel companyId="co1" companyName="Northwind Studio" /></MemoryRouter>);
const grid = () => within(screen.getByRole('region', { name: 'Billing plans for 2026' }));
const stat = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement as HTMLElement;
const month = (name: string, planName = 'Website retainer') =>
  screen.getByRole('button', { name: new RegExp(`^Edit ${name} 2026 for ${planName}`) }) as HTMLButtonElement;
const type = (scope: ReturnType<typeof within>, label: string | RegExp, value: string) =>
  fireEvent.change(scope.getByLabelText(label), { target: { value } });
const pick = async (scope: ReturnType<typeof within>, label: string, option: string) => {
  fireEvent.keyDown(scope.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
};
const menu = async (planName: string, itemName: string) => {
  fireEvent.keyDown(screen.getByRole('button', { name: `More actions for ${planName}` }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: itemName }));
};
const calls = (start: string) => sr.call.mock.calls.filter((c) => String(c[0]).startsWith(start));
const changes = () => sr.call.mock.calls.filter((c) => c[2] === 'POST' || c[2] === 'PATCH');
const readBlob = (blob: Blob) => new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.readAsText(blob);
});

/** £500.00 a month from September 2026. September was paid by hand; October was not. */
const retainer = (over: Partial<ClientProject> = {}) => plan({ monthlyEntries: { '2026-09': monthEntry(50000, 50000) }, ...over });

beforeEach(() => {
  stubBrowser();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  server.customers = [customer()];
  server.plans = [retainer()];
  server.invoices = [];
  server.refuse = null;
  server.down = null;
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Billing plans: the year', () => {
  it('shows each month as paid, to come or overdue, with what was expected', async () => {
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    expect(sr.call).toHaveBeenCalledWith('client-projects/c1?year=2026');

    const august = within(month('Aug'));
    expect(august.queryByText(/Paid|To come|Overdue/)).toBeNull();
    const september = within(month('Sep'));
    expect(september.getByText('£500.00')).toBeTruthy();
    expect(september.getByText('Paid').getAttribute('data-tone')).toBe('success');
    const october = within(month('Oct'));
    expect(october.getByText('of £500.00')).toBeTruthy();
    expect(october.getByText('Overdue').getAttribute('data-tone')).toBe('danger');
    expect(within(month('Nov')).getByText('To come').getAttribute('data-tone')).toBe('info');

    const row = within(screen.getByRole('button', { name: 'Website retainer' }).closest('tr') as HTMLElement);
    expect(row.getByText(/Monthly retainer · £500\.00 a month/)).toBeTruthy();
    expect(row.getByText('From Sep 2026')).toBeTruthy();
    expect(row.getByText('£2,000.00')).toBeTruthy();
    expect(row.getByText('£1,500.00')).toBeTruthy();
  });

  it('adds up the year: target, paid, still to come, overdue and unpaid invoices', async () => {
    server.invoices = [issued({
      id: 'i7', number: 'INV-0007', projectId: 'pl1', status: 'Part paid', totalMinor: 50000, subtotalMinor: 50000, taxMinor: 0,
      payments: [payment({ amountMinor: 20000, paidOn: '2026-10-05' })],
    })];
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    expect(within(stat('Target for 2026')).getByText('£2,000.00')).toBeTruthy();
    expect(within(stat('Target for 2026')).getByText('£1,300.00 left to reach it')).toBeTruthy();
    expect(within(stat('Paid')).getByText('£700.00')).toBeTruthy();
    expect(within(stat('Still to come')).getByText('£1,000.00')).toBeTruthy();
    expect(within(stat('Overdue')).getByText('£300.00').getAttribute('data-tone')).toBe('danger');
    expect(within(stat('Unpaid invoices')).getByText('£300.00')).toBeTruthy();

    const october = within(month('Oct'));
    expect(october.getByText('£200.00')).toBeTruthy();
    expect(october.getByText('Overdue')).toBeTruthy();
  });

  it('lists the invoices linked to a plan, each opening its invoice', async () => {
    server.invoices = [
      issued({ id: 'i7', number: 'INV-0007', projectId: 'pl1', totalMinor: 50000, subtotalMinor: 50000, taxMinor: 0 }),
      issued({ id: 'i8', number: 'INV-0008' }),
    ];
    open();
    const linked = within(await screen.findByRole('region', { name: 'Invoices linked to these plans' }));
    expect(sr.call).toHaveBeenCalledWith('billing?companyId=co1');
    const row = within(linked.getByRole('link', { name: 'INV-0007' }).closest('tr') as HTMLElement);
    expect(linked.getByRole('link', { name: 'INV-0007' }).getAttribute('href')).toBe('/crm/invoices/i7');
    expect(row.getByText('Website retainer')).toBeTruthy();
    expect(row.getByText('Issued')).toBeTruthy();
    expect(row.getAllByText('£500.00')).toHaveLength(2);
    expect(linked.queryByRole('link', { name: 'INV-0008' })).toBeNull();
  });

  it('keeps two currencies apart in every total', async () => {
    server.plans = [retainer(), plan({
      id: 'pl2', name: 'Shop build', billingType: 'One-off', currency: 'USD', monthlyFeeMinor: 0, contractValueMinor: 120000,
      startMonth: '2026-03', monthlyEntries: { '2026-03': monthEntry(30000, 120000) },
    })];
    open();
    await screen.findByRole('button', { name: 'Shop build' });
    expect(within(stat('Paid')).getByText('£500.00')).toBeTruthy();
    expect(within(stat('Paid')).getByText('$300.00')).toBeTruthy();
    expect(within(stat('Overdue')).getByText('£500.00')).toBeTruthy();
    expect(within(stat('Overdue')).getByText('$900.00')).toBeTruthy();
    expect(within(stat('Paid')).queryByText(/800/)).toBeNull();
    expect(grid().getByText(/One-off · \$1,200\.00/)).toBeTruthy();
    expect(grid().getByRole('rowheader', { name: 'Total GBP' })).toBeTruthy();
    expect(grid().getByRole('rowheader', { name: 'Total USD' })).toBeTruthy();
  });

  it('asks the server for another year', async () => {
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('client-projects/c1?year=2027'));
    expect(await screen.findByRole('region', { name: 'Billing plans for 2027' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('client-projects/c1?year=2025'));
  });

  it('filters by payment status with a count on each, by words, and shows archived plans apart', async () => {
    server.plans = [
      retainer(),
      plan({ id: 'pl2', name: 'Hosting', monthlyFeeMinor: 2000, startMonth: '2026-11' }),
      plan({ id: 'pl3', name: 'Old site care', archived: true }),
    ];
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    expect(screen.queryByRole('button', { name: 'Old site care' })).toBeNull();
    const payments = within(screen.getByRole('group', { name: 'Filter by payment' }));
    expect(payments.getByRole('button', { name: /^All 2$/ })).toBeTruthy();
    fireEvent.click(payments.getByRole('button', { name: /^Overdue 1$/ }));
    expect(screen.getByRole('button', { name: 'Website retainer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hosting' })).toBeNull();
    expect(within(stat('Still to come')).getByText('£1,000.00')).toBeTruthy();
    expect(screen.getByText(/^Showing 1 of 2 plans with an overdue month in 2026\./)).toBeTruthy();

    fireEvent.click(payments.getByRole('button', { name: /^All 2$/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search billing plans' }), { target: { value: 'host' } });
    expect(screen.getByRole('button', { name: 'Hosting' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Website retainer' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search billing plans' }), { target: { value: '' } });

    fireEvent.click(within(screen.getByRole('group', { name: 'Active or archived' })).getByRole('button', { name: /^Archived 1$/ }));
    expect(screen.getByRole('button', { name: 'Old site care' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Website retainer' })).toBeNull();
    expect(month('Nov', 'Old site care').disabled).toBe(true);
  });

  it('exports the plans shown, guarding anything a spreadsheet would run as a formula', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    server.plans = [retainer({ notes: '=SUM(A1)' })];
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(click).toHaveBeenCalled();
    const text = await readBlob(vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob);
    expect(text).toContain('"Plan","Company","Type","Currency"');
    expect(text).toContain('"Website retainer","Northwind Studio","Monthly retainer","GBP","500.00"');
    expect(text).toContain('"Active","\'=SUM(A1)"');
  });
});

describe('Billing plans: adding and changing a plan', () => {
  it('adds a plan with exactly what the server reads', async () => {
    server.plans = [];
    open();
    expect(await screen.findByText(/No billing plans for this company yet/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Add billing plan/ })[0]!);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('combobox', { name: 'How it bills' }).textContent).toContain('Monthly retainer');
    expect(dialog.getByRole('combobox', { name: 'Currency' }).textContent).toContain('GBP');
    expect((dialog.getByLabelText('Start month') as HTMLInputElement).value).toBe('2026-11');

    type(dialog, 'Plan name', 'Care plan');
    await pick(dialog, 'How it bills', 'Custom');
    type(dialog, 'Billing description', 'Per milestone');
    await pick(dialog, 'Currency', 'EUR');
    type(dialog, 'Monthly fee', '250');
    type(dialog, 'Contract value', '3000.50');
    type(dialog, /Yearly target/, '2800');
    await pick(dialog, 'Status', 'On hold');
    type(dialog, 'Start month', '2026-03');
    type(dialog, /End month/, '2027-02');
    type(dialog, 'Notes', 'Agreed by phone');
    fireEvent.click(dialog.getByRole('button', { name: 'Add plan' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Billing plan added.'));
    expect(changes()).toEqual([['client-projects/c1', {
      name: 'Care plan', billingType: 'Custom', billingLabel: 'Per milestone', currency: 'EUR', monthlyFee: '250',
      contractValue: '3000.50', annualTarget: '2800', startMonth: '2026-03', endMonth: '2027-02', status: 'On hold',
      notes: 'Agreed by phone',
    }, 'POST']]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Care plan' })).toBeTruthy();
    expect(calls('client-projects/c1?year=2026')).toHaveLength(2);
  });

  it('does not make a customer record just by being looked at, only when the first plan is added', async () => {
    server.customers = [];
    server.plans = [];
    open();
    expect(await screen.findByText(/No billing plans for this company yet/)).toBeTruthy();
    expect(sr.call.mock.calls.map((c) => c[0])).toEqual(['clients']);

    fireEvent.click(screen.getAllByRole('button', { name: /Add billing plan/ })[0]!);
    const dialog = within(await screen.findByRole('dialog'));
    expect(sr.call.mock.calls.map((c) => c[0])).toEqual(['clients']);
    type(dialog, 'Plan name', 'Care plan');
    type(dialog, 'Monthly fee', '250');
    fireEvent.click(dialog.getByRole('button', { name: 'Add plan' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Billing plan added.'));
    expect(sr.call).toHaveBeenCalledWith('clients/from-company', { companyId: 'co1' });
    expect(changes()[0]![0]).toBe('client-projects/c1');
    expect(changes()[0]![1]).toMatchObject({ name: 'Care plan', billingType: 'Monthly', billingLabel: '', monthlyFee: '250', currency: 'GBP' });
    expect(await screen.findByRole('button', { name: 'Care plan' })).toBeTruthy();
  });

  it('changes a plan, sending the version it was read at', async () => {
    server.plans = [retainer({ revision: 4, notes: 'Renews each September' })];
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Website retainer' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect((dialog.getByLabelText('Plan name') as HTMLInputElement).value).toBe('Website retainer');
    expect((dialog.getByLabelText('Monthly fee') as HTMLInputElement).value).toBe('500.00');
    type(dialog, 'Plan name', 'Website care');
    type(dialog, 'Monthly fee', '550.00');
    fireEvent.click(dialog.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Billing plan saved.'));
    expect(changes()).toEqual([['client-projects/c1/pl1', {
      name: 'Website care', billingType: 'Monthly', billingLabel: '', currency: 'GBP', monthlyFee: '550.00',
      contractValue: '0.00', annualTarget: '0.00', startMonth: '2026-09', endMonth: '', status: 'Active',
      notes: 'Renews each September', revision: 4,
    }, 'PATCH']]);
    expect(await screen.findByRole('button', { name: 'Website care' })).toBeTruthy();
  });

  it('archives a plan and restores it', async () => {
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    await menu('Website retainer', 'Archive plan');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Plan archived. Its invoices and receipts are kept.'));
    expect(changes()).toEqual([['client-projects/c1/pl1', { action: 'archive', revision: 1 }, 'PATCH']]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Website retainer' })).toBeNull());

    fireEvent.click(within(screen.getByRole('group', { name: 'Active or archived' })).getByRole('button', { name: /^Archived 1$/ }));
    await menu('Website retainer', 'Restore plan');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Plan restored.'));
    expect(changes()[1]).toEqual(['client-projects/c1/pl1', { action: 'restore', revision: 2 }, 'PATCH']);
  });

  it('shows the server sentence in the form when a plan is refused, and keeps what was typed', async () => {
    server.refuse = () => Object.assign(new Error('Enter a billing plan name and supported billing type, currency and status.'), { status: 400 });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Website retainer' }));
    const dialog = within(await screen.findByRole('dialog'));
    type(dialog, 'Monthly fee', '12.345');
    fireEvent.click(dialog.getByRole('button', { name: 'Save plan' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('Enter a billing plan name and supported billing type, currency and status.');
    expect((dialog.getByLabelText('Monthly fee') as HTMLInputElement).value).toBe('12.345');
    expect(calls('client-projects/c1?year=2026')).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps what was typed when the server refuses for a reason other than a newer version', async () => {
    // Also a 409, but the plan itself has not changed: the sentence is the server's own.
    server.refuse = () => Object.assign(new Error('Billing plan currency cannot change after invoices have been linked.'), { status: 409 });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Website retainer' }));
    const dialog = within(await screen.findByRole('dialog'));
    await pick(dialog, 'Currency', 'USD');
    fireEvent.click(dialog.getByRole('button', { name: 'Save plan' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('Billing plan currency cannot change after invoices have been linked.');
    expect(dialog.getByRole('combobox', { name: 'Currency' }).textContent).toContain('USD');
    expect(calls('client-projects/c1?year=2026')).toHaveLength(2);
  });

  it('loads the latest version and says so when the plan was changed somewhere else', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Website retainer' }));
    const dialog = within(await screen.findByRole('dialog'));
    type(dialog, 'Monthly fee', '550.00');
    // Someone else renames the plan before this save arrives.
    server.plans = [retainer({ name: 'Website care', revision: 2 })];
    server.refuse = stale;
    fireEvent.click(dialog.getByRole('button', { name: 'Save plan' }));

    expect((await screen.findByRole('alert')).textContent)
      .toBe('This plan was changed somewhere else. The latest version is shown now, so make your change again.');
    expect(calls('client-projects/c1?year=2026')).toHaveLength(2);
    const fresh = within(screen.getByRole('dialog'));
    expect((fresh.getByLabelText('Plan name') as HTMLInputElement).value).toBe('Website care');
    expect((fresh.getByLabelText('Monthly fee') as HTMLInputElement).value).toBe('500.00');

    server.refuse = null;
    type(fresh, 'Monthly fee', '550.00');
    fireEvent.click(fresh.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Billing plan saved.'));
    expect(changes()[1]![1]).toMatchObject({ name: 'Website care', monthlyFee: '550.00', revision: 2 });
  });

  it('reloads and says why when archiving a plan that changed somewhere else', async () => {
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    server.plans = [retainer({ name: 'Website care', revision: 2 })];
    server.refuse = stale;
    await menu('Website retainer', 'Archive plan');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'This plan was changed somewhere else. The latest version is shown now, so make your change again.',
    ));
    expect(await screen.findByRole('button', { name: 'Website care' })).toBeTruthy();
  });
});

describe('Billing plans: one month', () => {
  it('sets what a month expects and what was paid outside an invoice', async () => {
    server.invoices = [issued({
      projectId: 'pl1', status: 'Part paid', totalMinor: 50000, subtotalMinor: 50000, taxMinor: 0,
      payments: [payment({ amountMinor: 10000, paidOn: '2026-10-05' })],
    })];
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    fireEvent.click(month('Oct'));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('heading', { name: 'October 2026' })).toBeTruthy();
    expect(dialog.getByText(/Receipts on linked invoices this month: £100\.00/)).toBeTruthy();
    expect((dialog.getByLabelText(/Expected this month/) as HTMLInputElement).value).toBe('500.00');
    expect((dialog.getByLabelText(/Paid outside an invoice/) as HTMLInputElement).value).toBe('0.00');
    expect(dialog.getByText('£400.00')).toBeTruthy();

    type(dialog, /Expected this month/, '450');
    type(dialog, /Paid outside an invoice/, '200');
    type(dialog, 'Notes', 'Paid in cash');
    expect(dialog.getByText('£150.00')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Save month' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Month saved.'));
    expect(changes()).toEqual([['client-projects/c1/pl1', {
      action: 'month', month: '2026-10', paid: '200', expected: '450', notes: 'Paid in cash', revision: 1,
    }, 'PATCH']]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('client-projects/c1?year=2026')).toHaveLength(2);
  });

  it('puts a month back to what the plan expects', async () => {
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    fireEvent.click(month('Oct'));
    expect((within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset to the plan' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(month('Sep'));
    const dialog = within(await screen.findByRole('dialog'));
    expect((dialog.getByLabelText(/Paid outside an invoice/) as HTMLInputElement).value).toBe('500.00');
    fireEvent.click(dialog.getByRole('button', { name: 'Reset to the plan' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Month put back to what the plan expects.'));
    expect(changes()).toEqual([['client-projects/c1/pl1', { action: 'month', month: '2026-09', reset: true, revision: 1 }, 'PATCH']]);
  });

  it('loads the latest version when the month was changed somewhere else', async () => {
    open();
    await screen.findByRole('button', { name: 'Website retainer' });
    fireEvent.click(month('Oct'));
    const dialog = within(await screen.findByRole('dialog'));
    type(dialog, /Paid outside an invoice/, '500');
    server.plans = [retainer({ revision: 2, monthlyEntries: { '2026-09': monthEntry(50000, 50000), '2026-10': monthEntry(12500, 50000, 'Part') } })];
    server.refuse = stale;
    fireEvent.click(dialog.getByRole('button', { name: 'Save month' }));
    expect((await screen.findByRole('alert')).textContent)
      .toBe('This plan was changed somewhere else. The latest version is shown now, so make your change again.');
    const fresh = within(screen.getByRole('dialog'));
    expect((fresh.getByLabelText(/Paid outside an invoice/) as HTMLInputElement).value).toBe('125.00');
    expect((fresh.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Part');
  });
});

describe('Billing plans: states', () => {
  it('says quietly that plans are not set up yet when the server answers 503', async () => {
    server.down = Object.assign(new Error('Run the latest database update to use billing plans.'), { status: 503 });
    open();
    const note = await screen.findByText('Run the latest database update to use billing plans.');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.className).not.toContain('destructive');
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: /Add billing plan/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls('billing?')).toHaveLength(0);
  });

  it('shows the server sentence as an error for any other failure', async () => {
    server.down = Object.assign(new Error('You do not have access to this workspace.'), { status: 403 });
    open();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this workspace.');
  });

  it('asks for a workspace, and calls nothing, while none is selected', async () => {
    sr.state.workspaceId = null;
    open();
    expect(screen.getByText("Pick a workspace in the sidebar to see this company's billing plans.")).toBeTruthy();
    await Promise.resolve();
    expect(sr.call).not.toHaveBeenCalled();
  });
});
