# Email phase 3: sequences

**Date:** 2026-09-19
**Status:** Approved, ready for implementation plan
**Builds on:** `2026-09-18-email-deliverability-design.md` (phase 1),
`2026-09-19-email-inbox-sync-design.md` (phase 2)

## Problem

A campaign is one message to a list, and then nothing. Outreach is not one
message: the reply rate on a second and third touch is most of the total, which
is why every tool in this category is built around a sequence rather than a
send. Today a user who wants a follow-up has to remember, hand-build a second
campaign, and hand-remove everyone who already answered — and that last part is
the one that damages them, because a follow-up sent to somebody who already
replied reads as a machine that is not listening.

Phase 2 made replies and bounces visible. Nothing consumes them yet.

## Goal

An organization defines a sequence: a first message and one or more follow-ups,
each with a delay. People are enrolled. The worker sends each step when it
falls due, in the same send window, from the same mailbox pool, under the same
caps. A reply, a bounce, an unsubscribe or a manual stop ends that person's
sequence, and no later step is sent.

## Decisions taken

| Question | Decision |
|---|---|
| How a step gets sent | It becomes an ordinary `email_messages` row. The send path does not learn what a sequence is. |
| Where steps hang | Each step owns a hidden `email_campaigns` row of `kind = 'sequence'`, so claiming, pacing, counting, suppression and the pool all work untouched. |
| Delay measured from | The previous step's actual send, not from enrollment. A queue that ran late must not compress the gaps. |
| Stop on reply | In SQL, inside `record_inbox_result()`, in the same statement that records the reply. Plus a second check when a step is materialized. |
| Auto-replies | An out-of-office does NOT stop a sequence. Settled here, as phase 2 required. |
| Threading | Follow-ups go in the same thread, from the same mailbox as step 1. |
| Who may edit | Any org member, as with campaigns. Enrollment is likewise a member action. |
| Editing a running sequence | Allowed for steps nobody has reached yet; a step that has been sent to anyone is frozen. |

## Architecture

```
email_sequences ── email_sequence_steps ── (one hidden email_campaigns row each)
        │
        └─ email_sequence_enrollments  (person, current step, next_due_at, stop)
                     │
       worker: materialize due enrollments → email_messages → phase 1 send path
                     ▲
       phase 2 inbox: a reply → stop the enrollment
```

### The send path does not change

This is the load-bearing decision and everything else follows from it. A
sequence step is not a new kind of send; it is a row in `email_messages` like
any other. `claim_email_batch()` already enforces the mailbox pool, the daily
and hourly caps, the warmup ramp, the send window, the suppression list and the
retry budget. A second sender that reimplemented any of that would drift from
it, and the failure mode of drift here is a customer's domain.

`email_messages.campaign_id` is `not null`, and it stays that way. Each step
carries a `campaign_id` pointing at a hidden campaign row created with the
step, `kind = 'sequence'`, named after the sequence and step. The Campaigns tab
filters these out; the sequence's own screen reads their counters, which the
existing `record_send_result()` already maintains.

`email_campaigns.kind`'s check constraint gains `'sequence'`. Its `status`
stays as it is: a step's campaign is `'sending'` for as long as the sequence is
active, and `finalize_email_campaigns()` must not close it while the sequence
can still enroll — so the finalizer skips `kind = 'sequence'`.

### Materializing a step

A worker loop, on the same cycle as the sender, claims enrollments whose
`next_due_at` has passed and whose status is `active`, with `FOR UPDATE SKIP
LOCKED` as the send claim does. For each, in ONE transaction:

1. Re-check the stop conditions. The enrollment may have been stopped since it
   became due, and the address may have been suppressed by an unrelated
   campaign's bounce. Both are checked again HERE, not only at enrollment.
2. Insert the `email_messages` row for the current step, with `send_after =
   now()`.
3. Advance the enrollment: `current_step + 1`, `next_due_at = null` (the next
   due time is not known until this step is actually sent), `status` unchanged.

`next_due_at` for the FOLLOWING step is set when this step's message reaches
`sent`, from the delay on the next step. That is why the delay is measured from
the send and not from the enrollment: a queue held overnight by the send window
would otherwise release three steps within minutes of each other, which is both
the worst possible impression and a spam signal.

Setting it belongs in `record_send_result()`, which is the one place a message
becomes `sent`, and it is guarded so a non-sequence message costs nothing.

A step whose message ends `failed` stops the enrollment with that reason. A
hard bounce already suppresses the address; a permanent failure means this
person cannot be reached, and stepping forward would queue two more messages to
the same dead address.

### Stopping

An enrollment stops for exactly five reasons, each recorded:

| Reason | Set by |
|---|---|
| `replied` | `record_inbox_result()`, in the same statement that records the reply |
| `bounced` | the same function, on a bounce that matched |
| `unsubscribed` | the unsubscribe endpoint, alongside the suppression it already writes |
| `failed` | `record_send_result()` on a permanent failure |
| `manual` | a person, from the sequence screen |

Stopping is org-wide by address, not per enrollment: if somebody replies to one
sequence and is enrolled in two, both stop. They answered a human; a second
machine still talking to them is the same failure.

The reply that stops a sequence is matched the way phase 2 matches everything
— organization-wide, against what this organization sent — so a reply landing
in a sibling mailbox stops the sequence just the same.

**Stopping is idempotent and one-way.** An enrollment that is already stopped
is never re-stopped or reopened by a later event, so the reason and the time
record the FIRST thing that ended it, which is the one a support question is
about. Re-enrolling the same person is a new enrollment row.

