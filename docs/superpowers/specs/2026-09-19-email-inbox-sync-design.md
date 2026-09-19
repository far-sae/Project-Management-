# Email phase 2: replies, bounces and sent-folder sync

**Date:** 2026-09-19
**Status:** Approved, ready for implementation plan
**Builds on:** `2026-09-18-email-deliverability-design.md` (phase 1)

## Problem

Phase 1 can send well. It is blind to what comes back.

- **A reply is invisible.** The person you were trying to reach answers, and the
  app never knows. In phase 3 that becomes actively harmful, because a sequence
  would keep sending follow-ups to someone who already replied.
- **A bounce is invisible.** Many providers accept a message and only later
  discover the recipient does not exist, so the failure arrives as a separate
  email rather than as an SMTP error. Phase 1 records that message as sent. The
  address stays on the list and is mailed again, and bounce rate is the metric
  that gets a sender throttled.
- **Sent mail exists nowhere.** SMTP hands a message to the server for delivery
  and puts a copy in no folder. Mail clients do that themselves, which is why
  app-sent mail appears in no one's Sent folder. The customer's own mailbox has
  no record of what was sent from it.

## Goal

The worker reads each connected mailbox on a schedule. A reply marks the
message and its contact, and is shown in the campaign. A bounce suppresses the
address automatically. Every message the worker sends is filed in the mailbox's
own Sent folder.

## Decisions taken

| Question | Decision |
|---|---|
| Protocol | IMAP, polled by the same worker. There is no inbound webhook for an ordinary mailbox. |
| Credentials | The mailbox's existing stored password is reused. Only host, port and TLS are new fields, defaulted from the SMTP host. |
| What a reply does | Marks the message replied and records it against the contact. Stopping follow-ups arrives with sequences in phase 3. |
| Does a reply suppress? | No. A reply is engagement, not an opt-out. Only an unsubscribe or a bounce suppresses. |
| Message bodies | Never downloaded for reply detection; envelopes only. Bounce detection downloads only messages that already look like bounces. |
| Sent-folder sync | On, using the exact bytes that were sent, so the copy matches what the recipient received. |

## Architecture

The worker gains a second, slower loop. Sending runs every fifteen seconds;
the inbox scan runs every five minutes, because a reply that is noticed four
minutes late costs nothing and an IMAP login per mailbox per fifteen seconds is
itself a throttling trigger.

```
worker
 ├─ send cycle   (15s)  claim → send → settle → append to Sent
 └─ inbox cycle  (5m)   per mailbox: connect once, scan, disconnect
                         ├─ envelopes since last scan  → replies
                         └─ bounce-shaped messages     → suppressions
```

### Matching a reply

For each mailbox the worker fetches the envelopes of INBOX messages received
since that mailbox's last scan, and matches each sender address against
addresses **this organization** sent to recently — not against that one
mailbox's own sends. The scope is organization-wide because pooled sending is
the point of the mailbox pool: a campaign goes out through whichever mailbox
was free, and the reply lands wherever From or Reply-To pointed, which is
routinely a different mailbox. Matching per mailbox would drop those replies
before the database saw them. Suppression is organization-wide in any case, so
the tenant is the boundary that means anything here. A match marks the most
recent sent message to that address as replied, and stamps the contact.

**What counts as a reply:** any message in the scan window whose sender
address matches one this organization sent to recently. That is a deliberately
blunt definition and it includes automatic mail — an out-of-office autoresponder
sent from the recipient's own address is currently counted as a reply, and so
is a one-line "please use my new address". Phase 3 makes a reply STOP a
sequence, which turns this into a decision with consequences: an out-of-office
would then silence a follow-up for someone who never read the first message.
Phase 3 should settle that deliberately rather than inherit it — either by
detecting the auto-submitted headers (`Auto-Submitted: auto-replied`,
`X-Autoreply`) and recording such a message as something other than a reply, or
by ruling explicitly that it counts.

Envelope-only fetching means no message body is ever pulled into the system for
reply detection. That keeps the scan fast and means a customer's inbox contents
are not copied into our database, which matters because these are their own
private mailboxes.

A sender that matches nothing we sent to is ignored entirely.

Each mailbox is read in **one IMAP session**: connect, walk the window's
envelopes, fetch the bodies of the bounce-shaped ones, disconnect. No IMAP
command may be issued while a fetch is being iterated — the client serialises
commands through one queue and the in-flight fetch holds it, so a nested
command deadlocks until the socket times out.

The scan window's own message times come from the server's `internalDate`.
The sender's `Date:` header is not trusted for this: it is the sender's clock,
routinely wrong and trivially forged. It is read only where a server returns no
`internalDate` at all, and then only clamped into the scan's own window, so a
header claiming 1970 or 2099 cannot move a message out of the window it was
actually read in.

### Detecting a bounce

A message is treated as a candidate when its sender looks like a bounce
notifier, for example `mailer-daemon` or `postmaster`, or its subject matches
the usual wording such as undeliverable, delivery status or returned mail. Only
then is the body downloaded, and the failed address is extracted from the
standard `Final-Recipient` field, falling back to an inline pattern.

