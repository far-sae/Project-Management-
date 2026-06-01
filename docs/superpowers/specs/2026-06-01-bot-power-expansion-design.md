# Chat-bot power expansion — Telegram + WhatsApp

**Date:** 2026-06-01
**Status:** Approved (design)
**Supersedes/extends:** [2026-05-18-telegram-whatsapp-bot-design.md](2026-05-18-telegram-whatsapp-bot-design.md)

## Summary

Today the TaskCalendar chat bot (Telegram + WhatsApp) is **create-only**. It parses a
natural-language message into an `Intent`, confirms with a button, and writes a new
record. It cannot read, list, or edit anything; its disambiguation buttons are dead;
it silently drops media; and it parses relative dates in hardcoded UTC.

This project makes the bot a full read/write assistant:

1. **Disambiguation actually works** — tapping a choice resolves the record.
2. **Per-user timezone** — dates parse and render in the user's real timezone.
3. **Read / list queries** — "show my open tasks", "deals closing this month".
4. **Edit / update** — "mark X done", "reschedule Y to Friday", "move Acme to Won".
5. **Media** — voice notes are transcribed and run as commands; images/docs attach to a record.

**Out of scope:** delete (any entity), and the full deal→project "Won" handoff.

## Key architectural fact

Both webhooks already share one brain. `telegram-webhook/{intent,agentActions,types}.ts`
are thin re-export wrappers around `_shared/agent/`; `whatsapp-webhook/handlers.ts`
imports the same shared modules. So **all new logic is built once in `_shared/agent/`**
and both bots inherit it. The only code that exists per-provider is unavoidable transport
glue (sending messages/buttons, downloading media, parsing each platform's webhook
payload, rendering replies).

| Lives once — `_shared/agent/` | Lives twice — platform glue |
|---|---|
| Intent parsing, action resolution, disambiguation state machine, query logic, edit logic, transcription + attach logic, tz-aware formatting | Send message/buttons/list, download media, webhook payload parsing, callback routing, reply rendering |

## Decisions (locked with user)

- **Build once** in `_shared/agent/`; both bots inherit. (Corrects an earlier wrong claim that the bots were duplicated.)
- **Edits always confirm** before writing — same one-tap confirm flow as creates.
- **Voice transcript flows in silently** as if the user typed it (the normal flow still confirms any create/edit).
- **No delete.** **No** full "Won" project handoff (just set stage + close date).
- **Generic `query` / `update` actions** rather than one action per entity.
- **Media default target** is the chat's last-touched record.

## Components

### New shared modules (`_shared/agent/`)
- `query.ts` — runs org-scoped reads, returns formatted list strings.
- `media.ts` — `transcribeAudio(bytes, mime)` and `attachToEntity(...)`.
- `format.ts` — `formatLocal(iso, tz)` and helpers for rendering dates/values in replies.

### Changed shared modules
- `types.ts` — new action types + `Intent` fields (below).
- `intent.ts` — expanded system prompt, schema, and few-shot examples for `query` + `update`.
- `agentActions.ts` — new `resolveIntent` cases, `executePending` cases for edits, `resumeDisambiguation()`, and honoring `resolved_ids`.

### Per-provider glue
- `telegram.ts` — `downloadMedia()` (via `getFile`). Already renders inline keyboards.
- `whatsapp.ts` — `downloadMedia()` (media-id → URL → fetch) + **new** `sendList()` (interactive list, ≤10 rows) for >3 candidates.
- `index.ts` (both) — detect media message types; route `pick*:` callbacks.
- `handlers.ts` (both) — forward media to `media.ts`, forward `pick*:` to `resumeDisambiguation()`, render returned replies. Unify HELP text (move canonical HELP to shared, append new examples).

## Data model

### Intent (`types.ts`)

New `AgentActionType` members: `query`, `update`.

New `Intent` fields (all optional, additive):
```
entity?:    "task" | "client_task" | "deal" | "lead" | "client" | "contact" | "meeting" | "call"
scope?:     "mine" | "all"
timeframe?: "today" | "this_week" | "this_month" | "overdue" | "upcoming"
target?:    string          // the name/title to look up for an update
priority?:  string          // task priority for create/update
resolved_ids?: Record<string,string>   // internal; carried through disambiguation
```
For `update`, the **change** reuses existing fields: `status`, `stage`, `due` (new due date),
`title` (new title), `value`, `currency`, `priority`.

### `query` semantics
| entity | filters honored | "mine" means | renders |
|---|---|---|---|
| task | status, timeframe, project | created_by or assignee = user | title · project · due |
| client_task | status, timeframe, client | assigned_to = user | title · client · due |
| deal | stage, timeframe | owner_id = user | title · stage · value · close date |
| lead | timeframe | created_by = user | name · company · created |
| client | — | — | name |
| meeting | timeframe | host_user_id = user | title · start |
| call | timeframe | caller_user_id = user | subject · status · time |

Results capped at **10**; if more exist, append `…and N more — open TaskCalendar to see all.`
(No silent truncation.) Dates rendered via `format.ts` in the user's timezone.

### `update` semantics
| entity | allowed changes | write |
|---|---|---|
| task | status (done/in_progress/pending/undefined), due (reschedule), title (rename), priority | `UPDATE public.tasks ... WHERE task_id=? AND organization_id=?` |
| client_task | status, due, title | `UPDATE public.client_tasks` |
| deal | stage (lead/qualified/proposal/negotiation/won/lost), value+currency, expected_close_date | `UPDATE public.deals`; "won" also sets `actual_close_date` |
| lead | status, email, phone | `UPDATE public.leads` |
| meeting | start_at (reschedule), status (cancel) | `UPDATE public.meetings` |

