/**
 * Which open deals need attention: nothing has happened on them for a while,
 * or the date they were expected to close has passed. Pure functions only.
 *
 * "Nothing has happened" means no change to the deal and nothing logged on it
 * (a note, a call, an email, a meeting, a move, a signed agreement). A deal
 * that is won or lost is finished and is never flagged.
 */

/** An open deal with nothing on it for this many days is flagged. */
export const IDLE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DealHealth {
  /** Whole days since anything happened on the deal. */
  idleDays: number;
  idle: boolean;
  closeDatePassed: boolean;
  /** Either of the two. */
  attention: boolean;
  /** What to show on the deal, or null when nothing is wrong. */
  label: string | null;
}

const FINE: DealHealth = { idleDays: 0, idle: false, closeDatePassed: false, attention: false, label: null };

export function dealHealth(
  deal: { status: string; updatedAt: Date; expectedCloseDate: string | null },
  lastActivityAt: Date | null | undefined,
  now: Date,
): DealHealth {
  if (deal.status !== 'open') return FINE;
  const last = Math.max(deal.updatedAt.getTime(), lastActivityAt ? lastActivityAt.getTime() : 0);
  const idleDays = Math.max(0, Math.floor((now.getTime() - last) / DAY_MS));
  const idle = idleDays >= IDLE_DAYS;
  // A close date is a day, not a moment: it has passed once that whole day is over.
  const closeDay = deal.expectedCloseDate ? new Date(`${deal.expectedCloseDate.slice(0, 10)}T23:59:59.999`) : null;
  const closeDatePassed = closeDay !== null && !Number.isNaN(closeDay.getTime()) && closeDay.getTime() < now.getTime();
  const label = closeDatePassed
    ? idle ? `Close date passed, no activity for ${idleDays} days` : 'Close date passed'
    : idle ? `No activity for ${idleDays} days` : null;
  return { idleDays, idle, closeDatePassed, attention: idle || closeDatePassed, label };
}
