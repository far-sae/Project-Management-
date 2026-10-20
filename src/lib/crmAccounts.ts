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
