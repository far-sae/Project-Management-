# Automations — extend (SMS/notify, date trigger, AI-author, branching)

**Date:** 2026-06-04
**Status:** Approved (design)
**Branch:** `automations-extend` (off `main`)

## Summary

The automations subsystem is already mature (17 triggers, 20 actions incl. webhook/Slack/email/5 AI/wait-sequences, conditions, run logs, send windows, templates, enrollment, health). This spec **extends** it with four targeted additions:

- **A. `send_sms` + `notify` actions** — wire the (now CORS-fixed) `sms-send` and `createNotification` into the action registry.
- **B. Date/inactivity trigger** — fire relative to a date (e.g. N days before a deal's `expected_close_date`) and on staleness (deal with no activity in N days).
- **C. AI-authored recipes** — "describe it in plain English" → `crm-assistant` drafts a `RecipeDraft` the user reviews in the builder.
- **D. Visual if/then branching** — a `branch` action that runs one of two nested action lists based on conditions (backward-compatible with today's linear recipes).

Build order: A → B → C → D (easy→hard; D is the large/risky one, done last).

## Baseline (extend, don't rebuild)
- Engine: `supabase/functions/crm-run-automations/` — `ACTION_REGISTRY` (actions/index.ts), `runRecipe` loop, `conditions/evaluator.ts`, `triggers/matchers.ts`, `wait`/`pending_actions` defer mechanism, send windows.
- DB: `automation_recipes` (trigger_type, trigger_config jsonb, conditions jsonb, actions jsonb, enabled…), `automation_events`, `automation_runs`, `pending_actions`. Triggers enqueue events via SECURITY DEFINER table triggers; cron worker every minute.
- Frontend: `src/services/supabase/automations.ts` (`TriggerType`/`ActionType` unions, `RecipeDraft`, `upsertRecipe`, `listRecipes`, `listRuns`…), `RecipeBuilder.tsx`, `AutomationsSettingsTab.tsx`.
- Reusable callables: `sms-send` edge fn, `createNotification` (service), `sendViaGmail`, `crm-assistant`.

## A. send_sms + notify actions

**Engine:** add two action handlers + register them.
- `send_sms` (`actions/sendSms.ts`): config `{ to: string | "client_phone" | "deal_owner_phone"; body: string (template) }`. Resolve `to` (template + special tokens), then call the `sms-send` edge fn (service-role bearer) with `{ organizationId, to, body, clientId?, dealId? }`. Skip gracefully if no phone. Return `{ status, meta: { provider_sid } }`.
- `notify` (`actions/notify.ts`): config `{ user: "deal_owner" | "client_owner" | "<user_id>"; title: string (template); body: string (template) }`. Resolve the user, call the org's notification insert (the worker uses the service-role admin client → insert into `notifications` directly or via `create_notification_v1` RPC). Return `{ status }`.
- Register both in `ACTION_REGISTRY`, add to the `ActionType` union (engine `shared/types.ts` + frontend `automations.ts`), add `validateRecipeDraft` rules, and add builder config panels + labels in `RecipeBuilder.tsx`.

## B. Date/inactivity trigger

Two new recipe trigger types, both **cron-enqueued** (like the existing `task_overdue`/`scheduled`), so no new DB table triggers:
- `date_relative` — trigger_config `{ entity: "deal"; date_field: "expected_close_date"; offset_days: number (− = before, + = after) }`. The worker's cron-enqueue step scans deals whose `date_field` is `today − offset_days` (dedup via an existing-event check in the last 24h, mirroring `task_overdue`).
- `deal_inactive` — trigger_config `{ days: number }`. Reuse the logic behind `crm-stuck-deal-scanner` / `find_stale_deals` (already exists for the AI agent): enqueue a `deal_inactive` event for deals with no activity in `days`, deduped.
Add both to `TriggerType` (engine + frontend), `triggerConfigMatches` (filter), the cron-enqueue block in the worker, and builder trigger options + config panels.

## C. AI-authored recipes

- A "✨ Describe an automation" entry in `AutomationsSettingsTab` → a prompt box. On submit, call `crm-assistant` (or a small dedicated edge call) with the user's text + the catalog of available trigger/action types, asking it to return a **`RecipeDraft` JSON** (trigger, conditions, actions). Validate the draft client-side against the known `TriggerType`/`ActionType` unions; open it in `RecipeBuilder` **pre-filled** (using the existing `initialDraft` prop) so the user reviews/edits before saving. Never auto-save.
- Reuse the existing `crm-assistant` edge fn with a focused system prompt + a `StructuredOutput`-style JSON contract; parse defensively (drop unknown trigger/action types).

## D. Visual if/then branching (backward-compatible)

**Data model:** keep `actions: jsonb[]`. Add a new action type `branch` whose `config` is `{ conditions: RecipeCondition[]; then: RecipeAction[]; else: RecipeAction[] }`. Existing linear recipes (no `branch` action) are unaffected.

**Engine:** in `runRecipe`'s action loop, when `action.type === "branch"`: evaluate `config.conditions` against the context (reuse `conditions/evaluator.ts`); run the `then` list if true, else the `else` list — by recursing the same action-execution helper over the chosen sub-list. Results are flattened into `action_results` with a path marker. **v1 constraint:** disallow a `wait` action *inside* a branch (the `pending_actions` resume-by-index model doesn't address nested paths) — `validateRecipeDraft` rejects it with a clear message; top-level `wait` keeps working. (A later version can extend resume to nested paths.)

**Builder:** `RecipeBuilder` renders a `branch` action as an "If <conditions> → [then actions] / Else → [else actions]" block with nested action editors (reuse the existing action-row + condition-row components). Drag-drop within each sub-list.

**Engine type:** extend `RecipeAction` so `config` can hold nested `RecipeAction[]` (recursive type) in both the engine `shared/types.ts` and frontend `automations.ts`.

## Permissions
Unchanged: creating/editing recipes stays admin-only (`crm_upsert_recipe`/`crm_delete_recipe` are admin-gated); members read recipes + run history + can enroll. The new actions run with the worker's service-role context (same as all actions). `send_sms`/`notify` respect the same org scoping.

## Error handling
- `send_sms`/`notify` resolve-failure (no phone / unknown user) → `skipped` result, not a hard failure (matches `send_email`'s graceful skip).
- AI-author: malformed/over-spec JSON → show the raw suggestion + a "couldn't parse into a recipe" message; never save an invalid recipe.
- Branching: a `branch` with no matching condition runs `else` (possibly empty = no-op). Nested `wait` is rejected at validation.
- Engine keeps its run-record + runaway-disable safety.

## Testing
- **Engine (Deno):** unit-test `send_sms`/`notify` handlers (mocked fetch / admin) returning the right result shape + graceful skip; the `branch` executor (then/else selection over a mocked condition evaluator); `date_relative`/`deal_inactive` enqueue predicates.
- **Frontend (vitest):** the AI-draft JSON validator (drops unknown types; rejects nested wait); `RecipeBuilder` renders/saves a branch draft (light test).
- Build + manual per phase.

## Build phasing
- **A** — send_sms + notify actions (small; immediately useful, leverages the just-fixed sms-send).
- **B** — date_relative + deal_inactive triggers.
- **C** — AI-authored recipes.
- **D** — visual branching (large; engine + builder; backward-compatible; v1 disallows nested wait).

Each phase is independently shippable.
