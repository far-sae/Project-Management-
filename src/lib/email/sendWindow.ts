// Pure send-window logic. No React, no Node-only APIs — only `Intl`, so this
// runs unmodified in the worker, in Vercel functions and in the browser.

import type { SendWindow } from './types';

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The largest pause between messages anyone may configure, in milliseconds.
 *
 * The pause is what paces a batch, and the window is what bounds it: at five
 * minutes a batch of fifty already runs over four hours, which is most of an
 * ordinary working day, and anything past that would simply push the tail of
 * every batch out beyond the window's end — where it waits until tomorrow. A
 * value typed with one zero too many should be refused, not obeyed.
 *
 * Mirrored by `email_settings_jitter_ceiling_check` in migration 156, so a
 * value that gets past the screen is still refused by the database.
 */
export const MAX_JITTER_MS = 300_000;

/**
 * Reads the hour and ISO weekday (1 = Monday … 7 = Sunday) of `date` *in the
 * given IANA timezone*, via `Intl.DateTimeFormat`. Using `Date` getters
 * (`getHours`, `getDay`) would evaluate the window in the host's own
 * timezone, which is wrong for every user who is not in that same zone —
 * `Intl` is the only standard way to project a UTC instant into an arbitrary
 * timezone's civil time.
 */
function localHourAndWeekday(date: Date, timeZone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);

  let hourStr = '';
  let weekdayStr = '';
  for (const part of parts) {
    if (part.type === 'hour') hourStr = part.value;
    if (part.type === 'weekday') weekdayStr = part.value;
  }

  let hour = Number(hourStr);
  // Some ICU builds render midnight as "24" rather than "0" under
  // hour12: false. Normalise so hour is always 0-23.
  if (hour === 24) hour = 0;

  const weekday = WEEKDAY_TO_ISO[weekdayStr];
  if (weekday === undefined) {
    throw new Error(`Could not determine weekday for timezone "${timeZone}"`);
  }

  return { hour, weekday };
}

/** True when `now` (default: the current instant) falls inside the window, evaluated in the window's own timezone. A disabled window never blocks sending. */
export function isWithinSendWindow(w: SendWindow, now: Date = new Date()): boolean {
  if (!w.enabled) return true;

  const { hour, weekday } = localHourAndWeekday(now, w.timezone);

  if (!w.days.includes(weekday)) return false;
  return hour >= w.startHour && hour < w.endHour;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** A human-readable sentence naming the hours, days and timezone — used in settings UI and blocked-send explanations. */
export function describeSendWindow(w: SendWindow): string {
  if (!w.enabled) return 'Sending is not restricted to a time window.';

  const days = w.days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DAY_NAMES[d - 1] ?? String(d))
    .join(', ');

  return `Sends between ${pad2(w.startHour)}:00 and ${pad2(w.endHour)}:00, ${days} (${w.timezone}).`;
}
