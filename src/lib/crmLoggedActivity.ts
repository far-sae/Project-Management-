/**
 * Logging something by hand on a lead: when it happened and, for a call, how
 * it went. Pure functions only.
 */
import { OUTCOME_LABEL, type CallOutcome } from '../../api/_voice/shared/types';

/** A date as a `datetime-local` input wants it, in the person's own time zone: "2026-11-21T09:30". */
export function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * When a hand-logged activity happened, from the form's value. An empty or
 * unreadable value, or a time in the future, means "now": nothing can have
 * happened yet tomorrow, and a wrong date on the timeline is worse than none.
 */
export function occurredAtFrom(value: string, now: Date): Date {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime()) return now;
  return parsed;
}

/**
 * What goes on the timeline. A call starts with how it went ("No answer.",
 * "Spoke to them."), in the same words the dialler uses, so a call typed in
 * by hand and a call placed from the CRM read alike, and the automation can
 * tell a call nobody answered from a conversation.
 */
export function loggedDescription(type: string, outcome: CallOutcome | null, text: string): string {
  const said = text.trim();
  if (type !== 'call' || !outcome) return said;
  const how = `${OUTCOME_LABEL[outcome]}.`;
  return said ? `${how} ${said}` : how;
}
