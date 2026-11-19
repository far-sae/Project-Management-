// Pure invoice helpers: what the list, the editor and the exports are built on.
import { describe, expect, it } from 'vitest';
import type { Invoice } from '../../../../api/_signroom/shared/types';
import {
  INVOICE_CURRENCIES, dealFirstLine, defaultInvoiceCurrency, emptyLine, filterInvoices, formatMinor, formatSums,
  isOverdue, lineDrafts, linesForServer, listTotals, liveTotals, receiptRows, shortDate, taxModeOf,
} from '@/lib/signroom/billing';
import { csvText, invoicesCsv, statementCsv } from '@/lib/signroom/billingCsv';

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'i1', workspaceId: 'w', clientId: 'c1', createdBy: 'u1', revision: 1, status: 'Draft', number: 'INV-0001',
  currency: 'GBP', issueDate: '2026-11-01', dueDate: '2026-11-30', lines: [], taxBps: 0, subtotalMinor: 0,
  taxMinor: 0, totalMinor: 0, notes: '', created: '2026-11-01T00:00:00Z', updated: '2026-11-01T00:00:00Z',
  payments: [], events: [], ...over,
});
const payment = (id: string, amountMinor: number, paidOn: string, recordedAt = `${paidOn}T10:00:00Z`) => ({
  id, amountMinor, paidOn, reference: '', method: 'Bank transfer', receiptNumber: `INV-0001-R0${id.slice(1)}`,
  receiptHash: 'h', recordedAt,
});
const line = (over: Partial<ReturnType<typeof emptyLine>> = {}) => ({ ...emptyLine(), description: 'Design', ...over });

describe('money and dates', () => {
  it('writes minor units in the invoice currency with two decimals', () => {
    expect(formatMinor(1800, 'GBP')).toBe('£18.00');
    expect(formatMinor(123456, 'USD')).toBe('$1,234.56');
  });

  it('writes a date the same way whatever the time zone', () => {
    expect(shortDate('2026-11-01')).toBe('1 Nov 2026');
    expect(shortDate('2026-11-01T23:30:00Z')).toBe('1 Nov 2026');
  });

  it('offers only the currencies the server accepts', () => {
    expect(INVOICE_CURRENCIES).toEqual(['GBP', 'USD', 'EUR', 'CAD', 'AUD', 'NZD', 'INR', 'AED']);
  });
});

describe('live totals', () => {
  it('uses the shared maths for tax on each line', () => {
    const out = liveTotals([line({ quantity: '1.5', rate: '10.00', taxPercent: '20' })], 'line', '0');
    expect(out.totals).toMatchObject({ subtotalMinor: 1500, taxMinor: 300, totalMinor: 1800 });
    expect(out.problem).toBeNull();
  });

  it('uses one rate for the whole invoice when asked, ignoring the rates on the lines', () => {
    const lines = [line({ rate: '10.00', taxPercent: '50' }), line({ rate: '5.00', taxPercent: '50' })];
    const out = liveTotals(lines, 'invoice', '20');
    expect(out.totals).toMatchObject({ subtotalMinor: 1500, taxMinor: 300, totalMinor: 1800, taxBps: 2000 });
    expect(linesForServer(lines, 'invoice')[0]).not.toHaveProperty('taxPercent');
    expect(linesForServer(lines, 'line')[0]).toHaveProperty('taxPercent', '50');
  });

  it('gives the server sentence instead of totals while a line is not valid', () => {
    const out = liveTotals([emptyLine()], 'line', '0');
    expect(out.totals).toBeNull();
    expect(out.problem).toBe('Each line needs a description and quantity greater than zero.');
  });

  it('turns saved lines back into what was typed', () => {
    const saved = invoice({
      taxBps: 2000,
      lines: [
        { description: 'Design', quantityMilli: 1500, rateMinor: 1000, totalMinor: 1500, billingType: 'Monthly' },
        { description: 'Hosting', quantityMilli: 1000, rateMinor: 250, totalMinor: 250, taxBps: 500, taxMinor: 13, billingType: 'Custom', billingLabel: 'Per site' },
      ],
    });
    expect(lineDrafts(saved)).toEqual([
      { description: 'Design', quantity: '1.5', rate: '10.00', billingType: 'Monthly', billingLabel: '', taxPercent: '20' },
      { description: 'Hosting', quantity: '1', rate: '2.50', billingType: 'Custom', billingLabel: 'Per site', taxPercent: '5' },
    ]);
    expect(taxModeOf(saved)).toBe('line');
    expect(taxModeOf(invoice({ lines: [saved.lines[0]!] }))).toBe('invoice');
    expect(taxModeOf(invoice())).toBe('line');
    expect(lineDrafts(invoice())).toEqual([emptyLine()]);
  });
});

