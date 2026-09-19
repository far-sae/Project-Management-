# Email Marketing — Deployment & Secrets Setup

This guide walks through everything needed **outside the code** to make the
Email page (`/email`) actually send mail in production: applying the
migrations, generating secrets, and setting them in Vercel. Until you finish
these steps, sending stays broken even though the app builds and deploys
cleanly.

> **Sending itself now runs on a separate persistent worker, not Vercel.**
> The "Sending runs on Vercel" bullet and Step 5 below describe the
> `/api/email/tick` + Supabase-cron mechanism that migration
> `156_mailbox_pool_and_worker.sql` **removed** — kept here only as history of
> what changed and why. After finishing this guide (secrets, migrations,
> Vercel variables), deploy `worker/` per
> [`email-worker-setup.md`](./email-worker-setup.md) — sending does not work
> until that worker is running, and this guide alone is no longer enough.

Background: `docs/superpowers/specs/2026-09-18-email-marketing-design.md` and
`docs/superpowers/specs/2026-09-18-email-deliverability-design.md` (the
mailbox pool, warmup and worker that superseded the tick).

---

## How the pieces fit together

- **Sending runs on a persistent worker (`worker/`), deployed on Railway —
  superseded from Vercel.** `api/email/tick.ts` and the Supabase `pg_cron` job
  that used to poke it once a minute (`email_worker_minute`, from migration
  `153_email_claim_and_cron.sql`) are both gone as of migration
  `156_mailbox_pool_and_worker.sql`; `public.kick_email_worker()` is dropped
  in the same migration. See
  [`email-worker-setup.md`](./email-worker-setup.md) for what runs now and how
  to deploy it. It still runs outside a Supabase Edge Function for the same
  reason the tick did — Deno on Supabase Edge blocks outbound SMTP ports 25
  and 587, and Microsoft 365 requires 587.
