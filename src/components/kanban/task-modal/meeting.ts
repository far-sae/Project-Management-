/**
 * Pure helpers for the TaskCalendar meeting attached to a task.
 * No React / DOM here so they can be unit-tested directly.
 */

export const MEETING_DURATIONS = [15, 30, 45, 60, 90] as const;
export const DEFAULT_MEETING_DURATION = 30;
/** "Starting soon" window before the start time. */
export const MEETING_SOON_WINDOW_MS = 15 * 60 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type MeetingStatusKind = 'upcoming' | 'soon' | 'live' | 'ended';

export interface MeetingStatus {
  kind: MeetingStatusKind;
  label: string;
}

const effectiveDuration = (durationMinutes: number | null | undefined): number =>
  typeof durationMinutes === 'number' && durationMinutes > 0
    ? durationMinutes
    : DEFAULT_MEETING_DURATION;

/**
 * Status chip for a meeting relative to `now`:
 *  - "Ended"          now >= start + duration
 *  - "Live now"       start <= now < start + duration
 *  - "Starting soon"  start - 15 min <= now < start
 *  - "In 40 min" / "In 2 h" / "In 3 days" otherwise
 */
export function getMeetingStatus(
  startsAt: Date,
  durationMinutes: number | null | undefined,
  now: Date,
): MeetingStatus {
  const start = startsAt.getTime();
  const end = start + effectiveDuration(durationMinutes) * MINUTE;
  const t = now.getTime();

  if (t >= end) return { kind: 'ended', label: 'Ended' };
  if (t >= start) return { kind: 'live', label: 'Live now' };

  const diff = start - t;
  if (diff <= MEETING_SOON_WINDOW_MS) return { kind: 'soon', label: 'Starting soon' };
  if (diff < HOUR) return { kind: 'upcoming', label: `In ${Math.round(diff / MINUTE)} min` };
  if (diff < DAY) {
    const hours = Math.max(1, Math.round(diff / HOUR));
    // 23.6 h rounds to 24 h — say "In 1 day" rather than "In 24 h".
    if (hours < 24) return { kind: 'upcoming', label: `In ${hours} h` };
  }
  const days = Math.max(1, Math.round(diff / DAY));
  return { kind: 'upcoming', label: days === 1 ? 'In 1 day' : `In ${days} days` };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "HH:MM" in local time — the value format of `<input type="time">`. */
export function toTimeInputValue(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "30 min", "1 h", "1 h 30 min". */
export function formatMeetingDuration(durationMinutes: number | null | undefined): string {
  const total = effectiveDuration(durationMinutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/**
 * "Fri 13 Nov · 15:00 · 30 min" in local time. Adds the year when the meeting
 * is not in the same calendar year as `now`.
 */
export function formatMeetingSummary(
  startsAt: Date,
  durationMinutes: number | null | undefined,
  now: Date = new Date(),
): string {
  const weekday = startsAt.toLocaleDateString('en-GB', { weekday: 'short' });
  const month = startsAt.toLocaleDateString('en-GB', { month: 'short' });
  const year = startsAt.getFullYear() !== now.getFullYear() ? ` ${startsAt.getFullYear()}` : '';
  const day = `${weekday} ${startsAt.getDate()} ${month}${year}`;
  return `${day} · ${toTimeInputValue(startsAt)} · ${formatMeetingDuration(durationMinutes)}`;
}

/** The next full hour after `now` (14:00 → 15:00, 14:20 → 15:00). */
export function nextFullHour(now: Date): Date {
  const d = new Date(now);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

/** Returns a copy of `day` with the local time set from "HH:MM", or null if invalid. */
export function withTime(day: Date, hhmm: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Moves `start` to the calendar day of `day`, keeping its local time. */
export function withDay(start: Date, day: Date): Date {
  const d = new Date(start);
  d.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
  return d;
}

/** Normalises a stored value (Date / ISO string / null) to a valid Date or null. */
export function toMeetingDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Why "Join meeting" is disabled, or null when it can be used. Order matters:
 * the first matching reason is the one shown in the tooltip.
 */
export function getJoinDisabledReason(opts: {
  isSaved: boolean;
  inCall: boolean;
  isViewer: boolean;
  mediaSupported: boolean;
}): string | null {
  if (!opts.isSaved) return 'Create the task first to join its meeting.';
  if (opts.isViewer) return 'View-only — calls are disabled for your role.';
  if (opts.inCall) return 'You are already in a call. Leave it to join this meeting.';
  if (!opts.mediaSupported) return "This browser can't access a camera or microphone.";
  return null;
}
