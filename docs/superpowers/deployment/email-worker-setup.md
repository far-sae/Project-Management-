# Email Worker — Deployment

This guide covers deploying `worker/` — the persistent Node process that now
sends the email outbox, scans each mailbox's own inbox for replies and
bounces, and moves multi-step sequences along — and confirming it is actually
running. It supersedes the sending
mechanism described in `email-marketing-setup.md`: read that guide first for
the migrations, the Vercel routes and the encryption key, then use this one to
stand up the worker itself.

This guide also assumes migration `157_inbox_sync.sql` has been applied, in
the same numeric order as the rest (`email-marketing-setup.md`, Step 1). It
adds `imap_host`/`imap_port`/`imap_secure`/`imap_status`/`imap_last_error`/
`inbox_last_scan_at`/`sent_folder_enabled` to `email_accounts`, `replied_at`/
`bounced_at` to `email_messages`, and the `email_inbox_events` table the inbox
loop below writes to. Nothing in it is required for sending: every column it
adds defaults to the "not configured" state, and a database that has not run
it yet still sends exactly as `email-marketing-setup.md` describes — the inbox
loop below simply finds no mailbox with an `imap_host` to scan.

Migration `161_email_open_tracking.sql` adds open tracking, and it is inert
until somebody switches it on: the `track_opens` column defaults to false, and
nothing is tracked, recorded or inferred for an organization that has not been
to **Email -> Settings** and turned it on. The pixel is served by
`/api/email/open` on Vercel, which needs no new environment variable -- it
signs with the same `EMAIL_UNSUBSCRIBE_SECRET` the unsubscribe link uses.

What to tell a user who asks why the number looks low, or high: Apple Mail
pre-fetches every image in every message and has done since 2021, and security
scanners fetch every URL in inbound mail within seconds of delivery. Both are
counted and flagged as automatic, and the screens separate them. Clients that
block images record nothing at all, so the honest reading is that an open count
is a floor with false positives on top -- never a read receipt.

It also assumes migrations `158_email_sequences.sql`,
`159_sequence_engine.sql` and `160_claim_respects_pinned_mailbox.sql` have been
applied, in that order and after 157. They add the sequence tables, the
functions that move an enrollment along, and one condition in
`claim_email_batch()` so a follow-up leaves from the mailbox its thread started
on. Like 157, none of it is required for sending: a database that has not run
them still sends campaigns exactly as before, and the sequence loop below finds
no enrollment to move.

**160 drops and re-creates `claim_email_batch()`**, because its return type
gains two columns. It is dropped by exact signature and re-created in the same
file, so the only window in which the worker has no claim is the moment
between the two statements — but run 160 in one go rather than statement by
statement, and if the worker logs `could not claim` immediately after, re-run
the file.

Background: `docs/superpowers/specs/2026-09-18-email-deliverability-design.md`,
`docs/superpowers/specs/2026-09-19-email-inbox-sync-design.md`,
`docs/superpowers/specs/2026-09-19-email-sequences-design.md`, and
`worker/README.md` for the send cycle in detail.

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

## What the inbox loop is, and why an IMAP problem never affects sending

The same process also runs a second loop, on its own much slower interval: it
reads each mailbox that has an `imap_host` set, over IMAP, and records the
replies and bounces it finds through `record_inbox_result()` (migration 157).
It shares nothing with the send loop but the shutdown flag — no queue, no
connection, no failure path — because reading a mailbox and sending from it
are separate permissions at every provider. Google and Zoho both issue app
passwords with IMAP access left off by default, so it is entirely normal for a
mailbox to send perfectly well while its inbox cannot be read at all.

**IMAP is optional, and a mailbox with no `imap_host` is simply not scanned —
not an error, not a mailbox left half-configured.** Everything from
`email-marketing-setup.md` and the rest of this guide works identically
whether or not any mailbox has IMAP set up. Fill it in from the mailbox form's
"Inbox" section in the app (**Email → Accounts**, the "Limits" button on a
mailbox, or while adding one) — there is nothing to set here on the worker
side beyond the one optional environment variable below.

