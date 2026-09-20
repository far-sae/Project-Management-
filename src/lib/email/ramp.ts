// The volume ramp, and what it is honest to claim for it.
//
// Pure: no React, no Supabase, no network, no Node built-ins.
//
// This feature has called the ramp "warmup" since phase 1, and that name
// promises something it does not deliver. A ramp raises a mailbox's daily
// allowance on a schedule. Warming up an inbox — building a sending
// reputation so that mail reaches the inbox rather than the spam folder — is a
// different thing that involves real messages being received, opened and
// replied to by real mailboxes, and no slider produces it.
//
// The distinction matters because of what somebody does with the belief. A
// person who thinks a ramp has warmed their mailbox sends their real campaign
// on day 14 expecting placement they have no evidence for. So: the ramp is
// described as a ramp, health is reported separately from it, and nothing
// here presents elapsed days as proof of anything.

import type { MailboxHealth } from './types';

/** Whole days between two dates, floored at zero. */
function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(Math.floor(ms / (24 * 60 * 60 * 1000)), 0);
}

/**
 * The allowance a ramp gives on a given day.
 *
 * Mirrors the arithmetic in `mailbox_status` (migration 156), which is what
 * the sender actually obeys. It is repeated here rather than read from the
 * view because this answers a question the view cannot: what the allowance
 * will be on a date in the FUTURE.
 */
export function limitOnDay(mailbox: MailboxHealth, day: Date): number {
  // The ramp inputs are optional on MailboxHealth: the worker's own mapper
  // only needs effectiveLimit and sentToday to send, and does not populate
  // them. Where they are absent there is nothing to project, so today's
  // effective limit is the only honest answer — better than assuming the
  // migration's defaults and drawing a ramp for a mailbox that may not have
  // one.
  const limit = mailbox.dailyLimit;
  const start = mailbox.warmupStartVolume;
  const step = mailbox.warmupIncrement;
  if (limit === undefined || start === undefined || step === undefined) {
    return mailbox.effectiveLimit;
  }

  if (!mailbox.warmupEnabled) return limit;
  if (!mailbox.warmupStartedOn) return start;

  const elapsed = daysBetween(mailbox.warmupStartedOn, day);
  return Math.min(limit, start + step * elapsed);
}

export interface NextIncrease {
  /** When the allowance next changes. */
  on: Date;
  /** What it becomes. */
  to: number;
}

/**
 * When this mailbox's allowance next rises, and to what — or null when it
 * never will.
 *
 * Null covers three genuinely different situations, and the caller says which
 * rather than printing "no increase" for all of them: the ramp is off, it has
 * not been started, or it has already reached the mailbox's limit.
 */
export function nextIncrease(mailbox: MailboxHealth, today: Date): NextIncrease | null {
  if (mailbox.dailyLimit === undefined || mailbox.warmupIncrement === undefined) return null;
  if (!mailbox.warmupEnabled || !mailbox.warmupStartedOn) return null;
  if (mailbox.warmupIncrement <= 0) return null;

  const todayLimit = limitOnDay(mailbox, today);
  if (todayLimit >= mailbox.dailyLimit) return null;

  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return { on: tomorrow, to: limitOnDay(mailbox, tomorrow) };
}

/** How far along the ramp is, 0 to 1, or null when it is not running. */
export function rampProgress(mailbox: MailboxHealth, today: Date): number | null {
  const limit = mailbox.dailyLimit;
  const start = mailbox.warmupStartVolume;
  if (limit === undefined || start === undefined) return null;
  if (!mailbox.warmupEnabled || !mailbox.warmupStartedOn) return null;

  const span = limit - start;
  if (span <= 0) return 1;
  return Math.min(Math.max((limitOnDay(mailbox, today) - start) / span, 0), 1);
}

/** The measured bounce rate for a mailbox, or null when nothing was measured. */
export interface BounceRate {
  sent30d: number;
  bounced30d: number;
  /** Null when nothing has been sent — NOT zero. */
  percent: number | null;
}

export type HealthState = 'good' | 'watch' | 'bad' | 'unmeasured';

export interface MailboxHealthReport {
  state: HealthState;
  /** One sentence. Says "not measured" where that is the truth. */
  detail: string;
}

/**
 * What can honestly be said about a mailbox's sending health.
 *
 * The rule running through this: an absence of evidence is reported as an
 * absence of evidence. A mailbox that has sent nothing has no bounce rate, and
 * showing "0%" for it would be presenting silence as a clean record — which is
 * the specific dishonesty that makes people trust a warm-up dashboard and then
 * send five hundred messages into a spam folder.
 */
export function healthReport(
  mailbox: MailboxHealth,
  bounce: BounceRate | null,
  threshold: number,
): MailboxHealthReport {
  if (!mailbox.isActive) {
    return {
      state: 'bad',
      detail: mailbox.pausedReason ?? 'This mailbox is paused, so nothing is being sent from it.',
    };
  }

  if (mailbox.status === 'error') {
    return {
      state: 'bad',
      detail: 'The last send failed and this mailbox is out of rotation until it is re-verified.',
    };
  }

  if (!bounce || bounce.percent === null || bounce.sent30d === 0) {
    return {
      state: 'unmeasured',
      detail:
        'Nothing has been sent from this mailbox in the last 30 days, so there is no delivery ' +
        'record to judge. This is not a clean bill of health — it is no information.',
    };
  }

  // Too few sends to mean anything. Two bounces out of three is 67% and is
  // evidence of nothing.
  if (bounce.sent30d < 20) {
    return {
      state: 'unmeasured',
      detail:
        `Only ${bounce.sent30d} messages in the last 30 days — too few for a bounce rate to ` +
        'mean anything yet.',
    };
  }

  if (bounce.percent >= threshold) {
    return {
      state: 'bad',
      detail:
        `${bounce.percent}% of the last ${bounce.sent30d} messages bounced, at or over this ` +
        `mailbox's ${threshold}% limit. Sending pauses automatically at this point.`,
    };
  }

  // Half the threshold: close enough that it is worth seeing before it stops.
  if (bounce.percent >= threshold / 2) {
    return {
      state: 'watch',
      detail:
        `${bounce.percent}% of the last ${bounce.sent30d} messages bounced. Below the ` +
        `${threshold}% limit, but worth cleaning the list before it is not.`,
    };
  }

  return {
    state: 'good',
    detail: `${bounce.percent}% of the last ${bounce.sent30d} messages bounced.`,
  };
}
