# Email phase 4: open tracking

**Date:** 2026-09-19
**Status:** Approved, ready for implementation plan
**Builds on:** phases 1–3 (`2026-09-18-email-deliverability-design.md`,
`2026-09-19-email-inbox-sync-design.md`,
`2026-09-19-email-sequences-design.md`)

## Problem

A campaign reports how many messages were sent, how many failed and how many
were answered. Between "delivered" and "replied" there is nothing, and that
gap is where every decision about the copy gets made. Was the subject line
read at all? Did the third step land better than the first? Today the only
signal is a reply, which perhaps two percent of recipients send.

## Goal

An organization can see, per campaign and per sequence step, how many of the
messages it sent were opened — with the honesty about what that number means
built into the screen rather than left to be discovered.

## What an open actually is, and why that shapes everything here

A tracking pixel is a 1×1 image with a unique URL. When a mail client renders
the message it fetches that image and the server records it. That is the whole
mechanism, and it is far less reliable than it sounds:

- **Apple Mail Privacy Protection pre-fetches every image**, for every message,
  whether or not anybody read it. It has been on by default since 2021 and
  Apple Mail is roughly half the consumer market. Those fetches come from
  Apple's proxy, not the recipient.
- **Gmail proxies images** through `googleusercontent.com` and caches them, so
  a second open from the same person often never reaches us.
- **Many clients block images by default**, so a real, careful read records
  nothing at all.
- **Security scanners fetch every URL in a message**, including this one,
  usually within seconds of delivery.

So the number is a floor with a large false-positive rate on top of it. This
phase's job is to record it accurately, mitigate what can be mitigated, and
say plainly on the screen what it is. A product that shows "68% open rate" in
large type beside "12 replies" is teaching its user something false.

## Decisions taken

| Question | Decision |
|---|---|
| Mechanism | A 1×1 transparent GIF from a Vercel route, signed like the unsubscribe link. |
| Default | **Off.** Each organization turns it on in Email → Settings. |
| Single sends | Never tracked. Transactional mail is not a campaign. |
| What is stored | First open, last open, and a count. No IP address, no user agent, no geolocation. |
| Apple/proxy fetches | Recorded, and flagged as `prefetch` so the screen can say so. |
| Sequences | Opens are shown per step. Conditional steps ("only if unopened") are **out of scope**. |
| Retro-fitting | Only messages sent after it is switched on. Nothing is backfilled or inferred. |

### Off by default, and a real decision rather than a formality

Tracking when your customer's customer opened an email is surveillance, however
ordinary it has become. Some of this product's users are in jurisdictions where
it needs consent, and some simply would not want it. So the pixel is only
inserted when the organization has switched it on, the switch says what it
does in plain words, and nothing anywhere infers an open from anything else.

### The pixel

`GET /api/email/open?m=<messageId>&t=<token>` returns a 43-byte transparent
GIF with `Cache-Control: no-store`, always, in under a few milliseconds. The
token is an HMAC of the message id under the same secret the unsubscribe link
uses, so the URL cannot be forged to inflate another organization's numbers.

**It always returns the image.** A bad token, an unknown message, a database
that is down — the response is the same GIF with the same status. A tracking
pixel that 404s shows a broken-image icon in somebody's email, which is a
visible defect in the customer's mail caused by our bookkeeping. The failure
is logged on our side and invisible on theirs.

The route records the open and returns; it never blocks the image on the
write.

### Recording, and not double-counting

`record_email_open(p_message uuid, p_prefetch boolean)`:

- sets `opened_at` if it is null (first open only — the same transition guard
  `replied_at` uses, so "opened after" figures do not move every time the
  message is re-rendered),
- always sets `last_opened_at` and increments `open_count`,
- increments the campaign's `opened_count` **only on the first-open
  transition**, so a campaign's opened count is a count of messages, not of
  fetches,
- does nothing at all when the organization has tracking switched off, which
  closes the window where a pixel from before the switch was flipped is still
  in somebody's mailbox.

A message opened fifty times is one open and fifty fetches, and the screen
says both.

### Telling a prefetch apart from a person

Two signals, both from the request:

1. `User-Agent` matching the known proxies (`GoogleImageProxy`,
   `AppleMailProxy`, `YahooMailProxy`).
2. An open arriving within **ten seconds** of `sent_at`. No human opens a
   message that fast; a scanner does.

Either one marks the row `prefetch`. A message whose only opens are prefetches
counts in `open_count` but is shown separately, and the campaign's headline
number excludes it. The user agent is used for this classification and is
**not stored** — the flag is the only thing kept.

This is a heuristic and the screen says so. It is not an attempt to be
accurate about individuals; it is an attempt to stop Apple's proxy from making
every campaign look like a triumph.

### State

`email_messages` gains `opened_at`, `last_opened_at`, `open_count` (default 0)
and `open_was_prefetch` (boolean, default false).
`email_campaigns` gains `opened_count`.
`email_settings` gains `track_opens` (boolean, default **false**).

No new table. An `email_open_events` row per fetch was considered and dropped:
the volume is every image render by every client for ever, the only questions
it answers are "when" and "how many", and both are on the message row.

### Interface

- **Campaigns**: an "Opened" column beside Sent and Replied, showing the count
  of messages opened by a person. A tooltip, not a footnote: "Counts messages
  whose images were loaded. Apple Mail and most scanners load images
  automatically, so this is an estimate — N of these look automatic and are
  not counted here."
- **Sequences**: the same per step, which is where it is actually useful — it
  says which follow-up is being read.
- **Settings**: the switch, with one sentence saying what it does and that it
  is off until turned on.
- Nowhere is an "open rate" shown as a headline percentage without the reply
  count beside it.

## Testing

Pure, no network:

1. `openPixelUrl(base, id, token)` and the token round-trip — a valid token, a
   token for a different message, a truncated token.
2. `isPrefetch(userAgent, sentAt, now)` — each known proxy, a fetch two
   seconds after send, a fetch two hours after send from a real client, and a
   missing user agent.
3. `injectTrackingPixel(html, url)` — appended before `</body>` when there is
   one, at the end when there is not, and not injected twice.

Against a stubbed database:

4. The route returns a GIF with the right bytes and `no-store` for a valid
   token, an invalid token, an unknown message and a failing database.
5. The first open sets `opened_at` and increments the campaign; the second
   sets `last_opened_at` and `open_count` and does not touch the campaign.
6. Nothing is recorded when the organization has tracking off.

## Out of scope

- Click tracking, which rewrites every link in the message and is a much
  larger change to deliverability and to trust.
- Conditional sequence steps ("only if unopened").
- Any per-recipient open history, device, location or read duration.
- Backfilling opens for mail sent before this shipped.
