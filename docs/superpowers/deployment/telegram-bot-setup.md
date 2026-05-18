# Telegram Bot — Deployment & Setup

## 1. Create the bot
1. Open Telegram, message @BotFather, send `/newbot`.
2. Pick a display name and a username ending in `bot` (e.g. `TaskCalendarBot`).
3. BotFather replies with a token like `123456:ABC-DEF...`. Keep it secret.
4. Optional: send `/setdescription`, `/setabouttext`, `/setuserpic` to BotFather to polish the bot's profile.
5. Privacy mode is fine to leave on — the bot only operates in private 1:1 chats.

## 2. Generate the webhook secret
```bash
openssl rand -hex 32
```
Save the output.

## 3. Set Edge Function secrets (Supabase Dashboard → Edge Functions → Secrets)
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `TELEGRAM_WEBHOOK_SECRET` — the random string above
- `OPENAI_API_KEY` — already set if the AI chat works elsewhere

Set `VITE_TELEGRAM_BOT_USERNAME` in the frontend `.env` to the bot's username (without `@`).

## 4. Apply migrations
```bash
npx supabase db push        # or `migration up` for local
```
Expected: applies `082_telegram_bot.sql` and `083_agent_create_rpcs.sql`.

## 5. Deploy edge functions
```bash
npx supabase functions deploy telegram-link-code
npx supabase functions deploy telegram-webhook --no-verify-jwt
```

## 6. Register the webhook with Telegram
```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<project-ref>.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```
Expected: `{"ok":true,"result":true,"description":"Webhook was set"}`.

Verify:
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```
Expected: `url` matches, `pending_update_count` is 0 or small, no `last_error_message`.

## 7. Smoke test
1. In TaskCalendar: Settings → Integrations → Telegram → **Connect**. Note the 6-digit code.
2. In Telegram: open the bot, send `/start <code>`. Bot replies "✅ Linked!".
3. Send `add workspace Acme`. Bot replies with a Confirm/Cancel keyboard.
4. Tap **Confirm**. Bot replies "✅ Workspace Acme created." Reload the app — workspace appears.
5. Send `task: call John tomorrow 3pm in <existing project name>`. Tap Confirm. Task appears.
6. `/orgs` lists orgs; `/switchorg <name>` switches; `/unlink` disconnects.

## Troubleshooting
- `/start` reply is silent → `TELEGRAM_BOT_TOKEN` not set or wrong; check edge function logs.
- 401 in logs → `TELEGRAM_WEBHOOK_SECRET` mismatch between Edge Function secret and `setWebhook` call.
- "I didn't catch that" for everything → `OPENAI_API_KEY` missing or invalid; check edge function logs.
- "User is not a member of this organization" → integration's `metadata.current_org_id` points at an org the user no longer belongs to; `/switchorg` or unlink + re-link.
