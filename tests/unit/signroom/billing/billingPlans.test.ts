// Pure billing-plan and accounts-overview helpers: the sums, the filters and the export rows.
import { describe, expect, it } from 'vitest';
import {
  MONTH_NAMES, filterOverview, filterPlans, groupOverviewByMonth, monthBody, monthKey, monthLabel, monthResetBody,
  monthStatus, monthTotals, overviewCsvRows, overviewTotals, planBody, planForm, planHasPayment, planTotals,
  planTypeLabel, plansCsvRows, sumLines,
} from '@/lib/signroom/billingPlans';
import { issued, monthEntry, overviewRow, payment, planYear } from './fixtures';

const NOW = '2026-11';

/** £500.00 a month from September. September was paid by hand; October was not. */
const retainer = () => planYear({ monthlyEntries: { '2026-09': monthEntry(50000, 50000) } });
/** A one-off $1,200.00 build, started in March, with $300.00 paid in March. */
const build = () => planYear({
  id: 'pl2', name: 'Shop build', billingType: 'One-off', currency: 'USD', monthlyFeeMinor: 0, contractValueMinor: 120000,
  startMonth: '2026-03', monthlyEntries: { '2026-03': monthEntry(30000, 120000) },
});

describe('months and names', () => {
  it('writes a month key and its name', () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(monthKey(2026, 0)).toBe('2026-01');
    expect(monthKey(2026, 10)).toBe('2026-11');
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(monthLabel('2027-01-15')).toBe('January 2027');
  });

  it('calls a monthly plan a retainer and a custom plan by its own words', () => {
    expect(planTypeLabel({ billingType: 'Monthly', billingLabel: '' })).toBe('Monthly retainer');
    expect(planTypeLabel({ billingType: 'One-off', billingLabel: '' })).toBe('One-off');
    expect(planTypeLabel({ billingType: 'Custom', billingLabel: 'Per milestone' })).toBe('Per milestone');
    expect(planTypeLabel({ billingType: 'Custom', billingLabel: '' })).toBe('Custom');
  });
});

describe('a plan year', () => {
  it('knows each month as paid, still to come, overdue or empty', () => {
    const p = retainer();
    expect(monthStatus(p, 7, 2026, NOW)).toBe('neutral');
    expect(monthStatus(p, 8, 2026, NOW)).toBe('paid');
    expect(monthStatus(p, 9, 2026, NOW)).toBe('overdue');
    expect(monthStatus(p, 10, 2026, NOW)).toBe('upcoming');
    expect(monthStatus(p, 11, 2026, NOW)).toBe('upcoming');
  });

  it('adds up the year: target, paid, still to come, overdue and what is left', () => {
    const totals = planTotals([retainer()], 2026, NOW);
    expect(totals.target).toEqual({ GBP: 200000 });
    expect(totals.paid).toEqual({ GBP: 50000 });
    expect(totals.overdue).toEqual({ GBP: 50000 });
    expect(totals.stillToCome).toEqual({ GBP: 100000 });
    expect(totals.leftOfTarget).toEqual({ GBP: 150000 });
    expect(totals.unpaidInvoices).toEqual({ GBP: 0 });
  });

  it('counts receipts on linked invoices as paid, and their balance as unpaid invoices', () => {
    const linked = issued({
      projectId: 'pl1', status: 'Part paid', totalMinor: 50000, subtotalMinor: 50000, taxMinor: 0,
      payments: [payment({ amountMinor: 20000, paidOn: '2026-10-05' })],
    });
    const p = planYear({}, [linked]);
    expect(p.months[9]).toBe(20000);
    const totals = planTotals([p], 2026, NOW);
    expect(totals.paid).toEqual({ GBP: 20000 });
    expect(totals.overdue).toEqual({ GBP: 80000 });
    expect(totals.unpaidInvoices).toEqual({ GBP: 30000 });
  });

  it('never adds two currencies together', () => {
    const totals = planTotals([retainer(), build()], 2026, NOW);
    expect(totals.target).toEqual({ GBP: 200000, USD: 120000 });
    expect(totals.paid).toEqual({ GBP: 50000, USD: 30000 });
    expect(totals.overdue).toEqual({ GBP: 50000, USD: 90000 });
    expect(totals.stillToCome).toEqual({ GBP: 100000, USD: 0 });
  });

  it('adds up each month per currency for the foot of the grid', () => {
    const second = planYear({ id: 'pl3', name: 'Hosting', monthlyFeeMinor: 2000, startMonth: '2026-11' });
    const [gbp, usd] = monthTotals([retainer(), second, build()]);
    expect(gbp!.currency).toBe('GBP');
    expect(gbp!.expected[10]).toBe(52000);
    expect(gbp!.paid[8]).toBe(50000);
    expect(gbp!.paid[10]).toBe(0);
    expect(usd!.currency).toBe('USD');
    expect(usd!.expected[2]).toBe(120000);
    expect(usd!.paid[2]).toBe(30000);
  });

  it('treats every unpaid month of a past year as overdue and of a later year as still to come', () => {
    const last = planYear({ startMonth: '2025-11' }, [], 2025);
    expect(planTotals([last], 2025, NOW).overdue).toEqual({ GBP: 100000 });
    const next = planYear({}, [], 2027);
    expect(planTotals([next], 2027, NOW).stillToCome).toEqual({ GBP: 600000 });
    expect(planTotals([next], 2027, NOW).overdue).toEqual({ GBP: 0 });
  });
});

