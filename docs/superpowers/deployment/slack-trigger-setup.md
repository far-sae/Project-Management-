# Slack message trigger — deployment & Slack app setup

External one-time setup required before recipes can fire on Slack
messages.

## Prereqs
- Slack OAuth already working (Batch 2a + the Slack scopes fix from
  this session). You should already be able to post to Slack from
  automation recipes.
- `INTEGRATION_TOKEN_KEY` already set (used to decrypt the bot token).

## 1. Apply migration 070

```bash
npx supabase db push
```

Creates `slack_event_dedupe` + a partial index on
`integrations.metadata->>team_id` for fast org lookup + the
`gc_slack_event_dedupe` RPC.

## 2. Get the Slack signing secret

The signing secret authenticates incoming events. It is per-Slack-app
(NOT per-workspace), and you already have one from the existing app:

1. https://api.slack.com/apps → pick your TaskCalendar app
2. **Basic Information → App Credentials → Signing Secret** → copy it

```bash
npx supabase secrets set SLACK_SIGNING_SECRET=<paste>
```

## 3. Deploy the two new Edge Functions

```bash
npx supabase functions deploy slack-events --no-verify-jwt
npx supabase functions deploy slack-list-channels
npx supabase functions deploy crm-run-automations    # picks up the new trigger
```

`--no-verify-jwt` on `slack-events` is required — Slack doesn't send a
JWT, we verify their signing-secret signature ourselves.

## 4. Add the new Slack scopes

In the Slack app dashboard → **OAuth & Permissions → Bot Token Scopes**,
add these THREE new scopes:

- `channels:history` — read messages from public channels the bot is in
- `users:read.email` — match Slack senders to TaskCalendar users by email
- `channels:read` is already there from Batch 2a; if it's not, add it

(`users:read` was already added in a previous session.)

## 5. Enable Event Subscriptions

In the Slack app dashboard → **Event Subscriptions**:

1. Toggle **Enable Events** ON
2. **Request URL:**
   `https://<your-project-ref>.supabase.co/functions/v1/slack-events`

   Slack will immediately POST a `url_verification` event — our
   function echoes back the challenge token and Slack shows
   "Verified ✓". If you see "Your URL didn't respond with the value of
   the `challenge` parameter", check `npx supabase functions logs
   slack-events` for the error.

3. **Subscribe to bot events** → click "Add Bot User Event" →
   add `message.channels`
4. Save Changes

## 6. Reinstall the app to your workspace

The new scopes only take effect after reinstall:

- Slack app dashboard → **Install App** → **Reinstall to Workspace**
- Approve the new permissions when prompted
- This also re-runs our OAuth callback which writes `team_id` into the
  integration's metadata jsonb — **required** so the events endpoint
  knows which org an incoming Slack event belongs to. If an org set up
  Slack before this batch, they MUST reinstall — pre-existing
  integration rows have no `team_id` and events are silently dropped
  until they do.

## 7. Invite the bot to channels

For each channel you want monitored, in Slack type:

```
/invite @TaskCalendar
```

(Replace `@TaskCalendar` with your app's actual bot name.)

The bot can only see messages in channels it's been invited to.

## 8. Frontend redeploy

Standard Vite/Vercel/Netlify push. After it's live:

1. Settings → Automations → **New recipe**
2. **When:** "a Slack message is posted"
3. Pick channels from the dropdown (loads via `slack-list-channels`).
4. Optional keyword filter — leave blank to fire on every message, or:
   - `task:` — fires only on messages containing `task:` (case-insensitive)
   - `/^todo:/i` — regex form (anchor + flags supported)
5. **Then:** add `create_task`, set **Assignee:** "Slack sender
   (matched by email)", **Title:** `{{slack.text}}` (or
   `{{slack.user_name}}: {{slack.text}}` for context).
6. Save + enable.

## 9. Verify

1. Type `task: follow up with Acme Friday` in a watched channel.
2. Within ~60 seconds (next worker tick): a task with that title
   appears in `client_tasks`, assigned to your TaskCalendar account
   (if your Slack email matches a TaskCalendar user).
3. Type `lol nothing` — no task created (keyword filter didn't match).
4. Have the bot itself post a message (`@TaskCalendar say hi`) — no
   loop, the function drops bot-authored messages.
5. Replay protection: if a request arrives with a timestamp >5 minutes
   old, the function returns 401. Slack's own retries (~3 attempts ~1s
   apart) are deduped by `X-Slack-Event-Id`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| URL verification fails in Slack | Function not deployed or signing secret wrong | Check `supabase functions logs slack-events` |
| Recipe never fires on messages | Bot not invited to channel, OR channel not in recipe's whitelist, OR keyword doesn't match | `/invite @TaskCalendar`; double-check the channel multi-select; test with no keyword first |
| Assignee comes out null | Slack user's email doesn't match any TaskCalendar user, AND no recipe creator fallback (rare) | Make sure Slack user has `users:read.email` scope granted; check that the user's TaskCalendar account uses the same email |
| Events arrive but no recipes match | `metadata.team_id` not populated (pre-batch slack integration) | Reinstall the Slack app |
| `slack-list-channels` returns empty | Bot not in any channels yet, OR the OAuth row lacks the new scopes | `/invite` the bot; reinstall the app |
