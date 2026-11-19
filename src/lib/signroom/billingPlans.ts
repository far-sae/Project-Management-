/**
 * Billing plans (what a company is expected to pay, month by month) and the
 * accounts overview. The server works out each plan's year; this file only
 * adds those figures up for the screen, filters them and writes export rows.
 * Money is whole minor units, and currencies are never added together.
 *
 * The server calls a billing plan a "client project" (`client-projects`,
 * `projectId`). On screen it is always a billing plan, because a project in
 * this app is a task project.
 */
import { projectPaymentStatus } from '../../../api/_signroom/shared/accounts';
import type { ClientProject, OverviewRow, ProjectYear } from '../../../api/_signroom/shared/types';
import { formatMinor, type Sums } from './billing';

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The years plans and the overview cover. A month can only be changed in the years 2000 to 2099. */
export const PLAN_YEARS = { min: 2000, max: 2099 } as const;
export const OVERVIEW_YEARS = { min: 2000, max: 2099 } as const;

export const PLAN_TYPES: ReadonlyArray<ClientProject['billingType']> = ['Monthly', 'One-off', 'Custom'];
export const PLAN_STATUSES: ReadonlyArray<ClientProject['status']> = ['Active', 'On hold', 'Completed'];

/** "2026-11" for November (month index 10) of 2026. */
export const monthKey = (year: number, monthIndex: number): string => `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

/** "November 2026" for "2026-11" or for any date in that month. */
export const monthLabel = (value: string): string =>
  new Date(`${value.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Nov 2026" for "2026-11". */
export const shortMonth = (value: string): string =>
  `${MONTH_NAMES[Number(value.slice(5, 7)) - 1] ?? ''} ${value.slice(0, 4)}`.trim();

const TYPE_LABEL: Record<ClientProject['billingType'], string> = {
  Monthly: 'Monthly retainer',
  'One-off': 'One-off',
  Custom: 'Custom',
};

/** The words for how a plan bills. A custom plan is called by what was typed for it. */
export const planTypeLabel = (plan: Pick<ClientProject, 'billingType' | 'billingLabel'>): string =>
  (plan.billingType === 'Custom' && plan.billingLabel.trim()) || TYPE_LABEL[plan.billingType];

export const planTypeName = (type: ClientProject['billingType']): string => TYPE_LABEL[type];

const decimal = (minor: number): string => (minor / 100).toFixed(2);

/** An amount as the text an amount box starts with: "500.00". */
export const amountText = decimal;

// ---------------------------------------------------------------- one company's plans

/** `neutral` is a month with nothing expected and nothing paid. */
export type MonthStatus = 'paid' | 'upcoming' | 'overdue' | 'neutral';

/** A month is overdue once it has ended (by the London calendar) with something still to pay. */
export const monthStatus = (plan: ProjectYear, monthIndex: number, year: number, currentMonth: string): MonthStatus =>
  projectPaymentStatus(plan.months[monthIndex] ?? 0, plan.upcomingMonths[monthIndex] ?? 0, year, monthIndex, currentMonth);

export type PaymentFilter = 'all' | Exclude<MonthStatus, 'neutral'>;
export const PAYMENT_FILTERS: ReadonlyArray<PaymentFilter> = ['all', 'paid', 'upcoming', 'overdue'];

/** The word shown for a payment status. */
export const STATUS_WORD: Record<Exclude<MonthStatus, 'neutral'>, string> = {
  paid: 'Paid',
  upcoming: 'To come',
  overdue: 'Overdue',
};

/** Active or archived plans, narrowed by words in the name, the notes or the custom billing words. */
export function filterPlans(plans: ProjectYear[], filter: { archived: boolean; query: string }): ProjectYear[] {
  const query = filter.query.trim().toLowerCase();
  return plans.filter((p) =>
    p.archived === filter.archived && (!query || `${p.name} ${p.notes} ${p.billingLabel}`.toLowerCase().includes(query)));
}

/** Whether any month of the plan has this payment status. */
export const planHasPayment = (plan: ProjectYear, filter: PaymentFilter, year: number, currentMonth: string): boolean =>
  filter === 'all' || plan.months.some((_, m) => monthStatus(plan, m, year, currentMonth) === filter);

export interface PlanTotals {
  /** What the year should bring in. */
  target: Sums;
  /** Receipts on linked invoices plus amounts entered by hand. */
  paid: Sums;
  /** Still to pay in this month and the months ahead. */
  stillToCome: Sums;
  /** Still to pay in months that have ended. */
  overdue: Sums;
  /** The target less what has been paid. */
  leftOfTarget: Sums;
  /** What is still owed on the invoices linked to the plans. */
  unpaidInvoices: Sums;
}

const add = (sums: Sums, currency: string, minor: number): void => { sums[currency] = (sums[currency] ?? 0) + minor; };

/** The year for the plans given, one amount per currency. */
export function planTotals(plans: ProjectYear[], year: number, currentMonth: string): PlanTotals {
  const out: PlanTotals = { target: {}, paid: {}, stillToCome: {}, overdue: {}, leftOfTarget: {}, unpaidInvoices: {} };
  for (const p of plans) {
    let late = 0;
    let ahead = 0;
    p.upcomingMonths.forEach((minor, m) => {
      if (monthKey(year, m) < currentMonth) late += minor;
      else ahead += minor;
    });
    add(out.target, p.currency, p.targetMinor);
    add(out.paid, p.currency, p.receivedMinor);
    add(out.stillToCome, p.currency, ahead);
    add(out.overdue, p.currency, late);
    add(out.leftOfTarget, p.currency, p.remainingTargetMinor);
    add(out.unpaidInvoices, p.currency, p.outstandingMinor);
  }
  return out;
}

export interface MonthTotals { currency: string; paid: number[]; expected: number[] }

/** Paid and expected for each of the twelve months, one line per currency. */
export function monthTotals(plans: ProjectYear[]): MonthTotals[] {
  const byCurrency = new Map<string, MonthTotals>();
  for (const p of plans) {
    let line = byCurrency.get(p.currency);
    if (!line) {
      line = { currency: p.currency, paid: Array.from({ length: 12 }, () => 0), expected: Array.from({ length: 12 }, () => 0) };
      byCurrency.set(p.currency, line);
    }
    for (let m = 0; m < 12; m += 1) {
      line.paid[m]! += p.months[m] ?? 0;
      line.expected[m]! += p.expectedMonths[m] ?? 0;
    }
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * One amount per currency, each ready to show on its own line. A currency at
 * zero is left out while another has an amount; all at zero shows the zeros.
 */
export function sumLines(sums: Sums): string[] {
  const codes = Object.keys(sums).sort();
  const withAmount = codes.filter((code) => sums[code] !== 0);
  return (withAmount.length ? withAmount : codes).map((code) => formatMinor(sums[code] ?? 0, code));
}

// ---------------------------------------------------------------- adding and changing a plan

/** A plan as it is typed. Amounts are decimal text; the server turns them into exact amounts. */
export interface PlanForm {
  name: string;
  billingType: ClientProject['billingType'];
  billingLabel: string;
  currency: string;
  monthlyFee: string;
  contractValue: string;
  annualTarget: string;
  /** YYYY-MM. */
  startMonth: string;
  /** YYYY-MM, or "" for a plan with no end. */
  endMonth: string;
  status: ClientProject['status'];
  notes: string;
}

/** What the server reads when a plan is added. Changing one sends the same with its `revision`. */
export type PlanBody = PlanForm;

/** The form for a plan being changed, or for a new one starting this month in the account's currency. */
export function planForm(plan: ClientProject | null, start: { currency: string; startMonth: string }): PlanForm {
  return {
    name: plan?.name ?? '',
    billingType: plan?.billingType ?? 'Monthly',
    billingLabel: plan?.billingLabel ?? '',
    currency: plan?.currency ?? start.currency,
    monthlyFee: decimal(plan?.monthlyFeeMinor ?? 0),
    contractValue: decimal(plan?.contractValueMinor ?? 0),
    annualTarget: decimal(plan?.annualTargetMinor ?? 0),
    startMonth: plan?.startMonth ?? start.startMonth,
    endMonth: plan?.endMonth ?? '',
    status: plan?.status ?? 'Active',
    notes: plan?.notes ?? '',
  };
}

const amount = (text: string): string => text.trim() || '0';

export function planBody(form: PlanForm): PlanBody {
  return {
    name: form.name.trim(),
    billingType: form.billingType,
    billingLabel: form.billingType === 'Custom' ? form.billingLabel.trim() : '',
    currency: form.currency,
    monthlyFee: amount(form.monthlyFee),
    contractValue: amount(form.contractValue),
    annualTarget: amount(form.annualTarget),
    startMonth: form.startMonth,
    endMonth: form.endMonth,
    status: form.status,
    notes: form.notes,
  };
}

export interface MonthInput { paid: string; expected: string; notes: string }

/** Set what one month expects and what was paid outside any invoice. */
export const monthBody = (month: string, input: MonthInput, revision: number) => ({
  action: 'month' as const, month, paid: amount(input.paid), expected: amount(input.expected), notes: input.notes, revision,
});

/** Put a month back to what the plan itself expects, with nothing entered by hand. */
export const monthResetBody = (month: string, revision: number) => ({
  action: 'month' as const, month, reset: true as const, revision,
});

// ---------------------------------------------------------------- exports

type Cell = string | number;

/** One row per plan, with every month's paid and still-to-pay amounts. */
export function plansCsvRows(plans: ProjectYear[], companyName: string, year: number): Cell[][] {
  return [
    [
      'Plan', 'Company', 'Type', 'Currency', 'Monthly fee', 'Contract value', `Target ${year}`, 'Start month', 'End month',
      ...MONTH_NAMES.flatMap((m) => [`${m} paid`, `${m} still to pay`]),
      `Paid ${year}`, 'Left of target', 'Unpaid invoices', 'Status', 'Notes',
    ],
    ...plans.map((p) => [
      p.name, companyName, planTypeLabel(p), p.currency, decimal(p.monthlyFeeMinor), decimal(p.contractValueMinor),
      decimal(p.targetMinor), p.startMonth, p.endMonth,
      ...p.months.flatMap((paid, m) => [decimal(paid), decimal(p.upcomingMonths[m] ?? 0)]),
      decimal(p.receivedMinor), decimal(p.remainingTargetMinor), decimal(p.outstandingMinor),
      p.archived ? `${p.status} (archived)` : p.status, p.notes,
    ]),
  ];
}

// ---------------------------------------------------------------- accounts overview

export type OverviewSource = OverviewRow['source'];
export type OverviewStatus = 'all' | OverviewRow['status'];
export const OVERVIEW_STATUSES: ReadonlyArray<OverviewStatus> = ['all', 'paid', 'upcoming', 'overdue'];

export interface OverviewFilter {
  /** Plan months or invoices. Never both: a receipt on a linked invoice counts in its plan's month too. */
  source: OverviewSource;
  status: OverviewStatus;
  /** Words in the company name or the plan or invoice. */
  query: string;
  /** Include archived companies and plans. */
  archived: boolean;
}

export function filterOverview(rows: OverviewRow[], filter: OverviewFilter): OverviewRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((r) =>
    r.source === filter.source
    && (filter.archived || !r.archived)
    && (filter.status === 'all' || r.status === filter.status)
    && (!query || `${r.clientName} ${r.reference}`.toLowerCase().includes(query)));
}

export interface OverviewTotals { paid: Sums; stillToCome: Sums; overdue: Sums }

/** Paid, still to come and overdue for the rows given, one amount per currency. */
export function overviewTotals(rows: OverviewRow[]): OverviewTotals {
  const out: OverviewTotals = { paid: {}, stillToCome: {}, overdue: {} };
  for (const r of rows) {
    add(out.paid, r.currency, r.paidMinor);
    add(out.stillToCome, r.currency, r.status === 'upcoming' ? r.remainingMinor : 0);
    add(out.overdue, r.currency, r.status === 'overdue' ? r.remainingMinor : 0);
  }
  return out;
}

export type MonthOrder = 'earliest' | 'latest';

export interface OverviewMonth {
  /** YYYY-MM: a plan's month, or the month an invoice falls due. */
  month: string;
  rows: OverviewRow[];
  paid: Sums;
  remaining: Sums;
}

const byName = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** The rows under their month. Inside a month: by date, then company, then plan or invoice. */
export function groupOverviewByMonth(rows: OverviewRow[], order: MonthOrder): OverviewMonth[] {
  const months = new Map<string, OverviewMonth>();
  for (const r of rows) {
    const key = r.period.slice(0, 7);
    let month = months.get(key);
    if (!month) {
      month = { month: key, rows: [], paid: {}, remaining: {} };
      months.set(key, month);
    }
    month.rows.push(r);
    add(month.paid, r.currency, r.paidMinor);
    add(month.remaining, r.currency, r.remainingMinor);
  }
  const out = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const month of out) {
    month.rows.sort((a, b) =>
      a.period.localeCompare(b.period) || byName(a.clientName, b.clientName) || byName(a.reference, b.reference));
  }
  return order === 'latest' ? out.reverse() : out;
}

export const sourceLabel = (source: OverviewSource): string => (source === 'Invoice' ? 'Invoice' : 'Billing plan');

export function overviewCsvRows(rows: OverviewRow[]): Cell[][] {
  return [
    ['Company', 'Type', 'Plan or invoice', 'Month or due date', 'Currency', 'Paid', 'Still to pay', 'Status', 'Archived'],
    ...rows.map((r) => [
      r.clientName, sourceLabel(r.source), r.reference, r.period, r.currency,
      decimal(r.paidMinor), decimal(r.remainingMinor), STATUS_WORD[r.status], r.archived ? 'Archived' : '',
    ]),
  ];
}
