# Telegram / WhatsApp Bot — Design

**Status:** Approved (brainstorm)
**Date:** 2026-05-18
**Scope:** v1 ships Telegram; WhatsApp added later as a second adapter against the same core.

## Goal

Let an authenticated TaskCalendar user manage their workspace from a chat app. They text the bot in natural language ("add task: call Acme tomorrow 3pm in Sales > Q1 launch") and the bot creates the corresponding entity after a confirmation step. Supported entities in v1: **workspace, project, task, client, client task**.

Audience: org members only (authenticated TaskCalendar users). Not a client-facing portal.

## Non-goals

- Client-facing chat / support inbox (deferred).
- Updating/deleting existing entities via bot (read + create only in v1).
- Group chats — bot only responds in 1:1 private chats in v1.
- Threaded conversations / context across multiple messages (each message is parsed standalone).

## High-level architecture

```
Telegram ──webhook──▶ Supabase Edge Function  ──▶  intent parser (OpenAI)
                       (telegram-webhook)             │
                                │                     ▼
                                │              structured action
                                ▼                     │
                       linked user lookup             ▼
                       (integrations table)    agentActions.ts ──▶ existing services
                                                                    (workspaces, projects,
                                                                     tasks, clients,
                                                                     clientTasks)
```

Five pieces:

1. **`telegram-webhook` edge function** — receives Telegram updates, verifies secret token, dispatches to handlers.
2. **Account-linking flow** — TaskCalendar Settings → Integrations → Telegram generates a 6-digit code. `/start <code>` in the bot consumes the code and writes a row in `integrations` (`provider='telegram'`).
3. **Intent parser** — reuses `services/ai/openai.ts` with function-calling / JSON-mode. Returns typed `Intent`.
4. **`agentActions.ts`** — platform-agnostic. Takes `(Intent, user_id, org_id)`, resolves names → IDs, returns either a `ConfirmReply`, a `DisambiguationReply`, or an error.
5. **Pending-action store** — `agent_pending_actions` table buffers the parsed action for ~10 min so the inline-button reply ("✅ Confirm") matches back.

WhatsApp later = a second edge function `whatsapp-webhook` that produces the same `Intent` and reuses pieces 3–5 unchanged.

## Data model

Three new tables. No changes to existing entity tables.

### `telegram_link_codes`
```sql
id              uuid primary key default gen_random_uuid()
user_id         text         not null   -- TaskCalendar user (Firebase UID, matches existing convention)
org_id          uuid         not null
code_hash       text         not null   -- SHA-256 of the 6-digit code
created_at      timestamptz  not null default now()
expires_at      timestamptz  not null   -- created_at + interval '10 minutes'
consumed_at     timestamptz  null
```
Indexes: unique on `code_hash` where `consumed_at IS NULL`. RLS: user can only `select`/`insert` rows where `user_id = auth.uid()`. Webhook uses service role.

### `agent_pending_actions`
```sql
id              uuid primary key default gen_random_uuid()
provider        text         not null   -- 'telegram' | 'whatsapp'
chat_id         text         not null   -- platform chat identifier
user_id         text         not null   -- resolved TaskCalendar user
org_id          uuid         not null
action          jsonb        not null   -- the parsed Intent
created_at      timestamptz  not null default now()
expires_at      timestamptz  not null   -- + 10 min
```
Indexes: `(provider, chat_id, expires_at desc)`. Cleanup: a `WHERE expires_at < now()` purge runs on each insert (cheap, keeps the table tiny).

### `integrations` (existing — extend only)
- Add `'telegram'` (and later `'whatsapp'`) to `ProviderId` union.
- `metadata` jsonb for telegram holds:
  ```json
  {
    "telegram_user_id": 123456789,
    "telegram_username": "faraz",
    "chat_id": 123456789,
    "current_org_id": "uuid"
  }
  ```
- One row per `(user_id, provider)`. `current_org_id` is mutable via `/switchorg`.

## Message flow

### Linking
1. User in Settings → Integrations → Telegram clicks **Connect**.
2. Frontend calls new edge function `telegram-link-code`, which inserts a row with the user's currently selected org and returns a 6-digit code.
3. UI shows: *"Open @YourBotName on Telegram and send `/start 482931`. Expires in 10 min."*
4. User sends `/start 482931`. Webhook:
   - Looks up `code_hash`, validates not expired / not consumed.
   - Marks consumed.
   - Upserts `integrations` row with `provider='telegram'`, populating `metadata`.
5. Bot replies: *"✅ Linked as faraz@... in org **Acme**. Try: `add task call John tomorrow 3pm`."*

### Natural-language command
Example: `task: call Acme tomorrow 3pm in Sales > Q1 launch`

1. Webhook validates secret token → looks up `telegram_user_id` in `integrations`.
   - Not linked → reply with link instructions, stop.
2. Loads compact context for the user's `current_org_id`: workspace names, project names per workspace, client names (capped at ~50 each to keep prompt small).
3. Calls intent parser with `(message_text, context)`. OpenAI returns:
   ```json
   {
     "action": "create_task",
     "workspace": "Sales",
     "project": "Q1 launch",
     "title": "Call Acme",
     "due": "2026-05-19T15:00:00",
     "confidence": 0.92
   }
   ```
