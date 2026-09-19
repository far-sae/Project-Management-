// Pure helpers for phase 3, the sequence engine. Same contract as the rest of
// src/lib/email: no Node built-ins, no Supabase, no network, no React, so the
// worker and the browser share one definition of each of these.

/**
 * When the step after this one falls due.
 *
 * Measured from when the previous step was actually SENT, never from
 * enrollment: a queue held overnight by the send window would otherwise
 * release three steps within minutes of each other.
 *
 * It takes no send window, deliberately. claim_email_batch() holds a message
 * until the window opens, which is where phase 1 put that rule and where it
 * belongs -- the message waits, the schedule does not move. Applying the
 * window here as well would push this date to the next open hour and the claim
 * would then hold it again, so every step would drift later than the one
 * before and a three-day sequence would take a week.
 */
export function nextDueAt(sentAt: Date, delayHours: number): Date {
  return new Date(sentAt.getTime() + Math.max(delayHours, 0) * 60 * 60 * 1000);
}

/**
 * `In-Reply-To` and `References` for a follow-up, from the ids of the messages
 * already sent in this enrollment, oldest first.
 *
 * Phase 1 gives every message a derived Message-ID of
 * `<{email_messages.id}@{sender domain}>`, so the whole thread is
 * reconstructable from the row ids and nothing has to be stored.
 *
 * Returns an empty object for the first step, which starts the thread, and for
 * an unknown domain -- a malformed In-Reply-To breaks threading more
 * thoroughly than no In-Reply-To at all.
 */
export function threadHeaders(
  previousMessageIds: string[],
  senderDomain: string,
): Record<string, string> {
  if (previousMessageIds.length === 0 || senderDomain.trim() === '') return {};

  const ids = previousMessageIds.map((id) => `<${id}@${senderDomain}>`);
  return {
    'In-Reply-To': ids[ids.length - 1],
    References: ids.join(' '),
  };
}

const ALREADY_A_REPLY = /^\s*re\s*:/i;

/**
 * The subject a follow-up goes out with.
 *
 * A step may carry its own, or leave it blank and inherit the first step's
 * with `Re: ` in front -- which is what a person would do, and what keeps the
 * message in the same conversation: most clients break threading on a fresh
 * subject however correct the References header is.
 */
export function followUpSubject(stepSubject: string, firstSubject: string): string {
  const own = stepSubject.trim();
  if (own !== '') return own;
  return ALREADY_A_REPLY.test(firstSubject) ? firstSubject : `Re: ${firstSubject}`;
}
