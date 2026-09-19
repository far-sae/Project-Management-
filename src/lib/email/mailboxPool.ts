// Pure mailbox-pool selection logic. No React, no Supabase, no network — the
// worker calls this with freshly loaded health rows and sends whatever comes
// back.

import type { MailboxHealth } from './types';

/** A mailbox this many sends in a row failed is taken out of rotation until someone looks at it. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** The most a single mailbox contributes to one pass, so a big daily limit on one mailbox cannot starve the rest of the pool. */
export const PER_MAILBOX_SLICE = 10;

/** How many more messages this mailbox may send today, never negative. */
export function remainingToday(m: MailboxHealth): number {
  return Math.max(0, m.effectiveLimit - m.sentToday);
}

/**
 * Whether a mailbox is in the pool at all: active, unpaused, credentials
 * verified, and under the failure ceiling. Nothing but today's allowance
 * stands between a usable mailbox and sending, and that comes back by itself
 * at midnight.
 *
 * Separate from `isSendable` because the two questions have different
 * answers at different times of day. "Can this campaign ever go out?" is this
 * one: a pool whose every mailbox is paused or needs re-verifying will not
 * send tomorrow either, and queueing into it is queueing into nothing.
 */
export function isUsable(m: MailboxHealth): boolean {
  if (!m.isActive) return false;
  if (m.pausedReason !== null) return false;
  if (m.status !== 'active') return false;
  if (m.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return false;
  return true;
}

/** Whether a mailbox can take on more sends right now: usable, and with allowance left today. */
export function isSendable(m: MailboxHealth): boolean {
  return isUsable(m) && remainingToday(m) > 0;
}

function byLeastRecentlyUsed(a: MailboxHealth, b: MailboxHealth): number {
  // Mailboxes that have never sent are the most overdue, so null sorts before
  // any date.
  const at = a.lastSentAt ? a.lastSentAt.getTime() : -Infinity;
  const bt = b.lastSentAt ? b.lastSentAt.getTime() : -Infinity;
  return at - bt;
}

/**
 * Spreads a send budget across the sendable mailboxes, least-recently-used
 * first, capping each at its own remaining allowance and at
 * `PER_MAILBOX_SLICE`, and stopping once the budget is exhausted. A mailbox
 * that would contribute nothing is left out of the result entirely.
 */
export function selectMailboxes(
  pool: MailboxHealth[],
  budget: number,
): Array<{ mailbox: MailboxHealth; take: number }> {
  const ordered = pool.filter(isSendable).sort(byLeastRecentlyUsed);

  const out: Array<{ mailbox: MailboxHealth; take: number }> = [];
  let remainingBudget = budget;

  for (const mailbox of ordered) {
    if (remainingBudget <= 0) break;

    const take = Math.min(remainingBudget, remainingToday(mailbox), PER_MAILBOX_SLICE);
    if (take <= 0) continue;

    out.push({ mailbox, take });
    remainingBudget -= take;
  }

  return out;
}

/**
 * Explains why nothing can be sent, in decreasing order of specificity, or
 * `null` if at least one mailbox is sendable.
 */
export function blockedReason(pool: MailboxHealth[]): string | null {
  if (pool.some(isSendable)) return null;

  if (pool.length === 0) {
    return 'No mailboxes are configured for this organisation.';
  }
  if (pool.every((m) => m.pausedReason !== null)) {
    return 'Every mailbox is paused.';
  }
  if (pool.every((m) => remainingToday(m) === 0)) {
    return 'Every mailbox has used up its daily sending allowance.';
  }
  return 'No mailbox is currently able to send.';
}
