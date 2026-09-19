# Email sending worker

A persistent Node process that sends the email outbox. It replaces the Vercel
`/api/email/tick` route, which was removed together with its per-minute cron in
migration `156_mailbox_pool_and_worker.sql`.

> **It must be the only sender.** Two processes claiming from the same outbox is
> how a recipient receives the same message twice, and the daily limits, the
> warmup ramp and the send window are all enforced here rather than in the
> database. Run exactly one instance. Do not re-enable the `email_worker_minute`
> cron job, and do not restore `api/email/tick.ts`.

## What a cycle does

1. Reads `email_settings` and `mailbox_status` for every organisation.
2. Skips any organisation outside its send window — the queue simply waits.
3. Orders that organisation's sendable mailboxes least-recently-used first and
   gives each a slice of the cycle's budget, capped by what is left of its own
   effective limit for today (warmup included).
4. For each mailbox: decrypts its SMTP password, opens one connection, calls
   `claim_email_batch(mailbox, slice)`, and for each claimed row checks that the
   recipient's domain can receive mail, builds the message, sends it, settles it
   with a single `record_send_result(...)` call, then pauses a random interval
   before the next one.
5. Closes the connection and moves on to the next mailbox.

A mailbox whose credential cannot be read is skipped *before* anything is
claimed, so its share of the queue stays queued for a mailbox that can send it.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `SUPABASE_URL` | yes | The project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key. The worker has no user session, so it cannot satisfy row level security any other way. Server-side only — never give it a `VITE_` prefix. |
| `INTEGRATION_TOKEN_KEY` | yes | 32-byte base64url AES-256-GCM key that the stored SMTP passwords are encrypted with. The same value the Vercel routes use, or the worker cannot decrypt what they wrote. |
| `EMAIL_UNSUBSCRIBE_SECRET` | yes | HMAC secret for one-click unsubscribe links. Must match `api/email/unsubscribe.ts`, or every link 401s. |
| `PUBLIC_SITE_URL` | yes | Public origin, no trailing slash, e.g. `https://taskcalendar.app`. Unsubscribe links are built from it. |
| `WORKER_INTERVAL_MS` | no | Pause between cycles. Default `15000`. |
| `WORKER_BATCH` | no | Messages per organisation per cycle. Default `50`. |

The worker refuses to start if a required variable is missing, naming it and
never printing its value.

## Running it

```bash
# from the repository root
npm run worker
```

This is the only supported way to run it — `worker/` has no `package.json`
of its own (see `docs/superpowers/deployment/email-worker-setup.md` for why:
it shares the pure email helpers in `src/lib/email` and the packages in the
root `package.json`, so it cannot be built or started as an isolated
folder). Runs `tsx`, so there is no build step. On Railway, use `npm run
worker` as the start command with Root Directory left at the repository
root, set the variables above, and keep the replica count at one.

### Shutdown

A redeploy sends `SIGTERM`. The worker stops at the next message boundary — it
checks between organisations, between mailboxes and between messages — settles
the message in flight, hands the rest of that mailbox's claimed batch back to the
queue, and exits. It takes no pacing pause on the way out, so what a shutdown
costs is the message already on the wire and nothing else: at worst the SMTP
socket timeout, 30 seconds. A batch of 50 with the default jitter runs up to
twenty minutes, which is why it does not wait for the cycle to end.

It is not instant, and it is not a guarantee. Anything that kills the process
outright — `SIGKILL`, an OOM kill, a shutdown grace period that expires while a
message is on the wire, or a **second** `SIGINT`/`SIGTERM`, which exits
immediately by design — leaves the rows that cycle had claimed in `sending`.
They are not lost: `claim_email_batch()` sweeps rows stuck there for more than
ten minutes and either settles them as `sent` (when a `provider_message_id`
proves delivery), retires them at three attempts, or returns them to the queue.
The cost is a delay of up to ten minutes, not a dropped message.

The residual risk runs the other way, and it is a duplicate rather than a loss:
a message SMTP already accepted, killed before `record_send_result()` could
store its `provider_message_id`, looks to the sweep exactly like one that never
went out, so it is requeued and sent again. The pathological ceiling on that is
**three deliveries, not two** — the sweep will requeue such a row on each pass
until the three-attempt budget is spent, and every pass can be one that was
killed the same way. It needs the process to be killed outright during the same
message three times over, which is why it is a residual rather than an expected
cost; but two is the wrong number to plan around.

## Logs

One line per cycle that did something, plus up to five distinct failure reasons,
each naming the mailbox address that produced it. Passwords are never logged and
recipient lists are never logged; an idle worker logs its reason once, when it
changes, rather than on every cycle.
