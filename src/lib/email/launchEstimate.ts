// How long a campaign will actually take, and when it will finish.
//
// Pure: no React, no Supabase, no network, no Node built-ins.
//
// This exists because the product asks somebody to press Send without telling
// them what happens next, and what happens next is rarely "it goes now". Three
// separate things pace a campaign, each configured on a different screen:
//
//   * the SEND WINDOW — outside it the queue simply waits (Settings)
//   * each mailbox's DAILY ALLOWANCE, which the warmup ramp may be holding far
//     below its limit (Accounts)
//   * the pool's SIZE, because the allowances add up
//
// So a 500-recipient campaign from two warming mailboxes at 8 a day is not a
// campaign that sends this afternoon; it is one that finishes in a month. That
// is a fine thing to choose and a terrible thing to discover, and nothing on
// the composing screen said it.

import type { MailboxHealth, SendWindow } from './types';

export interface LaunchEstimate {
  /** People who will actually be mailed, after suppression and de-duplication. */
  recipients: number;
  /** What the whole pool can still send today. */
  remainingToday: number;
  /** What the pool can send on a full day, once warmup is where it is now. */
  perDay: number;
  /** Whole days this will take, 1 when it fits inside today's remainder. */
  days: number;
  /**
   * True when the campaign cannot start right now because the window is shut.
   * Not an error — the queue waits, which is the point of a window.
   */
  waitingForWindow: boolean;
  /** One sentence for the review screen. */
  summary: string;
}

/** Mailboxes that can actually take work right now. */
function usable(mailboxes: MailboxHealth[]): MailboxHealth[] {
  return mailboxes.filter((m) => m.isActive && m.status !== 'error');
}

/**
 * Whether the organisation's window is open at `now`.
 *
 * Deliberately a re-implementation of nothing: `isWithinSendWindow` in
 * sendWindow.ts is the authority and is what the worker actually obeys. This
 * module takes the answer as an argument rather than computing a second one,
 * because two implementations of a timezone-aware window is exactly how a
 * screen ends up disagreeing with the sender.
 */
export interface EstimateInput {
  recipients: number;
  mailboxes: MailboxHealth[];
  window: SendWindow;
  windowOpenNow: boolean;
}

export function launchEstimate(input: EstimateInput): LaunchEstimate {
  const pool = usable(input.mailboxes);

  const remainingToday = pool.reduce(
    (total, m) => total + Math.max(m.effectiveLimit - m.sentToday, 0),
    0,
  );
  // Tomorrow's capacity, at today's ramp. The ramp climbs, so this
  // UNDERSTATES a warming pool — which is the right direction to be wrong in
  // for an estimate somebody plans around.
  const perDay = pool.reduce((total, m) => total + m.effectiveLimit, 0);

  const waitingForWindow = !input.windowOpenNow && input.window.enabled;

  if (input.recipients === 0) {
    return {
      recipients: 0,
      remainingToday,
      perDay,
      days: 0,
      waitingForWindow,
      summary: 'No recipients selected yet.',
    };
  }

  if (pool.length === 0) {
    return {
      recipients: input.recipients,
      remainingToday: 0,
      perDay: 0,
      days: 0,
      waitingForWindow,
      summary:
        'No mailbox is currently able to send, so this will sit in the queue until one is.',
    };
  }

  const afterToday = Math.max(input.recipients - remainingToday, 0);
  // Today counts as a day whenever anything can go today.
  const days = afterToday === 0 ? 1 : 1 + Math.ceil(afterToday / Math.max(perDay, 1));

  const mailboxWord = pool.length === 1 ? 'mailbox' : 'mailboxes';
  const parts: string[] = [];

  if (days === 1) {
    parts.push(
      `All ${input.recipients} can go today — ${remainingToday} left in today's allowance ` +
        `across ${pool.length} ${mailboxWord}.`,
    );
  } else {
    parts.push(
      `About ${days} days: ${remainingToday} can go today, then up to ${perDay} a day ` +
        `across ${pool.length} ${mailboxWord}.`,
    );
  }

  if (waitingForWindow) {
    parts.push(
      `The send window is closed right now, so nothing leaves until it opens ` +
        `(${input.window.startHour}:00–${input.window.endHour}:00 ${input.window.timezone}).`,
    );
  }

  return {
    recipients: input.recipients,
    remainingToday,
    perDay,
    days,
    waitingForWindow,
    summary: parts.join(' '),
  };
}