4. `agentActions.execute(intent, user_id, org_id)` resolves names → IDs. Three outcomes:
   - **Resolved cleanly** → insert `agent_pending_actions` row, reply with summary + inline keyboard `[✅ Confirm] [✏️ Edit] [❌ Cancel]`.
   - **Ambiguous** ("Sales" matches 2 workspaces) → reply with numbered inline buttons listing each option; tapping stores the choice and re-runs resolution.
   - **Unknown entity** ("workspace Acme" doesn't exist) → reply: *"No workspace called Acme. Create it? [Yes, create] [Cancel]"*.
5. On `✅ Confirm` callback: webhook reads pending action, calls the existing service function (e.g. workspaces.createTask), replies *"✅ Created. <deep link to web UI>"*, deletes the pending row.

### Slash commands (always available)
- `/start [code]` — link account or show status if already linked.
- `/orgs` — list orgs the user belongs to, marking the current one.
- `/switchorg <name|index>` — change `current_org_id` in `integrations.metadata`. Bot confirms.
- `/help` — usage examples.
- `/unlink` — delete the integrations row for this chat.

### Errors and edges
- OpenAI returns malformed JSON or fails → *"I didn't catch that. Try `/help` or rephrase."* Logged via existing logger.
- Service-layer error (RLS denial, plan-limit reached) → surface the existing error message + *"Open TaskCalendar to fix."*
- Rate limit per `telegram_user_id`: reuse `services/ai/rateLimiter.ts`. 30 messages / 5 minutes default.
- Expired pending action on confirm → *"That request expired. Resend the message."*
- Webhook secret mismatch → 401, no reply.

## Security

- **Webhook authenticity** — webhook URL contains a long random path segment AND Telegram echoes `X-Telegram-Bot-Api-Secret-Token`. Both validated; either mismatch → 401. Secret stored in Supabase Vault / function env.
- **Bot token** — `TELEGRAM_BOT_TOKEN` env var, never client-side.
- **Service-role usage** — webhook runs with service role, but every entity write is performed via service functions that explicitly pass the resolved `user_id`. Audit trails attribute correctly and RLS-equivalent checks (org membership, plan caps) are re-applied in `agentActions`.
- **Link codes** — 6 digits, 10-min expiry, single-use, hashed at rest (SHA-256). Generation rate-limited to 5/hour per user.
- **Privacy** — message text is sent to OpenAI for parsing. The Settings card must disclose this before the user connects. No message text persisted beyond the pending-action TTL.
- **Plan gating** — `agentActions` calls the same plan-limit checks as the web UI before each create.

## File layout

### New
```
supabase/functions/telegram-webhook/index.ts          # entrypoint, secret check, routing
supabase/functions/telegram-webhook/handlers.ts       # /start, /orgs, NL handler, callback queries
supabase/functions/telegram-webhook/telegram.ts       # Telegram API client (sendMessage, answerCallbackQuery, editMessageText)
supabase/functions/telegram-link-code/index.ts        # POST → inserts code row, returns 6-digit code

supabase/migrations/0NN_telegram_link_codes.sql
supabase/migrations/0NN_agent_pending_actions.sql

src/services/agent/intentParser.ts                    # OpenAI call, typed Intent return
src/services/agent/agentActions.ts                    # platform-agnostic executor
src/services/agent/types.ts                           # Intent, PendingAction, AgentReply
src/components/integrations/TelegramConnectCard.tsx   # Settings UI: generate code, show status, unlink
```

### Edits
- `src/services/integrations/types.ts` — add `'telegram'` to `ProviderId`.
- `src/services/integrations/providers.ts` — register telegram with display metadata (icon, accent, copy).
- `src/services/ai/prompts.ts` — add intent-parsing prompt.
- Settings → Integrations page — render `TelegramConnectCard`.

## Testing

### Unit
- **Intent parser** — fixture table of `(message, expected Intent)` covering each action type, dates ("tomorrow 3pm", "next Friday"), ambiguous inputs. Stubs OpenAI.
- **agentActions** — name resolution (exact, case-insensitive, ambiguous, missing), each create path, plan-limit rejection. Mocks supabase services.
- **Telegram API client** — verifies request shape for `sendMessage` and `answerCallbackQuery`.

### Integration
- POST a real Telegram update JSON to the webhook; assert outgoing reply payload and DB state for: link flow, create task happy path, ambiguous resolution, confirm, cancel, expired pending action, secret-token mismatch.

### Manual checklist (must pass before ship)
1. Link new chat with valid code.
2. Code expires after 10 min.
3. Code rejected after consumption.
4. Create workspace, project, task, client, client task via natural language — each requires confirm.
5. Ambiguous workspace name triggers disambiguation buttons.
6. Unknown workspace prompts to create.
7. `/orgs` lists orgs, `/switchorg` switches and confirms.
8. `/unlink` removes the row; next message asks to link again.
9. Plan-limit exceeded surfaces the existing error message.
10. OpenAI outage falls through to a graceful error.

## Open questions

None blocking. Items to confirm during implementation:
- Exact migration number prefix (`0NN`) once a migration is reserved.
- Whether `services/ai/rateLimiter.ts` already handles per-user keys or needs a small extension.

## WhatsApp adapter (later, not in v1 scope)

For reference so the v1 design stays compatible:
- New edge function `whatsapp-webhook` (Meta Cloud API).
- Verifies `X-Hub-Signature-256` HMAC.
- Maps incoming `messages[0].from` (phone number) → linked TaskCalendar user via an analogous link-code flow.
- Produces the same `Intent` shape and reuses `agentActions.ts` + `agent_pending_actions` unchanged.
- WhatsApp inline-button equivalents: interactive reply buttons (max 3, fits our Confirm/Edit/Cancel).
