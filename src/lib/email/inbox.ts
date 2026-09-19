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

/**
 * True when an envelope is worth DOWNLOADING and looking at — nothing more.
 *
 * This is the download trigger and it is deliberately loose, because the cost
 * of a false positive here is one body pulled and discarded. It is NOT the
 * suppression decision; `bounceTrigger` is, and it needs real evidence. The
 * two were one function, and the subject half of it was doing both jobs:
 *
 *   A customer forwards a bounce to a contact asking whether the address is
 *   right. The contact replies. Her subject is now "Re: Undeliverable: ...",
 *   her signature reads "ada@acme.com | Suite 500", and on the strength of
 *   that alone she was suppressed organisation-wide, permanently, in the same
 *   scan that recorded her reply.
 *
 * A subject is whatever the person typing it decided to type. It is a reason
 * to look; it is not evidence of anything.
 */
export function looksLikeBounce(envelope: InboxEnvelope): boolean {
  return BOUNCE_SENDERS.test(envelope.from) || BOUNCE_SUBJECTS.test(envelope.subject);
}

/**
 * What made this message a bounce, for the event's detail. A support question
 * about a suppression can then be answered without re-reading the mailbox.
 */
export type BounceTrigger = 'notifier-sender' | 'delivery-status-report';

/**
 * A body that says, in its own headers, that it is a machine-generated
 * delivery report: RFC 3464's `multipart/report; report-type=delivery-status`
 * wrapper, or the `message/delivery-status` part it wraps. Matched against the
 * raw source, so either the top-level header or the part header will do.
 *
 * The lookahead spans folded header lines, which is why it is not anchored to
 * one line: `Content-Type: multipart/report;` with `report-type=...` on the
 * continuation line is the ordinary shape, not an exotic one.
 */
const DELIVERY_REPORT =
  /content-type:\s*(?:message\/delivery-status|multipart\/report[\s\S]{0,200}?report-type\s*=\s*"?delivery-status)/i;

/**
 * The evidence that lets a bounce SUPPRESS an address, or null when there is
 * none and the message was only ever worth a look.
 *
 * Two things count, and a subject is not one of them:
 *
 *  - the sender is a bounce notifier (`mailer-daemon`, `postmaster`), which is
 *    what an MTA actually sends from; or
 *  - the body identifies itself as a delivery status report by its content
 *    type, which is what an MTA actually sends.
 *
 * Neither is unforgeable — bounce notifications are unauthenticated mail, and
 * always will be — which is why this is only the FIRST of two gates. The
 * second is in record_inbox_result(), which suppresses the matched message's
 * own recipient and only when this organisation really did send to it
 * recently. What this gate removes is the case where no forgery was needed at
 * all: before it, any message with the right subject line could suppress
 * anyone the organisation had ever mailed.
 */
export function bounceTrigger(envelope: InboxEnvelope, source: string): BounceTrigger | null {
  if (BOUNCE_SENDERS.test(envelope.from)) return 'notifier-sender';
  if (DELIVERY_REPORT.test(source)) return 'delivery-status-report';
  return null;
}

/** `Final-Recipient: rfc822; someone@example.com` in a delivery status notification. */
const FINAL_RECIPIENT = /final-recipient:\s*(?:rfc822;\s*)?<?([^\s<>;,]+@[^\s<>;,]+)>?/i;

/**
 * Fallback for a human-readable bounce with no structured DSN part: an
 * address followed closely by wording that only a delivery failure produces.
 *
 * What is NOT in here any more is a bare three-digit number starting with
 * five. `\b5\d\d\b` was matching an ordinary signature — "ada@acme.com |
 * Suite 500", a phone number containing 555, a header line naming port 587 —
 * and handing that address back as the one a bounce was reporting as failed.
 * An SMTP reply code never appears on its own in a real notification anyway;
 * it comes with the text of the failure, which the phrases below already
 * catch.
 *
 * An ENHANCED status code (RFC 3463: `5.1.1`) replaces it. That shape has no
 * innocent reading next to an email address, unlike three digits.
 */
const INLINE_FAILURE =
  /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})(?=[^\n]{0,100}?(?:could not be delivered|delivery (?:has )?failed|undeliverable|does not exist|no such (?:user|address|recipient|mailbox)|user unknown|recipient (?:address )?rejected|mailbox (?:is )?(?:unavailable|full)|address rejected|permanent(?:ly)? fail|\b5\.\d{1,3}\.\d{1,3}\b))/i;

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
