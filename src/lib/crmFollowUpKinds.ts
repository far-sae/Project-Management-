/**
 * What kind of thing a follow-up is, and follow-ups that come back by
 * themselves. Pure functions only.
 */

export const FOLLOW_UP_KINDS = ['todo', 'call', 'email', 'meeting'] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export const FOLLOW_UP_KIND_LABEL: Record<FollowUpKind, string> = {
  todo: 'To-do',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
};

export const FOLLOW_UP_REPEATS = ['daily', 'weekly', 'monthly'] as const;
export type FollowUpRepeat = (typeof FOLLOW_UP_REPEATS)[number];

export const FOLLOW_UP_REPEAT_LABEL: Record<FollowUpRepeat, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

export const isFollowUpKind = (value: unknown): value is FollowUpKind =>
  typeof value === 'string' && (FOLLOW_UP_KINDS as readonly string[]).includes(value);

export const isFollowUpRepeat = (value: unknown): value is FollowUpRepeat =>
  typeof value === 'string' && (FOLLOW_UP_REPEATS as readonly string[]).includes(value);

const daysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate();

/** One step on from `from`. `anchorDay` is the day of the month a monthly follow-up belongs to. */
function step(from: Date, repeat: FollowUpRepeat, anchorDay: number): Date {
  const next = new Date(from);
  if (repeat === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (repeat === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else {
    // The 31st has no place in a 30-day month: use the last day there, and the 31st again after it.
    const month = from.getMonth() + 1;
    const year = from.getFullYear() + Math.floor(month / 12);
    next.setFullYear(year, month % 12, Math.min(anchorDay, daysInMonth(year, month % 12)));
  }
  return next;
}

/**
 * When the next one is due, after a repeating follow-up is done. It moves on
 * from the date the follow-up was due (from now when it had none), at least one
 * step, and on again until it lies in the future: a weekly follow-up done three
 * weeks late does not come back already overdue.
 */
export function nextDueDate(due: Date | null, repeat: FollowUpRepeat, now: Date): Date {
  let next = new Date(due ?? now);
  const anchorDay = next.getDate();
  do {
    next = step(next, repeat, anchorDay);
  } while (next.getTime() <= now.getTime());
  return next;
}

/** A follow-up is mine when it is given to me, or when I made it and it is given to nobody. */
export function isMine(task: { assignedTo: string | null; ownerId: string | null }, userId: string): boolean {
  return task.assignedTo ? task.assignedTo === userId : task.ownerId === userId;
}
