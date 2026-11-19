/**
 * Spreadsheet exports for invoices, receipts and a company's statement.
 * Amounts are written as plain decimals so a spreadsheet can add them up.
 */
import { balance } from '../../../api/_signroom/shared/invoiceMath';
import type { AccountEntry, Invoice } from '../../../api/_signroom/shared/types';
import type { ReceiptRow } from './billing';

type Cell = string | number;

/** Quoted, and with a leading apostrophe on anything a spreadsheet would run as a formula. */
const cell = (value: Cell): string =>
  '"' + String(value).replace(/^(\s*[=+@-]|[\t\r\n])/, "'$&").replace(/"/g, '""') + '"';

/** Rows as CSV text that opens cleanly in a spreadsheet (byte order mark, CRLF line ends). */
export const csvText = (rows: Cell[][]): string => '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n');

const decimal = (minor: number): string => (minor / 100).toFixed(2);

export function invoicesCsv(invoices: Invoice[], nameOf: (invoice: Invoice) => string): string {
  return csvText([
    ['Invoice', 'Company', 'Status', 'Date', 'Due', 'Currency', 'Total', 'Paid', 'Outstanding'],
    ...invoices.map((i) => [
      i.number, nameOf(i), i.status, i.issueDate, i.dueDate, i.currency,
      decimal(i.totalMinor), decimal(i.totalMinor - balance(i)), i.status === 'Voided' ? '' : decimal(balance(i)),
    ]),
  ]);
}

export function receiptsCsv(rows: ReceiptRow[], nameOf: (invoice: Invoice) => string): string {
  return csvText([
    ['Receipt', 'Invoice', 'Company', 'Received date', 'Currency', 'Amount', 'Method', 'Reference'],
    ...rows.map(({ invoice, payment }) => [
      payment.receiptNumber, invoice.number, nameOf(invoice), payment.paidOn, invoice.currency,
      decimal(payment.amountMinor), payment.method, payment.reference,
    ]),
  ]);
}

export interface StatementExport {
  companyName: string;
  from: string;
  to: string;
  asOf: string;
  /** A currency code, or "All". */
  currency: string;
  opening: Record<string, number>;
  rows: AccountEntry[];
}

export function statementCsv(s: StatementExport): string {
  const wanted = (code: string) => s.currency === 'All' || s.currency === code;
  return csvText([
    ['Company', s.companyName],
    ['Statement from', s.from || 'Beginning'],
    ['Statement to', s.to || s.asOf],
    [],
    ['Date', 'Type', 'Reference', 'Invoice', 'Currency', 'Charge', 'Payment', 'Running balance'],
    ...Object.entries(s.opening)
      .filter(([code]) => wanted(code))
      .map(([code, minor]) => [s.from, 'Opening balance', '', '', code, '', '', decimal(minor)]),
    ...s.rows.map((r) => [
      r.date, r.kind, r.reference, r.invoiceNumber, r.currency,
      decimal(r.chargeMinor), decimal(r.paymentMinor), decimal(r.balanceMinor),
    ]),
  ]);
}

/** Hands a text file to the browser to save. */
export function saveTextFile(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
