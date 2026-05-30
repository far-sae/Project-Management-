# CRM AI Blocks — Batch 2b

**Date:** 2026-05-17
**Status:** Draft — pending user review
**Scope:** Add five LLM-powered action handlers to the recipe automation engine (Batch 2a). Org-funded model, per-org monthly run cap, per-call cost tracking, admin Settings page for usage + recent runs. Sequences and AI Sales Agent are separate specs (2c, 2d).

---

## Goals

1. Five new automation actions usable inside any recipe: `ai_summarize`, `ai_classify_lead`, `ai_draft_email`, `ai_extract`, `ai_translate`.
2. All calls go to Claude Sonnet 4.6 (`claude-sonnet-4-6`) via the official `@anthropic-ai/sdk` (Deno-compatible import) with prompt caching enabled on the system block.
3. Per-org monthly soft cap (default 1000 runs). Over the cap → action returns `status: 'skipped'` with `message: 'ai_quota_exceeded'`. Admin can edit the cap.
4. Per-call logging: action type, model, input/output tokens, USD cents, success/failure, duration, recipe + automation_run linkage.
5. Admin Settings page (`Settings → AI Usage`) showing this-month usage bar + cap controls + last 50 AI runs.
6. Chainable output via `{{ai.output}}` (and `{{ai.output_subject}}` / `{{ai.output_body}}` for `ai_draft_email`) so AI blocks feed downstream actions like `send_email` or `add_note`.

## Non-goals (v1)

- Prompt-template editing in the UI (system prompts are hard-coded per action).
- Per-AI-block model override (Sonnet for everything).
- Multi-turn conversations (each call is one shot, stateless).
- Image input (text only).
- Streaming responses.
- Per-recipe usage limits (only per-org).
- "Test this AI block" button in the recipe builder (deferred).
- Translation back-and-forth (`ai_translate` is one-way; admin picks target).

## Coordination

- Migration `066_ai_blocks.sql` (next number after `065_automation_engine.sql`).
- All 5 handlers live in **one file**: `supabase/functions/crm-run-automations/actions/ai.ts` (small file, shared `callClaude` helper, one prompt template each).
- `actions/index.ts` `ACTION_REGISTRY` gets 5 new entries.
- `src/services/supabase/automations.ts` `ACTION_TYPES` + `ACTION_LABEL` extended so the recipe builder dropdown surfaces them.
- One new secret: `ANTHROPIC_API_KEY` on Supabase Edge Function secrets.
- The existing `crm-rotate-turnstile-salt` daily cron gains a 3rd cleanup query (prune `ai_block_runs` older than 90 days).

---

## Section A — Architecture & cost tracking

### A.1 Flow

```
Automation worker → action handler (e.g. ai_summarize)
  ↓
  RPC: check_and_increment_ai_cap(org_id)
    → returns false if over cap → handler returns status='skipped', message='ai_quota_exceeded'
    → returns true → counter incremented
  ↓
  Anthropic SDK call (Sonnet 4.6, system block cached)
  ↓
  Insert ai_block_runs row (tokens, cost, status, recipe linkage)
  ↓
  Return ActionResult to worker (with meta.ai_output set so next action can reference it)
```

### A.2 Tables — `066_ai_blocks.sql`

