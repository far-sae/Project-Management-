/**
 * What a deal was sold for against what has been invoiced and paid, so the
 * three numbers can be read in one place. Pure functions only.
 *
 * The deal's own value and currency are in crmDealMoney.ts; this file is about
 * its invoices.
 */

export interface DealInvoice {
  status: 'Draft' | 'Issued' | 'Part paid' | 'Paid' | 'Voided';
  currency: string;
  totalMinor: number;
  payments: Array<{ amountMinor: number }>;
}

/** The invoices of one deal in one currency, in pence (or cents). */
export interface MoneyLine {
  currency: string;
  /** Issued invoices, paid or not. Drafts and voided invoices are not in it. */
  invoicedMinor: number;
  paidMinor: number;
  owedMinor: number;
  /** Written but not issued yet. */
  draftMinor: number;
}

/**
 * One line per currency, biggest first. Currencies are never added together:
 * £1,000 and $1,000 are not 2,000 of anything.
 */
export function dealMoney(invoices: DealInvoice[]): MoneyLine[] {
  const byCurrency = new Map<string, MoneyLine>();
  for (const invoice of invoices) {
    if (invoice.status === 'Voided') continue;
    let line = byCurrency.get(invoice.currency);
    if (!line) {
      line = { currency: invoice.currency, invoicedMinor: 0, paidMinor: 0, owedMinor: 0, draftMinor: 0 };
      byCurrency.set(invoice.currency, line);
    }
    if (invoice.status === 'Draft') {
      line.draftMinor += invoice.totalMinor;
      continue;
    }
    const paid = invoice.payments.reduce((sum, p) => sum + p.amountMinor, 0);
    line.invoicedMinor += invoice.totalMinor;
    line.paidMinor += paid;
    line.owedMinor += Math.max(0, invoice.totalMinor - paid);
  }
  return [...byCurrency.values()].sort((a, b) => b.invoicedMinor + b.draftMinor - (a.invoicedMinor + a.draftMinor));
}

/**
 * How the invoices compare with the deal value, in one or two short sentences.
 * `dealValue` is in whole units of `dealCurrency` (12000 = £12,000).
 */
export function moneySentence(
  dealValue: number,
  dealCurrency: string,
  lines: MoneyLine[],
  format: (minor: number, currency: string) => string,
): string {
  if (lines.length === 0) return dealValue > 0 ? 'Nothing is invoiced for this deal yet.' : '';
  if (lines.length > 1) return 'The invoices are in more than one currency, so they are not compared with the deal value.';
  const [line] = lines;
  if (line.currency !== dealCurrency) {
    return `The invoices are in ${line.currency}, the deal value in ${dealCurrency}, so they are not compared.`;
  }
  const gap = Math.round(dealValue * 100) - line.invoicedMinor;
  const first = gap > 0
    ? (line.invoicedMinor === 0 && line.draftMinor === 0
      ? 'Nothing is invoiced for this deal yet.'
      : `${format(gap, line.currency)} of this deal is not invoiced yet.`)
    : gap === 0
      ? 'The whole deal is invoiced.'
      : `${format(-gap, line.currency)} more than the deal value is invoiced. Check the deal value.`;
  return line.draftMinor > 0 ? `${first} ${format(line.draftMinor, line.currency)} more is in draft invoices.` : first;
}
