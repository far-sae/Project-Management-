// @vitest-environment node
// Collections: what each client service is charged in a month, what was paid
// for that month, what is still owed from before, and what to collect.
import { describe, expect, it } from 'vitest';
import {
  collectionRow, collectionsTotals, monthKey, monthLabel, monthsBetween, nextMonth, paysFor, previousMonth, sheetCsv, totalCost, yearRow,
} from '@/lib/crmCollections';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

const account = (over: Partial<CrmClientAccount> = {}): CrmClientAccount => ({
  id: 'acc-1', organizationId: 'org', workspaceId: 'ws', contactId: 'lead-1', projectId: null, serviceName: 'Digital marketing',
  billingType: 'monthly', agreedAmount: 500, openingPaid: 0, serviceStart: '2026-07-01', serviceEnd: null, notes: null,
  dueDay: null, dueDate: null, createdAt: new Date('2026-07-01'), updatedAt: new Date('2026-07-01'), ...over,
});
let n = 0;
const paid = (paidOn: string, amount: number, over: Partial<CrmAccountPayment> = {}): CrmAccountPayment => ({
  id: `p${++n}`, accountId: 'acc-1', organizationId: 'org', workspaceId: 'ws', paidOn, amount, notes: null, billingMonth: null, method: null, reference: null, createdAt: new Date(paidOn), ...over,
});
const figures = (row: ReturnType<typeof collectionRow>) => ({ charges: row.charges, paid: row.paid, monthUnpaid: row.monthUnpaid, earlierUnpaid: row.earlierUnpaid, collect: row.collect, credit: row.credit, status: row.status });

describe('months', () => {
  it('names and counts them', () => {
    expect(monthKey(new Date(2026, 10, 24))).toBe('2026-11');
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthLabel('2026-09', true)).toBe('Sep 2026');
    expect(monthLabel('soon')).toBe('soon');
    expect(monthsBetween('2026-07', '2026-10')).toBe(4);
    expect(monthsBetween('2025-11', '2026-02')).toBe(4);
    expect(monthsBetween('2026-10', '2026-07')).toBe(0);
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });

  it('counts a payment for the month it names, else for the month it arrived in', () => {
    expect(paysFor(paid('2026-10-03', 500))).toBe('2026-10');
    expect(paysFor(paid('2026-10-03', 500, { billingMonth: '2026-09' }))).toBe('2026-09');
    expect(paysFor(paid('2026-10-03', 500, { billingMonth: 'September' }))).toBe('2026-10');
  });
});

describe('a monthly fee', () => {
  const upToOctober = [paid('2026-07-05', 500), paid('2026-08-05', 500), paid('2026-09-05', 500), paid('2026-10-05', 500)];

  it('is due in a month that is not paid yet, and paid in one that is', () => {
    expect(figures(collectionRow(account(), upToOctober, '2026-11'))).toEqual({ charges: 500, paid: 0, monthUnpaid: 500, earlierUnpaid: 0, collect: 500, credit: 0, status: 'due' });
    expect(figures(collectionRow(account(), upToOctober, '2026-10'))).toEqual({ charges: 500, paid: 500, monthUnpaid: 0, earlierUnpaid: 0, collect: 0, credit: 0, status: 'paid' });
  });

  it('carries a missed month forward as earlier unpaid', () => {
    const row = collectionRow(account(), [paid('2026-07-05', 500), paid('2026-08-05', 500)], '2026-10');
    // September was never paid, October is not paid yet.
    expect(figures(row)).toEqual({ charges: 500, paid: 0, monthUnpaid: 500, earlierUnpaid: 500, collect: 1000, credit: 0, status: 'overdue' });
  });

  it('counts a payment for the month it pays for, not the month it arrived in', () => {
    const late = [paid('2026-07-05', 500), paid('2026-08-05', 500), paid('2026-10-02', 500, { billingMonth: '2026-09' })];
    expect(figures(collectionRow(account(), late, '2026-09'))).toMatchObject({ paid: 500, collect: 0, status: 'paid' });
    expect(figures(collectionRow(account(), late, '2026-10'))).toMatchObject({ paid: 0, earlierUnpaid: 0, collect: 500, status: 'due' });
  });

  it('shows a part payment, and a credit when more was paid than owed', () => {
    expect(figures(collectionRow(account(), [paid('2026-07-05', 200)], '2026-07'))).toMatchObject({ paid: 200, monthUnpaid: 300, collect: 300, status: 'part' });
    const ahead = collectionRow(account(), [paid('2026-07-05', 1200)], '2026-07');
    expect(figures(ahead)).toMatchObject({ collect: 0, credit: 700, status: 'paid' });
    // The credit of July pays for August.
    expect(figures(collectionRow(account(), [paid('2026-07-05', 1200)], '2026-08'))).toMatchObject({ charges: 500, collect: 0, credit: 200 });
  });

  it('charges nothing before it starts or after it ends, and still shows what was left unpaid', () => {
    expect(figures(collectionRow(account(), [], '2026-06'))).toMatchObject({ charges: 0, collect: 0, status: 'none' });
    const ended = collectionRow(account({ serviceEnd: '2026-08-31' }), [paid('2026-07-05', 500)], '2026-10');
    // It ran July and August; only July was paid.
    expect(figures(ended)).toEqual({ charges: 0, paid: 0, monthUnpaid: 0, earlierUnpaid: 500, collect: 500, credit: 0, status: 'overdue' });
  });

  it('counts what was paid before the records began for its first month', () => {
    expect(figures(collectionRow(account({ openingPaid: 500 }), [], '2026-07'))).toMatchObject({ paid: 500, collect: 0, status: 'paid' });
    expect(figures(collectionRow(account({ openingPaid: 500 }), [], '2026-08'))).toMatchObject({ charges: 500, earlierUnpaid: 0, collect: 500 });
  });

  it('says when it is due in the month, on a day that exists', () => {
    expect(collectionRow(account({ dueDay: 5 }), [], '2026-11').dueOn).toBe('2026-11-05');
    expect(collectionRow(account({ dueDay: 31 }), [], '2027-02').dueOn).toBe('2027-02-28');
    expect(collectionRow(account(), [], '2026-11').dueOn).toBeNull();
  });

  it('bills the month but cannot count earlier months without a start month, and says so', () => {
    const row = collectionRow(account({ serviceStart: null }), [paid('2026-01-05', 500)], '2026-11');
    expect(figures(row)).toMatchObject({ charges: 500, earlierUnpaid: 0, collect: 500, status: 'due' });
    expect(row.setup).toBe('Set a start month to count the months before');
  });

  it('only counts the payments of its own service', () => {
    const other = paid('2026-11-01', 500, { accountId: 'acc-2' });
    expect(collectionRow(account(), [other], '2026-11').paid).toBe(0);
  });
});

