# Email marketing: single + bulk sending with bring-your-own provider

**Date:** 2026-09-18
**Status:** Approved, ready for implementation plan

## Problem

TaskCalendar can email exactly one person at a time, from the browser, through
EmailJS, against a monthly quota. There is no way to email a list of CRM
contacts, no personalization, no unsubscribe handling, and no delivery record.

Two defects were found while researching this and are fixed as part of the work:

1. **Notification email is silently broken.** `src/services/email/emailService.ts`
   posts to the `notify-send-gmail` edge function, which migration 143 deleted.
   Every call 404s and falls through to EmailJS.
2. **A dead cron job fires every minute.** Migration 111 scheduled
   `crm_automation_worker_minute` against `crm-run-automations`, which 143 also
   deleted. The database has been calling a missing endpoint ~1,440 times a day.

## Goal

An Email page where a user connects their own sending account, then sends either
a single email or a bulk campaign to CRM contacts, a pasted list, or a CSV, with
personalization, an enforced suppression list, and per-recipient delivery status.

## Decisions taken

| Question | Decision |
|---|---|
| Who sends the mail | The user's own provider, like Apollo. We never send from a shared address. |
| Provider type | Custom SMTP first (host/port/user/password). OAuth for Google and Microsoft is a later addition to the same pipeline. |
| Where sending runs | A Vercel Node function. Supabase Edge Functions run on Deno, which blocks outbound ports 25 and 587; Microsoft 365 requires 587. |
| Scope of v1 | Send, personalize, suppress/unsubscribe, per-recipient status. No open or click tracking. |
| Single vs bulk | One pipeline. A single email is a campaign with one recipient. |

## Architecture

### Why a queue

Sending inline from the browser loses the send when the tab closes, cannot
retry, cannot schedule, and cannot pace. Recipients become rows in an outbox;
a worker drains it. Cost is one table and one function.

### Flow

```
Compose (browser)
   │  insert campaign + one row per recipient
   ▼
Supabase: email_campaigns / email_messages (outbox)
   ▲                                   │
   │ status write-back                 │ pg_cron every minute
   │                                   ▼  net.http_post + shared secret
   └──────────────  Vercel /api/email/tick (Node)
                       │ claims a batch (FOR UPDATE SKIP LOCKED)
                       │ decrypts the account secret (AES-256-GCM)
                       ▼
                    nodemailer → the user's SMTP server → recipient
```

### Tables (new)

All org-scoped, RLS via the existing `public.is_org_member(uuid)` and
`public.is_org_admin_or_owner(uuid)` helpers from migration 036.

1. **`email_accounts`** — a sending identity. `id, organization_id,
   workspace_id (nullable), user_id, label, from_name, from_email, reply_to,
   smtp_host, smtp_port, smtp_secure, smtp_username, daily_limit,
   hourly_limit, status ('unverified'|'active'|'error'), last_error,
   last_verified_at`. No secret column.
2. **`email_account_secrets`** — `account_id primary key, secret_encrypted
   text`. RLS `using (false)` for `authenticated`, mirroring `app_secrets`
   from migration 111, so the ciphertext never reaches a browser at all.
   Written and read only by the service role.
3. **`email_campaigns`** — `id, organization_id, workspace_id, created_by,
   account_id, kind ('single'|'bulk'), name, subject, body_html, body_text,
   status ('draft'|'scheduled'|'sending'|'paused'|'sent'|'failed'),
   scheduled_at, rate_per_hour, counts (queued/sent/failed/suppressed),
   created_at, updated_at`.
4. **`email_messages`** — the outbox. `id, campaign_id, organization_id,
   contact_id (nullable), to_email, to_name, merge_data jsonb, status
   ('queued'|'sending'|'sent'|'failed'|'suppressed'), attempts, last_error,
   provider_message_id, unsubscribe_token, send_after timestamptz, sent_at`.
   Index on `(status, send_after)` for the claim query.
5. **`email_suppressions`** — `organization_id, email (lowercased), reason
   ('unsubscribed'|'bounced'|'complaint'|'manual'), campaign_id, created_at`,
   unique on `(organization_id, email)`.