describe('finding plans', () => {
  const archived = planYear({ id: 'pl9', name: 'Old site care', archived: true, notes: 'Ended in spring' });

  it('shows active or archived plans, and searches the name, notes and billing words', () => {
    const all = [retainer(), build(), archived];
    expect(filterPlans(all, { archived: false, query: '' }).map((p) => p.id)).toEqual(['pl1', 'pl2']);
    expect(filterPlans(all, { archived: true, query: '' }).map((p) => p.id)).toEqual(['pl9']);
    expect(filterPlans(all, { archived: false, query: ' SHOP ' }).map((p) => p.id)).toEqual(['pl2']);
    expect(filterPlans(all, { archived: true, query: 'spring' }).map((p) => p.id)).toEqual(['pl9']);
  });

  it('matches a plan when any month has the chosen payment status', () => {
    expect(planHasPayment(retainer(), 'all', 2026, NOW)).toBe(true);
    expect(planHasPayment(retainer(), 'overdue', 2026, NOW)).toBe(true);
    expect(planHasPayment(retainer(), 'paid', 2026, NOW)).toBe(true);
    expect(planHasPayment(build(), 'upcoming', 2026, NOW)).toBe(false);
    expect(planHasPayment(build(), 'paid', 2026, NOW)).toBe(false);
  });
});

describe('what is sent to the server', () => {
  it('starts a new plan as a monthly retainer in the account currency, from this month', () => {
    expect(planForm(null, { currency: 'EUR', startMonth: '2026-11' })).toEqual({
      name: '', billingType: 'Monthly', billingLabel: '', currency: 'EUR', monthlyFee: '0.00', contractValue: '0.00',
      annualTarget: '0.00', startMonth: '2026-11', endMonth: '', status: 'Active', notes: '',
    });
  });

  it('writes money as decimal text and keeps the custom words only for a custom plan', () => {
    const form = planForm(
      planYear({ billingType: 'Custom', billingLabel: 'Per milestone', contractValueMinor: 123456, endMonth: '2027-02', notes: 'Phase one' }),
      { currency: 'USD', startMonth: '2026-11' },
    );
    expect(planBody(form)).toEqual({
      name: 'Website retainer', billingType: 'Custom', billingLabel: 'Per milestone', currency: 'GBP', monthlyFee: '500.00',
      contractValue: '1234.56', annualTarget: '0.00', startMonth: '2026-09', endMonth: '2027-02', status: 'Active', notes: 'Phase one',
    });
    expect(planBody({ ...form, billingType: 'Monthly', name: '  Care plan ', monthlyFee: '', annualTarget: ' ' })).toMatchObject({
      name: 'Care plan', billingType: 'Monthly', billingLabel: '', monthlyFee: '0', annualTarget: '0',
    });
  });

  it('writes a month change, and a reset, as the server reads them', () => {
    expect(monthBody('2026-10', { paid: '200', expected: '500.00', notes: 'Cash' }, 4)).toEqual({
      action: 'month', month: '2026-10', paid: '200', expected: '500.00', notes: 'Cash', revision: 4,
    });
    expect(monthResetBody('2026-10', 4)).toEqual({ action: 'month', month: '2026-10', reset: true, revision: 4 });
  });
});

