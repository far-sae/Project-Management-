# Email Worker — Deployment

This guide covers deploying `worker/` — the persistent Node process that now
sends the email outbox — and confirming it is actually running. It supersedes
the sending mechanism described in `email-marketing-setup.md`: read that guide
first for the migrations, the Vercel routes and the encryption key, then use
this one to stand up the worker itself.

Background: `docs/superpowers/specs/2026-09-18-email-deliverability-design.md`,
and `worker/README.md` for the send cycle in detail.

---

## What the worker is, and why it replaced the Vercel tick

`api/email/tick.ts` — a Vercel serverless function poked once a minute by a
Supabase `pg_cron` job — used to drain the outbox. That design had a ceiling:
a serverless invocation runs for seconds, not minutes, so it could never pace
sends with a deliberate delay between messages, track which mailbox in a pool
sent last, or hold an SMTP connection open across a whole batch. It also had no
concept of a mailbox pool, a warmup ramp or an organization-wide send window —
all of that arrived in migration `156_mailbox_pool_and_worker.sql`, and none of
it fits inside a one-shot HTTP handler.

`worker/index.ts` is a long-running process instead: it loops forever, and each
cycle reads every organization's `mailbox_status` and `email_settings`, skips
any organization outside its send window, rotates the sendable mailboxes in
each pool least-recently-used first, and — per mailbox — decrypts its SMTP
password once, opens one connection, claims a slice of the queue through
`claim_email_batch()`, sends it with a random pause between messages, and
settles every row through `record_send_result()`.

**The worker must be the only sender.** Two processes claiming from the same
outbox is how a recipient receives the same message twice — the daily limits,
the warmup ramp and the send window are all enforced in this process, not in
the database, so a second sender does not just duplicate mail, it ignores
every one of those rules for whatever it sends. This is exactly why migration
156 also **removes** the per-minute `email_worker_minute` cron and its call to
`/api/email/tick`: there must never be a window where both the old tick and
this worker are live at once. Do not re-enable that cron, and do not restore
`api/email/tick.ts`. Run exactly one instance of `worker/` in production —
Railway's replica count for this service must stay at 1.

---

## Deploying on Railway

**Deploy from the repository root, not from `worker/`.** The worker cannot be
built as an isolated folder: `worker/lib/engine.ts` and `worker/lib/dns.ts`
import `@/lib/email/...`, which `worker/tsconfig.json`'s path mapping resolves
to `../src/lib/email` — the same pure send-window, mailbox-pool and SMTP-error
helpers the rest of the app uses, living outside `worker/` entirely. A build
scoped to `worker/` would see neither those source files nor the packages
(`tsx`, `@supabase/supabase-js`, `nodemailer`) that only the root
`package.json` declares. There is nothing to fix inside `worker/` to make it
self-contained — the fix is to not scope the build to it.

1. In the Railway project, add a new service from this repository.
2. Leave **Root Directory** empty (or set it to the repository root — do
   **not** set it to `worker`).
3. Set **Build Command** to:

   ```
   npm install
   ```

4. Set **Start Command** to:

   ```
   npm run worker
   ```

   This is the root `package.json`'s own `worker` script
   (`"worker": "tsx worker/index.ts"`) — it already exists, runs from the
   repository root, and needs nothing added. There is no compile step; `tsx`
   runs the TypeScript source directly.

5. Set the five environment variables below (Production only — this project
   has no separate Railway "preview" environment for the worker).
6. Deploy, then confirm it started (next section).
7. Set the service's **replica count to 1**. Running two copies is the one
   configuration this guide exists to prevent — see the warning above.

### The five environment variables

Every one of these is read by `env()` in `worker/lib/db.ts`, which the worker
calls before it claims a single row — if any is missing, it logs which one and
exits rather than claiming a batch it cannot use.

| Variable | Where the value comes from |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → **Project Settings → API**. Same project, same value as the Vercel deployment's `SUPABASE_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → **Project Settings → API**, the service-role secret key. Same value as Vercel's `SUPABASE_SERVICE_ROLE_KEY`. Never expose this to a browser. |
| `INTEGRATION_TOKEN_KEY` | **Must be the exact value already set in Vercel** (`email-marketing-setup.md`, Step 3/4). It decrypts the SMTP passwords that `api/email/account-secret.ts` encrypted with that same key — a different value here and the worker cannot read any stored password. |
| `EMAIL_UNSUBSCRIBE_SECRET` | **Must be the exact value already set in Vercel** (`email-marketing-setup.md`, Step 2/4). The worker signs the one-click unsubscribe link on the way out; `api/email/unsubscribe.ts` on Vercel verifies it on the way back. A mismatch 401s every link. |
| `PUBLIC_SITE_URL` | **Must be the exact value already set in Vercel** — your production origin, no trailing slash (e.g. `https://taskcalendar.app`). Used to build the unsubscribe links above. |

