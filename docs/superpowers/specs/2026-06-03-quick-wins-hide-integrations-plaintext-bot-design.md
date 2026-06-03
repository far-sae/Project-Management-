# Quick Wins — Hide WhatsApp/Gmail + Plain-text bot

**Date:** 2026-06-03
**Status:** Approved (design)
**Branch:** `quick-wins-hide-plaintext` (stacked on `bot-power-expansion`; rebase onto `main` after PR #1 merges)

## Summary

Two small, independent changes, bundled as one spec:

- **Part A — Hide WhatsApp + Gmail** from the public landing pages and from the in-app Integrations tab, behind a feature flag (default OFF) so they can be flipped on later without code changes.
- **Part B — Plain-text bot**: the Telegram/WhatsApp bot accepts natural language for everything (linking + utility commands), so users never need to type a `/command`. Slash commands keep working as **silent aliases** so nothing breaks.

These are the first of a 5-part roadmap. Deferred to their own specs: fine-grained CRM module permissions (#4), an execute-after-confirm in-app agent across CRM+PM (#2), and 500 MB resumable uploads (#3).

## Part A — Hide WhatsApp + Gmail behind a flag

### Component: feature flags
New `src/config/featureFlags.ts`:
```ts
// Build-time feature flags. Default OFF — flip on by setting the env var and
// rebuilding (e.g. VITE_ENABLE_WHATSAPP=true).
export const FEATURES = {
  whatsapp: import.meta.env.VITE_ENABLE_WHATSAPP === "true",
  gmail: import.meta.env.VITE_ENABLE_GMAIL === "true",
} as const;
```

### In-app (Settings → Integrations)
- `src/components/integrations/IntegrationsTab.tsx`: compute the rendered provider list as `providerOrder.filter(id => id !== "gmail" || FEATURES.gmail)`; render `<WhatsAppConnectCard />` only when `FEATURES.whatsapp`.
- `src/components/integrations/IntegrationsHealthCard.tsx`: hide the **Gmail** health row when `!FEATURES.gmail`. (Leave Google **Meet** and Automations rows untouched — Meet ≠ Gmail.)
- Telegram card and the `google` (Google Meet) provider are **unaffected**.

### Public landing
- `src/components/landing/FeaturesSection.tsx` and `src/components/landing/HeroSection.tsx`: remove the WhatsApp and Gmail items/copy from the marketing content. (Static marketing — removed at source, not flag-gated. If a single shared list drives both, edit that list.)

### Flip-on path
Set `VITE_ENABLE_WHATSAPP=true` and/or `VITE_ENABLE_GMAIL=true` in the build env and rebuild. (A runtime/org-settings flag is possible but out of scope; env flag chosen for simplicity.)

## Part B — Plain-text bot (no slash commands)

Applies to both `supabase/functions/telegram-webhook/` and `supabase/functions/whatsapp-webhook/`. All logic that can be shared stays in the webhook `index.ts` routing layer; copy lives in `handlers.ts`.

### Linking without `/start`
- An **unlinked** chat that sends a bare 6-digit code (`/^\d{6}$/`) is treated as a link code — same path as `handleStart(..., code)` today, just without the `/start` prefix.
- An unlinked chat that sends anything else (and isn't a slash command) gets: *"Send me the 6-digit code from TaskCalendar → Settings → Integrations to connect this chat."*

### Utility commands as plain phrases
Matched in the webhook **before** the natural-language parser (cheap regex, no LLM call). Case-insensitive, trimmed:
| Phrase (regex) | Action | Existing handler |
|---|---|---|
| `^(help\|what can you do\??\|commands)$` | help text | `handleHelp` |
| `^(my )?orgs$` / `^list orgs$` | list orgs | `handleListOrgs` |
| `^(switch\|use)( to)?\s+(.+)$` | switch org to `$3` | `handleSwitchOrg` |
| `^(cancel\|never ?mind\|stop)$` | clear pending prompt | `handleCancel` |
| `^(unlink\|disconnect)$` | unlink chat | `handleUnlink` |

Anything not matched → existing NL create/query/edit pipeline (`handleNaturalLanguage`), unchanged.

### Slash commands kept as silent aliases
The existing `/start /unlink /help /orgs /switchorg /cancel` handlers stay wired so Telegram's auto-`/start` button and muscle memory keep working. They are **no longer advertised** anywhere.

### Copy cleanup
- Link-success and "not linked" messages stop mentioning `/start`.
- `handleHelp` / `HELP_TEXT` rewritten to show plain-text examples (e.g. `add task call John tomorrow 3pm in Q1 launch`, `show my open tasks`, `mark Deploy v2 done`, `switch to Acme Corp`, `unlink`) with no leading slashes.

### Out of scope
Conversational slot-filling ("What's the task title?") stays — it's natural Q&A, not a slash command.

## Data flow

**Part A:** build env → `FEATURES` constant → conditional render in Integrations UI; landing copy removed at source.

**Part B (per inbound message):** webhook `index.ts` → (1) if unlinked & 6-digit → link; (2) else if matches a utility regex → dedicated handler; (3) else slash-command alias if present; (4) else → `handleNaturalLanguage`.

## Error handling
- Part A: a missing/garbage env var → flag is `false` (hidden) — safe default.
- Part B: unchanged webhook contract (always HTTP 200 to avoid provider retries). Unknown plain text still routes to the NL parser, which already handles "unknown" gracefully. Switch-org with no/[]-match name reuses `handleSwitchOrg`'s existing "No org named X" reply.

## Testing
- **Part A:** a small unit test that `FEATURES` reads the env vars (vitest), and a render test of `IntegrationsTab` asserting the Gmail card / WhatsApp card are absent when flags are off and present when on. Manual: load the landing page — no WhatsApp/Gmail copy.
- **Part B:** the utility-phrase matcher is a pure function (`matchUtilityCommand(text)`) returning a discriminated result — unit-tested in `deno test` for each phrase + the 6-digit link case + a non-match falling through. Manual (post-deploy): send `123456` to link, `help`, `my orgs`, `switch to <org>`, `cancel`, `unlink`, and a normal `add task …` — all work with no slashes.

## Build order
1. Part A (frontend, self-contained).
2. Part B (bot routing + copy).
Independent; either can ship first.
