import type { TimeEntry } from '@/services/supabase/timeEntries';

export type AttendanceStatus = 'on_clock' | 'out' | 'auto_out' | 'absent';

export interface AttendancePerson {
  userId: string;
  name: string;
  photoURL?: string;
}

export interface AttendanceRow extends AttendancePerson {
  status: AttendanceStatus;
  /** First clock-in on the day. */
  firstIn: Date | null;
  /** Last clock-out on the day (null while still on the clock). */
  lastOut: Date | null;
  /** Hours worked on the day (open shifts counted up to now). */
  daySeconds: number;
  /** Hours worked in the Monday–Sunday week containing the day. */
  weekSeconds: number;
  sessions: number;
}

const DAY_MS = 86_400_000;

/**
 * A shift nobody clocked out of is closed for them after this many hours
 * (the database job of migration 218 uses the same number). Until then the
 * clock keeps running: closing the tab or the laptop does not stop it.
 */
export const STALE_SHIFT_HOURS = 24;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfLocalWeek(d: Date): Date {
  const start = startOfLocalDay(d);
  const offset = (start.getDay() + 6) % 7; // Monday = 0
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() - offset);
}

/** When the shift ended, or now while it is still running. */
const endOf = (e: TimeEntry, now: Date): number => (e.clockedOutAt ?? now).getTime();

/** The seconds of a shift that fall between `from` and `to`. */
function secondsWithin(e: TimeEntry, from: number, to: number, now: Date): number {
  const start = Math.max(e.clockedInAt.getTime(), from);
  const end = Math.min(endOf(e, now), to);
  return Math.max(0, Math.round((end - start) / 1000));
}

/**
 * True when the shift belongs to the time between `from` and `to`: it started
 * there, or it started before and was still running after `from`. A shift
 * that ended exactly at `from` (midnight) does not belong to the next day.
 */
function touches(e: TimeEntry, from: number, to: number, now: Date): boolean {
  const start = e.clockedInAt.getTime();
  if (start >= to) return false;
  return start >= from || endOf(e, now) > from;
}

const ORDER: Record<AttendanceStatus, number> = { on_clock: 0, auto_out: 1, out: 1, absent: 2 };

/**
 * One row per teammate for `day` (local time): status, first clock-in, last
 * clock-out, hours that day and hours that week.
 *
 * A shift may go over midnight (a night shift, or one nobody clocked out of).
 * It is listed on every day it touches, and each day and each week gets only
 * its own part of the hours, so nobody on the clock at 02:00 shows as absent.
 */
export function buildAttendance(
  entries: TimeEntry[],
  people: AttendancePerson[],
  day: Date,
  now: Date,
): AttendanceRow[] {
  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = dayStart + DAY_MS;
  const weekStart = startOfLocalWeek(day).getTime();
  const weekEnd = weekStart + 7 * DAY_MS;

  const byUser = new Map<string, AttendancePerson>();
  for (const p of people) byUser.set(p.userId, p);
  for (const e of entries) {
    if (!byUser.has(e.userId) && touches(e, weekStart, weekEnd, now)) {
      byUser.set(e.userId, { userId: e.userId, name: e.userName?.trim() || 'Unknown member' });
    }
  }

  const rows: AttendanceRow[] = [];
  for (const person of byUser.values()) {
    const mine = entries.filter((e) => e.userId === person.userId);
    const today = mine
      .filter((e) => touches(e, dayStart, dayEnd, now))
      .sort((a, b) => a.clockedInAt.getTime() - b.clockedInAt.getTime());
    const week = mine.filter((e) => touches(e, weekStart, weekEnd, now));

    const open = today.some((e) => !e.clockedOutAt);
    const lastOut = open
      ? null
      : today.reduce<Date | null>(
          (latest, e) => (e.clockedOutAt && (!latest || e.clockedOutAt > latest) ? e.clockedOutAt : latest),
          null,
        );
    const status: AttendanceStatus =
      today.length === 0
        ? 'absent'
        : open
          ? 'on_clock'
          : // Said on the day the shift was closed for them, not on the day it started.
            today.some((e) => e.autoClosed && e.clockedOutAt !== null && e.clockedOutAt !== undefined && e.clockedOutAt.getTime() <= dayEnd)
            ? 'auto_out'
            : 'out';

    rows.push({
      ...person,
      status,
      firstIn: today[0]?.clockedInAt ?? null,
      lastOut,
      daySeconds: today.reduce((sum, e) => sum + secondsWithin(e, dayStart, dayEnd, now), 0),
      weekSeconds: week.reduce((sum, e) => sum + secondsWithin(e, weekStart, weekEnd, now), 0),
      sessions: today.length,
    });
  }

  return rows.sort((a, b) => {
    const o = ORDER[a.status] - ORDER[b.status];
    if (o !== 0) return o;
    if (a.firstIn && b.firstIn) return a.firstIn.getTime() - b.firstIn.getTime();
    return a.name.localeCompare(b.name);
  });
}

export function summarizeAttendance(rows: AttendanceRow[]) {
  return {
    teamSize: rows.length,
    onClock: rows.filter((r) => r.status === 'on_clock').length,
    clockedIn: rows.filter((r) => r.status !== 'absent').length,
    totalSeconds: rows.reduce((sum, r) => sum + r.daySeconds, 0),
  };
}
