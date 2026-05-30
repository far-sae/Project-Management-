# Slack → Task Automation (Design)

**Status:** Design accepted 2026-05-17. Implementation pending.

## A. Overview

Add Slack messages as a trigger in the existing automation recipe engine.
When someone posts in a watched channel (optionally matching a keyword
regex), recipes fire — most commonly `create_task` assigned to the
person who typed it.

### A.1 Goals
- Let teams turn ad-hoc Slack chatter into tracked tasks without leaving
  Slack.
- Reuse the existing recipe engine — no parallel automation system.
- Reuse the existing Slack OAuth integration — no new auth flow.

### A.2 Non-goals (this batch)
- Two-way replies (TaskCalendar posting back to the originating thread
  is a follow-up).
- Slash commands (`/task ...`) — separate UX, separate scope.
- DM-based interaction with the bot.
- @mention-only triggers (the user picked "all messages in selected
  channels" with keyword filter; @mention support is trivial to add
  later with the same plumbing).

## B. Architecture

### B.1 Event flow

```
Slack workspace
    │
    │  POST message to channel
    ▼
Slack Events API
    │
    │  HTTPS POST (signed)
    ▼
slack-events Edge Function  (public; --no-verify-jwt)
    │
    │  1. URL verification handshake (if first install)
    │  2. Verify X-Slack-Signature (HMAC-SHA256 over timestamp+body)
    │  3. Dedupe by X-Slack-Event-Id (slack_event_dedupe table, 1h TTL)
    │  4. Skip if message.bot_id present OR subtype='bot_message'
    │  5. Resolve org by team_id via integrations table
    │  6. Resolve user_email via Slack users.info (cached in same row)
    │  7. Enrich payload with channel_name + permalink
    │
    ▼
INSERT into automation_events (event_type='slack_message_received', ...)
    │
    │  (existing per-minute worker drain)
    ▼
crm-run-automations
    │
    │  Match recipes WHERE trigger.type='slack_message_received'
    │    AND payload.channel_id IN trigger.config.channels
    │    AND (no keyword OR keyword regex matches payload.text)
    │
    ▼
Action handlers (create_task, ai_summarize, etc.)
```

### B.2 Slack signature verification

Standard Slack scheme:
```
base = "v0:" + timestamp + ":" + raw_body
expected = "v0=" + hex(hmac_sha256(SLACK_SIGNING_SECRET, base))
reject if expected !== request.headers["x-slack-signature"]
reject if |now - timestamp| > 5 minutes
```

`SLACK_SIGNING_SECRET` is a single global secret across all orgs that
install the same Slack app (this app is single-tenant from Slack's POV;
multi-tenancy on our side is by `team_id` lookup, see B.3).

### B.3 Multi-tenant team_id lookup

The integrations table already stores `metadata` jsonb per
`(user_id, provider='slack')` row. On install we record `team_id` and
`team_name` there. The events endpoint looks up:

```sql
select organization_id, access_token_encrypted, metadata
  from integrations
 where provider = 'slack'
   and status = 'active'
   and metadata ->> 'team_id' = $1
 limit 1
```

If no match (someone added the bot to a workspace not connected to a
TaskCalendar org) → drop the event silently with a log line.

### B.4 Deduplication

Slack retries on 3xx/timeout for 3 attempts, ~1s apart. We must return
2xx fast and dedupe by `X-Slack-Event-Id` to avoid creating duplicate
tasks.

```sql
create table public.slack_event_dedupe (
  event_id   text primary key,
  seen_at    timestamptz not null default now()
);
-- Trim hourly via cron or on-demand in the function:
delete from slack_event_dedupe where seen_at < now() - interval '1 hour';
```

The function: `INSERT … ON CONFLICT DO NOTHING RETURNING event_id`. If
no row returned, it was a retry — return 200 immediately.

### B.5 Payload shape

```ts
{
  team_id: "T012ABCDE",
  channel_id: "C012ABCDE",
  channel_name: "sales",
  user_id: "U012ABCDE",            // slack user id
  user_email: "jane@acme.com" | null,
  user_name: "Jane Doe" | null,
  text: "follow up with Acme by Friday",
  message_ts: "1715954400.001500",
  permalink: "https://acme.slack.com/archives/C012/p1715954400001500",
  thread_ts: "1715954400.001500" | null   // for replies in threads
}
```

This is the `event.payload` available to substitute() in action
configs (e.g. task title can use `{{slack.text}}`).

