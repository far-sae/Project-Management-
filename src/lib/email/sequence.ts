// Pure helpers for phase 3, the sequence engine. Same contract as the rest of
// src/lib/email: no Node built-ins, no Supabase, no network, no React, so the
// worker and the browser share one definition of each of these.

// What is NOT here: nextDueAt().
//
// The schedule is computed in SQL, by record_send_result() (migration 159c),
// because that is the one place a message becomes 'sent' and the delay runs
// from the actual send rather than from enrollment. A TypeScript copy of that
// arithmetic had no caller and two places to disagree about when a follow-up
// is due, so it is gone rather than kept "for completeness".


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