### Auto-replies

Phase 2 recorded an out-of-office as a reply and flagged this as phase 3's to
settle, because from here it silences a follow-up for someone who never read
the first message. It is settled as: **an auto-reply is recorded, and does not
stop the sequence.**

Detection is by header, not by wording: `Auto-Submitted:` with anything other
than `no`, `X-Autoreply`, `X-Autorespond`, or `Precedence: auto_reply` — the
headers RFC 3834 defines for exactly this purpose. Wording is not used at all;
"I am out of the office" is a sentence a person can type.

This costs one change to the phase 2 scan: the envelope pass asks for those
four headers alongside the envelope. Headers, not bodies — the promise that no
message body is pulled for ordinary mail is unchanged, and four header lines
per message do not move the cost of the scan.

An auto-reply records an `email_inbox_events` row of kind `auto_reply` and sets
nothing on the message. It does not mark `replied_at`, so it does not inflate
the reply rate either, which is the other thing it was quietly doing.

A person who replies for real after their out-of-office expires is matched on
that second message, as they always were.

### Threading

A follow-up belongs in the same conversation as the message before it, or the
recipient sees a stranger repeating themselves.

Phase 1 sets each message's `Message-ID` to
`<{email_messages.id}@{sender domain}>` — derived, not stored. So a follow-up
needs only the row id of the previous step's message to thread: `In-Reply-To`
is that id, and `References` accumulates the ids of every earlier step. The
enrollment therefore carries `last_message_id` (the row id) and the send path
reads the chain from `email_messages` by enrollment.

Threading also pins the mailbox. A conversation that continues from a different
address is not a conversation, and it breaks the recipient's own threading, so
the enrollment records `account_id` on its first send and every later step is
queued for that mailbox. That narrows the pool for an enrollment, deliberately:
the pool's job is to spread a campaign's volume, and a sequence spreads across
enrollments rather than within one.

A pinned mailbox that has been paused or deleted stops the enrollment with
reason `failed` rather than silently switching sender.

### Subject on a follow-up

A threaded follow-up with a fresh subject is not threaded in most clients. A
step may either carry its own subject, or leave it empty and inherit `Re: ` +
step 1's subject, which is the default and what a human would do.

### State

```
email_sequences        (id, organization_id, workspace_id, created_by, name,
                        status: draft|active|paused|archived, created_at, ...)
email_sequence_steps   (id, sequence_id, step_index, delay_hours, subject,
                        body_html, campaign_id, created_at)
email_sequence_enrollments
                       (id, sequence_id, organization_id, contact_id, to_email,
                        to_name, merge_data, account_id, current_step,
                        next_due_at, last_message_id, status:
                        active|stopped|completed, stop_reason, stopped_at,
                        created_at)
```

`email_messages` gains `enrollment_id` and `step_index`, both nullable — a
campaign message has neither. They exist so `record_send_result()` can advance
the right enrollment without a second lookup.

Uniqueness: one active enrollment per `(sequence_id, lower(to_email))`, as a
partial unique index on `status = 'active'`. Enrolling the same address twice
into one sequence is a mistake every time, and a stopped enrollment must not
block a deliberate re-enrollment.

Row-level security follows the existing email tables exactly: read for org
members, write for org members, and the enrollments table is reachable only
through its sequence's organization.

### Interface

A **Sequences** tab on the Email page, beside Campaigns, in the same
components as everything else on that page.

- The list: name, status, step count, active / replied / stopped counts.
- The editor: steps in order, each with its delay, subject and body, using the
  same body editor and the same `{{placeholder}}` substitution as Compose. A
  step already sent to somebody is read-only and says why.
- Enrollment: the existing `RecipientPicker`, unchanged, plus a paste-a-list
  path as Compose has.
- The enrollment table: person, current step, next due, status, and stop
  reason where there is one. Stopping one by hand is a row action.

Nothing here introduces a new visual pattern; the phase 1 and 2 screens are the
reference.

## Testing

Pure and testable without a database or network:

1. `nextDueAt(sentAt, delayHours, window)` — the plain case, a delay that lands
   outside the send window, and a zero delay.
2. `threadHeaders(chain)` — first step (none), second step, tenth step, and the
   `References` order.
3. `followUpSubject(step, firstSubject)` — own subject, inherited subject, and
   an inherited subject that is already `Re:`.
4. `isAutoReply(headers)` — each of the four headers, `Auto-Submitted: no`
   (which is NOT an auto-reply), and a message with none of them.
5. `stopReasonFor(event)` — reply, bounce, unsubscribe, permanent failure.

Against a stubbed database and transport:

6. A due enrollment materializes exactly one message, advances the step, and
   does not materialize again on the next cycle.
7. An enrollment stopped between becoming due and being claimed materializes
   nothing.
8. A suppressed address materializes nothing and stops the enrollment.
9. A reply recorded through `record_inbox_result()` stops every active
   enrollment for that address in that organization, and an auto-reply stops
   none.
10. A paused or deleted pinned mailbox stops the enrollment rather than
    switching sender.

SQL-level, against a real migration run by the user later: the partial unique
index rejects a second active enrollment, and `finalize_email_campaigns()`
leaves `kind = 'sequence'` alone.

## Out of scope

- Open tracking, which is phase 4 and is what makes "stop on open" or
  "follow up only if unopened" possible. Steps here are time-based only.
- A/B testing of steps.
- Branching: every enrollment walks the same steps in order.
- Sending a sequence step outside the organization's send window, or any
  per-sequence override of the pool, caps or warmup.
- Importing sequences from another tool.
