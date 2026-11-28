// A new invoice made from an existing one: what is carried over, and what is not.
import { describe, expect, it, vi } from 'vitest';
import { invoiceCopy, invoiceForService, monthAfter } from '@/lib/signroom/billing';
import { copyInvoice } from '@/components/signroom/billing/copyInvoice';
import { designLine, invoice, issued } from './fixtures';

describe('the month after', () => {
  it('goes to the next month, and from December to January', () => {
    expect(monthAfter('2026-11')).toBe('2026-12');
    expect(monthAfter('2026-12')).toBe('2027-01');
    expect(monthAfter('soon')).toBeNull();
  });
});

describe('what a copy of an invoice starts from', () => {
  const source = issued({
    id: 'src', number: 'INV-0002', clientId: 'c1', dealId: 'deal-1', currency: 'USD', notes: 'Thank you.', project: 'Website', taxBps: 2000,
    lines: [{ ...designLine, description: 'Design work' }],
  });

  it('carries the customer, the deal, the lines, the currency, the tax and the notes', () => {
    const copy = invoiceCopy(source);
    expect(copy.create).toEqual({ clientId: 'c1', dealId: 'deal-1' });
    expect(copy.currency).toBe('USD');
    expect(copy.notes).toBe('Thank you.');
    expect(copy.project).toBe('Website');
    expect(copy.taxPercent).toBe('20');
    expect(copy.lines).toHaveLength(1);
    expect(copy.lines[0]).toMatchObject({ description: 'Design work', quantity: String(designLine.quantityMilli / 1000), rate: (designLine.rateMinor / 100).toFixed(2) });
  });

  it('never carries the number, the dates, the payments or a receipt', () => {
    const copy = invoiceCopy(source) as unknown as Record<string, unknown>;
    for (const key of ['number', 'issueDate', 'dueDate', 'payments', 'receiptDraft', 'status']) expect(Object.keys(copy)).not.toContain(key);
  });

  it('bills the next month when the invoice was for one month of a service', () => {
    const monthly = issued({
      clientId: 'c1', accountId: 'acc-1', billingMonth: '2026-12',
      lines: [{ ...designLine, description: 'Digital marketing, December 2026' }, { ...designLine, description: 'Extra hours' }],
    });
    const copy = invoiceCopy(monthly);
    expect(copy.create).toEqual({ clientId: 'c1', accountId: 'acc-1', billingMonth: '2027-01' });
    expect(copy.lines.map((l) => l.description)).toEqual(['Digital marketing, January 2027', 'Extra hours']);
  });

  it('keeps a one-time service, with no month', () => {
    expect(invoiceCopy(issued({ clientId: 'c1', accountId: 'acc-1', billingMonth: null })).create).toEqual({ clientId: 'c1', accountId: 'acc-1' });
  });
});

describe('making the copy', () => {
  const source = issued({ id: 'src', number: 'INV-0002', clientId: 'c1', dealId: 'deal-1', lines: [{ ...designLine, description: 'Design work' }] });
  const draft = invoice({ id: 'new1', number: 'INV-0009', revision: 1, issueDate: '2026-11-28', dueDate: '2026-12-28' });

  it('creates a draft for the same customer, then fills it in with today’s dates', async () => {
    const call = vi.fn(async (path: string, body?: Record<string, unknown>) => (path === 'billing' ? draft : { ...draft, revision: 2, currency: body?.currency }));
    const made = await copyInvoice({ call } as never, source);
    expect(call).toHaveBeenNthCalledWith(1, 'billing', { clientId: 'c1', dealId: 'deal-1' });
    const [path, body] = call.mock.calls[1] as [string, Record<string, unknown>];
    expect(path).toBe('billing/new1/save');
    expect(body).toMatchObject({ revision: 1, issueDate: '2026-11-28', dueDate: '2026-12-28', receiptDraft: null, lines: [{ description: 'Design work' }] });
    expect(made).toMatchObject({ filled: true, invoice: { id: 'new1', revision: 2 } });
  });

  it('still makes the draft when the deal or the service it was for is gone', async () => {
    const call = vi.fn(async (path: string, body?: Record<string, unknown>) => {
      if (path === 'billing' && body?.dealId) throw Object.assign(new Error('That deal was not found.'), { status: 404 });
      return path === 'billing' ? draft : { ...draft, revision: 2 };
    });
    const made = await copyInvoice({ call } as never, source);
    expect(call).toHaveBeenNthCalledWith(2, 'billing', { clientId: 'c1' });
    expect(made.invoice.id).toBe('new1');
  });

  it('hands back the empty draft, and says so, when the lines could not be added', async () => {
    const call = vi.fn(async (path: string) => {
      if (path === 'billing') return draft;
      throw new Error('Check the line items.');
    });
    const made = await copyInvoice({ call } as never, source);
    expect(made).toMatchObject({ filled: false, invoice: { id: 'new1' } });
  });
});

describe('the invoice already made for a service', () => {
  const list = [
    issued({ id: 'i1', number: 'INV-0003', accountId: 'acc-1', billingMonth: '2026-10', issueDate: '2026-10-01' }),
    issued({ id: 'i2', number: 'INV-0004', accountId: 'acc-1', billingMonth: '2026-11', issueDate: '2026-11-01', status: 'Voided' }),
    invoice({ id: 'i3', number: 'INV-0005', accountId: 'acc-1', billingMonth: '2026-11', issueDate: '2026-11-02' }),
    issued({ id: 'i4', number: 'INV-0006', accountId: 'acc-2', billingMonth: null, issueDate: '2026-06-01', status: 'Paid' }),
    issued({ id: 'i5', number: 'INV-0007', accountId: 'acc-2', billingMonth: null, issueDate: '2026-09-01' }),
    issued({ id: 'i6', number: 'INV-0008' }),
  ];

  it('is the one for that month of a monthly service', () => {
    expect(invoiceForService(list, 'acc-1', '2026-10')?.number).toBe('INV-0003');
    expect(invoiceForService(list, 'acc-1', '2026-09')).toBeNull();
  });

  it('never counts a voided invoice: the draft made after it is the one', () => {
    expect(invoiceForService(list, 'acc-1', '2026-11')?.number).toBe('INV-0005');
  });

  it('is the newest one for a one-time service, whatever the month', () => {
    expect(invoiceForService(list, 'acc-2', null)?.number).toBe('INV-0007');
  });

  it('is nothing for a service that was never invoiced', () => {
    expect(invoiceForService(list, 'acc-9', null)).toBeNull();
  });
});
