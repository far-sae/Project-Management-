// Income: the money that came in, and the money still to come.
//
// What came in is read from three places and shown as one list:
//   invoice   a payment recorded on an invoice (each has its own receipt)
//   service   a payment written on a client's service (CRM, Accounts)
//   other     income with no invoice and no service: a cash sale, a refund
// A payment on an invoice that was made for a service is written on that
// service too, by the database. It is the same money, so it is counted once,
// as the invoice's.
//
// What is still to come is every issued invoice that is not paid in full:
// what is left on it, and the day it is due.
//
// Two currencies are never added together. Nothing here talks to a server.
import { balance } from '../../api/_signroom/shared/invoiceMath';
import type { Invoice } from '../../api/_signroom/shared/types';
import { accountCurrency, formatByCurrency } from '@/lib/crmCurrency';
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

/** Income with no invoice and no service (income_entries, migration 220). */
export interface IncomeEntry {
  id: string;
  organizationId: string;
  workspaceId: string;
  /** What the money was for. */
  title: string;
  /** Who paid it. */
  payer: string;
  /** In major units (pounds, not pence). */
  amount: number;
  currency: string;
  /** "2026-11-21" */
  receivedOn: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
}

export type IncomeSource = 'invoice' | 'service' | 'other';

export const SOURCE_LABEL: Record<IncomeSource, string> = { invoice: 'Invoice', service: 'Client service', other: 'Other income' };

export interface ReceivedRow {
  id: string;
  source: IncomeSource;
  /** The day it was paid, "2026-11-21". */
  date: string;
  /** In major units. */
  amount: number;
  currency: string;
  /** What it was for. */
  title: string;
  /** Who paid. Empty when that is not known. */
  who: string;
  method: string;
  reference: string;
  /** Where the record of it can be opened. Null for other income, which is opened in place. */
  href: string | null;
  /** Set for other income: the entry to change or remove. */
  entryId?: string;
}

export interface UpcomingRow {
  id: string;
  number: string;
  who: string;
  dueDate: string;
  /** What is left to pay, in major units. */
  amount: number;
  currency: string;
  overdue: boolean;
  href: string;
}

const major = (minor: number): number => Math.round(minor) / 100;

/** Everything that came in, newest first. */
export function receivedRows(input: {
  invoices: Invoice[];
  /** The customer of an invoice, by name. */
  nameOf: (invoice: Invoice) => string;
  accounts: CrmClientAccount[];
  payments: CrmAccountPayment[];
  /** The client a service belongs to, by name. */
  clientOf: (account: CrmClientAccount) => string;
  entries: IncomeEntry[];
  companyCurrency: string;
}): ReceivedRow[] {
  const rows: ReceivedRow[] = [];

  for (const invoice of input.invoices) {
    for (const payment of invoice.payments) {
      rows.push({
        id: `invoice:${payment.id}`, source: 'invoice', date: payment.paidOn, amount: major(payment.amountMinor), currency: invoice.currency,
        title: `Invoice ${invoice.number}`, who: input.nameOf(invoice), method: payment.method ?? '',
        reference: payment.receiptNumber || payment.reference || '', href: `/crm/invoices/${invoice.id}`,
      });
    }
  }

  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  for (const payment of input.payments) {
    // The same money as a payment on an invoice: that one is already in the list.
    if (payment.fromInvoice) continue;
    const account = accountById.get(payment.accountId);
    rows.push({
      id: `service:${payment.id}`, source: 'service', date: payment.paidOn, amount: payment.amount,
      currency: account ? accountCurrency(account, input.companyCurrency) : input.companyCurrency,
      title: account ? account.serviceName : 'A service that was removed', who: account ? input.clientOf(account) : '',
      method: payment.method ?? '', reference: payment.reference ?? '', href: account ? `/crm/contacts/${account.contactId}` : null,
    });
  }

  for (const entry of input.entries) {
    rows.push({
      id: `other:${entry.id}`, source: 'other', date: entry.receivedOn, amount: entry.amount, currency: entry.currency,
      title: entry.title, who: entry.payer, method: entry.method ?? '', reference: entry.reference ?? '', href: null, entryId: entry.id,
    });
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Issued invoices that are not paid in full: what is left on each, the soonest due first. */
export function upcomingRows(invoices: Invoice[], today: string, nameOf: (invoice: Invoice) => string): UpcomingRow[] {
  return invoices
    .filter((invoice) => (invoice.status === 'Issued' || invoice.status === 'Part paid') && balance(invoice) > 0)
    .map((invoice) => ({
      id: invoice.id, number: invoice.number, who: nameOf(invoice), dueDate: invoice.dueDate, amount: major(balance(invoice)),
      currency: invoice.currency, overdue: invoice.dueDate < today, href: `/crm/invoices/${invoice.id}`,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
}

export interface IncomeTotals {
  /** Each one is a text such as "£265 + $230": a currency has its own amount. */
  thisMonth: string;
  thisYear: string;
  upcoming: string;
  overdue: string;
  upcomingCount: number;
  overdueCount: number;
}

/** What came in this month and this year (of `today`), what is to come and how much of that is late. */
export function incomeTotals(received: ReceivedRow[], upcoming: UpcomingRow[], today: string, companyCurrency: string): IncomeTotals {
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const sum = (rows: { amount: number; currency: string }[]) => formatByCurrency(rows, companyCurrency);
  const late = upcoming.filter((row) => row.overdue);
  return {
    thisMonth: sum(received.filter((row) => row.date.startsWith(month))),
    thisYear: sum(received.filter((row) => row.date.startsWith(year))),
    upcoming: sum(upcoming),
    overdue: sum(late),
    upcomingCount: upcoming.length,
    overdueCount: late.length,
  };
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthIncome {
  /** "2026-11" */
  month: string;
  /** "Nov" */
  label: string;
  /** "£265", or "£265 + $30". */
  text: string;
  /** What came in, by currency. A currency with nothing is not in it. */
  amounts: Record<string, number>;
}

/** The twelve months of a year, each with what came in. */
export function monthSeries(received: ReceivedRow[], year: number, companyCurrency: string): MonthIncome[] {
  return SHORT.map((label, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    const rows = received.filter((row) => row.date.startsWith(month));
    const amounts: Record<string, number> = {};
    for (const row of rows) amounts[row.currency] = Math.round(((amounts[row.currency] ?? 0) + row.amount) * 100) / 100;
    return { month, label, text: formatByCurrency(rows, companyCurrency), amounts };
  });
}
