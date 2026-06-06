import { describe, it, expect } from 'vitest';
import { invoiceTotals, isOverdue, type Invoice } from '@/services/supabase/invoices';

// Minimal Invoice factory — only the fields the helpers read.
const inv = (over: Partial<Invoice>): Invoice => ({
  invoiceId: 'i', organizationId: 'o', clientId: 'c', dealId: null, quoteId: null,
  workspaceId: null, invoiceNumber: 'INV-1', title: null, status: 'draft',
  currency: 'USD', subtotal: 0, taxRate: 0, taxAmount: 0, discount: 0, total: 0,
  amountPaid: 0, lineItems: [], notes: null, terms: null,
  issuedAt: new Date('2026-01-01'), dueAt: null, sentAt: null, paidAt: null,
  voidedAt: null, publicToken: null, createdBy: null, createdByName: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  ...over,
});

const TODAY = new Date('2026-06-05T00:00:00Z');

describe('isOverdue', () => {
  it('is true for an unpaid sent invoice past its due date', () => {
    expect(isOverdue(inv({ status: 'sent', dueAt: new Date('2026-06-01'), total: 100 }), TODAY)).toBe(true);
  });
  it('is false when paid, void, no due date, or due in the future', () => {
    expect(isOverdue(inv({ status: 'paid', dueAt: new Date('2026-06-01') }), TODAY)).toBe(false);
    expect(isOverdue(inv({ status: 'void', dueAt: new Date('2026-06-01') }), TODAY)).toBe(false);
    expect(isOverdue(inv({ status: 'sent', dueAt: null }), TODAY)).toBe(false);
    expect(isOverdue(inv({ status: 'sent', dueAt: new Date('2026-07-01') }), TODAY)).toBe(false);
  });
});

describe('invoiceTotals', () => {
  it('sums outstanding, overdue, paid-30d and status counts, ignoring void', () => {
    const list = [
      inv({ status: 'sent',  total: 100, amountPaid: 0,  dueAt: new Date('2026-06-01') }), // overdue + outstanding
      inv({ status: 'sent',  total: 200, amountPaid: 50, dueAt: new Date('2026-07-01') }), // outstanding 150, not overdue
      inv({ status: 'paid',  total: 300, amountPaid: 300, paidAt: new Date('2026-05-20') }), // paid in last 30d
      inv({ status: 'paid',  total: 300, amountPaid: 300, paidAt: new Date('2026-01-01') }), // paid long ago
      inv({ status: 'void',  total: 999, amountPaid: 0 }), // ignored
      inv({ status: 'draft', total: 80,  amountPaid: 0 }), // draft count, not outstanding
    ];
    const t = invoiceTotals(list, TODAY);
    expect(t.outstanding).toBe(250);          // 100 + 150
    expect(t.overdue).toBe(100);              // only the first
    expect(t.paidLast30).toBe(300);           // only the 2026-05-20 one
    expect(t.counts.draft).toBe(1);
    expect(t.counts.sent).toBe(2);
    expect(t.counts.paid).toBe(2);
    expect(t.counts.void).toBe(1);
  });

  it('caps paidLast30 at the invoice total when amountPaid is stale/over total', () => {
    const list = [
      // Marked paid at 240k, later edited down to ~178.7k — amountPaid is stale.
      inv({ status: 'paid', total: 178673.76, amountPaid: 240000, paidAt: new Date('2026-05-20') }),
    ];
    const t = invoiceTotals(list, TODAY);
    expect(t.paidLast30).toBe(178673.76); // capped at total, not the stale 240000
  });
});