describe('a one-time fee', () => {
  const website = (over: Partial<CrmClientAccount> = {}) => account({ billingType: 'one_time', agreedAmount: 8000, openingPaid: 4000, serviceStart: null, dueDate: '2026-09-15', serviceName: 'Website', ...over });

  it('is owed in the month it is due, less what was paid already', () => {
    const row = collectionRow(website(), [], '2026-09');
    expect(figures(row)).toEqual({ charges: 8000, paid: 4000, monthUnpaid: 4000, earlierUnpaid: 0, collect: 4000, credit: 0, status: 'part' });
    expect(row.dueOn).toBe('2026-09-15');
  });

  it('is nothing yet before that month, and overdue after it', () => {
    expect(figures(collectionRow(website(), [], '2026-08'))).toMatchObject({ charges: 0, collect: 0, status: 'none' });
    expect(figures(collectionRow(website(), [], '2026-11'))).toEqual({ charges: 0, paid: 0, monthUnpaid: 0, earlierUnpaid: 4000, collect: 4000, credit: 0, status: 'overdue' });
  });

  it('is paid once the payments reach the fee, whenever they came', () => {
    const payments = [paid('2026-09-20', 2000), paid('2026-10-20', 2000)];
    expect(figures(collectionRow(website(), payments, '2026-11'))).toMatchObject({ collect: 0, credit: 0, status: 'paid' });
    expect(figures(collectionRow(website(), [...payments, paid('2026-11-01', 100)], '2026-11'))).toMatchObject({ collect: 0, credit: 100 });
  });

  it('is due on its start month when no due date was set, and asks for a date when it has neither', () => {
    expect(figures(collectionRow(website({ dueDate: null, serviceStart: '2026-09-01' }), [], '2026-09'))).toMatchObject({ monthUnpaid: 4000, status: 'part' });
    const undated = collectionRow(website({ dueDate: null }), [], '2026-11');
    expect(figures(undated)).toMatchObject({ collect: 0, status: 'setup' });
    expect(undated.setup).toBe('Set a due date');
    // Fully paid needs no date.
    expect(collectionRow(website({ dueDate: null, openingPaid: 8000 }), [], '2026-11')).toMatchObject({ status: 'paid', setup: null });
  });

  it('with nothing paid at all is simply due', () => {
    expect(collectionRow(website({ openingPaid: 0 }), [], '2026-09').status).toBe('due');
  });
});

