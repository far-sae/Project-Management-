// @vitest-environment node
// Income: what came in (invoice payments, payments written on a client's
// services, other income) and what is still to come (issued invoices not paid).
import { describe, expect, it } from 'vitest';
import { incomeTotals, monthSeries, receivedRows, upcomingRows, type IncomeEntry } from '@/lib/income';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';
import { invoice, issued, payment } from './signroom/billing/fixtures';

const TODAY = '2026-11-28';
const nameOf = () => 'Northwind Studio';

const account = (over: Partial<CrmClientAccount> = {}): CrmClientAccount => ({
  id: 'acc-1', organizationId: 'org', workspaceId: 'ws', contactId: 'lead-1', projectId: null, serviceName: 'Website care',
  billingType: 'monthly', agreedAmount: 100, openingPaid: 0, serviceStart: '2026-01-01', serviceEnd: null, notes: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...over,
});
const servicePayment = (id: string, paidOn: string, amount: number, over: Partial<CrmAccountPayment> = {}): CrmAccountPayment => ({
  id, accountId: 'acc-1', organizationId: 'org', workspaceId: 'ws', paidOn, amount, notes: null, createdAt: new Date(paidOn), ...over,
});
const entry = (over: Partial<IncomeEntry> = {}): IncomeEntry => ({
  id: 'e1', organizationId: 'org', workspaceId: 'ws', title: 'Cash sale', payer: 'Walk-in customer', amount: 40, currency: 'GBP',
  receivedOn: '2026-11-21', method: 'Cash', reference: null, notes: null, ...over,
});

const INVOICES = [
  invoice({ id: 'a', number: 'INV-0001' }),
  issued({ id: 'b', number: 'INV-0002', dueDate: '2026-11-10' }),
  issued({
    id: 'c', number: 'INV-0003', status: 'Part paid', totalMinor: 20000, dueDate: '2026-12-10',
    payments: [payment({ id: 'p1', amountMinor: 5000, paidOn: '2026-11-05', receiptNumber: 'INV-0003-R01', method: 'Bank transfer', reference: 'BACS 1' })],
  }),
  issued({
    id: 'd', number: 'INV-0004', status: 'Paid', currency: 'USD', totalMinor: 3000,
    payments: [payment({ id: 'p2', amountMinor: 3000, paidOn: '2026-10-20', receiptNumber: 'INV-0004-R01' })],
  }),
  issued({ id: 'e', number: 'INV-0005', status: 'Voided', dueDate: '2026-01-01' }),
];

const all = () => receivedRows({
  invoices: INVOICES, nameOf,
  accounts: [account(), account({ id: 'acc-2', serviceName: 'Paid ads', currency: 'USD' })],
  payments: [
    servicePayment('s1', '2026-11-12', 100, { method: 'Card' }),
    // Written by the database from invoice INV-0003's payment: the same money, so it is not counted twice.
    servicePayment('s2', '2026-11-05', 50, { fromInvoice: true }),
    servicePayment('s3', '2026-09-01', 200, { accountId: 'acc-2' }),
    servicePayment('s4', '2026-11-02', 75, { accountId: 'gone' }),
  ],
  clientOf: (a) => (a.id === 'acc-1' ? 'Elena Rossi' : 'Tom Okafor'),
  entries: [entry()],
  companyCurrency: 'GBP',
});

describe('what came in', () => {
  it('lists invoice payments, payments written on services and other income, newest first', () => {
    expect(all().map((r) => [r.date, r.source, r.amount, r.currency])).toEqual([
      ['2026-11-21', 'other', 40, 'GBP'],
      ['2026-11-12', 'service', 100, 'GBP'],
      ['2026-11-05', 'invoice', 50, 'GBP'],
      ['2026-11-02', 'service', 75, 'GBP'],
      ['2026-10-20', 'invoice', 30, 'USD'],
      ['2026-09-01', 'service', 200, 'USD'],
    ]);
  });

  it('never counts a payment twice: one that came from an invoice is the invoice’s', () => {
    expect(all().filter((r) => r.date === '2026-11-05')).toHaveLength(1);
  });

  it('says what each amount was for, who paid and where to open it', () => {
    const rows = all();
    expect(rows[0]).toMatchObject({ title: 'Cash sale', who: 'Walk-in customer', href: null, entryId: 'e1', method: 'Cash' });
    expect(rows[1]).toMatchObject({ title: 'Website care', who: 'Elena Rossi', href: '/crm/contacts/lead-1' });
    expect(rows[2]).toMatchObject({ title: 'Invoice INV-0003', who: 'Northwind Studio', href: '/crm/invoices/c', reference: 'INV-0003-R01' });
    // A service that was removed since: the money still came in.
    expect(rows[3]).toMatchObject({ title: 'A service that was removed', who: '', href: null });
    // A service in its own currency.
    expect(rows[5]).toMatchObject({ title: 'Paid ads', currency: 'USD', who: 'Tom Okafor' });
  });
});

describe('what is still to come', () => {
  it('lists every issued invoice that is not paid in full, with what is left, soonest first', () => {
    const rows = upcomingRows(INVOICES, TODAY, nameOf);
    expect(rows.map((r) => [r.number, r.amount, r.currency, r.dueDate, r.overdue])).toEqual([
      ['INV-0002', 18, 'GBP', '2026-11-10', true],
      ['INV-0003', 150, 'GBP', '2026-12-10', false],
    ]);
    expect(rows[0].href).toBe('/crm/invoices/b');
  });

  it('leaves out drafts, paid and voided invoices', () => {
    expect(upcomingRows(INVOICES, TODAY, nameOf).map((r) => r.number)).not.toEqual(expect.arrayContaining(['INV-0001', 'INV-0004', 'INV-0005']));
  });
});

describe('the totals', () => {
  it('adds up this month, this year, what is to come and what is late, each currency apart', () => {
    const totals = incomeTotals(all(), upcomingRows(INVOICES, TODAY, nameOf), TODAY, 'GBP');
    expect(totals.thisMonth).toBe('£265');
    expect(totals.thisYear).toBe('£265 + $230');
    expect(totals.upcoming).toBe('£168');
    expect(totals.overdue).toBe('£18');
    expect(totals.upcomingCount).toBe(2);
    expect(totals.overdueCount).toBe(1);
  });

  it('is zero in the company’s currency when there is nothing', () => {
    expect(incomeTotals([], [], TODAY, 'EUR')).toMatchObject({ thisMonth: '€0', thisYear: '€0', upcoming: '€0', overdue: '€0' });
  });
});

describe('the year, month by month', () => {
  it('gives twelve months with what came in, each currency apart', () => {
    const series = monthSeries(all(), 2026, 'GBP');
    expect(series).toHaveLength(12);
    expect(series[10]).toEqual({ month: '2026-11', label: 'Nov', text: '£265', amounts: { GBP: 265 } });
    expect(series[9]).toMatchObject({ month: '2026-10', text: '$30', amounts: { USD: 30 } });
    expect(series[0]).toMatchObject({ month: '2026-01', text: '£0', amounts: {} });
  });
});