- **`POST /api/email/verify`** (the Accounts tab's "Send test" / the Compose
  tab's "Send test to me") still runs on Vercel, unchanged — it sends exactly
  one message on demand and always to the caller's own address. Only the
  ongoing campaign/pool sending moved to the worker.
- **SMTP passwords are encrypted server-side.** The browser posts the
  plaintext password over TLS to `POST /api/email/account-secret`
  (`src/services/supabase/email.ts` → `api/email/account-secret.ts`), which
  encrypts it there with the server-only `INTEGRATION_TOKEN_KEY` and writes
  the ciphertext with the service-role client. The key is never shipped to a
  browser. `email_account_secrets` has a deny-all RLS policy (migration
  `152`), so only the service role — used by the Vercel routes and by the
  worker — can read the ciphertext back out.

---

## Step 1 — Apply the migrations

Nine migrations ship this feature. The five below are the sending core;
`157_inbox_sync.sql` (replies, bounces and the Sent-folder copy) and
`158_email_sequences.sql` + `159_sequence_engine.sql` +
`160_claim_respects_pinned_mailbox.sql` (multi-step sequences) come after
them, in that order, and are covered by `email-worker-setup.md`. Everything in
157 through 160 is optional for sending: a database that stops at 156 sends
campaigns exactly as this guide describes.

The five: `152_email_marketing_schema.sql` (the
tables), `153_email_claim_and_cron.sql` (the atomic claim function + the
cron job, and it also drops the dead `crm_automation_worker_minute` cron left
over from migration 143), `154_claim_respects_suppressions.sql` (closes a
race where a mid-campaign unsubscribe didn't stop already-queued mail),
`155_email_limits_and_integrity.sql` (cross-organization foreign keys, the
per-account send limits, the retry budget, and `finalize_email_campaigns()`),
and `156_mailbox_pool_and_worker.sql` (the mailbox pool, warmup ramp, the
organization-wide send window and jitter, changes `claim_email_batch()` to
take the mailbox and budget it's claiming for, and **removes** the
`email_worker_minute` cron and `public.kick_email_worker()` — sending moves to
the persistent worker from here on). Apply all five, in order — they must not
be split up or reordered — then 157, 158, 159 and 160 on top if you want
inbox sync and sequences.

```bash
npx supabase db push --linked
```

This applies every migration newer than what's already on the linked
project, which includes 152 through 156 as long as nothing later depends on
skipping them. If you'd rather apply them by hand (e.g. no linked CLI
project), open the Supabase dashboard → **SQL Editor** and paste the contents
of each file, in numeric order: `152_email_marketing_schema.sql`, then
`153_email_claim_and_cron.sql`, then `154_claim_respects_suppressions.sql`,
then `155_email_limits_and_integrity.sql`, then
`156_mailbox_pool_and_worker.sql`.

Migration 155 adds composite foreign keys, so it fails loudly if the database
already holds a campaign whose sending account belongs to another
organization. That is the point — fix the offending row and re-run rather
than skipping the migration. Migration 156 refuses to run on PostgreSQL 14 or
older (it needs `security_invoker` views), and fails just as loudly rather
than leaving a definer-rights view behind.

Verify in **Table Editor** that `email_accounts`, `email_account_secrets`,
`email_campaigns`, `email_messages`, `email_suppressions` and `email_settings`
now exist, that `mailbox_status` exists as a view, and that
`public.claim_email_batch`, `public.finalize_email_campaigns` and
`public.record_send_result` all exist under **Database → Functions**.

Then run this in the **SQL Editor**. Checking that the function exists is not
enough: Postgres does not analyse a function body at creation time, so a
function with a broken body is created happily and only fails when something
calls it. Calling it once proves the body runs.

```sql
-- claim_email_batch(p_account, p_limit) as of migration 156 — the earlier
-- single-argument form no longer exists. A nil UUID matches no mailbox, so
-- this returns an empty result rather than actually claiming anything.
select * from public.claim_email_batch('00000000-0000-0000-0000-000000000000'::uuid, 1);
select public.finalize_email_campaigns();
```

Both should return without error — an empty result from the first is correct
when nothing is queued yet (or, with the placeholder UUID above, ever). An
error here means the worker would fail on every cycle while appearing
installed, so fix it before going further.

---

## Step 2 — Generate the unsubscribe secret

`EMAIL_UNSUBSCRIBE_SECRET` signs one-click unsubscribe tokens; it needs 32
random bytes, base64url-encoded:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Save the output somewhere safe (1Password, etc.) — you'll set it both in
Vercel (Step 4 below) and on the worker (`email-worker-setup.md`), and it
must be the **same value in both places**: the worker signs the link,
`api/email/unsubscribe.ts` on Vercel verifies it, and a mismatch 401s every
link.

There used to be a second secret here, `EMAIL_WORKER_SECRET`, which
authenticated the Supabase cron's call to `/api/email/tick`. Both the cron and
that route are gone as of migration 156 — the worker authenticates to
Supabase directly with `SUPABASE_SERVICE_ROLE_KEY` instead of a shared HTTP
header, so there is nothing left for that secret to protect. Do not generate
or set it.

---

## Step 3 — Reuse (or generate) `INTEGRATION_TOKEN_KEY`

`INTEGRATION_TOKEN_KEY` is the AES-256 key (`api/_lib/crypto.ts`) that
encrypts SMTP passwords in `api/email/account-secret.ts` and decrypts them
again in `api/email/verify.ts` **and in the worker** (which needs this exact
value too — see `email-worker-setup.md`). It is a server-only variable — it
must never be exposed to the browser. This project already uses
`INTEGRATION_TOKEN_KEY` for the OAuth-integrations framework
(`docs/superpowers/deployment/integrations-deployment-setup.md`), so:

- If the project already has an `INTEGRATION_TOKEN_KEY` set in Vercel, **reuse
  that exact value** — do not generate a second one.
- If the project has none yet, generate it the same way as Step 2:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Step 4 — Set the Vercel environment variables

Set these for **both Production and Preview** (the verify and unsubscribe
routes both run in both environments):

| Variable | Used by | What it is |
|---|---|---|
| `SUPABASE_URL` | `api/_lib/context.ts` (`serviceClient`) | Your Supabase project URL, e.g. `https://xxxx.supabase.co` (Project Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/_lib/context.ts` (`serviceClient`) | The service-role secret key (Project Settings → API). Never expose this to the browser. |
| `INTEGRATION_TOKEN_KEY` | `api/email/account-secret.ts` (`encryptSecret`), `api/email/verify.ts` (`decryptSecret`) | From Step 3. Server-only — do **not** mirror it into a `VITE_*` variable. The worker needs this exact value too (Railway, not Vercel — see `email-worker-setup.md`). |
| `EMAIL_UNSUBSCRIBE_SECRET` | `api/email/unsubscribe.ts` | From Step 2. The worker needs this exact value too, to sign the links this route verifies. |
| `PUBLIC_SITE_URL` | Declared in `api/_lib/context.ts` (`siteUrl()`) but, as of migration 156, **no Vercel route actually calls it** — the only caller was `api/email/tick.ts`, which that migration removed. Set it here anyway if you want one source of truth alongside the worker's copy; nothing in `api/` currently breaks if it's absent. The worker (Railway) is what actually needs it now — see `email-worker-setup.md`. | Your production site origin, no trailing slash, e.g. `https://taskcalendar.app` |

Using the Vercel CLI, for each variable:

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_URL preview
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY preview
vercel env add INTEGRATION_TOKEN_KEY production
vercel env add INTEGRATION_TOKEN_KEY preview
vercel env add EMAIL_UNSUBSCRIBE_SECRET production
vercel env add EMAIL_UNSUBSCRIBE_SECRET preview
vercel env add PUBLIC_SITE_URL production
vercel env add PUBLIC_SITE_URL preview
```

Each prompts for the value on stdin. Equivalently, in the Vercel dashboard:
**Project → Settings → Environment Variables**, add each name/value pair with
both **Production** and **Preview** checked.

---

## Step 5 — Superseded: configuring the cron to reach Vercel

**Skip this step.** Migration 156 drops `public.kick_email_worker()` and
unschedules the `email_worker_minute` cron outright, so there is nothing left
to configure here — there is no `app_secrets` row for this to read, because
nothing reads `app_secrets` for email anymore. Deploy `worker/` instead; see
[`email-worker-setup.md`](./email-worker-setup.md).

<details>
<summary>What this step used to do, before migration 156 (kept for history)</summary>

`public.kick_email_worker()` (migration 153) read its target URL and shared
secret from `public.app_secrets` — a deny-all-to-`authenticated` key/value
table (same pattern as migration 111) — and POSTed to
`<site_url>/api/email/tick` with that secret in an `x-worker-secret` header,
once a minute, via `pg_cron`:

```sql
insert into public.app_secrets(key, value) values
  ('site_url', 'https://<your-domain>'),
  ('email_worker_secret', '<EMAIL_WORKER_SECRET value>')
on conflict (key) do update set value = excluded.value;
```

</details>

---

## Step 6 — Redeploy

Every variable above is read at runtime by the `api/` functions, so a plain
redeploy picks them up — but deploy again anyway so the functions restart
with the new environment:

```bash
vercel --prod
```

Or from the dashboard: **Deployments → ⋯ → Redeploy**.

---

## Step 7 — Smoke test

1. Log in and open `/email` → **Accounts** tab → add a sending account with
   real SMTP credentials, then use **Send test to me**. Confirm the account's
   status moves to `active` and you receive the test message.
2. **Compose** tab → pick that account, add exactly one recipient, and send.
   In `src/components/email/ComposeTab.tsx` a campaign is queued as
   `kind: 'single'` when there is exactly one recipient — this exercises the
   basic send path but **not** the unsubscribe link (per `buildMessage` in
   `api/_lib/message.ts`, the one-click unsubscribe header and footer link
   are added for `kind: 'bulk'` only). Confirm in the **Campaigns** tab that
   the row's status reaches `sent` — this requires `worker/` to be deployed
   and running (`email-worker-setup.md`); it claims the queue on its own
   schedule (every `WORKER_INTERVAL_MS`, 15s by default), so allow that long
   rather than expecting it instantly. There is no longer a way to force one
   pass by hand from outside the worker.
3. To test unsubscribe, send a second campaign to **two or more** recipients
   (making it `kind: 'bulk'`) so the outgoing mail carries the unsubscribe
   link. Opening that link in a browser renders a confirmation page and
   writes nothing — a `GET` deliberately has no effect, because corporate
   link scanners fetch every URL in inbound mail and would otherwise
   unsubscribe the recipient automatically. Press **Confirm unsubscribe**
   (or POST to the same URL, which is what Gmail and Yahoo do for RFC 8058
   one-click) and confirm a new row appears in `public.email_suppressions` —
   visible in the **Suppression** tab in the app.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing sends, campaign stays `sending`/`queued` forever | This is no longer a Vercel/cron question — sending runs on `worker/` now. See `email-worker-setup.md`'s own troubleshooting table (pool empty vs. outside the send window, both explained by the worker's own log line) rather than looking for a cron job or an `app_secrets` row; neither exists anymore. |
| SMTP call times out on port 587 | The **test send** (`api/email/verify.ts`, "Send test to me") still runs as a Vercel function; confirm it's actually reaching that route rather than a Supabase Edge Function — Deno on Supabase Edge blocks outbound 25/587. For an ordinary **campaign**, the send happens in the worker process itself (`worker/`), not in any Vercel or Supabase Edge function — see `email-worker-setup.md`. |
| SMTP "authentication failed" | For Gmail/Google Workspace, Zoho and IONOS accounts, `smtp_username`/password must be an **app password**, not the account's login password; Microsoft 365 has SMTP AUTH disabled by default and needs an admin to re-enable it per mailbox. The error message names which of these it is — `friendlySmtpError()` in `src/lib/email/smtpErrors.ts` — whether it came from a test send (Vercel) or a campaign (the worker). |

---

## Known limitations

- **`INTEGRATION_TOKEN_KEY` and the database together are enough to recover
  every SMTP password.** Encryption happens in `api/email/account-secret.ts`
  with a single long-lived symmetric key held in the Vercel environment, and
  the same key encrypts the Google and Slack OAuth tokens in
  `supabase/functions/_shared/tokens.ts`. State it plainly: anyone holding
  both the database contents and `INTEGRATION_TOKEN_KEY` can decrypt every
  stored SMTP password and every stored OAuth token. The key is no longer in
  the JS bundle, so a browser visitor cannot obtain it, but it is not a KMS,
  there is no per-secret key and there is no rotation story — treat the
  Vercel environment and the database as two halves of the same secret, and
  do not let a single person or a single backup hold both.
- **Scheduled/bulk sending now depends on `worker/` actually being deployed
  and running, continuously.** This replaced the Supabase-cron-reaching-Vercel
  risk this bullet used to describe — that mechanism is gone as of migration
  156, along with its own failure mode (a drifted `app_secrets` value or a
  silently-stalled cron). The worker has different limitations of its own:
  no alerting if the process itself dies, and nothing stops a second replica
  from running alongside it. See `email-worker-setup.md`'s "Known
  limitations" section rather than this one for what to watch for now.
