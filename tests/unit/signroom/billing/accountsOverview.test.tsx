// The accounts overview: every company's plan months and issued invoices for one year.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OverviewRow } from '../../../../api/_signroom/shared/types';
import { customer, overviewRow, stubBrowser } from './fixtures';

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

import { AccountsOverviewPage } from '@/pages/signroom/AccountsOverview';

const harbour = { clientId: 'c2', clientName: 'Harbour Dental' };
const rows: OverviewRow[] = [
  overviewRow({ id: 'a', period: '2026-10', status: 'overdue', remainingMinor: 50000 }),
  overviewRow({ id: 'b', period: '2026-11', status: 'upcoming', remainingMinor: 30000, paidMinor: 20000 }),
  overviewRow({ id: 'c', period: '2026-09', status: 'paid', remainingMinor: 0, paidMinor: 50000 }),
  overviewRow({ id: 'd', ...harbour, reference: 'Shop build', currency: 'USD', period: '2026-03', status: 'overdue', paidMinor: 30000, remainingMinor: 90000 }),
  overviewRow({ id: 'e', clientId: 'c3', clientName: 'Old Mill', reference: 'Care plan', archived: true, period: '2026-11' }),
  overviewRow({ id: 'i1', source: 'Invoice', reference: 'INV-0002', period: '2026-11-10', status: 'overdue', remainingMinor: 1800 }),
  overviewRow({ id: 'i2', source: 'Invoice', ...harbour, reference: 'INV-0004', currency: 'USD', period: '2026-10-20', status: 'paid', paidMinor: 3000, remainingMinor: 0 }),
];

function serve(data: OverviewRow[] = rows) {
  sr.call.mockImplementation(async (path: string) => {
    if (path === 'clients') return [customer(), customer({ id: 'c2', crmCompanyId: 'co2', name: 'Harbour Dental' })];
    const year = /^accounts-overview\?year=(\d{4})$/.exec(path);
    if (year) return { year: Number(year[1]), today: '2026-11-19', rows: Number(year[1]) === 2026 ? data : [] };
    throw new Error(`unexpected ${path}`);
  });
}
const open = () => render(<MemoryRouter><AccountsOverviewPage /></MemoryRouter>);
const table = () => within(screen.getByRole('region', { name: 'Accounts for 2026' }));
const stat = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement as HTMLElement;
const chips = (name: string) => within(screen.getByRole('group', { name }));
const months = () => table().getAllByRole('columnheader').map((th) => th.textContent ?? '').filter((text) => /\d{4}/.test(text));
const ready = () => screen.findByRole('region', { name: 'Accounts for 2026' });
const readBlob = (blob: Blob) => new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.readAsText(blob);
});