describe('all services of a month together', () => {
  it('adds them up', () => {
    const marketing = account();
    const website = account({ id: 'acc-2', billingType: 'one_time', agreedAmount: 8000, openingPaid: 4000, serviceStart: null, dueDate: '2026-11-15' });
    const payments = [paid('2026-07-05', 500), paid('2026-08-05', 500), paid('2026-09-05', 500), paid('2026-10-05', 500), paid('2026-11-05', 200)];
    const rows = [collectionRow(marketing, payments, '2026-11'), collectionRow(website, payments, '2026-11')];
    expect(collectionsTotals(rows)).toEqual({ monthlyFees: 500, charges: 8500, paid: 4200, monthUnpaid: 4300, earlierUnpaid: 0, collect: 4300 });
  });
});

describe('a service across a year', () => {
  it('puts each payment in the month it pays for, and adds them up', () => {
    const payments = [paid('2026-07-05', 500), paid('2026-08-05', 500), paid('2026-10-02', 500, { billingMonth: '2026-09' }), paid('2025-12-01', 999), paid('2026-10-09', 1, { accountId: 'acc-2' })];
    const row = yearRow(account(), payments, 2026, '2026-11');
    expect(row.months).toEqual([0, 0, 0, 0, 0, 0, 500, 500, 500, 0, 0, 0]);
    expect(row.totalPaid).toBe(1500);
    // The payment of December 2025 is not in a column of 2026, but it is not lost: it counts towards what is owed.
    // Billed July to November: 2,500. Paid: 2,499.
    expect(row.amountDue).toBe(1);
    expect(yearRow(account(), payments.filter((p) => !p.paidOn.startsWith('2025')), 2026, '2026-11').amountDue).toBe(1000);
  });

  it('adds what was paid before the records began for a one-time fee', () => {
    const website = account({ billingType: 'one_time', agreedAmount: 8000, openingPaid: 4000, serviceStart: null, dueDate: '2026-09-15' });
    const row = yearRow(website, [paid('2026-09-20', 2000)], 2026, '2026-11');
    expect(row.totalPaid).toBe(6000);
    expect(row.amountDue).toBe(2000);
  });
});

describe('what a whole service costs', () => {
  it('is the fee itself for a one-time service', () => {
    expect(totalCost(account({ billingType: 'one_time', agreedAmount: 8000, serviceStart: null }))).toBe(8000);
  });

  it('is the monthly fee for every month from the start to the end, both counted', () => {
    expect(totalCost(account({ serviceStart: '2026-07-01', serviceEnd: '2026-12-31' }))).toBe(3000);
    expect(totalCost(account({ serviceStart: '2026-11-15', serviceEnd: '2027-02-01' }))).toBe(2000);
  });

  it('is not known while a monthly service has no end, or no start', () => {
    expect(totalCost(account({ serviceEnd: null }))).toBeNull();
    expect(totalCost(account({ serviceStart: null, serviceEnd: '2026-12-31' }))).toBeNull();
  });

  it('is on the row of the year sheet', () => {
    expect(yearRow(account({ serviceEnd: '2026-12-31' }), [], 2026, '2026-11').totalCost).toBe(3000);
    expect(yearRow(account(), [], 2026, '2026-11').totalCost).toBeNull();
  });
});

describe('the year sheet as a file', () => {
  it('has the columns of a payments sheet, with plain numbers a spreadsheet can add up', () => {
    const rows = [yearRow(account({ serviceEnd: '2026-12-31', notes: 'Pays by card' }), [paid('2026-07-05', 500), paid('2026-08-05', 500)], 2026, '2026-11')];
    const csv = sheetCsv(rows, 2026, () => ({ name: 'Elena Rossi', company: 'Harbour Dental' }), () => 'USD');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"Project","Client","Company","Type","Currency","Fee","Total cost","Opening paid","Start","End","Jan 2026","Feb 2026","Mar 2026","Apr 2026","May 2026","Jun 2026","Jul 2026","Aug 2026","Sep 2026","Oct 2026","Nov 2026","Dec 2026","Total paid","Amount due","Notes"');
    expect(lines[1]).toBe('"Digital marketing","Elena Rossi","Harbour Dental","Monthly","USD","500","3000","0","2026-07","2026-12","0","0","0","0","0","0","500","500","0","0","0","0","1000","1500","Pays by card"');
  });

  it('leaves the total cost empty for a service that is still running, and cannot be made to run a formula', () => {
    const rows = [yearRow(account({ serviceName: '=SUM(A1:A9)' }), [], 2026, '2026-11')];
    const line = sheetCsv(rows, 2026, () => ({ name: 'Tom', company: '' }), () => 'GBP').split('\n')[1];
    expect(line.startsWith(`"'=SUM(A1:A9)","Tom","","Monthly","GBP","500","",`)).toBe(true);
  });
});