`contact` stays create-only in this round (no query/update row). All writes use the
**service-role admin client, scoped by `organization_id`** — the same
pattern the existing CRM create intents use ([agentActions.ts](../../supabase/functions/_shared/agent/agentActions.ts)).
Org membership is already verified at account load. No new RPCs required.

### Disambiguation state
Reuse `agent_conversation_state` (PK `provider, chat_id`, 5-min TTL):
- When `findByName` returns >1, persist `awaiting_field = "__pick:<field>"` (e.g. `__pick:project_id`)
  and `partial_intent`, then send the `choices` reply.
- `resumeDisambiguation(admin, provider, chatId, "pick<type>:<id>")`:
  1. Load conversation state.
  2. Set `partial_intent.resolved_ids["<type>_id"] = <id>`.
  3. Clear the await.
  4. Re-run `resolveIntent(partial_intent)`.
- `resolveIntent` checks `intent.resolved_ids?.[field]` **before** calling `findByName`,
  using the known id directly. This also makes existing creates resolve end-to-end.

### Last-touched record (media target)
Store `last_entity: { type, id, label }` in `integrations.metadata`, updated whenever
`executePending` succeeds (create or edit). Image/document attachments default to this
record. Survives beyond the 5-min conversation TTL. If absent, the bot asks which record
(reuses disambiguation); a media caption is parsed as a command to pick the target first.

### Attachments (existing — no migration)
Reuse the polymorphic `attachments` table + private `attachments` Storage bucket
([116_attachments_email_events.sql](../../supabase/migrations/116_attachments_email_events.sql)).
Path: `<org_id>/<entity_type>/<entity_id>/<attachment_id>-<file_name>`. The bot inserts the
row + uploads bytes with the service-role client.

### Timezone (migration + frontend)
- **Migration** `<next>_user_profiles_timezone.sql` (next sequential number; current max is `122`): `alter table public.user_profiles add column if not exists timezone text;`
  IANA string (e.g. `Europe/London`); `null` ⇒ treat as `UTC`. (Profile data lives in
  `public.user_profiles`, PK `id` → `auth.users`.)
- **Frontend**: timezone `<select>` (IANA list, `@/components/ui/select`) in the Profile tab of
  [Settings.tsx](../../src/pages/Settings.tsx) (~L726–758), wired through `updateUserProfile` /
  `getUserProfile` in [auth.ts](../../src/services/supabase/auth.ts) and the `User` type in
  [user.ts](../../src/types/user.ts).
- **Bot**: `handleNaturalLanguage` loads `user_profiles.timezone` for `account.user_id` and passes
  it to `parseIntent` (replacing the hardcoded `"UTC"`); the same value drives `format.ts`.

## Data flow

### Read (query)
text → `parseIntent` → `{action:"query", entity, filters}` → `query.ts` runs org-scoped
select → formatted list (`AgentReply.text`) → send. No confirm (read-only).

### Edit (update)
text → `parseIntent` → `{action:"update", entity, target, changes}` → resolve `target`
(disambiguation if needed) → `confirm` reply with pending action → user taps Confirm →
`executePending` runs the scoped `UPDATE` → success message → update `last_entity`.

### Disambiguation
multiple matches → persist partial intent + `__pick:<field>` → `choices`/list →
tap → `resumeDisambiguation` → resolved `resolveIntent` → confirm.

### Voice
media event → `downloadMedia` → `transcribeAudio` → transcript → `handleNaturalLanguage`
(as if typed) → normal flow.

### Image / document
media event → `downloadMedia` → resolve target (caption command → last_entity → ask) →
`attachToEntity` (upload + row) → confirm message naming the record.

## Error handling & safety

- Every read/write filtered by `organization_id`; membership verified at account load — never cross-org.
- Target not found → friendly "No task called *X*."; multiple → disambiguation.
- Transcription failure → "Couldn't transcribe that voice note — try typing it."
- Attachment upload failure → surfaced to user; no partial DB row left.
- Webhooks always return 200 to avoid provider retry storms (existing contract).
- Pending edits use the existing 10-min TTL; disambiguation uses the 5-min conversation TTL.

## Testing

Deno unit tests in `_shared/agent/` with a mocked `SupabaseClient` and mocked `fetch`:
- intent parsing for each new `query`/`update` phrasing (mocked OpenAI response),
- `resolveIntent` for every new action incl. resolved-id short-circuit,
- `resumeDisambiguation` happy path + expired state,
- `query.ts` formatting incl. the "+N more" cap,
- `update` patch building per entity,
- `transcribeAudio` (mocked fetch) + `attachToEntity` path construction,
- `format.ts` tz conversion (UTC ↔ a sample IANA zone).

Plus a manual deploy-and-verify checklist per phase against a real Telegram + WhatsApp chat.

## Build order (phases — each independently shippable)

0. **Disambiguation** — `resumeDisambiguation`, honor `resolved_ids`, WhatsApp `sendList`. Fixes dead buttons; unblocks edits.
1. **Timezone** — migration + profile UI + bot read/format.
2. **Read / list queries** — `query.ts`, `query` action, parser examples.
3. **Edit / update** — `update` action, resolve+confirm+write, `last_entity` tracking.
4. **Media** — `downloadMedia` (both), `media.ts`, voice→command, image/doc→attach.

## Open items to resolve during planning
- Exact profile-settings component + how `profiles.timezone` is read elsewhere (consistency).
- Whisper model choice (`whisper-1` vs `gpt-4o-mini-transcribe`) and accepted audio mime types per platform (Telegram OGG/Opus, WhatsApp OGG/Opus).
- Whether `meeting` cancel maps to a `status` column or a dedicated flag (verify `meetings` schema).
