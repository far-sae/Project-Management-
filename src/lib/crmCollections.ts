// Collections: what each client service is charged in a month, what was paid
// for that month, and what is still to collect. The same sums a collections
// sheet does by hand:
//
//   charges        what the service bills in the review month
//   paid           the payments that pay FOR that month (a payment can arrive
//                  in another month than the one it pays for)
//   month unpaid   charges minus paid, never below zero
//   earlier unpaid what is still owed from the months before
//   to collect     everything owed up to and including the review month
//   credit         what was paid beyond that
//
// Nothing here talks to the database.
import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

/** "2026-09". */
export type MonthKey = string;

export const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthKey = (date: Date): MonthKey => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09" → "September 2026" (or "Sep 2026"). An odd value comes back as it is. */
export const monthLabel = (key: MonthKey, short = false): string =>
  (MONTH_KEY.test(key) ? `${(short ? SHORT_MONTHS : LONG_MONTHS)[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : key);

/** The month a payment pays for: the one it names, else the month it arrived in. */
export const paysFor = (payment: Pick<CrmAccountPayment, 'paidOn' | 'billingMonth'>): MonthKey =>
  (payment.billingMonth && MONTH_KEY.test(payment.billingMonth) ? payment.billingMonth : payment.paidOn.slice(0, 7));

const addMonths = (key: MonthKey, by: number): MonthKey => {
  const total = Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

/** How many months from `from` to `to`, both counted. 0 when `to` is before `from`. */
export const monthsBetween = (from: MonthKey, to: MonthKey): number => {
  const count = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1;
  return Math.max(0, count);
};

export const previousMonth = (key: MonthKey): MonthKey => addMonths(key, -1);
export const nextMonth = (key: MonthKey): MonthKey => addMonths(key, 1);

export type CollectionStatus = 'paid' | 'part' | 'due' | 'overdue' | 'none' | 'setup';
export const COLLECTION_STATUS_LABEL: Record<CollectionStatus, string> = {
  paid: 'Paid', part: 'Part paid', due: 'Due', overdue: 'Overdue', none: 'Nothing due', setup: 'Needs a date',
};

export interface CollectionRow {
  account: CrmClientAccount;
  /** What the service bills in the review month. */
  charges: number;
  /** The payments that pay for the review month. */
  paid: number;
  monthUnpaid: number;
  earlierUnpaid: number;
  /** Everything owed up to and including the review month. */
  collect: number;
  /** What was paid beyond everything owed so far. */
  credit: number;
  /** When it is due in the review month ("2026-09-05"), or null. */
  dueOn: string | null;
  status: CollectionStatus;
  /** What is missing before the sums can be complete ("Set a start month"), or null. */
  setup: string | null;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const total = (payments: CrmAccountPayment[]): number => payments.reduce((sum, payment) => sum + payment.amount, 0);

const daysIn = (key: MonthKey): number => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();

/** One service in one review month. `payments` may hold the payments of other services too. */
export function collectionRow(account: CrmClientAccount, payments: CrmAccountPayment[], month: MonthKey): CollectionRow {
  const mine = payments.filter((payment) => payment.accountId === account.id);
  const paidFor = total(mine.filter((payment) => paysFor(payment) === month));
  const paidBefore = total(mine.filter((payment) => paysFor(payment) < month));

  if (account.billingType === 'monthly') {
    const start = account.serviceStart ? account.serviceStart.slice(0, 7) : null;
    const end = account.serviceEnd ? account.serviceEnd.slice(0, 7) : null;
    const running = (start === null || start <= month) && (end === null || end >= month);
    const charges = running ? account.agreedAmount : 0;
    // What was already paid before the records began counts for the first month.
    const paid = paidFor + (start === month || start === null ? account.openingPaid : 0);
    // Without a first month nobody can say how many earlier months were billed.
    const lastEarlier = end !== null && end < month ? end : previousMonth(month);
    const earlierCharged = start !== null && start < month ? account.agreedAmount * monthsBetween(start, lastEarlier) : 0;
    const earlierPaid = start !== null && start < month ? paidBefore + account.openingPaid : 0;
    const owed = earlierCharged + charges - (earlierPaid + paid);
    const monthUnpaid = Math.max(0, charges - paid);
    const collect = Math.max(0, owed);
    const earlierUnpaid = Math.max(0, Math.min(collect, earlierCharged - earlierPaid));
    const dueOn = running && account.dueDay ? `${month}-${String(Math.min(account.dueDay, daysIn(month))).padStart(2, '0')}` : null;
    const setup = start === null ? 'Set a start month to count the months before' : null;
    return {
      account, charges, paid: round(paid), monthUnpaid: round(monthUnpaid), earlierUnpaid: round(earlierUnpaid), collect: round(collect), credit: round(Math.max(0, -owed)), dueOn,
      status: collect <= 0 ? (charges > 0 ? 'paid' : 'none') : earlierUnpaid > 0 ? 'overdue' : paid > 0 ? 'part' : 'due',
      setup,
    };
  }

  // A one-time fee is owed once, in the month it is due.
  const dueMonth = account.dueDate ? account.dueDate.slice(0, 7) : account.serviceStart ? account.serviceStart.slice(0, 7) : null;
  const paidEver = total(mine) + account.openingPaid;
  const balance = Math.max(0, account.agreedAmount - paidEver);
  const credit = Math.max(0, paidEver - account.agreedAmount);
  if (dueMonth === null) {
    return {
      account, charges: 0, paid: round(paidFor), monthUnpaid: 0, earlierUnpaid: 0, collect: 0, credit: round(credit), dueOn: null,
      status: balance > 0 ? 'setup' : 'paid', setup: balance > 0 ? 'Set a due date' : null,
    };
  }
  const charges = dueMonth === month ? account.agreedAmount : 0;
  const monthUnpaid = dueMonth === month ? balance : 0;
  const earlierUnpaid = dueMonth < month ? balance : 0;
  const collect = monthUnpaid + earlierUnpaid;
  return {
    account, charges, paid: round(paidFor + (dueMonth === month ? account.openingPaid : 0)), monthUnpaid: round(monthUnpaid), earlierUnpaid: round(earlierUnpaid), collect: round(collect), credit: round(credit),
    dueOn: dueMonth === month ? (account.dueDate ?? null) : null,
    status: collect <= 0 ? (dueMonth <= month ? 'paid' : 'none') : earlierUnpaid > 0 ? 'overdue' : paidEver > 0 ? 'part' : 'due',
    setup: null,
  };
}

export interface CollectionsTotals {
  /** The monthly fees of the services that run in the review month. */
  monthlyFees: number;
  charges: number;
  paid: number;
  monthUnpaid: number;
  earlierUnpaid: number;
  collect: number;
}

export function collectionsTotals(rows: CollectionRow[]): CollectionsTotals {
  const sum = (pick: (row: CollectionRow) => number): number => round(rows.reduce((acc, row) => acc + pick(row), 0));
  return {
    monthlyFees: sum((row) => (row.account.billingType === 'monthly' ? row.charges : 0)),
    charges: sum((row) => row.charges), paid: sum((row) => row.paid), monthUnpaid: sum((row) => row.monthUnpaid),
    earlierUnpaid: sum((row) => row.earlierUnpaid), collect: sum((row) => row.collect),
  };
}

export interface YearRow {
  account: CrmClientAccount;
  /** What was paid for each month of the year, January first. */
  months: number[];
  /** Everything paid for this year, with what was paid before the records began when the service started this year. */
  totalPaid: number;
  /** What is owed up to and including `through`. */
  amountDue: number;
}

/** One service across a year: the grid of a payments sheet (one column for each month). */
export function yearRow(account: CrmClientAccount, payments: CrmAccountPayment[], year: number, through: MonthKey): YearRow {
  const months = Array.from({ length: 12 }, () => 0);
  for (const payment of payments) {
    if (payment.accountId !== account.id) continue;
    const key = paysFor(payment);
    if (Number(key.slice(0, 4)) === year) months[Number(key.slice(5, 7)) - 1] += payment.amount;
  }
  const startedThisYear = account.serviceStart ? Number(account.serviceStart.slice(0, 4)) === year : false;
  const opening = account.billingType === 'one_time' || startedThisYear || !account.serviceStart ? account.openingPaid : 0;
  return {
    account, months: months.map(round), totalPaid: round(months.reduce((a, b) => a + b, 0) + opening),
    amountDue: collectionRow(account, payments, through).collect,
  };
}
