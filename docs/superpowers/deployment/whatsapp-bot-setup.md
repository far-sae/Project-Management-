# WhatsApp Bot — Deployment & Setup

The WhatsApp bot mirrors the Telegram bot. Same `Intent` parser, same
`agentActions` core, same `agent_pending_actions` / `agent_conversation_state`
tables. The only WhatsApp-specific pieces are the Meta Cloud API integration
and the link-code table.

## 1. Set up Meta WhatsApp Cloud API

1. Go to https://developers.facebook.com → **Create App** → Business app.
2. Add the **WhatsApp** product to the app.
3. In the WhatsApp setup screen, Meta gives you:
   - A test phone number (or you connect your own + verify via OTP).
   - A **Phone Number ID** (`WHATSAPP_PHONE_NUMBER_ID`).
   - A 24-hour test access token. For production, click **System Users** in the
     Business Settings → create a system user with `whatsapp_business_messaging`
     permission → generate a **permanent token** (`WHATSAPP_ACCESS_TOKEN`).
4. Note the App's **App Secret** from App Settings → Basic. This is
   `WHATSAPP_APP_SECRET`. Meta signs webhook payloads with it; we verify HMAC.
5. Pick any random string as your verify token (`WHATSAPP_VERIFY_TOKEN`). Meta
   challenges your webhook with this string during subscription.

## 2. Apply the migration and set secrets

```bash
npx supabase db push
```

Adds `088_whatsapp_link_codes.sql` (the link-code table + the WhatsApp-
specific DELETE policy on `integrations`).

In Supabase Dashboard → **Edge Functions → Secrets**, add:

- `WHATSAPP_ACCESS_TOKEN` — the permanent system-user token
- `WHATSAPP_PHONE_NUMBER_ID` — from Meta dashboard
- `WHATSAPP_VERIFY_TOKEN` — your chosen random string
- `WHATSAPP_APP_SECRET` — Meta App's App Secret
- `OPENAI_API_KEY` — already set if Telegram is working

Set on the frontend `.env`:

- `VITE_WHATSAPP_BOT_NUMBER` — the WhatsApp number people will message
  (e.g. `+1 555 123 4567`), shown on the Settings card.

## 3. Deploy the edge functions

```bash
npx supabase functions deploy whatsapp-link-code
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

## 4. Subscribe Meta to your webhook

In the Meta App dashboard → WhatsApp → Configuration:

- **Callback URL:** `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`
- **Verify token:** the value of `WHATSAPP_VERIFY_TOKEN`
- Click **Verify and save**. Meta will hit the URL with a GET that includes
  `hub.mode=subscribe` and our function will echo `hub.challenge` back.

Then subscribe to the **messages** field under "Webhook fields".

## 5. Smoke test

1. In TaskCalendar: Settings → Integrations → **WhatsApp** → Connect. Note the
   6-digit code.
2. In WhatsApp: send `/start <code>` to the bot number. Bot replies "✅ Linked".
3. Send `add workspace Acme`. Bot replies with an interactive card
   (Confirm / Cancel buttons).
4. Tap **Confirm**. Bot replies "✅ Workspace Acme created." Reload the app —
   the workspace appears.
5. Send `task: call John tomorrow 3pm in <existing project>`. Tap Confirm.
   Task lands with the right due date.

## Architecture

```
WhatsApp → Meta Cloud API → whatsapp-webhook ──► _shared/agent/intent.ts (OpenAI)
                                              │
                                              ├─► _shared/agent/agentActions.ts
                                              │      (provider="whatsapp")
                                              │
                                              └─► same RPCs as Telegram:
                                                  agent_create_workspace
                                                  agent_create_project
                                                  agent_create_task
                                                  crm_create_client_as
                                                  crm_create_client_task_as
```

`agent_pending_actions` and `agent_conversation_state` are shared tables;
the `provider` column ('telegram' | 'whatsapp') keeps the two chat surfaces
from cross-talking.

## Known v1 limits (same as Telegram)

- Per-user rate limiting is not enforced — Meta has its own throttles.
- Disambiguation buttons fall back to "rephrase please" if more than one
  workspace / project / client matches.
- Outside the 24-hour customer service window, Meta requires pre-approved
  template messages. If a user hasn't messaged the bot in >24h and the bot
  needs to reach out unprompted, sends will fail. For the interactive
  command flow this isn't an issue — the user always speaks first.

## Troubleshooting

- **`getWebhookInfo` analog — Meta dashboard → WhatsApp → Configuration**
  shows the last webhook delivery + any error.
- **401 from webhook**: `WHATSAPP_APP_SECRET` mismatch. Meta signs with the
  app secret; we verify HMAC. Double-check it's the App Secret (not Access
  Token).
- **403 on Meta subscribe**: `WHATSAPP_VERIFY_TOKEN` mismatch between Supabase
  secrets and what you typed into Meta's form.
- **Function deploys but messages never arrive**: subscribe to the `messages`
  field in Meta's Webhook fields section. Easy to miss.
- **Bot can't send messages**: `WHATSAPP_ACCESS_TOKEN` expired (24-hour test
  tokens) or `WHATSAPP_PHONE_NUMBER_ID` is wrong.
