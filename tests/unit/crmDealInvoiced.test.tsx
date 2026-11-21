// One place on the deal that says what was sold, invoiced, paid and is still owed.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { dealMoney, moneySentence } from '@/lib/crmDealInvoiced';

type Inv = Parameters<typeof dealMoney>[0][number];

const h = vi.hoisted(() => ({
  invoices: { invoices: [] as unknown[], loading: false, error: '', workspaceId: 'w' as string | null },
}));

vi.mock('@/components/signroom/billing/useBilling', () => ({ useInvoices: () => h.invoices }));

import { DealMoneySummary } from '@/components/crmHub/DealMoneySummary';

const invoice = (status: Inv['status'], total: number, paid: number[] = [], currency = 'GBP'): Inv => ({
  status, currency, totalMinor: total, payments: paid.map((amountMinor) => ({ amountMinor })) as Inv['payments'],
});

beforeEach(() => { h.invoices = { invoices: [], loading: false, error: '', workspaceId: 'w' }; });
afterEach(cleanup);

describe('adding up the invoices of a deal', () => {
  it('counts issued invoices as invoiced, with what was paid and what is still owed', () => {
    expect(dealMoney([invoice('Issued', 400000), invoice('Part paid', 200000, [50000, 25000]), invoice('Paid', 100000, [100000])])).toEqual([
      { currency: 'GBP', invoicedMinor: 700000, paidMinor: 175000, owedMinor: 525000, draftMinor: 0 },
    ]);
  });

  it('keeps drafts apart and leaves voided invoices out', () => {
    expect(dealMoney([invoice('Draft', 300000), invoice('Voided', 900000, [100000]), invoice('Issued', 100000)])).toEqual([
      { currency: 'GBP', invoicedMinor: 100000, paidMinor: 0, owedMinor: 100000, draftMinor: 300000 },
    ]);
  });

  it('never adds two currencies together', () => {
    const lines = dealMoney([invoice('Issued', 100000), invoice('Paid', 250000, [250000], 'USD')]);
    expect(lines.map((l) => [l.currency, l.invoicedMinor])).toEqual([['USD', 250000], ['GBP', 100000]]);
  });

  it('never shows less than nothing owed when an invoice was overpaid', () => {
    expect(dealMoney([invoice('Paid', 100000, [120000])])[0]).toMatchObject({ paidMinor: 120000, owedMinor: 0 });
  });

  it('is empty for a deal with no invoices', () => {
    expect(dealMoney([])).toEqual([]);
  });
});

describe('the sentence under the figures', () => {
  const line = (invoicedMinor: number, draftMinor = 0, currency = 'GBP') => ({ currency, invoicedMinor, paidMinor: 0, owedMinor: invoicedMinor, draftMinor });
  const fmt = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString('en-GB')}`;

  it('says how much of the deal is not invoiced yet', () => {
    expect(moneySentence(12000, 'GBP', [line(700000)], fmt)).toBe('GBP 5,000 of this deal is not invoiced yet.');
    expect(moneySentence(12000, 'GBP', [], fmt)).toBe('Nothing is invoiced for this deal yet.');
  });

  it('says when it is all invoiced, or more than the deal', () => {
    expect(moneySentence(7000, 'GBP', [line(700000)], fmt)).toBe('The whole deal is invoiced.');
    expect(moneySentence(5000, 'GBP', [line(700000)], fmt)).toBe('GBP 2,000 more than the deal value is invoiced. Check the deal value.');
  });

  it('mentions drafts, which are not invoiced until they are issued', () => {
    expect(moneySentence(12000, 'GBP', [line(700000, 200000)], fmt))
      .toBe('GBP 5,000 of this deal is not invoiced yet. GBP 2,000 more is in draft invoices.');
  });

  it('does not compare when the invoices are in another currency or in several', () => {
    expect(moneySentence(12000, 'GBP', [line(700000, 0, 'USD')], fmt)).toBe('The invoices are in USD, the deal value in GBP, so they are not compared.');
    expect(moneySentence(12000, 'GBP', [line(1, 0, 'USD'), line(1)], fmt)).toBe('The invoices are in more than one currency, so they are not compared with the deal value.');
  });

  it('says nothing about a deal with no value and no invoices', () => {
    expect(moneySentence(0, 'GBP', [], fmt)).toBe('');
  });
});

describe('Money on the deal page', () => {
  const deal = { id: 'd1', companyId: 'c1', value: 12000 };
  const figure = (label: string) => screen.getByText(label).parentElement?.querySelector('dd')?.textContent;

  it('shows the four figures side by side', () => {
    h.invoices.invoices = [invoice('Part paid', 700000, [200000])];
    render(<DealMoneySummary deal={deal} valueText="£12,000" currency="GBP" />);
    expect(figure('Deal value')).toBe('£12,000');
    expect(figure('Invoiced')).toBe('£7,000.00');
    expect(figure('Paid')).toBe('£2,000.00');
    expect(figure('Still owed')).toBe('£5,000.00');
    expect(screen.getByText('£5,000.00 of this deal is not invoiced yet.')).toBeTruthy();
  });

  it('shows zeros, not blanks, for a deal with nothing invoiced', () => {
    render(<DealMoneySummary deal={deal} valueText="£12,000" currency="GBP" />);
    expect(figure('Invoiced')).toBe('£0.00');
    expect(figure('Still owed')).toBe('£0.00');
    expect(screen.getByText('Nothing is invoiced for this deal yet.')).toBeTruthy();
  });

  it('shows each currency when the invoices are in two', () => {
    h.invoices.invoices = [invoice('Issued', 100000), invoice('Issued', 250000, [], 'USD')];
    render(<DealMoneySummary deal={deal} valueText="£12,000" currency="GBP" />);
    expect(figure('Invoiced')).toBe('$2,500.00 + £1,000.00');
  });

  it('compares with the deal in the deal’s own currency', () => {
    h.invoices.invoices = [invoice('Issued', 700000, [], 'USD')];
    render(<DealMoneySummary deal={deal} valueText="$12,000" currency="USD" />);
    expect(figure('Deal value')).toBe('$12,000');
    expect(screen.getByText('$5,000.00 of this deal is not invoiced yet.')).toBeTruthy();
  });

  it('does not show figures it does not have', () => {
    h.invoices = { invoices: [], loading: true, error: '', workspaceId: 'w' };
    const { unmount } = render(<DealMoneySummary deal={deal} valueText="£12,000" currency="GBP" />);
    expect(figure('Deal value')).toBe('£12,000');
    expect(figure('Invoiced')).toBe('…');
    unmount();
    h.invoices = { invoices: [], loading: false, error: 'Billing is not set up yet.', workspaceId: 'w' };
    render(<DealMoneySummary deal={deal} valueText="£12,000" currency="GBP" />);
    expect(figure('Invoiced')).toBe('—');
    expect(screen.queryByText('Nothing is invoiced for this deal yet.')).toBeNull();
  });
});