describe('the list', () => {
  const today = '2026-11-19';
  const all = [
    invoice({ id: 'a', number: 'INV-0001', status: 'Draft', totalMinor: 5000 }),
    invoice({ id: 'b', number: 'INV-0002', status: 'Issued', totalMinor: 10000, dueDate: '2026-11-10' }),
    invoice({ id: 'c', number: 'INV-0003', status: 'Part paid', totalMinor: 20000, dueDate: '2026-12-10', payments: [payment('p1', 5000, '2026-11-05')] }),
    invoice({ id: 'd', number: 'INV-0004', status: 'Paid', totalMinor: 3000, currency: 'USD', payments: [payment('p2', 3000, '2026-10-20')] }),
    invoice({ id: 'e', number: 'INV-0005', status: 'Voided', totalMinor: 7000, dueDate: '2026-01-01' }),
  ];

  it('knows an invoice is overdue only while money is still owed', () => {
    expect(isOverdue(all[1]!, today)).toBe(true);
    expect(isOverdue(all[2]!, today)).toBe(false);
    expect(isOverdue(all[4]!, today)).toBe(false);
  });

  it('adds up what is owed, what is late and what came in this month, per currency', () => {
    const totals = listTotals(all, today);
    expect(totals.outstanding).toEqual({ GBP: 25000, USD: 0 });
    expect(totals.overdue).toEqual({ GBP: 10000, USD: 0 });
    expect(totals.paidThisMonth).toEqual({ GBP: 5000, USD: 0 });
    expect(totals.unpaidCount).toBe(2);
    expect(totals.overdueCount).toBe(1);
    expect(formatSums(totals.outstanding)).toBe('£250.00');
    expect(formatSums({ GBP: 25000, USD: 3000 })).toBe('£250.00 · $30.00');
    expect(formatSums({ GBP: 0, USD: 0 })).toBe('£0.00 · $0.00');
    expect(formatSums({})).toBe('—');
  });

  it('filters by status, including overdue, and by words and dates', () => {
    const ids = (f: Parameters<typeof filterInvoices>[1]) => filterInvoices(all, f).map((i) => i.id);
    const base = { status: 'All' as const, query: '', from: '', to: '', today };
    expect(ids(base)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids({ ...base, status: 'Overdue' })).toEqual(['b']);
    expect(ids({ ...base, status: 'Part paid' })).toEqual(['c']);
    expect(ids({ ...base, query: 'inv-0004' })).toEqual(['d']);
    expect(ids({ ...base, query: 'harbour', nameOf: (i) => (i.id === 'c' ? 'Harbour Dental' : 'Northwind Studio') })).toEqual(['c']);
    expect(ids({ ...base, from: '2026-11-02' })).toEqual([]);
  });

  it('lists every receipt, newest first', () => {
    const rows = receiptRows([
      invoice({ id: 'c', payments: [payment('p1', 5000, '2026-11-05'), payment('p2', 100, '2026-11-07')] }),
    ]);
    expect(rows.map((r) => r.payment.id)).toEqual(['p2', 'p1']);
    expect(rows[0]!.invoice.id).toBe('c');
  });
});

describe('starting an invoice', () => {
  it('uses the account currency, then the company currency, then what the server picked', () => {
    expect(defaultInvoiceCurrency('USD', 'EUR', 'GBP')).toBe('USD');
    expect(defaultInvoiceCurrency(undefined, 'EUR', 'GBP')).toBe('EUR');
    expect(defaultInvoiceCurrency(undefined, 'JPY', 'GBP')).toBe('GBP');
  });

  it('starts the first line from the deal, in the deal currency', () => {
    expect(dealFirstLine({ name: 'Northwind website', value: 9500, currency: null }, 'GBP')).toEqual({
      line: { ...emptyLine(), description: 'Northwind website', rate: '9500.00' },
      currency: 'GBP',
    });
    expect(dealFirstLine({ name: 'Driver app', value: 20000.5, currency: 'usd' }, 'GBP').currency).toBe('USD');
  });

  it('leaves the price out when invoices cannot use the deal currency', () => {
    const out = dealFirstLine({ name: 'Tokyo launch', value: 500000, currency: 'JPY' }, 'GBP');
    expect(out.currency).toBeNull();
    expect(out.line.rate).toBe('0.00');
    expect(out.line.description).toBe('Tokyo launch');
  });
});

describe('exports', () => {
  it('guards spreadsheet formulas and quotes', () => {
    expect(csvText([['@SUM(A1)', 'He said "hi"', 12]])).toBe('﻿"\'@SUM(A1)","He said ""hi""","12"');
  });

  it('writes one row per invoice with what was paid and what is owed', () => {
    const text = invoicesCsv(
      [invoice({ status: 'Part paid', number: 'INV-0003', totalMinor: 20000, payments: [payment('p1', 5000, '2026-11-05')] })],
      () => 'Harbour Dental',
    );
    const [head, row] = text.replace('﻿', '').split('\r\n');
    expect(head).toBe('"Invoice","Company","Status","Date","Due","Currency","Total","Paid","Outstanding"');
    expect(row).toBe('"INV-0003","Harbour Dental","Part paid","2026-11-01","2026-11-30","GBP","200.00","50.00","150.00"');
  });

  it('writes the statement with its opening balance and running balance', () => {
    const text = statementCsv({
      companyName: 'Harbour Dental', from: '2026-11-01', to: '', asOf: '2026-11-19', currency: 'All',
      opening: { GBP: 1000 },
      rows: [{
        id: 'e1', date: '2026-11-05', kind: 'Invoice', reference: 'INV-0003', invoiceId: 'c', invoiceNumber: 'INV-0003',
        currency: 'GBP', chargeMinor: 20000, paymentMinor: 0, balanceMinor: 21000,
      }],
    });
    const rows = text.replace('﻿', '').split('\r\n');
    expect(rows[0]).toBe('"Company","Harbour Dental"');
    expect(rows[2]).toBe('"Statement to","2026-11-19"');
    expect(rows[5]).toBe('"2026-11-01","Opening balance","","","GBP","","","10.00"');
    expect(rows[6]).toBe('"2026-11-05","Invoice","INV-0003","INV-0003","GBP","200.00","0.00","210.00"');
  });
});
