// Pure inbox helpers for phase 2 of the email system. Phase 1 sends mail from
// a pool of mailboxes; these functions let the worker work out which incoming
// IMAP messages are replies to mail we sent and which are bounce
// notifications, and how far back a scan should look.
//
// Deliberately pure: no React, no Supabase, no network, no Node-only APIs.
// The worker owns the IMAP connection and calls these with the envelopes and
// error values it reads; that keeps this module runnable in the worker and
// in browser code alike.

import type { InboxEnvelope } from './types';

export const FIRST_SCAN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const SCAN_OVERLAP_MS = 3 * 60 * 1000;

/**
 * The start of the window a scan should fetch, given when the mailbox was
 * last scanned.
 *
 * Three bounds apply together, not in isolation:
 *  - Start a little before `lastScanAt` (the overlap) so a message that
 *    arrived in the last few seconds of the previous scan, and hadn't
 *    finished landing in the mailbox yet, isn't missed.
 *  - Never look back further than `now - FIRST_SCAN_LOOKBACK_MS`. A mailbox
 *    that has not been scanned for a month must not pull a month of
 *    envelopes on its first pass back — that floor applies whether this is
 *    genuinely the first scan (`lastScanAt` is null) or just a very stale
 *    one.
 *  - Never return a time after `now`. If `lastScanAt` is ahead of `now` —
 *    a clock jump, a clock skew between processes — the overlap-adjusted
 *    value could otherwise land in the future, which would fetch nothing
 *    and never catch up.
 */
export function scanWindow(lastScanAt: Date | null, now: Date): Date {
  const nowMs = now.getTime();
  const floor = nowMs - FIRST_SCAN_LOOKBACK_MS;
  const candidate = lastScanAt === null ? floor : lastScanAt.getTime() - SCAN_OVERLAP_MS;
  const bounded = Math.max(candidate, floor);
  return new Date(Math.min(bounded, nowMs));
}

const ANGLE_ADDRESS = /<([^<>]+)>\s*$/;
const LOOKS_LIKE_ADDRESS = /^[^\s@]+@[^\s@]+$/;

/**
 * Pulls the bare address out of a `"Display Name" <addr>` header value,
 * trims and lowercases it. Returns `""` for anything that doesn't come out
 * looking like an address, so callers can treat the empty string as "no
 * address" without a separate null check.
 */
export function normalizeAddress(raw: string): string {
  const trimmed = raw.trim();
  const angled = ANGLE_ADDRESS.exec(trimmed);
  const candidate = (angled ? angled[1] : trimmed).trim().toLowerCase();
  return LOOKS_LIKE_ADDRESS.test(candidate) ? candidate : '';
}

/**
 * Which of the addresses we sent to actually replied, and when.
 *
 * Returns one entry per address, carrying the *earliest* `at` — that is when
 * they actually replied; a later message from the same person is part of the
 * same conversation, not a second reply.
 */
export function matchReplies(
  incoming: InboxEnvelope[],
  sentTo: string[],
): Array<{ address: string; at: Date }> {
  const sentSet = new Set(sentTo.map(normalizeAddress).filter((address) => address !== ''));
  const earliest = new Map<string, Date>();

  for (const message of incoming) {
    const address = normalizeAddress(message.from);
    if (address === '' || !sentSet.has(address)) continue;

    const existing = earliest.get(address);
    if (!existing || message.at.getTime() < existing.getTime()) {
      earliest.set(address, message.at);
    }
  }

  return [...earliest.entries()].map(([address, at]) => ({ address, at }));
}

const BOUNCE_SENDERS = /(mailer-daemon|postmaster|no-?reply.*bounce)/i;
const BOUNCE_SUBJECTS = /(undeliverable|delivery status|returned mail|failure notice)/i;

/** True when an envelope looks like an automated bounce/DSN, not a reply. */
export function looksLikeBounce(envelope: InboxEnvelope): boolean {
  return BOUNCE_SENDERS.test(envelope.from) || BOUNCE_SUBJECTS.test(envelope.subject);
}

/** `Final-Recipient: rfc822; someone@example.com` in a delivery status notification. */
const FINAL_RECIPIENT = /final-recipient:\s*(?:rfc822;\s*)?<?([^\s<>;,]+@[^\s<>;,]+)>?/i;

/**
 * Fallback for a human-readable bounce with no structured DSN part: an
 * address followed, within the same line or two, by common failure wording.
 */
const INLINE_FAILURE =
  /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})(?=[^\n]{0,100}?(?:could not be delivered|delivery (?:has )?failed|undeliverable|does not exist|\b5\d\d\b))/i;

/**
 * The recipient address a bounce message is reporting as failed, or null
 * when nothing recognisable was found. Tries the structured
 * `Final-Recipient:` field first, then falls back to an inline pattern, and
 * always lowercases what it finds.
 */
export function extractBouncedAddress(source: string): string | null {
  const finalRecipient = FINAL_RECIPIENT.exec(source);
  if (finalRecipient?.[1]) return finalRecipient[1].toLowerCase();

  const inline = INLINE_FAILURE.exec(source);
  if (inline?.[1]) return inline[1].toLowerCase();

  return null;
}
