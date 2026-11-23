import { describe, expect, it } from 'vitest';
import { activeMonthsInYear, daysInMonth, paymentInPeriod, periodLabel, summarizeAccountPeriod, summarizeClientAccount } from '@/lib/crmAccounts';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

const account = (overrides: Partial<CrmClientAccount> = {}): CrmClientAccount => ({
  id: 'a', organizationId: 'o', workspaceId: 'w', contactId: 'c', projectId: null,
  serviceName: 'Service', billingType: 'monthly', agreedAmount: 100, openingPaid: 50,
  serviceStart: '2026-03-01', serviceEnd: null, notes: null,
  createdAt: new Date(), updatedAt: new Date(), ...overrides,
});
const payment = (paidOn: string, amount: number): CrmAccountPayment => ({
  id: paidOn, accountId: 'a', organizationId: 'o', workspaceId: 'w', paidOn, amount,
  notes: null, createdAt: new Date(),
});

describe('CRM account balances', () => {
  it('charges monthly services only for active months', () => {
    expect(activeMonthsInYear(2026, '2026-03-01', '2026-05-31')).toBe(3);
    const result = summarizeClientAccount(account({ serviceEnd: '2026-05-31' }), [payment('2026-03-10', 100)], 2026);
    expect(result).toMatchObject({ due: 300, paid: 150, outstanding: 150 });
  });
  it('charges a one-time agreement once and never returns a negative balance', () => {
    const result = summarizeClientAccount(account({ billingType: 'one_time', agreedAmount: 200, openingPaid: 100 }), [payment('2026-04-01', 150)], 2026);
    expect(result).toMatchObject({ due: 200, paid: 250, outstanding: 0 });
  });
  it('carries a one-time outstanding balance across year views', () => {
    const result = summarizeClientAccount(account({ billingType: 'one_time', agreedAmount: 300, openingPaid: 0, serviceStart: '2025-03-01' }), [payment('2025-04-01', 100)], 2026);
    expect(result).toMatchObject({ due: 300, paid: 100, outstanding: 200 });
  });
  it('separates payment history by selected year', () => {
    const result = summarizeClientAccount(account(), [payment('2025-03-10', 100), payment('2026-04-10', 80)], 2026);
    expect(result.monthlyPaid[2]).toBe(0);
    expect(result.monthlyPaid[3]).toBe(80);
  });
});

describe('a year, a month or one day', () => {
  const year = { year: 2026, month: null, day: null };
  const march = { year: 2026, month: 2, day: null };
  const tenth = { year: 2026, month: 2, day: 10 };

  it('knows which payments fall in the time chosen', () => {
    expect(paymentInPeriod('2026-03-10', year)).toBe(true);
    expect(paymentInPeriod('2025-03-10', year)).toBe(false);
    expect(paymentInPeriod('2026-03-10', march)).toBe(true);
    expect(paymentInPeriod('2026-04-10', march)).toBe(false);
    expect(paymentInPeriod('2026-03-10', tenth)).toBe(true);
    expect(paymentInPeriod('2026-03-11', tenth)).toBe(false);
  });

  it('names the time chosen in words', () => {
    expect(periodLabel(year)).toBe('2026');
    expect(periodLabel(march)).toBe('March 2026');
    expect(periodLabel(tenth)).toBe('10 March 2026');
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
  });

  it('gives the same answer for a year as the year summary', () => {
    const acc = account({ serviceEnd: '2026-05-31' });
    const pays = [payment('2026-03-10', 100)];
    expect(summarizeAccountPeriod(acc, pays, year)).toEqual({ due: 300, paid: 150, outstanding: 150 });
  });

  it('charges a monthly service one month at a time, counting the opening payment in its first month', () => {
    const acc = account({ serviceEnd: '2026-05-31' });
    const pays = [payment('2026-03-10', 20), payment('2026-04-02', 100)];
    expect(summarizeAccountPeriod(acc, pays, march)).toEqual({ due: 100, paid: 70, outstanding: 30 });
    expect(summarizeAccountPeriod(acc, pays, { year: 2026, month: 3, day: null })).toEqual({ due: 100, paid: 100, outstanding: 0 });
    // Before it starts and after it ends, nothing is due.
    expect(summarizeAccountPeriod(acc, pays, { year: 2026, month: 1, day: null }).due).toBe(0);
    expect(summarizeAccountPeriod(acc, pays, { year: 2026, month: 5, day: null }).due).toBe(0);
  });

  it('carries what is still owed on a one-time agreement into each month', () => {
    const acc = account({ billingType: 'one_time', agreedAmount: 300, openingPaid: 50, serviceStart: '2026-01-15' });
    const pays = [payment('2026-02-01', 100), payment('2026-03-10', 60)];
    // 300 agreed, 50 at the start and 100 in February: 150 was still owed when March began.
    expect(summarizeAccountPeriod(acc, pays, march)).toEqual({ due: 150, paid: 60, outstanding: 90 });
    expect(summarizeAccountPeriod(acc, pays, { year: 2025, month: 11, day: null }).due).toBe(0);
  });

  it('gives only what was paid for one day: nothing is "due" on a day', () => {
    const acc = account();
    expect(summarizeAccountPeriod(acc, [payment('2026-03-10', 20), payment('2026-03-11', 5)], tenth)).toEqual({ due: null, paid: 20, outstanding: null });
  });
});