**Being a candidate is not evidence.** A subject line is whatever the person
typing it decided to type, and a human reply to a forwarded bounce carries "Re:
Undeliverable:" like any other reply. So a subject match earns a download and
nothing else. To SUPPRESS, the message must additionally either come from a
bounce notifier address, or declare itself a delivery status report by its
content type (`multipart/report; report-type=delivery-status`, or
`message/delivery-status`). Which of the two fired is recorded on the event, so
a disputed suppression can be answered months later.

The extracted address is suppressed with reason `bounced`, which the existing
claim already enforces for every future campaign in that organization, and the
matching sent message is marked bounced so the campaign's numbers are honest.

An address is suppressed only when it matches something **this organization**
sent to, within the last thirty days. A bounce for an address we never mailed
is someone else's problem and must not land on the customer's suppression list;
and a notification naming an address last mailed in another quarter is not
reporting on that message, so it must not mark it bounced either. The address
that gets suppressed is the one we hold on the matched message, never the
spelling the notification chose.

### Sent-folder sync

The send path changes to build the message's raw MIME once and hand those exact
bytes to both SMTP and the Sent folder, so the copy carries the same
Message-ID and headers the recipient received. Building it twice would not.

The folder is found by its `\Sent` special-use flag rather than by name,
because providers disagree: some use `Sent`, Gmail uses `[Gmail]/Sent Mail`.
One IMAP connection files the whole batch; a connection per message would cost
more than the send.

A failure to file a copy is logged and never fails the send. The message was
delivered; the copy is a convenience.

### State

`email_accounts` gains `imap_host`, `imap_port` defaulting to 993,
`imap_secure` defaulting to true, `imap_status` with its own `imap_last_error`,
and `inbox_last_scan_at`. IMAP is optional: a mailbox without a host simply is
not scanned, and everything in phase 1 continues to work.

`email_messages` gains `replied_at` and `bounced_at`.

A new `email_inbox_events` table records what each scan found, so a support
question about why an address was suppressed has an answer.

### Failure handling

IMAP failures are classified like SMTP ones, with provider-specific advice:
Zoho needs an app password and IMAP access enabled, Google needs an app
password, port 993 with TLS is standard. An authentication failure sets
`imap_status` to `error`, and every later scan goes on trying — there is no
lockout, because the fix is a credential the admin changes and the next scan
should simply pick it up. It must never pause sending, because a mailbox that
cannot be read can still deliver perfectly well.

`imap_status` has a fourth value, `incomplete`, and it is deliberately not
`error`. It means the mailbox was read perfectly well and the scan then could
not finish recording what it found — a failed write, a match set that could not
be read, a credential that could not be opened out of the database. Nothing is
wrong with the mailbox, so the Accounts screen must not say there is: an admin
told `error` goes and re-enters a password that was never wrong. A mailbox for
which no password was ever stored is the exception and reports `error`: no
retry can clear that one, and only the admin can.

A cap reached before the window was read out is NOT `incomplete`, because
`incomplete` holds the cursor and holding it here stalls the mailbox for good:
the window is derived from the cursor, so the next scan recomputes the same
window, reads the same first few hundred messages and stops in the same place.
A mailbox busy enough to reach the cap would never read past it. So a truncated
scan reports `active` and advances the cursor to the newest message it actually
read, and the mailbox's card says that some messages in the window went
unchecked. Stepping over that gap is the cap's cost; holding the cursor costs
the gap and everything after it, permanently.

The scan window is bounded. The first scan of a mailbox looks back one day
rather than its whole history, and each later scan starts from the last one,
with an overlap of a few minutes so nothing falls between scans.

`inbox_last_scan_at` is the scan CURSOR, not a log of when we last tried. Only
a scan that read its whole window and recorded everything in it (`active`) may
move it, and it moves to the moment that scan STARTED, so mail that arrived
while a slow scan was running is read by the next one instead of stepped over.
`error`, `incomplete` and `unconfigured` all leave it exactly where it was:
there is unread mail behind the window in the first two cases and no window at
all in the third, and advancing in any of them loses mail that fixing the cause
will not bring back. The one scan that moves the cursor anywhere other than its
own start time is the truncated one above, which moves it to the newest message
it read — the only value that is neither a stall nor a skip.

## Testing

The logic is pure and testable without a network:

1. `matchReplies(incoming, sentAddresses)` — a match, a non-match, case
   insensitivity, and a sender that replied twice counting once.
2. `looksLikeBounce(envelope)` — notifier senders, each subject wording, and a
   normal message that must not be treated as a bounce.
3. `extractBouncedAddress(source)` — the standard field, the inline fallback,
   a body with neither, and a body naming an address we never sent to.
4. `scanWindow(lastScanAt, now)` — the first-scan floor, the overlap, and a
   clock that jumped backwards.
5. `friendlyImapError(err, host)` — authentication, unreachable host, and the
   provider-specific advice.

The inbox cycle itself is covered by a test that stubs the IMAP client and the
database, asserting that a reply marks the right message, that a bounce
suppresses only a matching address, that an authentication failure stops
scanning without touching sending, and that the scan window advances.

## Out of scope

- Sequences and stop-on-reply, which are phase 3.
- Open tracking, which is phase 4.
- Reading or storing message bodies for anything other than bounce extraction.
- Threading, conversation view, or replying from inside the app.
- OAuth mailboxes; this phase stays with host, port and password.
