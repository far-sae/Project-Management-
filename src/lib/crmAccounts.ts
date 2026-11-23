import type { CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

export interface AccountYearSummary {
  due: number;
  paid: number;
  outstanding: number;
  monthlyPaid: number[];
}

const inSelectedYear = (iso: string, year: number) => Number(iso.slice(0, 4)) === year;

export const activeMonthsInYear = (
  year: number,
  start: string | null,
  end: string | null,
): number => {
  const first = start ? new Date(`${start}T00:00:00Z`) : new Date(Date.UTC(year, 0, 1));
  const last = end ? new Date(`${end}T00:00:00Z`) : new Date(Date.UTC(year, 11, 31));
  const from = Math.max(0, first.getUTCFullYear() === year ? first.getUTCMonth() : first < new Date(Date.UTC(year, 0, 1)) ? 0 : 12);
  const to = Math.min(11, last.getUTCFullYear() === year ? last.getUTCMonth() : last > new Date(Date.UTC(year, 11, 31)) ? 11 : -1);
  return to < from ? 0 : to - from + 1;
};

export const summarizeClientAccount = (
  account: CrmClientAccount,
  payments: CrmAccountPayment[],
  year: number,
): AccountYearSummary => {
  const monthlyPaid = Array.from({ length: 12 }, () => 0);
  for (const payment of payments) {
    if (payment.accountId !== account.id || !inSelectedYear(payment.paidOn, year)) continue;
    const month = Number(payment.paidOn.slice(5, 7)) - 1;
    if (month >= 0 && month < 12) monthlyPaid[month] += payment.amount;
  }
  const yearPaid = monthlyPaid.reduce((sum, amount) => sum + amount, 0);
  const allTimePaid = payments
    .filter((payment) => payment.accountId === account.id)
    .reduce((sum, payment) => sum + payment.amount, 0);
  const opening = account.serviceStart && Number(account.serviceStart.slice(0, 4)) === year
    ? account.openingPaid
    : 0;
  const paid = account.billingType === 'one_time'
    ? allTimePaid + account.openingPaid
    : yearPaid + opening;
  const due = account.billingType === 'monthly'
    ? account.agreedAmount * activeMonthsInYear(year, account.serviceStart, account.serviceEnd)
    : account.agreedAmount;
  return { due, paid, outstanding: Math.max(0, due - paid), monthlyPaid };
};

/** The time the Accounts tab is showing: a whole year, one month of it (0–11), or one day of that month. */
export interface AccountPeriod {
  year: number;
  month: number | null;
  day: number | null;
}

/** What one service comes to in a period. On a single day nothing is "due", so only what was paid is given. */
export interface AccountPeriodSummary {
  due: number | null;
  paid: number;
  outstanding: number | null;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** "2026", "March 2026" or "10 March 2026". */
export const periodLabel = (period: AccountPeriod): string => {
  if (period.month === null) return String(period.year);
  const month = `${MONTH_NAMES[period.month]} ${period.year}`;
  return period.day === null ? month : `${period.day} ${month}`;
};

/** Whether a payment dated `paidOn` (YYYY-MM-DD) falls in the period. */
export const paymentInPeriod = (paidOn: string, period: AccountPeriod): boolean => {
  if (Number(paidOn.slice(0, 4)) !== period.year) return false;
  if (period.month === null) return true;
  if (Number(paidOn.slice(5, 7)) - 1 !== period.month) return false;
  return period.day === null || Number(paidOn.slice(8, 10)) === period.day;
};

const sum = (payments: CrmAccountPayment[]): number => payments.reduce((total, payment) => total + payment.amount, 0);

/**
 * One service in a year, a month or a day.
 *  - A year: the same answer as summarizeClientAccount.
 *  - A month: a monthly service is due its monthly amount while it runs; a
 *    one-time agreement is due whatever was still owed when the month began.
 *  - A day: only what was paid that day.
 */
export const summarizeAccountPeriod = (
  account: CrmClientAccount,
  payments: CrmAccountPayment[],
  period: AccountPeriod,
): AccountPeriodSummary => {
  if (period.month === null) {
    const { due, paid, outstanding } = summarizeClientAccount(account, payments, period.year);
    return { due, paid, outstanding };
  }
  const mine = payments.filter((payment) => payment.accountId === account.id);
  const paidIn = sum(mine.filter((payment) => paymentInPeriod(payment.paidOn, period)));
  if (period.day !== null) return { due: null, paid: paidIn, outstanding: null };

  const key = `${period.year}-${String(period.month + 1).padStart(2, '0')}`;
  const startKey = account.serviceStart ? account.serviceStart.slice(0, 7) : null;
  const endKey = account.serviceEnd ? account.serviceEnd.slice(0, 7) : null;
  const started = startKey === null || startKey <= key;
  if (account.billingType === 'monthly') {
    const running = started && (endKey === null || endKey >= key);
    const due = running ? account.agreedAmount : 0;
    const paid = paidIn + (startKey === key ? account.openingPaid : 0);
    return { due, paid, outstanding: Math.max(0, due - paid) };
  }
  const paidBefore = sum(mine.filter((payment) => payment.paidOn.slice(0, 7) < key));
  const due = started ? Math.max(0, account.agreedAmount - account.openingPaid - paidBefore) : 0;
  return { due, paid: paidIn, outstanding: Math.max(0, due - paidIn) };
};