```sql
create table if not exists public.ai_block_runs (
  run_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  recipe_id uuid references public.automation_recipes(recipe_id) on delete set null,
  automation_run_id uuid references public.automation_runs(run_id) on delete set null,
  action_type text not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  cost_usd_cents numeric(10,4),
  status text not null check (status in ('success','failure','skipped')),
  error_message text,
  duration_ms int,
  created_at timestamptz default now()
);

create index if not exists ai_block_runs_org_time_idx
  on public.ai_block_runs(organization_id, created_at desc);

create table if not exists public.ai_block_usage_caps (
  organization_id uuid primary key
    references public.organizations(organization_id) on delete cascade,
  monthly_run_cap int not null default 1000,
  current_month_runs int not null default 0,
  current_month_started_at date not null default date_trunc('month', current_date)::date
);

-- Atomic cap check + increment. Resets the counter when a new calendar month starts.
create or replace function public.check_and_increment_ai_cap(p_org uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_cap public.ai_block_usage_caps%rowtype;
  v_this_month date := date_trunc('month', current_date)::date;
begin
  insert into public.ai_block_usage_caps (organization_id) values (p_org)
    on conflict (organization_id) do nothing;
  select * into v_cap from public.ai_block_usage_caps
    where organization_id = p_org for update;
  if v_cap.current_month_started_at < v_this_month then
    update public.ai_block_usage_caps
    set current_month_runs = 0, current_month_started_at = v_this_month
    where organization_id = p_org;
    v_cap.current_month_runs := 0;
  end if;
  if v_cap.current_month_runs >= v_cap.monthly_run_cap then
    return false;
  end if;
  update public.ai_block_usage_caps
  set current_month_runs = current_month_runs + 1
  where organization_id = p_org;
  return true;
end;
$$;

grant execute on function public.check_and_increment_ai_cap(uuid) to service_role;

-- Admin-only RPC to update the cap from the UI.
create or replace function public.set_ai_block_cap(p_org uuid, p_cap int)
returns void
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_cap < 0 or p_cap > 1000000 then
    raise exception 'Cap must be 0–1,000,000' using errcode = '22023';
  end if;
  insert into public.ai_block_usage_caps (organization_id, monthly_run_cap)
  values (p_org, p_cap)
  on conflict (organization_id) do update set monthly_run_cap = p_cap;
end;
$$;

grant execute on function public.set_ai_block_cap(uuid, int) to authenticated;

-- RLS: members read; writes only via SECURITY DEFINER RPCs above.
alter table public.ai_block_runs enable row level security;
alter table public.ai_block_usage_caps enable row level security;

drop policy if exists "ai_block_runs read for org members" on public.ai_block_runs;
create policy "ai_block_runs read for org members"
  on public.ai_block_runs for select
  using (public.is_org_member(organization_id));

drop policy if exists "ai_block_usage_caps read for org members" on public.ai_block_usage_caps;
create policy "ai_block_usage_caps read for org members"
  on public.ai_block_usage_caps for select
  using (public.is_org_member(organization_id));
```

### A.3 Cost calculation

Claude Sonnet 4.6 pricing (May 2026):
- Input: $3 / 1M tokens = 0.0003 cents/token
- Output: $15 / 1M tokens = 0.0015 cents/token

`cost_usd_cents = (input_tokens * 0.0003) + (output_tokens * 0.0015)`

Stored per row so monthly bill is auditable. The "spend" number in the AI Usage tab is `sum(cost_usd_cents) / 100` for the current calendar month.

Prompt caching halves real cost on repeat invocations of the same prompt template — the cached system block doesn't count toward input_tokens after the first call within the 5-minute cache window. We don't track cache hit/miss separately in v1 (Anthropic reports it in `usage.cache_creation_input_tokens` / `cache_read_input_tokens`; we sum all into `input_tokens` for simplicity).

---

## Section B — The 5 action handlers

### B.1 Shared `callClaude` helper

`supabase/functions/crm-run-automations/actions/ai.ts`:

```ts
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.30.0";
import { ActionHandler, ActionContext } from "../shared/types.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";

const client = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

interface CallOptions {
  actionType: string;
  system: string;
  user: string;
  maxTokens?: number;
}

interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
}

async function callClaude(ctx: ActionContext, opts: CallOptions): Promise<CallResult> {
  if (!client) throw new Error("ANTHROPIC_API_KEY not set on the worker");

  // 1. Cap check via RPC — atomic increment if allowed.
  const { data: allowed } = await ctx.admin.rpc("check_and_increment_ai_cap", { p_org: ctx.orgId });
  if (allowed === false) throw new Error("ai_quota_exceeded");

  // 2. Make the call with prompt caching on the system block.
  const t0 = Date.now();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: [
      { type: "text", text: opts.system, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: opts.user }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

  const inputTokens =
    (res.usage.input_tokens ?? 0) +
    (res.usage.cache_creation_input_tokens ?? 0) +
    (res.usage.cache_read_input_tokens ?? 0);
  const outputTokens = res.usage.output_tokens ?? 0;
  const costCents = inputTokens * 0.0003 + outputTokens * 0.0015;
  const durationMs = Date.now() - t0;

  // 3. Log the call. Best-effort: if logging fails, swallow it — the action itself succeeded.
  await ctx.admin.from("ai_block_runs").insert({
    organization_id: ctx.orgId,
    recipe_id: ctx.recipeId,
    automation_run_id: null, // worker doesn't yet pass run_id; can wire later
    action_type: opts.actionType,
    model: MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd_cents: costCents.toFixed(4),
    status: "success",
    duration_ms: durationMs,
  }).catch(() => undefined);

  return { text, inputTokens, outputTokens, costCents, durationMs };
}

// Shared failure-logging helper used by each handler's catch block.
async function logFailure(ctx: ActionContext, actionType: string, message: string): Promise<void> {
  await ctx.admin.from("ai_block_runs").insert({
    organization_id: ctx.orgId,
    recipe_id: ctx.recipeId,
    action_type: actionType,
    model: MODEL,
    status: "failure",
    error_message: message,
  }).catch(() => undefined);
}
```

