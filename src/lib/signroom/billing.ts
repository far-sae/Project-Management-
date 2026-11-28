/**
 * Invoice helpers for the screens. Money is whole minor units (pence, cents)
 * and tax is basis points. Every sum comes from the server's own maths in
 * api/_signroom/shared, so the screen, the server and the PDF always agree.
 */
import { publicMessage } from '@/lib/publicError';
import { balance, CURRENCIES, totals } from '../../../api/_signroom/shared/invoiceMath';
import { londonToday } from '../../../api/_signroom/shared/accounts';
import type { Invoice, Payment } from '../../../api/_signroom/shared/types';
import { formatCurrency } from '@/lib/crmCurrency';
import { dealCurrency } from '@/lib/crmDealMoney';

/** The currencies the documents server accepts on an invoice. */
export const INVOICE_CURRENCIES: readonly string[] = CURRENCIES;

export const BILLING_TYPES = ['One-off', 'Monthly', 'Quarterly', 'Yearly', 'Custom'] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

/** Tax worked out on each line, or once on the whole invoice. */
export type TaxMode = 'line' | 'invoice';

/** A line as it is typed. The server turns the text into exact amounts. */
export interface LineDraft {
  description: string;
  quantity: string;
  rate: string;
  billingType: BillingType;
  billingLabel: string;
  taxPercent: string;
}

export type InvoiceTotals = ReturnType<typeof totals>;

/** "£1,234.56": minor units in the invoice's own currency. */
export const formatMinor = (minor: number, currency: string): string =>
  formatCurrency(minor / 100, currency, { maximumFractionDigits: 2 });

/** "1 Nov 2026" for a YYYY-MM-DD date or an ISO time, read in UTC so it never shifts a day. */
export const shortDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "1 Nov 2026, 14:05" for an ISO time, in the reader's own time zone. */
export const shortDateTime = (value: string): string =>
  new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Today as the server counts it: the calendar date in London. */
export const billingToday = (): string => londonToday(new Date());

/** The sentence to show for a failed call: the server's own when it sent one. */
export const errorSentence = (error: unknown, fallback = 'Something went wrong. Please try again.'): string =>
  publicMessage(error instanceof Error ? error : null, fallback);

/** The HTTP status of a failed call to the server, when it has one. */
export const errorStatus = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};

// ---------------------------------------------------------------- lines and totals

export const emptyLine = (): LineDraft => ({
  description: '', quantity: '1', rate: '0.00', billingType: 'One-off', billingLabel: '', taxPercent: '0',
});

/** The saved lines as text for the editor. A draft with no lines starts with one empty line. */
export function lineDrafts(invoice: Pick<Invoice, 'lines' | 'taxBps'>): LineDraft[] {
  if (!invoice.lines.length) return [emptyLine()];
  return invoice.lines.map((l) => ({
    description: l.description,
    quantity: String(l.quantityMilli / 1000),
    rate: (l.rateMinor / 100).toFixed(2),
    billingType: l.billingType || 'One-off',
    billingLabel: l.billingLabel || '',
    taxPercent: String((l.taxBps ?? invoice.taxBps) / 100),
  }));
}

/** How a saved invoice works out tax. A new invoice starts with a rate on each line. */
export function taxModeOf(invoice: Pick<Invoice, 'lines'>): TaxMode {
  if (!invoice.lines.length) return 'line';
  return invoice.lines.some((l) => l.taxBps !== undefined) ? 'line' : 'invoice';
}

/** The lines as the server reads them: no rate on a line means the invoice's one rate applies. */
export function linesForServer(lines: LineDraft[], mode: TaxMode): Array<Omit<LineDraft, 'taxPercent'> & { taxPercent?: string }> {
  if (mode === 'line') return lines.map((l) => ({ ...l }));
  return lines.map(({ taxPercent: _unused, ...rest }) => rest);
}

// ---------------------------------------------------------------- a copy of an invoice