describe('plan export', () => {
  it('writes one row per plan with every month as plain decimals', () => {
    const [head, row] = plansCsvRows([retainer()], 'Northwind Studio', 2026);
    expect(head!.slice(0, 9)).toEqual([
      'Plan', 'Company', 'Type', 'Currency', 'Monthly fee', 'Contract value', 'Target 2026', 'Start month', 'End month',
    ]);
    expect(head!.slice(9, 11)).toEqual(['Jan paid', 'Jan still to pay']);
    expect(head!.slice(-5)).toEqual(['Paid 2026', 'Left of target', 'Unpaid invoices', 'Status', 'Notes']);
    expect(head).toHaveLength(38);
    expect(row!.slice(0, 9)).toEqual([
      'Website retainer', 'Northwind Studio', 'Monthly retainer', 'GBP', '500.00', '0.00', '2000.00', '2026-09', '',
    ]);
    // September paid, October unpaid.
    expect(row!.slice(25, 29)).toEqual(['500.00', '0.00', '0.00', '500.00']);
    expect(row!.slice(-5)).toEqual(['500.00', '1500.00', '0.00', 'Active', '']);
  });

  it('marks an archived plan in its status', () => {
    const [, row] = plansCsvRows([planYear({ archived: true, status: 'Completed' })], 'Northwind Studio', 2026);
    expect(row!.at(-2)).toBe('Completed (archived)');
  });
});