### B.2 Handler specs

Each handler exports a single `ActionHandler` function. Signatures match the engine's `(ctx, config) => Promise<ActionResult>` contract.

**`ai_summarize`**

Config: `{ source?: 'client_notes' | 'free_text', text?: string, limit?: number }`

- If `source === 'client_notes'` (default): fetch last `limit ?? 5` rows from `client_notes` for `event.payload.client_id`, joined into one prompt.
- If `source === 'free_text'`: use `substitute(config.text, ctx)` as the input.
- System prompt: *"You summarize CRM customer activity into a 2-sentence brief for a busy sales rep. Be concrete: mention specific things mentioned, deals, blockers."*
- After call: insert into `client_notes` (`kind='note'`, `subject='AI summary ({{recipe.name}})'`, `body=output`, `author_name='Automation: {{recipe.name}}'`).
- Return `{ status: 'success', meta: { ai_output: text, note_id, cost_cents } }`.

**`ai_classify_lead`**

Config: `{}` (no per-block config; uses the event's client).

- Fetch client row (industry, employee_count, annual_revenue, country, score) + last 5 notes + count of non-won/non-lost deals.
- System prompt: *"Classify this lead as `hot`, `warm`, or `cold` based on the data. Respond with EXACTLY one word: hot, warm, or cold. Consider engagement recency, deal size, and stage progression."*
- Parse output: lowercase first word, validate against `['hot','warm','cold']`. If invalid → failure.
- After call: `update clients set score_band = parsed_band where client_id = event.payload.client_id` (service-role bypasses RLS).
- Return `{ status: 'success', meta: { ai_output: parsed_band } }`.

**`ai_draft_email`**

Config: `{ goal: string, tone?: 'formal'|'casual', length?: 'short'|'medium' }`

- Required: `goal`. Defaults: `tone='formal'`, `length='short'`.
- Build user message from client row + recent deals + recent notes + the goal.
- System prompt: *"You draft outbound sales emails. Output format: subject line on first line, blank line, then body. Tone: {tone}. Length: {length} (short = 3 sentences max, medium = 5 sentences max). Do not include greeting/signature — the system will add those."*
- Parse output: split on first `\n\n` → subject (line 1) + body (rest).
- Return `{ status: 'success', meta: { ai_output: full_text, ai_output_subject: subject, ai_output_body: body } }`.
- **Does NOT send** — the next `send_email` action consumes `{{ai.output_subject}}` and `{{ai.output_body}}` from substitute context.

**`ai_extract`**

Config: `{ source_text: string, fields: string[] }`

- Run `substitute(source_text, ctx)` so placeholders resolve.
- System prompt: *"Extract these fields from the text. Respond as JSON object only — no prose, no markdown. Fields: {fields.join(',')}. Use null for any field not present in the text."*
- Set `max_tokens = 512` (short response expected).
- Parse output: `JSON.parse`; if fails → failure with message `"Could not parse AI response as JSON"`.
- After call: `update clients set custom_fields = custom_fields || $1 where client_id = event.payload.client_id` (Postgres JSONB concat — added/updated keys merge into existing).
- Return `{ status: 'success', meta: { ai_output: extracted_json, fields_extracted: object_keys } }`.

**`ai_translate`**

Config: `{ source_text: string, target_language: string }`

- Required: both fields.
- Run substitute on `source_text`.
- System prompt: *"Translate the following text to {target_language}. Preserve formatting and line breaks. Output only the translation, no explanation, no markdown."*
- Return `{ status: 'success', meta: { ai_output: translation } }`.

### B.3 `{{ai.output}}` chaining

`substitute.ts` extension: when an action returns `meta.ai_output` (any field starting with `ai_output`), the worker stashes them in `ctx.aiOutputs` for subsequent actions in the same recipe run. `substitute()` resolves:

- `{{ai.output}}` → `aiOutputs.ai_output`
- `{{ai.output_subject}}` → `aiOutputs.ai_output_subject`
- `{{ai.output_body}}` → `aiOutputs.ai_output_body`
- `{{ai.<any_key>}}` → `aiOutputs[<any_key>]` (forward-compatible for future ai_* meta fields)

If a placeholder references an `ai.` key that doesn't exist (e.g. recipe references `{{ai.output}}` but no AI action ran), it passes through unchanged (matches Batch 2a's "unknown placeholders are kept verbatim" behavior).

