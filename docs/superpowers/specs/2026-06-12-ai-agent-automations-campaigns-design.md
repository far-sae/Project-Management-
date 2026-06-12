# AI agent builds automations + campaigns, modern chat

**Date:** 2026-06-12
**Status:** Approved (scope confirmed)
**Branch(es):** `ai-agent-*` (off `main`), one per slice.

## Goal
Let the in-app AI agent build **automations** and **outreach campaigns** from
plain English, and give the chat a modern (ChatGPT/Perplexity-style) feel.

Confirmed scope:
- On confirm → **save live** (enabled, running) + a toast/link to manage.
- Campaign → **auto-enroll** the matched segment on create.
- Chat → **modern layout + typing indicator** (single-shot under the hood; no token streaming).

## What already exists (reuse, don't rebuild)
- `crm-assistant` edge fn: propose→confirm; client executes confirmed actions in
  `src/services/agent/useAgentActionRunner.ts` (switch on `AgentActionType` from
  `src/services/agent/agentActions.ts`).
- `draftAutomationFromText(orgId, description)` → `RecipeDraft` (NL→recipe, via the
  `automation-author` edge fn).
- `upsertRecipe(orgId, recipeId|null, draft)` → persists to `automation_recipes`.
- `enrollInAutomation(recipeId, clientId?, dealId?)` → enrolls a record.
- A **campaign = a recipe** with `send_email` + `wait` actions (no new table).
- Leads are organised by **category** (recent change) — the natural campaign segment.

## Slice A — Agent builds automations
- Edge fn: new tool `propose_create_automation { name, description }`. The agent
  captures intent; it does NOT hand-write recipe JSON.
- `agentActions.ts`: add `create_automation` to `AgentActionType` (+ permission gate:
  owner/admin or canEditModule).
- `useAgentActionRunner.ts`: on confirm →
  `const draft = await draftAutomationFromText(orgId, description); draft.name = name;
   draft.enabled = true; await upsertRecipe(orgId, null, draft);` → toast
  "Automation '<name>' is live."
- Reuses the entire automations engine; no migration.

## Slice B — Agent builds campaigns
- Edge fn: new tool `propose_create_campaign { name, description, segment }` where
  `segment` is plain text (e.g. "leads in category Enterprise", "customer accounts").
- `agentActions.ts`: add `create_campaign`.
- `useAgentActionRunner.ts`: on confirm →
  1. draft a **sequence** recipe (send_email + wait steps) from `description`
     (reuse `draftAutomationFromText`, campaign-oriented prompt) + `enabled = true`;
     `upsertRecipe`.
  2. **Resolve the segment** client-side: match leads by category (and/or accounts by
     type/category) from the loaded lists.
  3. `enrollInAutomation(recipeId, clientId)` for each matched record.
  → toast "Campaign '<name>' created — N enrolled."

## Slice C — Modern chat
- Redesign `src/components/aiAgent/CrmAssistantChat.tsx`: cleaner message bubbles,
  suggestion chips, an animated **typing indicator** while awaiting the reply, and
  tighter proposed-action cards (incl. the new automation/campaign cards). Single-shot
  request flow unchanged.

## Non-goals
- No token-by-token streaming (deferred).
- No new automations *builder* UI (the agent is the interface; a recipe is editable
  via a future list if needed). Settings automation tabs stay removed.
- No new tables (recipes/enrollments already exist).

## Deploy
- Redeploy the `crm-assistant` edge fn after Slices A/B (new tools):
  `npx supabase functions deploy crm-assistant --use-api`. `automation-author` already
  deployed. No migration.

## Testing
- Unit: segment-resolution helper (category/type → matched record ids) is pure +
  testable. Build + suite green per slice.
- Manual: "make an automation that adds a follow-up task when a lead goes hot" → confirm
  → recipe saved + live. "email all Enterprise leads a 3-step intro sequence" → confirm
  → campaign created + those leads enrolled.

## Self-review
Every slice reuses an existing primitive (draftAutomationFromText / upsertRecipe /
enrollInAutomation) behind one new proposed-action each; the only net-new logic is
segment resolution (pure) and the chat restyle. No tables, one edge-fn redeploy.
