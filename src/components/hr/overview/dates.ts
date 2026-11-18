import { format } from 'date-fns';

/**
 * Small helpers for plain `yyyy-MM-dd` dates (the database `date` type), so
 * nothing here shifts with the viewer's time zone.
 */

const DAY = 86_400_000;

function parts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m || 1, d || 1];
}

function dayNumber(ymd: string): number {
  const [y, m, d] = parts(ymd);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetweenYmd(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The calendar day a stored date falls on (dates are saved as UTC midnight). */
export function dateToYmd(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** "12 Nov", "12 Nov 2026" or "Thu 12 Nov". */
export function formatYmd(ymd: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const [y, m, d] = parts(ymd);
  const pattern = `${opts.weekday ? 'EEE ' : ''}d MMM${opts.year ? ' yyyy' : ''}`;
  return format(new Date(y, m - 1, d), pattern);
}

/**
 * "18 Nov" for one day, "18 Nov – 20 Nov" for several. The year is added when
 * the dates are in different years, or not in `currentYear` when that is given.
 */
export function formatYmdRange(start: string, end: string, currentYear?: number): string {
  const startYear = parts(start)[0];
  const endYear = parts(end)[0];
  const year = startYear !== endYear || (currentYear !== undefined && startYear !== currentYear);
  if (start === end) return formatYmd(start, { year });
  return `${formatYmd(start, { year })} – ${formatYmd(end, { year })}`;
}
