import { describe, it, expect } from 'vitest';
import { billTotals, isBillOverdue, type Bill } from '@/services/supabase/bills';

const bill = (over: Partial<Bill>): Bill => ({
  billId: 'b', organizationId: 'o', workspaceId: null, vendorName: 'V', vendorEmail: null,
  billNumber: 'BILL-1', reference: null, status: 'draft', currency: 'USD',
  subtotal: 0, taxRate: 0, taxAmount: 0, discount: 0, total: 0, amountPaid: 0,
  lineItems: [], notes: null, issuedAt: new Date('2026-01-01'), dueAt: null,
  paidAt: null, voidedAt: null, createdBy: null, createdByName: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...over,
});
const TODAY = new Date('2026-06-05T00:00:00Z');

describe('isBillOverdue', () => {
  it('true for an open bill past due, false when paid/void/no-date/future', () => {
    expect(isBillOverdue(bill({ status: 'open', dueAt: new Date('2026-06-01') }), TODAY)).toBe(true);
    expect(isBillOverdue(bill({ status: 'paid', dueAt: new Date('2026-06-01') }), TODAY)).toBe(false);
    expect(isBillOverdue(bill({ status: 'void', dueAt: new Date('2026-06-01') }), TODAY)).toBe(false);
    expect(isBillOverdue(bill({ status: 'open', dueAt: null }), TODAY)).toBe(false);
    expect(isBillOverdue(bill({ status: 'open', dueAt: new Date('2026-07-01') }), TODAY)).toBe(false);
  });
});

describe('billTotals', () => {
  it('sums payable, overdue, paid-30d and counts, excluding void + draft from payable', () => {
    const list = [
      bill({ status: 'open', total: 100, amountPaid: 0,  dueAt: new Date('2026-06-01') }), // payable + overdue
      bill({ status: 'open', total: 200, amountPaid: 50, dueAt: new Date('2026-07-01') }), // payable 150
      bill({ status: 'paid', total: 300, amountPaid: 300, paidAt: new Date('2026-05-20') }), // paid 30d
      bill({ status: 'void', total: 999, amountPaid: 0 }),
      bill({ status: 'draft', total: 80, amountPaid: 0 }),
    ];
    const t = billTotals(list, TODAY);
    expect(t.payable).toBe(250);
    expect(t.overdue).toBe(100);
    expect(t.paidLast30).toBe(300);
    expect(t.counts.open).toBe(2);
    expect(t.counts.void).toBe(1);
  });
});