**An IMAP failure never stops or slows sending, for any mailbox, ever.** The
inbox loop writes only `imap_status`, `imap_last_error` and
`inbox_last_scan_at` — never `status`, `is_active` or
`consecutive_failures`, which are what the send loop's `claim_email_batch()`
and `record_mailbox_failure()` consult. A mailbox can show a red inbox error
on the Accounts screen and go on sending campaigns normally in the same
minute; that is the intended state for any mailbox whose app password was
only ever granted send scope, not a bug to chase. See the Troubleshooting row
below for what to do about it anyway.

One more status is worth knowing before it shows up: `imap_status` can also
read `'incomplete'`. That is **not** a failure either — it means the mailbox
was read successfully (connected, logged in, envelopes fetched) but something
after that stopped the scan from finishing, so the next pass simply re-reads
the same window. The Accounts screen renders it as a plain, non-red remark
for exactly that reason; do not go looking for a credential problem on a
mailbox that says `incomplete`.

---

## What the sequence loop is, and why it sends nothing itself

A third loop, slower again, runs once a minute. It does exactly two things:

1. It calls `reconcile_stalled_enrollments()`, which is a safety net rather
   than routine work — see below.
2. It calls `claim_sequence_enrollments()` for up to fifty people whose next
   step has fallen due, and writes one ordinary `email_messages` row for each.

**It never sends.** It writes a queued row and stops. Everything that decides
whether that row may go out — the mailbox pool, the daily and hourly caps, the
warmup ramp, the send window, the suppression list, the three-attempt retry
budget — is applied afterwards by the send loop, unchanged, because a sequence
step is an ordinary message. That is the whole design: a second sender would
drift from those rules, and what drift costs here is the customer's sending
domain.

Two consequences worth knowing before somebody reports them as bugs:

- **A sequence makes a mailbox's queue longer, never its daily volume larger.**
  A three-step sequence to 200 people is 600 messages over its run, and the
  same daily limit and warmup ramp still bound how fast they leave. So a
  campaign started while a sequence is running will look slower. It is not
  throttled or stuck; it is queued behind mail that is also queued.
- **A follow-up is pinned to the mailbox its thread started on.** The first
  step goes out through whichever pool member was free, and every later step
  for that person waits for the same one. So a person's follow-up can sit
  queued while other mailboxes in the pool are idle. The alternative is a
  reply arriving from a different address than the message it answers, which
  the recipient's client will not thread and which reads as a second stranger.

### `reconcile_stalled_enrollments()`, and what a non-zero count means

The worker logs a line whenever this returns anything other than zero, and it
is worth reading when it does.

The claim advances a person to their next step and clears their due date in
one statement, and it takes nothing with a null due date. From that instant the
only thing that can move them again is their message reaching a final state —
so any path that ends a message without ending or rescheduling its enrollment
leaves that person frozen while every screen still shows them active. The
function sweeps up anyone in that state: an active enrollment with no due date
whose most recent message is `failed` or `suppressed`.

A non-zero count is not an error and needs no action — the sweep has already
fixed it. It does mean one of those paths fired, most often an address
suppressed between the step being queued and the send claim picking it up,
which is ordinary. A count that is non-zero on most cycles is worth
investigating.

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

   `tsx` is declared in the root `package.json`'s **`dependencies`**, not
   `devDependencies`, on purpose: it is a runtime requirement for this
   service (the process that runs in production needs it every time it
   starts), not a build-time-only tool. Several Node platform builders,
   Railway included, set `NODE_ENV=production` during the build step, and
   `npm install` skips `devDependencies` under that setting — a `tsx` left
   in `devDependencies` would make the plain `npm install` build command
   above produce an image that builds successfully and then fails to start.

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