Credentials use the existing `supabase/functions/_shared/crypto.ts` format,
`base64url(iv(12) || ciphertext || tag(16))`, AES-256-GCM, key
`INTEGRATION_TOKEN_KEY`. The Vercel function reimplements decrypt with Node
`webcrypto`, which is the same Web Crypto API, so the format is unchanged.

### Vercel API routes

`vercel.json` currently rewrites every path to `index.html`. It must exclude
`/api/` or these routes are unreachable. That change is part of the work.

- **`POST /api/email/tick`** — the worker. Authenticated by a shared secret
  header, never by a user session. Claims up to N queued rows whose
  `send_after` has passed, honouring each account's hourly limit, using
  `FOR UPDATE SKIP LOCKED` so two overlapping ticks cannot send the same row
  twice. Sends, then writes status per row. Returns counts.
- **`POST /api/email/verify`** — "Send test email". Verifies the caller's
  Supabase JWT, confirms org membership, sends one message through the
  account, and sets `status` to `active` or `error` with `last_error`.
- **`GET|POST /api/email/unsubscribe`** — public, token-authenticated. POST
  satisfies RFC 8058 one-click; GET renders a confirmation page. Both insert
  a suppression row.

### Compliance

Gmail and Yahoo require one-click unsubscribe from bulk senders and a spam
complaint rate under 0.3%. Every `kind = 'bulk'` message therefore carries
`List-Unsubscribe` and `List-Unsubscribe-Post` headers plus a visible
unsubscribe link appended to the body when the author did not include one.
Single sends are transactional and exempt.

Suppression is checked at claim time, not at compose time, so a contact who
unsubscribes after a campaign is queued is still skipped.

### Frontend

New page at `/email`, `PageKey: 'email'`, gated behind a new
`AppFeature: 'email_campaigns'` (trial, advanced, premium — same tiers as
`crm`). Four tabs: Campaigns, Compose, Accounts, Suppression. Added to
`PAGE_CATALOG`, the sidebar Quick Menu, and `QUICK_MENU_PAGE_KEYS` so the new
per-workspace menu toggles cover it.

### The two bug fixes

- **Notifications:** `sendNotificationEmail` stops calling the deleted
  `notify-send-gmail` function. If the org has an active `email_account`, it
  queues a `kind = 'single'` message; otherwise it falls back to EmailJS as
  today. No more 404 on every notification.
- **Dead cron:** the migration that schedules the new tick also runs
  `cron.unschedule('crm_automation_worker_minute')` and drops
  `public.crm_kick_automation_worker()`.

## Error handling

- A failed send increments `attempts` and records `last_error`. Three attempts,
  then `failed`. SMTP 5xx (bad credentials, rejected sender) fails immediately
  without retrying, and sets the account to `error` so the user is told.
- A claimed row that crashes mid-send stays `sending`; rows stuck in `sending`
  for over 10 minutes are returned to `queued` by the next tick.
- Missing `INTEGRATION_TOKEN_KEY` or shared secret in Vercel: the tick returns
  500 and sends nothing rather than failing open.
- An account that cannot be decrypted is set to `error`, and its queued
  messages are left queued, not dropped.

## Testing

Pure, database-free helpers carry the logic and are unit tested first in
`tests/unit`:

1. `substitutePlaceholders(template, context)` — known and unknown keys,
   missing values, no injection of raw HTML.
2. `unsubscribeToken` sign and verify — round trip, wrong secret, tampered
   payload.
3. `filterSuppressed(recipients, suppressions)` — case-insensitive, deduped.
4. `selectBatch(rows, limits, now)` — respects hourly limit, `send_after`,
   and per-account caps.
5. `buildMessage(...)` — headers present for bulk, absent for single;
   unsubscribe link appended only when missing.

## Out of scope

- Open and click tracking.
- Google and Microsoft OAuth connection (the pipeline is built to accept it).
- Inbound replies and bounce webhooks (bounces are manual for now).
- Multi-step sequences and drip cadences.
- Warmup and per-domain reputation management.