beforeEach(() => {
  stubBrowser();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Accounts overview', () => {
  it('shows this year\'s plan months under their month, each company opening its CRM page', async () => {
    open();
    await ready();
    expect(sr.call).toHaveBeenCalledWith('accounts-overview?year=2026');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Accounts overview');
    expect(months().map((text) => text.replace(/\d+ (entry|entries).*/, '').trim())).toEqual([
      'March 2026', 'September 2026', 'October 2026', 'November 2026',
    ]);

    const september = within(table().getAllByText('£500.00')[0]!.closest('tr') as HTMLElement);
    expect(september.getByRole('link', { name: 'Northwind Studio' }).getAttribute('href')).toBe('/crm/companies/co1');
    expect(september.getByText('Website retainer')).toBeTruthy();
    expect(september.getByText('Paid').getAttribute('data-tone')).toBe('success');
    expect(september.getByText('£0.00')).toBeTruthy();

    const shop = within(table().getByText('Shop build').closest('tr') as HTMLElement);
    expect(shop.getByRole('link', { name: 'Harbour Dental' }).getAttribute('href')).toBe('/crm/companies/co2');
    expect(shop.getByText('$300.00')).toBeTruthy();
    expect(shop.getByText('$900.00')).toBeTruthy();
    expect(shop.getByText('Overdue').getAttribute('data-tone')).toBe('danger');
    expect(table().queryByText('Old Mill')).toBeNull();
    expect(table().queryByText('INV-0002')).toBeNull();
    expect(screen.getByRole('link', { name: /Invoices/ }).getAttribute('href')).toBe('/crm/invoices');
  });

  it('adds up paid, still to come and overdue per currency and never adds two currencies together', async () => {
    open();
    await ready();
    expect(within(stat('Paid')).getByText('£700.00')).toBeTruthy();
    expect(within(stat('Paid')).getByText('$300.00')).toBeTruthy();
    expect(within(stat('Still to come')).getByText('£300.00')).toBeTruthy();
    expect(within(stat('Still to come')).queryByText(/\$/)).toBeNull();
    expect(within(stat('Overdue')).getByText('£500.00')).toBeTruthy();
    expect(within(stat('Overdue')).getByText('$900.00')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/1,000\.00|1,400\.00/);

    // One company in one currency: a single amount, coloured when something is overdue.
    fireEvent.change(screen.getByRole('textbox', { name: 'Search companies, plans and invoices' }), { target: { value: 'northwind' } });
    expect(within(stat('Paid')).queryByText('$300.00')).toBeNull();
    expect(within(stat('Overdue')).getByText('£500.00').getAttribute('data-tone')).toBe('danger');
  });

  it('filters by status with a count on each, and the totals stay for everything in view', async () => {
    open();
    await ready();
    const status = chips('Filter by status');
    expect(status.getByRole('button', { name: /^All 4$/ })).toBeTruthy();
    expect(status.getByRole('button', { name: /^Paid 1$/ })).toBeTruthy();
    expect(status.getByRole('button', { name: /^To come 1$/ })).toBeTruthy();
    fireEvent.click(status.getByRole('button', { name: /^Overdue 2$/ }));
    expect(months().map((text) => text.replace(/\d+ (entry|entries).*/, '').trim())).toEqual(['March 2026', 'October 2026']);
    expect(screen.getByText('2 entries · 2 companies')).toBeTruthy();
    expect(within(stat('Paid')).getByText('£700.00')).toBeTruthy();

    fireEvent.click(status.getByRole('button', { name: /^To come 1$/ }));
    expect(screen.getByText('1 entry · 1 company')).toBeTruthy();
    expect(table().getByText('To come').getAttribute('data-tone')).toBe('info');
  });

  it('shows invoices instead of plans, each opening its invoice', async () => {
    open();
    await ready();
    const show = chips('Show');
    expect(show.getByRole('button', { name: /^Billing plans 4$/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(show.getByRole('button', { name: /^Invoices 2$/ }));
    expect(months().map((text) => text.replace(/\d+ (entry|entries).*/, '').trim())).toEqual(['October 2026', 'November 2026']);
    const late = within(table().getByRole('link', { name: 'INV-0002' }).closest('tr') as HTMLElement);
    expect(table().getByRole('link', { name: 'INV-0002' }).getAttribute('href')).toBe('/crm/invoices/i1');
    expect(late.getByText('10 Nov 2026')).toBeTruthy();
    expect(late.getByText('£18.00')).toBeTruthy();
    expect(late.getByText('Overdue')).toBeTruthy();
    expect(table().queryByText('Website retainer')).toBeNull();
    expect(within(stat('Paid')).getByText('$30.00')).toBeTruthy();
    expect(within(stat('Overdue')).getByText('£18.00')).toBeTruthy();
  });

  it('finds a company, plan or invoice by words, shows archived ones when asked, and can put the latest month first', async () => {
    open();
    await ready();
    fireEvent.click(screen.getByLabelText('Show archived'));
    expect(table().getByText('Old Mill')).toBeTruthy();
    expect(within(table().getByText('Old Mill').closest('tr') as HTMLElement).getByText('Archived')).toBeTruthy();
    expect(chips('Show').getByRole('button', { name: /^Billing plans 5$/ })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Order' }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Latest month first' }), { key: 'Enter' });
    await waitFor(() => expect(months()[0]).toContain('November 2026'));

    fireEvent.change(screen.getByRole('textbox', { name: 'Search companies, plans and invoices' }), { target: { value: 'shop' } });
    expect(table().getByText('Shop build')).toBeTruthy();
    expect(table().queryByText('Website retainer')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search companies, plans and invoices' }), { target: { value: 'nothing like this' } });
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(await ready()).toBeTruthy();
    expect(table().getByText('Shop build')).toBeTruthy();
  });

  it('asks the server for another year, and says so when a year has nothing', async () => {
    open();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('accounts-overview?year=2025'));
    expect(await screen.findByText(/No billing plan months in 2025/)).toBeTruthy();
    expect(within(stat('Paid')).getByText('—')).toBeTruthy();
  });

  it('points to the invoices when only they have anything this year', async () => {
    serve(rows.filter((r) => r.source === 'Invoice'));
    open();
    expect(await screen.findByText(/No billing plan months in 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 invoices' }));
    expect(table().getByRole('link', { name: 'INV-0004' })).toBeTruthy();
  });

  it('exports what is shown, in the order shown', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    open();
    await ready();
    fireEvent.click(chips('Filter by status').getByRole('button', { name: /^Overdue 2$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(click).toHaveBeenCalled();
    const text = await readBlob(vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob);
    expect(text.slice(text.indexOf('"')).split('\r\n')).toEqual([
      '"Company","Type","Plan or invoice","Month or due date","Currency","Paid","Still to pay","Status","Archived"',
      '"Harbour Dental","Billing plan","Shop build","2026-03","USD","300.00","900.00","Overdue",""',
      '"Northwind Studio","Billing plan","Website retainer","2026-10","GBP","0.00","500.00","Overdue",""',
    ]);
    expect(toast.success).toHaveBeenCalledWith('Exported 2 entries');
  });

  it('says quietly that it is not set up yet when the server answers 503', async () => {
    sr.call.mockImplementation(async (path: string) => {
      if (path === 'clients') return [];
      throw Object.assign(new Error('Run the latest database update to see the accounts overview.'), { status: 503 });
    });
    open();
    const note = await screen.findByText('Run the latest database update to see the accounts overview.');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.className).not.toContain('destructive');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Accounts overview');
  });

  it('shows the server sentence when the year cannot be loaded', async () => {
    sr.call.mockImplementation(async (path: string) => {
      if (path === 'clients') return [];
      throw Object.assign(new Error('You do not have access to this workspace.'), { status: 403 });
    });
    open();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this workspace.');
  });

  it('asks for a workspace, and calls nothing, while none is selected', async () => {
    sr.state.workspaceId = null;
    open();
    expect(screen.getByText('Pick a workspace in the sidebar to see its accounts.')).toBeTruthy();
    await Promise.resolve();
    expect(sr.call).not.toHaveBeenCalled();
  });
});
