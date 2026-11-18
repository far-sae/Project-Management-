/**
 * HR leave rules. Dates are plain `yyyy-MM-dd` strings (the database `date`
 * type), so nothing here depends on the time zone of whoever is looking.
 */

export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'other';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  unpaid: 'Unpaid leave',
  other: 'Other',
};

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** The parts of a leave request the rules need. */
export interface LeaveLike {
  id: string;
  userId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  status: LeaveStatus;
}

export interface LeaveBalance {
  entitled: number;
  /** Approved days. */
  used: number;
  /** Asked for, not decided yet. */
  pending: number;
  remaining: number;
}

const DAY = 86_400_000;

/** Parse `yyyy-MM-dd` as a UTC day number so DST never shifts a date. */
function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY);
}

function ymdOf(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/** Add days to a `yyyy-MM-dd` date. */
export function addDaysYmd(ymd: string, days: number): string {
  return ymdOf(dayNumber(ymd) + days);
}

/** Today's date as `yyyy-MM-dd` in the viewer's own time zone. */
export function todayYmd(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * Working days a request uses: Monday to Friday, minus public holidays.
 * A single day can be taken as a half.
 */
export function countLeaveDays(
  startDate: string,
  endDate: string,
  holidays: string[] = [],
  halfDay = false,
): number {
  const start = dayNumber(startDate);
  const end = dayNumber(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  const off = new Set(holidays);
  let days = 0;
  for (let d = start; d <= end; d++) {
    const weekday = new Date(d * DAY).getUTCDay(); // 0 Sun … 6 Sat
    if (weekday === 0 || weekday === 6) continue;
    if (off.has(ymdOf(d))) continue;
    days += 1;
  }
  return halfDay && start === end && days === 1 ? 0.5 : days;
}

/** What is left of one person's yearly allowance for one leave type. */
export function leaveBalance(
  requests: LeaveLike[],
  userId: string,
  leaveType: LeaveType,
  year: number,
  entitled: number,
): LeaveBalance {
  let used = 0;
  let pending = 0;
  for (const r of requests) {
    if (r.userId !== userId || r.leaveType !== leaveType) continue;
    if (Number(r.startDate.slice(0, 4)) !== year) continue;
    if (r.status === 'approved') used += r.days;
    else if (r.status === 'pending') pending += r.days;
  }
  return { entitled, used, pending, remaining: entitled - used };
}

/** The approved leave that covers `date` for this person, if any. */
export function leaveOnDate<T extends LeaveLike>(requests: T[], userId: string, date: string): T | undefined {
  return requests.find(
    (r) => r.userId === userId && r.status === 'approved' && r.startDate <= date && r.endDate >= date,
  );
}

/** An approved or pending request of the same person that clashes with these dates. */
export function findOverlap<T extends LeaveLike>(
  requests: T[],
  userId: string,
  startDate: string,
  endDate: string,
  ignoreId?: string,
): T | undefined {
  return requests.find(
    (r) =>
      r.userId === userId &&
      r.id !== ignoreId &&
      (r.status === 'approved' || r.status === 'pending') &&
      r.startDate <= endDate &&
      r.endDate >= startDate,
  );
}

/** Approved leave that is running on `from` or starts within `days` days, soonest first. */
export function upcomingLeave<T extends LeaveLike>(requests: T[], from: string, days: number): T[] {
  const until = addDaysYmd(from, days);
  return requests
    .filter((r) => r.status === 'approved' && r.endDate >= from && r.startDate <= until)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