Three more are read directly by `worker/index.ts` and are optional — a
missing or invalid value falls back to the default rather than failing
startup:

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_INTERVAL_MS` | `15000` | Pause between send cycles, in milliseconds. |
| `WORKER_BATCH` | `50` | **Per organization**, not global — the worker serves every tenant in one pass, and this is the ceiling on how many messages any single organization's mailboxes may claim in one cycle (`selectMailboxes(pool, deps.maxPerCycle)` in `worker/lib/engine.ts` is called once per organization, with this same number, inside the loop over organizations). Raising it lets one busy organization claim more per cycle; it does not raise a shared, cross-tenant budget, because there is no such thing — each organization gets this full amount, every cycle. |
| `INBOX_INTERVAL_MS` | `300000` (5 minutes) | Pause between inbox scans — deliberately far coarser than `WORKER_INTERVAL_MS`: a reply noticed a few minutes late costs nothing, and logging into every configured mailbox's IMAP server every fifteen seconds is itself the kind of pattern providers throttle. Applies across every organization's mailboxes together, the same way `WORKER_INTERVAL_MS` paces the send loop. |

---

## Confirming it is running, from the Railway logs

On a clean start, the very first line is:

```
[2026-09-18 12:00:00] email worker started — one cycle every 15s, up to 50 messages per organisation per cycle; inbox scan every 5m.
```

(The "inbox scan every" figure reflects `INBOX_INTERVAL_MS`, so it reads
differently if that variable is set to something other than its default.)

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
- `[...] inbox: scanned 3, replies 1, bounces 0` — once per inbox pass that
  actually scanned a mailbox. **Silent when there is nothing to scan**, so a
  deployment where no mailbox has `imap_host` set writes no inbox line at
  all — that is the expected, healthy state for IMAP being entirely optional,
  not a sign the loop isn't running.
- `[...] inbox <mailbox address>: <reason>` — up to five distinct inbox
  failures per pass, in the same shape as the send failures above. These are
  entirely separate from the `claimed`/`sent`/`failed` line: an inbox failure
  never appears there, because it never affects sending (see "What the inbox
  loop is" above).

Passwords, recipient lists, subjects and message bodies are never logged, by
design — there is nothing in this process's log output that needs to be
treated as a secret beyond the environment variables themselves.

A redeploy sends `SIGTERM`. Expect `... SIGTERM received — stopping after the
message in flight.` followed by `... email worker stopped.` shortly after —
see `worker/README.md`'s "Shutdown" section for exactly what that grace period
does and does not guarantee.

---

## Configuring IMAP for inbox health

**IMAP is optional.** Skip this section entirely and the worker sends exactly
as `email-marketing-setup.md` describes — a mailbox with no `imap_host` is
simply never scanned. Fill it in per mailbox from the app: **Email →
Accounts**, either while adding a mailbox or from the existing "Limits"
button, whose dialog gained an "Inbox" section alongside the sending limits.

The same SMTP credential is reused for IMAP — there is no separate password to
store — so only the host, port and TLS setting need filling in. Typical
values:

| Provider | IMAP host | Port | TLS |
|---|---|---|---|
| Gmail / Google Workspace | `imap.gmail.com` | 993 | on |
| Zoho Mail | `imap.zoho.com` (or your region's Zoho IMAP host, e.g. `imap.zoho.eu`) | 993 | on |
| Microsoft 365 / Outlook | `outlook.office365.com` | 993 | on |
| IONOS | `imap.ionos.com` (or your region's IONOS IMAP host) | 993 | on |
| Most other providers | usually `imap.<your domain>` | 993 | on |

993 with TLS is the standard, encrypted IMAP port and the form's own default;
143 (cleartext) exists but should not be used. The form suggests a host by
swapping a leading `smtp` for `imap` in whatever SMTP host is already typed
(e.g. `smtp.acme.com` → `imap.acme.com`) — a starting guess to edit or
replace, never a value saved silently.

**App passwords.** Exactly like SMTP, Gmail/Google Workspace and Zoho commonly
issue an app password that is scoped to one protocol — an app password created
for sending does not automatically grant IMAP access. If an inbox shows a red
error mentioning authentication, the mailbox's app password (or its IMAP
access toggle, for Zoho) usually needs a second look separately from whatever
was set up for SMTP; see the Troubleshooting row below.

**The "File a copy in Sent" switch**, also in the Inbox section, defaults to
on and files a copy of every delivered message into the mailbox's own Sent
folder over the same IMAP connection. It is skipped automatically for any
host `worker/lib/engine.ts` recognises as Google, since Gmail already files
its own copy of an SMTP send and a second one would double it — but that
detection reads the *SMTP* hostname, so a Google Workspace mailbox sent
through a custom relay hostname is not caught by it and would get two copies
with no way to stop them from the Google side. Turn the switch off for that
one mailbox if its owner reports duplicates; it has no effect at all on a
mailbox with no `imap_host` set, since there is then no Sent folder to file a
copy into.

### Verifying migration 157 actually applied

Migration `157_inbox_sync.sql` rewrites `email_accounts`' `imap_status` check
constraint **by its conventional name**
(`email_accounts_imap_status_check`) rather than relying on the column's own
inline definition, specifically so a database that already ran an earlier
revision of this migration ends up with the same four-value constraint either
way. That rewrite is the one assumption in the whole migration nobody has
been able to exercise against a real database before this feature saw
traffic — run this once, right after applying it, in the Supabase SQL editor.

**Pick a mailbox with no `imap_host`.** The first query below finds one. A
mailbox that is being scanned must not be used here: the check writes
`imap_status` and `imap_last_error` on the row it names, and while the two
statuses used below both leave `inbox_last_scan_at` alone, restoring a row
whose status was `'active'` would mean calling `touch_inbox_scan(..., 'active',
...)`, and `'active'` is the one status that moves the scan cursor. Moving it
by hand skips whatever arrived in the window it steps over, which is a day of
that customer's replies and bounces, unrecoverably. An unconfigured mailbox
has no cursor to lose.

```sql
-- A mailbox that is not being scanned, which is the only safe subject for
-- this check. If this returns nothing, every mailbox on this database has
-- IMAP configured: skip the check rather than running it against a live one
-- (the constraint rewrite will be exercised by the first real scan anyway,
-- and a failure shows up as a raise from the worker, not as lost mail).
select id, from_email, imap_status
  from public.email_accounts
 where coalesce(trim(imap_host), '') = ''
 limit 1;