## C. Schema

### C.1 Migration 070_slack_trigger.sql

```sql
begin;

-- ============================================================
-- slack_event_dedupe: idempotency cache for Slack's retry behavior.
-- ============================================================
create table public.slack_event_dedupe (
  event_id   text primary key,
  seen_at    timestamptz not null default now()
);
create index slack_event_dedupe_ttl_idx on public.slack_event_dedupe (seen_at);

alter table public.slack_event_dedupe enable row level security;
-- service-role only.

-- ============================================================
-- automation_events.event_type check: extend if it has a CHECK constraint
-- (migration 065 declared it as a plain text column — no extra work needed,
-- but we document the new value).
-- New allowed value: 'slack_message_received'
-- ============================================================

-- ============================================================
-- integrations: ensure a team_id index so org lookup is O(1).
-- The column is in metadata jsonb so we add a partial expression index.
-- ============================================================
create index if not exists integrations_slack_team_id_idx
  on public.integrations ((metadata ->> 'team_id'))
  where provider = 'slack' and status = 'active';

-- ============================================================
-- gc_slack_event_dedupe(): trim rows older than 1 hour.
-- Called by the existing automation-tick cron piggyback.
-- ============================================================
create or replace function public.gc_slack_event_dedupe()
returns int language plpgsql security definer set search_path = public as $$
declare
  removed int;
begin
  with d as (
    delete from slack_event_dedupe where seen_at < now() - interval '1 hour'
    returning 1
  )
  select count(*) into removed from d;
  return removed;
end $$;

revoke all on function public.gc_slack_event_dedupe() from public;
grant execute on function public.gc_slack_event_dedupe() to service_role;

commit;
```

## D. Edge Function: `slack-events`

- Public endpoint (`--no-verify-jwt`).
- Handles `url_verification` events synchronously — echoes the
  `challenge` token. This is how Slack verifies the endpoint URL when
  the admin sets it up.
- Handles `event_callback` events with type `message`:
  1. Verify signature (B.2). Reject 401 if bad.
  2. Reject if timestamp is >5 min old (replay protection).
  3. Try dedupe insert; if duplicate → 200, return.
  4. Skip if `event.bot_id` is set or `subtype === 'bot_message'`.
  5. Look up org by `team_id`.
  6. Look up sender email via Slack `users.info`, with a per-call
     2-second timeout (skip on failure → enqueue without email; the
     assignee fallback handles it).
  7. Resolve channel name via Slack `conversations.info` (cached in
     dedupe table is overkill — we just fetch each time; ~50ms).
  8. Enqueue an `automation_events` row.
  9. Return 200 with `{ok: true}`.
- All Slack API calls use the bot token from the integrations row
  (decrypted via existing `_shared/crypto.ts`).

## E. Recipe trigger matching

### E.1 Type extension

`supabase/functions/crm-run-automations/shared/types.ts`:
```ts
export type TriggerType =
  | …existing…
  | "slack_message_received";
```

### E.2 Trigger config shape

```ts
trigger_config: {
  channels: string[];      // Slack channel IDs, e.g. ["C012ABCDE"]
                           // empty array = recipe never fires
  keyword?: string;        // optional; plain text contains-match,
                           // OR /pattern/flags for regex
}
```

### E.3 Matching logic addition

Inside the worker's recipe-matching path, after a recipe of type
`slack_message_received` is loaded:

```ts
if (recipe.trigger_type === "slack_message_received") {
  const cfg = recipe.trigger_config as { channels?: string[]; keyword?: string };
  const channels = cfg.channels ?? [];
  if (channels.length === 0) return;                     // never fires
  const channelId = (event.payload as any).channel_id;
  if (!channels.includes(channelId)) return;
  const text = (event.payload as any).text ?? "";
  if (cfg.keyword) {
    const m = cfg.keyword.match(/^\/(.+)\/([gimsuy]*)$/);
    const re = m ? new RegExp(m[1], m[2]) : null;
    if (re ? !re.test(text) : !text.toLowerCase().includes(cfg.keyword.toLowerCase())) {
      return;
    }
  }
  // else falls through to the existing condition + action loop
}
```

## F. `create_task` action — Slack-sender assignee

Existing `create_task` accepts `assignee: "deal_owner" | "creator" | <uuid>`.
We extend the union: `"slack_sender"`.