Two more are read directly by `worker/index.ts` and are optional — a missing
or invalid value falls back to the default rather than failing startup:

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_INTERVAL_MS` | `15000` | Pause between cycles, in milliseconds. |
| `WORKER_BATCH` | `50` | **Per organization**, not global — the worker serves every tenant in one pass, and this is the ceiling on how many messages any single organization's mailboxes may claim in one cycle (`selectMailboxes(pool, deps.maxPerCycle)` in `worker/lib/engine.ts` is called once per organization, with this same number, inside the loop over organizations). Raising it lets one busy organization claim more per cycle; it does not raise a shared, cross-tenant budget, because there is no such thing — each organization gets this full amount, every cycle. |

---

## Confirming it is running, from the Railway logs

On a clean start, the very first line is:

```
[2026-09-18 12:00:00] email worker started — one cycle every 15s, up to 50 messages per organisation per cycle.
```

If that line never appears, the process did not start — check the build logs
for a missing dependency or module (see the Root Directory note above and the
matching Troubleshooting row below) or a startup error naming a missing
environment variable (`worker/lib/db.ts`'s `env()` names the variable, never
its value).

After that, a healthy worker logs **only when there's something to say**:

- `[...] claimed 5, sent 4, failed 1, skipped 0` — one line per cycle that
  actually claimed anything.
- `[...] idle — <reason>` — logged once when the idle reason changes, not on
  every cycle (an idle worker outside its send window would otherwise write
  the same line four times a minute, all night). The reason is one of
  `describeSendWindow()`'s sentences (e.g. *"Sends between 08:00 and 18:00,
  Mon, Tue, Wed, Thu, Fri (Europe/London)."*) or one of `blockedReason()`'s
  (e.g. *"Every mailbox is paused."*, *"Every mailbox has used up its daily
  sending allowance."*).
- Up to five distinct failure reasons per cycle, each prefixed with the
  mailbox address that produced it, e.g.
  `[...] marketing@acme.com: Google rejected the username or password. ...`

Passwords and recipient lists are never logged, by design — there is nothing
in this process's log output that needs to be treated as a secret beyond the
environment variables themselves.

A redeploy sends `SIGTERM`. Expect `... SIGTERM received — stopping after the
message in flight.` followed by `... email worker stopped.` shortly after —
see `worker/README.md`'s "Shutdown" section for exactly what that grace period
does and does not guarantee.

---

## Troubleshooting

| Symptom | What's actually happening | Check |
|---|---|---|
| The worker exits immediately, or the build fails with `tsx: command not found` / `Cannot find module '@supabase/supabase-js'` / `Cannot find module '@/lib/email/...'` | Root Directory was set to `worker` instead of the repository root. Scoped that way, the build never sees the root `package.json`'s dependencies or the `src/lib/email` source the worker imports — see the note at the top of "Deploying on Railway" above. | Set Root Directory back to empty/repository root, Build Command `npm install`, Start Command `npm run worker`, and redeploy. |
| Nothing sends, campaigns stay `queued`/`sending` | Not a crash — this is the normal shape of "nothing to do." Either the pool is empty (`blockedReason()`: no mailboxes configured, every mailbox paused, or every mailbox has used its daily allowance) or every organization is currently outside its configured send window (`describeSendWindow()`). | Read the worker's `idle — <reason>` log line — it says which of the two, in words. Cross-check against the **Accounts** tab (mailbox status, paused reason) and the **Settings** tab (send window) in `/email`. |
| A mailbox stops sending and shows a red reason on the Accounts screen | Three consecutive SMTP failures paused it (`record_send_result()`'s `permanent` branch, matching `MAX_CONSECUTIVE_FAILURES` in `src/lib/email/mailboxPool.ts`). The reason is `friendlySmtpError()`'s message, which **names the provider** — Zoho, IONOS, Google or Microsoft — and what to do about it (an app password, re-enabling SMTP AUTH, etc.), because the fix differs by host. | Read the paused reason on the mailbox card, fix the credential or provider setting it names, then use **Resume** (admin only) to put it back in rotation. |
| A campaign's messages are stuck in `sending` after the worker crashed or was killed mid-batch | Expected, and self-healing — not a bug to chase. `claim_email_batch()`'s stuck-row sweep (migration 156, carried over from 155) runs on every claim and settles any row that has been `sending` for more than ten minutes: `sent` if a `provider_message_id` proves it was actually delivered, `failed` once its three attempts are spent, otherwise back to `queued`. | Give it up to ten minutes and check again — no manual intervention needed. If rows are still stuck well past that, confirm the worker is actually running (see the previous section) rather than editing rows by hand. |
| SMTP authentication fails for every mailbox on one provider | See the second row above — this is provider-specific, not worker-specific. Gmail/Google Workspace, Zoho and IONOS all reject a plain account password for SMTP and require an app-specific password; Microsoft 365 has SMTP AUTH disabled by default and an admin must turn it on per mailbox. | Read the mailbox's paused reason or the worker's log line for the exact provider name and instructions, rather than guessing which provider's rules apply. |

---

## Known limitations

- **No alerting on a silently-idle worker.** If the process itself dies
  (rather than logging `idle`), nothing pages anyone — the Railway service
  simply shows as crashed/restarting. Treat the "confirming it is running"
  section above as something to check by hand until Railway alerting (or
  equivalent) is wired up for this service.
- **One instance only, and nothing enforces that but this document.** Railway
  will happily run more replicas if the count is raised; there is no
  application-level lock that refuses a second sender.
