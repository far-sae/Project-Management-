# Email phase 1: sending worker and deliverability core

**Date:** 2026-09-18
**Status:** Approved, ready for implementation plan
**Supersedes part of:** `2026-09-18-email-marketing-design.md` (the Vercel tick worker)

## Problem

The email feature ships with one sending account per organization, a fixed
hourly cap, and no notion of sender health. That is enough to mail a list once.
It is not enough to do outreach without damaging the customer's domain:

- One mailbox carries the whole volume, so a 500-recipient campaign looks
  nothing like human sending.
- A brand-new mailbox sends at full volume from day one, which is the fastest
  way to get filtered.
- Dead addresses are sent to and bounce. Bounce rate above roughly 2% gets a
  sender throttled by the receiving side.
- A wrong password produces a raw SMTP code the user cannot act on.
- Nothing tells the user their domain is missing SPF, DKIM or DMARC, which is
  the single most common reason mail lands in spam.

Reference implementation: `far-sae/outreach-pilot-dash`, the user's own cold
outreach tool. Its server layer solves all of this. Its interface is React 19
with TanStack Router and Tailwind 4, so the screens are rebuilt to match
TaskCalendar rather than copied.

## Goal

Sending moves to a persistent worker, and an organization sends from a pool of
warmed mailboxes with health tracking, working-hours pacing, pre-send address
verification and actionable diagnostics.

## Decisions taken

| Question | Decision |
|---|---|
| Runtime | A persistent Node worker, deployed on Railway by the user later. Not serverless. |
| The existing Vercel tick | Retired, along with its `pg_cron` job. Two senders would double-send. |
| Browser-facing routes | Stay on Vercel: test send, account secret, unsubscribe. A mail client needs a public URL. |
| Interface | Rebuilt in TaskCalendar's existing components. Nothing from the reference project's UI is copied. |
| Phases 2 to 4 | Reply and bounce detection, sequences, open tracking. Each gets its own spec. |

## Architecture

```
Railway: worker (node, every 15s)
   │  claim_email_batch(account, budget)
   ▼
Supabase ── email_accounts (pool, warmup, health)
   │        email_messages (outbox)
   │        email_settings (send window, jitter)
   ▲
   │  browser reads status
Vercel: the app + /api/email/{verify,account-secret,unsubscribe}
```

### The worker

A new top-level `worker/` directory, run with `tsx`, holding all Node-only
code: nodemailer transports, DNS lookups, the drain loop. It imports the
existing pure helpers from `src/lib/email/` (message building, substitution,
suppression, unsubscribe tokens), which are ESM and browser-safe, so there is
no third copy of that logic.

Each cycle: pick sendable mailboxes, claim a slice per mailbox, send with
jitter between messages, record results, update mailbox health. A cycle that
finds nothing sleeps and repeats.

The worker is the only sender. `api/email/tick.ts` and the `email_worker_minute`
cron are removed in the same migration that adds the pool, so there is never a
window where both run.

### Mailbox pool

`email_accounts` gains, following the reference schema:

| Column | Meaning |
|---|---|
| `daily_limit` | ceiling once warmup finishes; default 40, a conservative outreach figure |
| `warmup_enabled` | default true |
| `warmup_started_on` | date the ramp began |
| `warmup_start_volume` | default 5 |
| `warmup_increment` | default 3 per day |
| `is_active`, `paused_reason` | manual or automatic pause |
| `consecutive_failures` | reset on success; pauses the mailbox at 3 |
| `last_sent_at` | drives rotation order |

A `mailbox_status` view exposes today's effective limit and how much of it is
used:

```sql
case
  when not warmup_enabled then daily_limit
  when warmup_started_on is null then warmup_start_volume
  else least(daily_limit,
             warmup_start_volume + warmup_increment * (current_date - warmup_started_on))
end
```

The view is declared `security_invoker = on`, so it cannot be used to read
another organization's mailboxes.

`email_campaigns.account_id` becomes nullable. Null means "use the whole
pool", which is the new default; a specific account still pins a campaign to
one mailbox.

### Rotation and pacing

Mailboxes are ordered by `last_sent_at` ascending, so the least recently used
goes first. Each takes a slice rather than the whole batch, so volume spreads
across the pool instead of draining one mailbox. Between messages the worker
sleeps a random interval inside a configured range, because perfectly regular
timing is itself a spam signal.

A new `email_settings` row per organization holds the send window: enabled,
start hour, end hour, weekdays, timezone, and the jitter range. Outside the
window the worker sends nothing and the queue simply waits. The default is 8am
to 6pm, Monday to Friday, in the organization's timezone.

### Pre-send verification

Before each message the worker resolves the recipient domain's MX records,
falling back to A records, since a domain with no MX but an A record still
accepts mail. A domain that resolves to neither cannot receive mail: the
message is skipped and the address is suppressed as a hard bounce, so it is
never tried again. Lookups are cached per domain per process, not per
recipient.

### Domain authentication report

For a connected mailbox's domain the app reports SPF, DKIM, DMARC and MX, each
with a plain sentence saying what is wrong and what to add. The advice is
provider-aware: an SPF record that does not include the provider the MX
records point at is called out specifically.

### Error handling

SMTP errors are classified rather than surfaced raw:

- **Permanent** (bad credentials, sender rejected): the message fails without
  retrying, the mailbox's failure count increments, and at three consecutive
  failures the mailbox is paused with the reason recorded.
- **Hard bounce** (unknown recipient): the message fails and the address is
  suppressed.
- **Anything else**: the message returns to the queue for another attempt, up
  to three.

Every classification carries a readable message naming the provider, for
example that Gmail requires an app password rather than the account password.

A success resets `consecutive_failures` to zero.

## Testing

The logic worth testing is pure and has no database or network:

1. `isWithinSendWindow(window, now)` — inside, outside, weekend, a timezone
   whose local hour differs from UTC, and a disabled window.
2. `selectMailboxes(mailboxes, budget)` — least-recently-used ordering, a
   mailbox at its effective limit excluded, a paused mailbox excluded, slice
   size per mailbox, and an empty pool.
3. `classifySmtpError(err, host)` — permanent, hard bounce, transient, and the
   provider-specific message.
4. `interpretDomainAuth(records)` — missing SPF, SPF that omits the provider,
   missing DMARC, present and correct.
5. `domainAcceptsMail` given stubbed resolver results — MX present, no MX but
   an A record, neither.

The worker's own loop is covered by a test that stubs the Supabase client and
the transport, asserting rotation order, that the window blocks sending, and
that a permanent failure pauses the mailbox at the third strike.

## Migration safety

One migration adds the columns with defaults, the view, and the settings
table, and drops the retired cron.

`warmup_enabled` defaults to true, but every account that predates the
migration has it switched **off** by a one-time backfill (`where
warmup_started_on is null`). Leaving it on would be the harmful direction, not
the safe one: with no start date the ramp resolves to `warmup_start_volume`,
five a day, and never climbs, because nothing sets the start date on its own —
so a mailbox configured for 500 a day would read as an outage. Existing
accounts therefore keep the `daily_limit` they already had. Warmup is for a new
mailbox proving itself: new ones get it on by default, and an admin starts the
ramp from the Accounts screen. Either way nobody's existing account suddenly
sends *more* than before.

## Out of scope for this phase

- Reply and bounce detection over IMAP (phase 2).
- Sequences (phase 3).
- Open tracking (phase 4).
- Copying sent mail into the user's Sent folder (phase 2, needs IMAP).
- Any change to campaign composition or the recipient picker.