### B.4 Registry + service-layer constants

`actions/index.ts`:

```ts
import { aiSummarize, aiClassifyLead, aiDraftEmail, aiExtract, aiTranslate } from "./ai.ts";

export const ACTION_REGISTRY: Record<ActionType, ActionHandler> = {
  // … existing 9 …
  ai_summarize: aiSummarize,
  ai_classify_lead: aiClassifyLead,
  ai_draft_email: aiDraftEmail,
  ai_extract: aiExtract,
  ai_translate: aiTranslate,
};
```

`src/services/supabase/automations.ts` `ACTION_TYPES` array gets the 5 new entries appended. `ACTION_LABEL` (used by RecipeBuilder dropdown) gets:

```ts
ai_summarize: "AI: summarize",
ai_classify_lead: "AI: classify lead",
ai_draft_email: "AI: draft email",
ai_extract: "AI: extract fields",
ai_translate: "AI: translate",
```

---

## Section C — UI + admin observability

### C.1 RecipeBuilder.tsx — 5 new `ActionConfigEditor` cases

Each case renders the inputs specified in B.2. Source code shown in the implementation plan; nothing surprising — same shadcn `Input`/`Select`/`Label` primitives as the other action editors.

### C.2 AI Usage Settings tab

New tab in `Settings → AI Usage` (admin-only). Two panels side-by-side on wide viewports, stacked on mobile.

**Left — This month at a glance:**

```
This month
  Runs used:        347 / 1000
  ▓▓▓▓▓▓▓▓░░░░░░░░░░  35%
  Spend:            $4.21
  Avg cost / run:   $0.012

  Monthly cap:   [ 1000 ]  [ Update cap ]
  Resets on:     1 Jun 2026
```

Reads `ai_block_usage_caps` row + aggregates current-month `ai_block_runs`:

```sql
select count(*) as runs, sum(cost_usd_cents) as cents
from public.ai_block_runs
where organization_id = ?
  and created_at >= date_trunc('month', now());
```

Admin can edit the cap inline (calls `set_ai_block_cap` RPC). Real-time subscribed to `ai_block_runs` INSERTs so the bar updates as recipes fire.

**Right — Recent AI runs (last 50):**

```
17 May 14:22  ai_summarize     ✅  $0.003  →  click for prompt + response
17 May 14:21  ai_classify_lead ✅  $0.001
17 May 12:08  ai_draft_email   ✅  $0.018
17 May 11:55  ai_extract       ❌  Could not parse AI response as JSON
…
```

