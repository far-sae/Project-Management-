import { format, parseISO } from 'date-fns';
import { upcomingLeave, type LeaveLike, type LeaveStatus } from '@/lib/leave';
import type { StatusTone } from '@/components/common/StatusPill';
import type { HrPerson } from '../types';

export const LEAVE_STATUS_TONE: Record<LeaveStatus, StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'muted',
};

/** Shared table classes (the spec's list/table pattern). */
export const TABLE_BOX = 'overflow-hidden rounded-lg border border-border';
export const TABLE_HEAD_ROW = 'h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground';
export const TABLE_ROW = 'h-12 border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2';

/** 28px square icon button in a row (touch-sized on phones). */
export const ROW_ICON_BUTTON = 'w-10 px-0 text-muted-foreground md:w-7';

/** `yyyy-MM-dd` → "17 Nov 2026" (or another date-fns pattern). */
export function formatYmd(ymd: string, pattern = 'd MMM yyyy'): string {
  return format(parseISO(ymd), pattern);
}

/** "17 Nov 2026" for one day, "17 Nov – 19 Nov 2026" for a range. */
export function formatLeaveDates(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatYmd(startDate);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${formatYmd(startDate, sameYear ? 'd MMM' : 'd MMM yyyy')} – ${formatYmd(endDate)}`;
}

/** A day count without floating-point noise: 16.5, not 16.500000000000004. */
export function formatDays(days: number): string {
  return String(Math.round(days * 100) / 100);
}

/** "1 day", "0.5 days", "3 working days". */
export function formatDayCount(days: number, unit = 'day'): string {
  return `${formatDays(days)} ${unit}${days === 1 ? '' : 's'}`;
}

/** Newest start date first; optionally with pending requests on top. */
export function sortLeaveRequests<T extends LeaveLike>(requests: T[], pendingFirst: boolean): T[] {
  return [...requests].sort((a, b) => {
    if (pendingFirst) {
      const rank = Number(b.status === 'pending') - Number(a.status === 'pending');
      if (rank !== 0) return rank;
    }
    return b.startDate.localeCompare(a.startDate);
  });
}

/** This year plus every year that has leave or a public holiday, newest first. */
export function leaveYears(
  requests: Pick<LeaveLike, 'startDate'>[],
  holidays: { date: string }[],
  currentYear: number,
): number[] {
  const years = new Set<number>([currentYear]);
  for (const r of requests) years.add(Number(r.startDate.slice(0, 4)));
  for (const h of holidays) years.add(Number(h.date.slice(0, 4)));
  return [...years].filter(Number.isFinite).sort((a, b) => b - a);
}

export interface LeaveFigures {
  pending: number;
  /** People with approved leave that covers today. */
  onLeaveToday: number;
  /** People with approved leave running today or starting in the next 14 days. */
  offNext14Days: number;
  holidaysThisYear: number;
}

/** The headline numbers at the top of the Leave tab. */
export function leaveFigures(requests: LeaveLike[], holidays: { date: string }[], today: string): LeaveFigures {
  const soon = upcomingLeave(requests, today, 14);
  const year = today.slice(0, 4);
  return {
    pending: requests.filter((r) => r.status === 'pending').length,
    onLeaveToday: new Set(soon.filter((r) => r.startDate <= today).map((r) => r.userId)).size,
    offNext14Days: new Set(soon.map((r) => r.userId)).size,
    holidaysThisYear: holidays.filter((h) => h.date.startsWith(year)).length,
  };
}

/** The message of a failed save; Supabase errors are plain objects, not `Error`s. */
export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/** The name to show for a person; requests can outlive their owner's membership. */
export function personName(person: HrPerson | undefined): string {
  if (!person) return 'Former member';
  return person.displayName.trim() || person.email || 'Member';
}