describe('accounts overview', () => {
  const rows = [
    overviewRow({ id: 'a', period: '2026-10', status: 'overdue', remainingMinor: 50000 }),
    overviewRow({ id: 'b', period: '2026-11', status: 'upcoming', remainingMinor: 30000, paidMinor: 20000 }),
    overviewRow({ id: 'c', period: '2026-09', status: 'paid', remainingMinor: 0, paidMinor: 50000 }),
    overviewRow({
      id: 'd', clientId: 'c2', clientName: 'Harbour Dental', reference: 'Shop build', currency: 'USD', period: '2026-03',
      status: 'overdue', paidMinor: 30000, remainingMinor: 90000,
    }),
    overviewRow({ id: 'e', clientId: 'c3', clientName: 'Old Mill', reference: 'Care plan', archived: true, period: '2026-11' }),
    overviewRow({ id: 'i1', source: 'Invoice', reference: 'INV-0002', period: '2026-11-10', status: 'overdue', remainingMinor: 1800 }),
    overviewRow({
      id: 'i2', source: 'Invoice', clientId: 'c2', clientName: 'Harbour Dental', reference: 'INV-0004', currency: 'USD',
      period: '2026-10-20', status: 'paid', paidMinor: 3000, remainingMinor: 0,
    }),
  ];
  const plans = { source: 'Project plan' as const, status: 'all' as const, query: '', archived: false };

  it('shows plans or invoices, never both, and leaves archived rows out until asked', () => {
    expect(filterOverview(rows, plans).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterOverview(rows, { ...plans, archived: true }).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(filterOverview(rows, { ...plans, source: 'Invoice' }).map((r) => r.id)).toEqual(['i1', 'i2']);
  });

  it('filters by status and by the company or reference typed', () => {
    expect(filterOverview(rows, { ...plans, status: 'overdue' }).map((r) => r.id)).toEqual(['a', 'd']);
    expect(filterOverview(rows, { ...plans, query: ' harbour ' }).map((r) => r.id)).toEqual(['d']);
    expect(filterOverview(rows, { ...plans, source: 'Invoice', query: 'inv-0002' }).map((r) => r.id)).toEqual(['i1']);
  });

  it('adds up paid, still to come and overdue per currency, never together', () => {
    const totals = overviewTotals(filterOverview(rows, plans));
    expect(totals.paid).toEqual({ GBP: 70000, USD: 30000 });
    expect(totals.stillToCome).toEqual({ GBP: 30000, USD: 0 });
    expect(totals.overdue).toEqual({ GBP: 50000, USD: 90000 });
    expect(overviewTotals([])).toEqual({ paid: {}, stillToCome: {}, overdue: {} });
  });

  it('groups by month, earliest or latest first, with each month added up per currency', () => {
    const months = groupOverviewByMonth(filterOverview(rows, plans), 'earliest');
    expect(months.map((m) => m.month)).toEqual(['2026-03', '2026-09', '2026-10', '2026-11']);
    expect(months[0]!.rows.map((r) => r.id)).toEqual(['d']);
    expect(months[0]!.paid).toEqual({ USD: 30000 });
    expect(months[0]!.remaining).toEqual({ USD: 90000 });
    expect(groupOverviewByMonth(filterOverview(rows, plans), 'latest').map((m) => m.month))
      .toEqual(['2026-11', '2026-10', '2026-09', '2026-03']);

    const invoices = groupOverviewByMonth(filterOverview(rows, { ...plans, source: 'Invoice' }), 'earliest');
    expect(invoices.map((m) => m.month)).toEqual(['2026-10', '2026-11']);
  });

  it('sorts the rows inside a month by date, then company, then reference', () => {
    const month = groupOverviewByMonth([
      overviewRow({ id: 'z', clientName: 'Zebra', reference: 'B' }),
      overviewRow({ id: 'y', clientName: 'apple', reference: 'B' }),
      overviewRow({ id: 'x', clientName: 'Apple', reference: 'A' }),
    ], 'earliest')[0]!;
    expect(month.rows.map((r) => r.id)).toEqual(['x', 'y', 'z']);
  });

  it('exports what is shown with amounts as plain decimals', () => {
    const out = overviewCsvRows(filterOverview(rows, { ...plans, query: 'harbour' }));
    expect(out).toEqual([
      ['Company', 'Type', 'Plan or invoice', 'Month or due date', 'Currency', 'Paid', 'Still to pay', 'Status', 'Archived'],
      ['Harbour Dental', 'Billing plan', 'Shop build', '2026-03', 'USD', '300.00', '900.00', 'Overdue', ''],
    ]);
    expect(overviewCsvRows([rows[4]!, rows[5]!]).slice(1)).toEqual([
      ['Old Mill', 'Billing plan', 'Care plan', '2026-11', 'GBP', '0.00', '500.00', 'To come', 'Archived'],
      ['Northwind Studio', 'Invoice', 'INV-0002', '2026-11-10', 'GBP', '0.00', '18.00', 'Overdue', ''],
    ]);
  });
});

describe('amounts in more than one currency', () => {
  it('gives one line per currency, leaving out a zero while another has an amount', () => {
    expect(sumLines({ USD: 3000, GBP: 25000 })).toEqual(['£250.00', '$30.00']);
    expect(sumLines({ USD: 0, GBP: 25000 })).toEqual(['£250.00']);
    expect(sumLines({ USD: 0, GBP: 0 })).toEqual(['£0.00', '$0.00']);
    expect(sumLines({})).toEqual([]);
  });
});
