# Email Marketing — Deployment & Secrets Setup

This guide walks through everything needed **outside the code** to make the
Email page (`/email`) actually send mail in production: applying the
migrations, generating secrets, setting them in Vercel, and wiring the
Supabase cron job that drives the send loop. Until you finish these steps,
sending stays broken even though the app builds and deploys cleanly.

Background: `docs/superpowers/specs/2026-09-18-email-marketing-design.md`.

---

## How the pieces fit together

- **Sending runs on Vercel** (`api/email/tick.ts`), not in a Supabase Edge
  Function, because Deno blocks outbound SMTP ports 25 and 587 and
  Microsoft 365 requires 587 (see migration `153_email_claim_and_cron.sql`).
- **A Supabase `pg_cron` job** (`email_worker_minute`, added in the same
  migration) calls `public.kick_email_worker()` every minute, which reads a
  URL and a shared secret out of `public.app_secrets` and POSTs to
  `<site>/api/email/tick`. If those two `app_secrets` rows aren't set,
  the cron job runs but the function returns immediately — nothing sends,
  silently.
- **SMTP passwords are encrypted server-side.** The browser posts the
  plaintext password over TLS to `POST /api/email/account-secret`
  (`src/services/supabase/email.ts` → `api/email/account-secret.ts`), which
  encrypts it there with the server-only `INTEGRATION_TOKEN_KEY` and writes
  the ciphertext with the service-role client. The key is never shipped to a
  browser. `email_account_secrets` has a deny-all RLS policy (migration
  `152`), so only the service role — used by the Vercel routes — can read the
  ciphertext back out.

---

## Step 1 — Apply the migrations

Three migrations ship this feature: `152_email_marketing_schema.sql` (the
tables), `153_email_claim_and_cron.sql` (the atomic claim function + the
cron job, and it also drops the dead `crm_automation_worker_minute` cron left
over from migration 143), and `154_claim_respects_suppressions.sql` (closes a
race where a mid-campaign unsubscribe didn't stop already-queued mail).
Apply all three, in order — they must not be split up or reordered.

```bash
npx supabase db push --linked
```

This applies every migration newer than what's already on the linked
project, which includes 152, 153 and 154 as long as nothing later depends on
skipping them. If you'd rather apply them by hand (e.g. no linked CLI
project), open the Supabase dashboard → **SQL Editor** and paste the contents
of each file, in numeric order: `152_email_marketing_schema.sql`, then
`153_email_claim_and_cron.sql`, then `154_claim_respects_suppressions.sql`.

Verify in **Table Editor** that `email_accounts`, `email_account_secrets`,
`email_campaigns`, `email_messages` and `email_suppressions` now exist, and
that `public.claim_email_batch` exists under **Database → Functions**.

---

## Step 2 — Generate the two new secrets