const MONTH_WORDS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-12" → "2027-01". Null for anything that is not a month. */
export function monthAfter(month: string | null | undefined): string | null {
  const m = MONTH_KEY.exec(month ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const index = Number(m[2]);
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`;
}

/** "2026-11" → "November 2026". */
const monthWords = (month: string): string => `${MONTH_WORDS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** What a new invoice made from an existing one starts from. */
export interface InvoiceCopy {
  /** What the draft is created with: the customer, and the deal or service the first invoice was for. */
  create: { clientId: string; dealId?: string; accountId?: string; billingMonth?: string };
  lines: LineDraft[];
  taxMode: TaxMode;
  taxPercent: string;
  currency: string;
  notes: string;
  project: string;
}

/**
 * The parts of an invoice a copy carries over: who it is for, what it bills,
 * in which currency, with which tax and notes. Never its number, its dates,
 * its payments or a receipt: those belong to the first invoice alone.
 *
 * An invoice for one month of a monthly service is copied for the month
 * after, and a line that names the month ("Digital marketing, November 2026")
 * names the new one.
 */
export function invoiceCopy(source: Invoice): InvoiceCopy {
  const nextMonth = source.accountId ? monthAfter(source.billingMonth) : null;
  const from = nextMonth && source.billingMonth ? monthWords(source.billingMonth) : '';
  const to = nextMonth ? monthWords(nextMonth) : '';
  return {
    create: {
      clientId: source.clientId,
      ...(source.dealId ? { dealId: source.dealId } : {}),
      ...(source.accountId ? { accountId: source.accountId } : {}),
      ...(nextMonth ? { billingMonth: nextMonth } : {}),
    },
    lines: lineDrafts(source).map((line) => (from ? { ...line, description: line.description.split(from).join(to) } : line)),
    taxMode: taxModeOf(source),
    taxPercent: String(source.taxBps / 100),
    currency: source.currency,
    notes: source.notes ?? '',
    project: source.project ?? '',
  };
}

/**
 * The totals for what is typed, from the shared maths. While something is not
 * valid yet, `totals` is null and `problem` is the server's sentence for it.
 */
export function liveTotals(lines: LineDraft[], mode: TaxMode, invoiceTaxPercent: string): { totals: InvoiceTotals | null; problem: string | null } {
  try {
    return { totals: totals(linesForServer(lines, mode), invoiceTaxPercent || '0'), problem: null };
  } catch (error) {
    return { totals: null, problem: errorSentence(error, 'Check the line items.') };
  }
}

// ---------------------------------------------------------------- status and lists

export const paidMinor = (invoice: Invoice): number => invoice.totalMinor - balance(invoice);

/** Issued or part paid, and past its due date. */
export const isOverdue = (invoice: Pick<Invoice, 'status' | 'dueDate'>, today: string): boolean =>
  (invoice.status === 'Issued' || invoice.status === 'Part paid') && invoice.dueDate < today;

export const STATUS_FILTERS = ['All', 'Draft', 'Issued', 'Part paid', 'Paid', 'Overdue', 'Voided'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const matchesStatus = (invoice: Invoice, filter: StatusFilter, today: string): boolean =>
  filter === 'All' || (filter === 'Overdue' ? isOverdue(invoice, today) : invoice.status === filter);

export interface InvoiceFilter {
  status: StatusFilter;
  query: string;
  /** Invoice date range, YYYY-MM-DD or "". */
  from: string;
  to: string;
  today: string;
  /** The company an invoice is for, so it can be searched by name. */
  nameOf?: (invoice: Invoice) => string;
}

const inRange = (date: string, from: string, to: string): boolean => (!from || date >= from) && (!to || date <= to);

export function filterInvoices(invoices: Invoice[], filter: InvoiceFilter): Invoice[] {
  const query = filter.query.trim().toLowerCase();
  return invoices.filter((i) => {
    if (!inRange(i.issueDate, filter.from, filter.to) || !matchesStatus(i, filter.status, filter.today)) return false;
    if (!query) return true;
    const text = [i.number, i.notes, i.project ?? '', filter.nameOf?.(i) ?? '', ...i.lines.map((l) => l.description)].join(' ');
    return text.toLowerCase().includes(query);
  });
}

export interface ReceiptRow { invoice: Invoice; payment: Payment }

/** Every recorded payment with its invoice, newest first. Each one has its own receipt. */
export function receiptRows(invoices: Invoice[]): ReceiptRow[] {
  return invoices
    .flatMap((invoice) => invoice.payments.map((payment) => ({ invoice, payment })))
    .sort((a, b) => b.payment.recordedAt.localeCompare(a.payment.recordedAt));
}

export function filterReceipts(rows: ReceiptRow[], filter: Pick<InvoiceFilter, 'query' | 'from' | 'to' | 'nameOf'>): ReceiptRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter(({ invoice, payment }) => {
    if (!inRange(payment.paidOn, filter.from, filter.to)) return false;
    if (!query) return true;
    const text = [payment.receiptNumber, invoice.number, payment.reference, payment.method, filter.nameOf?.(invoice) ?? ''].join(' ');
    return text.toLowerCase().includes(query);
  });
}

/** Minor units per currency code. Currencies are never added together. */
export type Sums = Record<string, number>;

export interface ListTotals {
  outstanding: Sums;
  overdue: Sums;
  paidThisMonth: Sums;
  unpaidCount: number;
  overdueCount: number;
}

/** What is owed, what is late and what came in this calendar month. Drafts and voided invoices do not count. */
export function listTotals(invoices: Invoice[], today: string): ListTotals {
  const out: ListTotals = { outstanding: {}, overdue: {}, paidThisMonth: {}, unpaidCount: 0, overdueCount: 0 };
  const month = today.slice(0, 7);
  const add = (sums: Sums, currency: string, minor: number) => { sums[currency] = (sums[currency] ?? 0) + minor; };
  for (const i of invoices) {
    if (i.status === 'Draft' || i.status === 'Voided') continue;
    const owed = balance(i);
    const late = owed > 0 && i.dueDate < today;
    add(out.outstanding, i.currency, owed);
    add(out.overdue, i.currency, late ? owed : 0);
    add(out.paidThisMonth, i.currency, i.payments.reduce((n, p) => n + (p.paidOn.startsWith(month) ? p.amountMinor : 0), 0));
    if (owed > 0) out.unpaidCount += 1;
    if (late) out.overdueCount += 1;
  }
  return out;
}

/**
 * "£250.00 · $30.00": one amount per currency. A currency at zero is left out
 * while another has an amount; all at zero shows the zeros; nothing at all is a dash.
 */
export function formatSums(sums: Sums): string {
  const codes = Object.keys(sums).sort();
  const withAmount = codes.filter((code) => sums[code] !== 0);
  return (withAmount.length ? withAmount : codes).map((code) => formatMinor(sums[code] ?? 0, code)).join(' · ') || '—';
}

export const anyAbove = (sums: Sums): boolean => Object.values(sums).some((n) => n > 0);

// ---------------------------------------------------------------- starting an invoice

const supported = (code: string | null | undefined): code is string => Boolean(code) && INVOICE_CURRENCIES.includes(code as string);

/**
 * The currency a new invoice starts in: the company's account currency when
 * one is set, otherwise our own company currency, otherwise what the server chose.
 */
export function defaultInvoiceCurrency(accountCurrency: string | null | undefined, companyCurrency: string, fallback: string): string {
  if (supported(accountCurrency)) return accountCurrency;
  const ours = companyCurrency.trim().toUpperCase();
  return supported(ours) ? ours : fallback;
}

/**
 * The first line of an invoice raised from a deal: the deal's name and value.
 * A deal's value is in major units, in the deal's own currency. When invoices
 * cannot use that currency, `currency` is null and the price is left at zero.
 */
export function dealFirstLine(
  deal: { name: string; value: number; currency: string | null },
  companyCurrency: string,
): { line: LineDraft; currency: string | null } {
  const code = dealCurrency(deal, companyCurrency);
  const usable = supported(code);
  const value = Math.round((Number.isFinite(deal.value) ? deal.value : 0) * 100) / 100;
  const rate = usable && value > 0 && value < 1e9 ? value.toFixed(2) : '0.00';
  return {
    line: { ...emptyLine(), description: deal.name.trim().slice(0, 1500), rate },
    currency: usable ? code : null,
  };
}
