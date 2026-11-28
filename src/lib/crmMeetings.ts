// Small sums for meetings with a lead: when the planner starts, how a start
// is written, and whether a meeting can still be joined.

const two = (n: number): string => String(n).padStart(2, '0');

/** A date as a date-and-time box writes it, in the person's own time: "2026-12-02T15:00". */
export const toLocalInput = (date: Date): string =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;

/** What the planner opens on: tomorrow at 10:00. */
export function defaultStart(now: Date): string {
  return toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0));
}

/** The moment a date-and-time box holds, or null while it is empty or half typed. */
export function startOf(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed 2 Dec 2026, 15:00", in the reader's own time. */
export const whenLabel = (date: Date): string =>
  `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${two(date.getHours())}:${two(date.getMinutes())}`;

export type MeetingState = 'upcoming' | 'now' | 'over';

const MINUTE = 60_000;
/** The guest's link works for a day after the start (see supabase/functions/_shared/callInvite.ts). */
const LINK_LASTS_MS = 24 * 60 * MINUTE;

/**
 * 'now' from a quarter of an hour before the start until the meeting's length
 * has passed; 'over' once the guest's link no longer works; otherwise
 * 'upcoming' (which includes a meeting that ended today: its link still opens).
 */
export function meetingState(meeting: { startsAt: Date; durationMinutes: number }, now: Date): MeetingState {
  const start = meeting.startsAt.getTime();
  const at = now.getTime();
  if (at >= start + LINK_LASTS_MS) return 'over';
  if (at >= start - 15 * MINUTE && at <= start + meeting.durationMinutes * MINUTE) return 'now';
  return 'upcoming';
}

export const MEETING_LENGTHS = [15, 30, 45, 60, 90, 120];