`EMAIL_WORKER_SECRET` (authenticates the cron's call to `/api/email/tick`)
and `EMAIL_UNSUBSCRIBE_SECRET` (signs one-click unsubscribe tokens) each need
32 random bytes, base64url-encoded. Run this once per secret — **do not
reuse the same value for both**:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run it twice and save each output somewhere safe (1Password, etc.):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # → EMAIL_WORKER_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # → EMAIL_UNSUBSCRIBE_SECRET
```

---

## Step 3 — Reuse (or generate) `INTEGRATION_TOKEN_KEY`

`INTEGRATION_TOKEN_KEY` is the AES-256 key (`api/_lib/crypto.ts`) that
encrypts SMTP passwords in `api/email/account-secret.ts` and decrypts them
again in `api/email/verify.ts` and `api/email/tick.ts`. It is a server-only
variable — it must never be exposed to the browser. This project already uses
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

Set these for **both Production and Preview** (the worker, verify, and
unsubscribe routes all run in both environments):

| Variable | Used by | What it is |
|---|---|---|
| `SUPABASE_URL` | `api/_lib/context.ts` (`serviceClient`) | Your Supabase project URL, e.g. `https://xxxx.supabase.co` (Project Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/_lib/context.ts` (`serviceClient`) | The service-role secret key (Project Settings → API). Never expose this to the browser. |
| `INTEGRATION_TOKEN_KEY` | `api/email/account-secret.ts` (`encryptSecret`), `api/email/verify.ts`, `api/email/tick.ts` (`decryptSecret`) | From Step 3. Server-only — do **not** mirror it into a `VITE_*` variable. |
| `EMAIL_WORKER_SECRET` | `api/email/tick.ts` (checked against the `x-worker-secret` header) | From Step 2 |
| `EMAIL_UNSUBSCRIBE_SECRET` | `api/email/unsubscribe.ts`, `api/email/tick.ts` | From Step 2 |
| `PUBLIC_SITE_URL` | `api/_lib/context.ts` (`siteUrl`), used by `api/email/tick.ts` to build unsubscribe links | Your production site origin, no trailing slash, e.g. `https://taskcalendar.app` |

Using the Vercel CLI, for each variable:

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_URL preview
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY preview
vercel env add INTEGRATION_TOKEN_KEY production
vercel env add INTEGRATION_TOKEN_KEY preview
vercel env add EMAIL_WORKER_SECRET production
vercel env add EMAIL_WORKER_SECRET preview
vercel env add EMAIL_UNSUBSCRIBE_SECRET production
vercel env add EMAIL_UNSUBSCRIBE_SECRET preview
vercel env add PUBLIC_SITE_URL production
vercel env add PUBLIC_SITE_URL preview
```

Each prompts for the value on stdin. Equivalently, in the Vercel dashboard:
**Project → Settings → Environment Variables**, add each name/value pair with
both **Production** and **Preview** checked.

---

## Step 5 — Configure the database side so the cron can reach Vercel

`public.kick_email_worker()` (migration 153) reads its target URL and shared
secret from `public.app_secrets` — a deny-all-to-`authenticated` key/value
table (same pattern as migration 111). Run this in the SQL Editor, as the
project owner:

```sql
insert into public.app_secrets(key, value) values
  ('site_url', 'https://<your-domain>'),
  ('email_worker_secret', '<EMAIL_WORKER_SECRET value>')
on conflict (key) do update set value = excluded.value;
```

Use the same `EMAIL_WORKER_SECRET` value you set in Vercel in Step 4 — if
they don't match, every cron tick gets a 401 (see Troubleshooting below).
`site_url` should be the same origin as `PUBLIC_SITE_URL`.

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
   the row's status reaches `sent` (this requires the cron from Step 5 to be
   ticking, or you can call `POST /api/email/tick` with the
   `x-worker-secret` header yourself to force one pass).
3. To test unsubscribe, send a second campaign to **two or more** recipients
   (making it `kind: 'bulk'`) so the outgoing mail carries the unsubscribe
   link. Click that link (or POST to it, per RFC 8058) and confirm a new row
   appears in `public.email_suppressions` — visible in the **Suppression**
   tab in the app.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing sends, campaign stays `sending`/`queued` forever | `select * from public.app_secrets where key in ('site_url','email_worker_secret');` — both rows must exist and `email_worker_secret` must match Vercel's `EMAIL_WORKER_SECRET`. Then check the cron itself: `select * from cron.job;` (look for `email_worker_minute`) and `select * from cron.job_run_details order by start_time desc limit 5;` for its last run status. |
| `POST /api/email/tick` returns 401 | Secret mismatch — the `x-worker-secret` header (from `app_secrets.email_worker_secret`) doesn't match Vercel's `EMAIL_WORKER_SECRET`. Re-run the Step 5 `insert ... on conflict` with the current value. |
| SMTP call times out on port 587 | Confirm the send is going through the Vercel function (`api/email/tick.ts` / `api/email/verify.ts`), not a Supabase Edge Function — Deno on Supabase Edge blocks outbound 25/587, which is exactly why this worker runs on Vercel instead. |
| SMTP "authentication failed" | For Gmail/Google Workspace accounts, `smtp_username`/password must be an **app password**, not the account's login password (Google requires 2FA + an app-specific password for SMTP AUTH). |

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
- **Scheduled/bulk sending depends on the Supabase cron reaching the Vercel
  endpoint.** If `public.app_secrets` isn't configured (Step 5), or the
  values there drift from what's set in Vercel, `kick_email_worker()` either
  no-ops or gets a 401 — campaigns sit in `queued`/`sending` indefinitely with
  no error surfaced anywhere in the app UI. There is currently no alerting on
  a silently-stalled cron; treat `select * from cron.job_run_details ...`
  as the source of truth when campaigns aren't moving.
