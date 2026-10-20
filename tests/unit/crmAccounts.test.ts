import { describe, expect, it } from 'vitest';
import { activeMonthsInYear, summarizeClientAccount } from '@/lib/crmAccounts';
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