Resolution:
1. `email = event.payload.user_email`
2. If no email → fall back to recipe creator
3. SELECT `auth.users` WHERE `email = $1` AND user is a member of
   `event.organization_id` (the existing `is_org_member` check via the
   organizations.members jsonb)
4. If no match → fall back to recipe creator

The fallback chain mirrors the existing pattern from
`sendEmail`'s `resolveSenderUserId` (deal owner → recipe creator).

## G. Slack app setup (user-facing, one-time)

Adds three scopes to the existing app:
- `channels:history` — read messages from public channels the bot is in
- `users:read` — list users
- `users:read.email` — read user emails

Steps:
1. https://api.slack.com/apps → pick the existing TaskCalendar app
2. **OAuth & Permissions** → Bot Token Scopes → add the three scopes
3. **Event Subscriptions** → toggle ON
   - **Request URL:** `https://<project-ref>.supabase.co/functions/v1/slack-events`
     (Slack will ping it for verification — our function echoes back
     the challenge token)
   - **Subscribe to bot events:** add `message.channels`
4. **Reinstall App** to workspace to apply the new scopes — this also
   re-runs our OAuth callback which writes `team_id` into the
   integration's `metadata` jsonb (required for the events endpoint
   to know which org an incoming Slack event belongs to). If an org
   set up Slack before this batch, they MUST reinstall — pre-existing
   integration rows have no `team_id` and events will be silently
   dropped until they do.
5. In each watched channel: `/invite @TaskCalendar`

Set the signing secret as a Supabase env var (already exists on the
Slack app page → **Basic Information → App Credentials → Signing Secret**):

```bash
npx supabase secrets set SLACK_SIGNING_SECRET=<paste>
npx supabase functions deploy slack-events --no-verify-jwt
```

## H. UI — recipe builder

New `TRIGGER_TYPES` entry `slack_message_received`, label
"a Slack message is posted".

When selected, the builder shows:
- **Channels** (required): multi-select dropdown of channels fetched
  from a new Edge Function `slack-list-channels` (JWT-authed; calls
  `conversations.list?types=public_channel`). v1 is public channels
  only — private channels require an extra scope (`groups:history`)
  and we'd need a separate consent prompt. UI shows `#channel-name`;
  under the hood stores the channel IDs.
- **Keyword filter** (optional): text input. Placeholder explains
  `task:` (contains-match) or `/^todo:/i` (regex form).

In `create_task` action config:
- The existing `Assignee` dropdown gets one new option:
  **"Slack sender (whoever posted)"** — value `slack_sender`.

## I. Testing

### I.1 Unit tests (vitest)
- `slackSignature.test.ts` — verify/reject correct + wrong + replayed
  signatures (5 tests)
- `slackTriggerMatch.test.ts` — channel filter, keyword plain match,
  keyword regex match, empty channels = never fires, bot-message skip
  (5 tests)
- `slackKeywordParse.test.ts` — regex detection
  vs plain-text contains (3 tests)

Total: 13 new tests → grand total 95.

### I.2 Manual acceptance
1. Set up Slack app per Section G.
2. Create a recipe: trigger = Slack message, channels = #sales,
   keyword = `task:`. Action = create_task with assignee=slack_sender,
   title = `{{slack.text}}`.
3. In #sales, type `task: follow up with Acme Friday`.
4. Within 60 seconds: a task with title "task: follow up with Acme
   Friday" appears, assigned to the Slack sender if their email matches
   a TaskCalendar user.
5. Type `lol nothing important` — no task created (keyword didn't
   match).
6. Have the bot itself post a message — no task created (bot_id skip).
7. Slack should retry on timeout: simulate by returning 500 from the
   function once → second delivery dedupes → still one task.

## J. Security

- Signature verification is the sole gate against forged events.
- Replay protection: 5-minute timestamp window + event_id dedupe.
- No PII in dedupe table (just event_id).
- Slack tokens already encrypted via `INTEGRATION_TOKEN_KEY` (Batch 2a
  pattern).
- The frontend's `slack-list-channels` function is JWT-gated; only
  members of the org with the integration can list channels.

## K. Rollout

1. Apply migration 070.
2. Set `SLACK_SIGNING_SECRET` secret.
3. Deploy `slack-events` (`--no-verify-jwt`) and `slack-list-channels`.
4. Reinstall the Slack app per Section G (adds scopes + sets URL).
5. Frontend redeploy (new trigger option + assignee value).
6. Each user: invite the bot to channels they want monitored, create a
   recipe.
