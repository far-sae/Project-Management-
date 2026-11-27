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
 * The one mailbox a campaign sent from "any mailbox" is given when it starts.
 *
 * The database chooses it (migration 168, email_pin_workspace_mailbox): of the
 * workspace's mailboxes that are active, the one used least recently, and one
 * that has never sent before any that has. From then on the whole campaign
 * goes from that mailbox. This is the screen's reading of the same rule, so it
 * can name the mailbox instead of promising a rotation that does not happen.
 * It is a forecast: another campaign may start in between.
 */
export function likelyPooledMailbox(pool: MailboxHealth[]): MailboxHealth | null {
  const active = pool.filter((m) => m.status === 'active' && m.isActive);
  return active.length > 0 ? [...active].sort(byLeastRecentlyUsed)[0] : null;
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

/**
 * What "all mailboxes" means for a campaign, in one sentence for the compose
 * screen. `takesTurns` is whether this database shares a campaign out over the
 * mailboxes (migration 216) or still gives it one (168): the sentence says
 * what will really happen. Empty when no mailbox can send.
 */
export function pooledSendingSentence(pool: MailboxHealth[], takesTurns: boolean): string {
  const working = pool.filter((m) => m.status === 'active' && m.isActive);
  if (working.length === 0) return '';
  if (!takesTurns) {
    const likely = likelyPooledMailbox(working);
    return likely
      ? `The whole campaign goes from one mailbox: the one used least recently when it starts. Right now that is ${likely.label} (${likely.fromEmail}).`
      : 'The whole campaign goes from one mailbox: the one used least recently when it starts.';
  }
  const aDay = working.reduce((total, m) => total + Math.max(m.effectiveLimit, 0), 0);
  if (working.length === 1) {
    return `You have one working mailbox (${working[0].label}), so it sends the whole campaign: up to ${aDay} emails a day. Add more mailboxes on the Accounts tab to send more.`;
  }
  return `Goes out through your ${working.length} working mailboxes in turn: up to ${aDay} emails a day together. Each one keeps its own daily limit.`;
}

export const SENDER_NAME_MAX = 120;
const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

/**
 * The sender name and reply address a campaign carries for every mailbox that
 * sends it. Empty means "each mailbox's own" and is stored as nothing. The
 * name is kept on one line: it goes into the email's header.
 */
export function campaignSender(input: { senderName: string; replyTo: string }): { senderName: string | null; replyTo: string | null; problem: string | null } {
  // eslint-disable-next-line no-control-regex
  const senderName = input.senderName.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SENDER_NAME_MAX) || null;
  const typed = input.replyTo.trim().toLowerCase();
  if (typed && (typed.length > 254 || !ADDRESS.test(typed))) return { senderName, replyTo: null, problem: 'The reply address is not an email address.' };
  return { senderName, replyTo: typed || null, problem: null };
}