-- Confirms the constraint accepts 'incomplete' specifically -- the one
-- status value nothing else in the app writes until a real scan hits the
-- code path that produces it. Replace <account-id> with the id printed
-- above; this writes and reads back, then restores what it found.
select imap_status as before_value, inbox_last_scan_at as before_cursor
  from public.email_accounts where id = '<account-id>';

select public.touch_inbox_scan('<account-id>', 'incomplete', null);

select imap_status, imap_last_error, inbox_last_scan_at
  from public.email_accounts where id = '<account-id>';
-- Expect: imap_status = 'incomplete', imap_last_error = null, and
-- inbox_last_scan_at UNCHANGED from before this call -- 'incomplete' holds
-- the scan cursor rather than advancing it (migration 157, part e), which is
-- what lets the next real scan re-read the same window.

-- Put the row back the way it was found. 'unconfigured' is what an unscanned
-- mailbox carries, and it holds the cursor too, so this restore changes
-- nothing but the status column.
select public.touch_inbox_scan('<account-id>', 'unconfigured', null);

-- Confirm the cursor is exactly where before_cursor said it was.
select imap_status, inbox_last_scan_at
  from public.email_accounts where id = '<account-id>';
```

If the middle `select` instead raises a constraint violation, the rewrite did
not take — `email_accounts_imap_status_check` on that database still reflects
whatever the column's very first `add column` created, and the migration
needs re-running (its `drop constraint if exists` / `add constraint` pair is
safe to run again on its own).

---

## Troubleshooting

| Symptom | What's actually happening | Check |
|---|---|---|
| The worker exits immediately, or the build fails with `tsx: command not found` / `Cannot find module '@supabase/supabase-js'` / `Cannot find module '@/lib/email/...'` | Two distinct causes produce the same symptom. **(1) Root Directory was set to `worker`** instead of the repository root — scoped that way, the build never sees the root `package.json`'s dependencies or the `src/lib/email` source the worker imports; see the note at the top of "Deploying on Railway" above. **(2) The build installed only production dependencies** — some platforms pass `--omit=dev` or run with `NODE_ENV=production` during `npm install`, which skips `devDependencies` entirely. `tsx`, `@supabase/supabase-js` and `nodemailer` are all in the root `package.json`'s `dependencies` specifically so this can't happen to them — if one of them is still reported missing after confirming Root Directory is correct, something in the platform's build configuration is stripping `dependencies` too, which is a platform issue rather than a `package.json` one. | For (1): set Root Directory back to empty/repository root, Build Command `npm install`, Start Command `npm run worker`, and redeploy. For (2): if a genuinely new runtime import is ever added to `worker/`, its package must go in the root `package.json`'s `dependencies`, never `devDependencies` — that's the whole fix, not a platform setting to hunt down. |
| Nothing sends, campaigns stay `queued`/`sending` | Not a crash — this is the normal shape of "nothing to do." Either the pool is empty (`blockedReason()`: no mailboxes configured, every mailbox paused, or every mailbox has used its daily allowance) or every organization is currently outside its configured send window (`describeSendWindow()`). | Read the worker's `idle — <reason>` log line — it says which of the two, in words. Cross-check against the **Accounts** tab (mailbox status, paused reason) and the **Settings** tab (send window) in `/email`. |
| A mailbox stops sending and shows a red reason on the Accounts screen | Three consecutive SMTP failures paused it (`record_send_result()`'s `permanent` branch, matching `MAX_CONSECUTIVE_FAILURES` in `src/lib/email/mailboxPool.ts`). The reason is `friendlySmtpError()`'s message, which **names the provider** — Zoho, IONOS, Google or Microsoft — and what to do about it (an app password, re-enabling SMTP AUTH, etc.), because the fix differs by host. | Read the paused reason on the mailbox card, fix the credential or provider setting it names, then use **Resume** (admin only) to put it back in rotation. |
| A campaign's messages are stuck in `sending` after the worker crashed or was killed mid-batch | Expected, and self-healing — not a bug to chase. `claim_email_batch()`'s stuck-row sweep (migration 156, carried over from 155) runs on every claim and settles any row that has been `sending` for more than ten minutes: `sent` if a `provider_message_id` proves it was actually delivered, `failed` once its three attempts are spent, otherwise back to `queued`. | Give it up to ten minutes and check again — no manual intervention needed. If rows are still stuck well past that, confirm the worker is actually running (see the previous section) rather than editing rows by hand. |
| SMTP authentication fails for every mailbox on one provider | See the second row above — this is provider-specific, not worker-specific. Gmail/Google Workspace, Zoho and IONOS all reject a plain account password for SMTP and require an app-specific password; Microsoft 365 has SMTP AUTH disabled by default and an admin must turn it on per mailbox. | Read the mailbox's paused reason or the worker's log line for the exact provider name and instructions, rather than guessing which provider's rules apply. |
| A mailbox's Accounts card shows a red inbox error, or the worker logs `inbox <address>: ...` naming an authentication failure | **This never stops or slows sending** — `status`/`is_active`/`consecutive_failures` (the send path) and `imap_status`/`imap_last_error` (the inbox path) are separate columns, updated by separate functions, and the inbox loop writes only the second pair. The failure itself is almost always the app-password scope: Zoho and Google Workspace both commonly issue an app password that covers SMTP but not IMAP, so sending works while the inbox read is rejected. `classifyImapError()`'s message names the provider — for Zoho specifically it reads *"Zoho needs an app password and IMAP access enabled for the mailbox."*; for everything else, *"Use the full email address as the username, and an app password if two-factor is on."* | Fix (or generate a second, IMAP-scoped) app password for that mailbox and re-check the host/port in the Inbox section — there is no "resend" for IMAP the way **Resume** exists for a paused sender; the next scheduled scan (`INBOX_INTERVAL_MS`) simply tries again once the credential is fixed. Confirm sending was never affected by checking the mailbox's ordinary status and the campaign it's part of, which should show no interruption. |

---

## Known limitations

- **No alerting on a silently-idle worker.** If the process itself dies
  (rather than logging `idle`), nothing pages anyone — the Railway service
  simply shows as crashed/restarting. Treat the "confirming it is running"
  section above as something to check by hand until Railway alerting (or
  equivalent) is wired up for this service.
- **One instance only, and nothing enforces that but this document.** Railway
  will happily run more replicas if the count is raised; there is no
  application-level lock that refuses a second sender. The sequence claim uses
  `FOR UPDATE SKIP LOCKED`, so a second instance would not send a step twice —
  but the send loop's pacing and the warmup ramp both assume one sender.
- **A sequence's step delays are a floor, not a schedule.** "72 hours" means
  the follow-up becomes eligible 72 hours after the previous step was actually
  sent. It then waits for the send window, the mailbox's remaining daily
  allowance and its turn in the queue, so it goes out at or after that mark,
  never before and sometimes well after. There is no way to schedule a step
  for a specific clock time.
- **The inbox loop reads envelopes, and bodies only for bounce candidates.**
  Every message's envelope (from, subject, date) is read to recognise a reply
  or a bounce; a message's body is downloaded, in-memory, only once its
  envelope already looks like a bounce, to read the failed address out of the
  delivery-failure report. Nothing it reads is ever stored — the customer's
  own mail stays in their mailbox — so there is no way to view the text of a
  reply, or the DSN body of a bounce, from inside this app.