Each row click opens a drawer with the error_message (for failures) and the linked recipe name (click → jump to that recipe's run history in Automations tab).

### C.3 Files added/modified

**Created:**
- `supabase/migrations/066_ai_blocks.sql`
- `supabase/functions/crm-run-automations/actions/ai.ts` (all 5 handlers + `callClaude` + `logFailure`)
- `src/services/supabase/aiBlocks.ts` (types + `listRuns`, `getUsage`, `setUsageCap`)
- `src/hooks/useAiUsage.ts` (current usage + cap + realtime subscription)
- `src/components/settings/AiUsageSettingsTab.tsx`

**Modified:**
- `supabase/functions/crm-run-automations/actions/index.ts` — extend `ACTION_REGISTRY`
- `supabase/functions/crm-run-automations/shared/substitute.ts` — extend to resolve `{{ai.*}}`
- `supabase/functions/crm-run-automations/index.ts` — stash `meta.ai_output*` fields into `ctx.aiOutputs` between actions in a recipe run
- `src/services/supabase/automations.ts` — extend `ACTION_TYPES` + `ACTION_LABEL`
- `src/components/settings/RecipeBuilder.tsx` — 5 new `ActionConfigEditor` cases + the `{{ai.output_*}}` hint shown after `ai_draft_email`
- `src/pages/Settings.tsx` — add `AiUsageSettingsTab` after Automations tab
- `supabase/functions/crm-rotate-turnstile-salt/index.ts` — add prune of `ai_block_runs` older than 90 days

### C.4 Failure surface

AI-block failures appear in two places:

1. **Recipe's run history** (`automation_runs.action_results`) — same surface as any other action. Shows `failure` / `skipped` with the AI error message.
2. **AI Usage tab's right pane** — every AI call regardless of recipe, useful for debugging prompt issues independent of which recipe fired them.

Quota-exceeded behavior:
- In `automation_runs`: `status: 'skipped'`, message `ai_quota_exceeded`.
- In `ai_block_runs`: **not logged** (we never called Claude — no tokens spent).
- In AI Usage tab: banner appears once the cap is hit: *"AI quota for this month exhausted. Recipes using AI actions will skip those steps until 1 Jun or until you raise the cap above."*

---

## Security

- `ANTHROPIC_API_KEY` lives only in Supabase Edge Function secrets. Never sent to the browser. The worker reads it via `Deno.env.get`.
- `set_ai_block_cap` RPC gated on `is_org_admin(org_id)`. Non-admins get `42501 Not authorized`.
- `ai_block_runs` has SELECT-only RLS for org members. No write policy — only the service-role worker writes via `insert`.
- AI actions never see other orgs' data: every read is scoped by `event.payload.client_id` whose `organization_id` matches `ctx.orgId`. There is no cross-org data leakage path because the worker resolves the org from the event row before invoking the handler.
- Prompts include only fields needed for the task — no entire database dump. We DO NOT pass user PII like email/phone unless the prompt explicitly needs it (`ai_draft_email` does; `ai_summarize` does NOT — it just gets note bodies, not contact data).
- Anthropic's Limited Use commitments: Anthropic does NOT train models on API customer data per their data usage policy. No additional consent banner needed.

## Testing strategy

**Unit (vitest):**
- `substitute.test.ts` — extend to cover `{{ai.output}}`, `{{ai.output_subject}}`, `{{ai.foo}}` (unknown key passthrough).
- New `tests/unit/aiBlocks.test.ts` — pure-function tests:
  - Cost calculation (Sonnet prices applied correctly)
  - `ai_classify_lead` response parser (validates `hot|warm|cold`, rejects other words)
  - `ai_draft_email` response parser (split into subject/body on first `\n\n`)
  - `ai_extract` response parser (handles valid JSON, returns failure on invalid)

**Integration (manual until DB test harness):**
- Set `ANTHROPIC_API_KEY` locally, run `supabase functions serve crm-run-automations`.
- Create a recipe `When client_created Then ai_summarize`. Insert a client + a note. Wait 60s. Check `client_notes` for the new AI-authored row.
- Repeat for each of the 5 handlers.
- Cap test: SQL `update ai_block_usage_caps set monthly_run_cap = 1 where organization_id = ?`. Fire a recipe twice. Confirm the second run reports `skipped: ai_quota_exceeded`.

## Rollout

1. Set the `ANTHROPIC_API_KEY` secret on Supabase.
2. Apply migration 066.
3. Redeploy `crm-run-automations` Edge Function.
4. New `Settings → AI Usage` tab visible to admins.
5. Beta: create one AI recipe per admin's own org, watch for a week. Check the cost-per-run distribution lines up with the estimate ($0.001–$0.02).
6. Once verified, lift the default cap from 1000 if needed (each org can be bumped individually).

## Open questions

1. **Cache TTL:** Anthropic's ephemeral cache is 5 minutes by default. For low-frequency recipes (one client_created per day) the cache won't help. Cost impact is modest; revisit if AI volume justifies a long-cache strategy.
2. **Failure log for quota-exceeded:** spec says we skip logging into `ai_block_runs`. Alternative: log a row with `status='skipped'` so the AI Usage tab shows total *attempts* vs *executed*. Choice: don't log skipped runs (keeps the right-pane signal:noise high).
3. **Anthropic outages:** if the API is down for a recipe firing, the action returns `failure` with the SDK error and the recipe overall result becomes `failure`. No automatic retry in v1; the next event (e.g. next deal stage change) gets a fresh attempt.

## V2 / future work

- **Batch 2c (Sequences):** the email-drafting action chain `ai_draft_email` → `send_email` is built on top of this batch but only completes once Gmail OAuth is verified and `sendEmail.ts` is rewritten to do direct Gmail API calls (same pattern as the recent `slackPost.ts` fix).
- **Batch 2d (AI Sales Agent):** consumes this same infrastructure but adds: autonomous trigger (recipes that fire on a schedule and call AI to *decide* what to do next), human-approval queue UI, Apollo enrichment integration.
- Prompt editing UI per recipe.
- Per-AI-block model override (Haiku for cost-sensitive recipes).
- Streaming responses (not useful for this use case until we have a chat-style surface).
- Cost-per-org dashboard for admins to see which recipes are spending the most.
- Anthropic batch API for bulk operations (cheaper, async).
