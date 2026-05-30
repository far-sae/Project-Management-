# CRM AI Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five LLM-powered action handlers (`ai_summarize`, `ai_classify_lead`, `ai_draft_email`, `ai_extract`, `ai_translate`) to the recipe automation engine. All calls go to Claude Sonnet 4.6 via the official `@anthropic-ai/sdk` with prompt caching enabled; per-org monthly soft cap (default 1000 runs); per-call cost logging; admin Settings page for usage observability.

**Architecture:** One new migration adds `ai_block_runs` + `ai_block_usage_caps` tables plus an atomic `check_and_increment_ai_cap(org)` RPC. One new worker file (`actions/ai.ts`) holds all five handlers and a shared `callClaude` helper. Five new entries in the existing `ACTION_REGISTRY`. The worker stashes `meta.ai_output*` keys between actions in a recipe run so downstream actions can use `{{ai.output_subject}}`-style placeholders. UI: extend `RecipeBuilder` with 5 new `ActionConfigEditor` cases and add a new `AI Usage` tab to Settings.

**Tech Stack:** Supabase Edge Functions (Deno) + Postgres, React + Vite + TS, `@anthropic-ai/sdk@0.30.0` (esm.sh Deno-compatible), shadcn/ui, vitest. Builds on the Batch 2a automation engine (recipes, events queue, action registry).

**Coordination:** Branch `feature/crm-ai-blocks` off main. Single new secret to set: `ANTHROPIC_API_KEY`. Migration number 066. No conflicts with the other agent's integrations lane.

---

## File structure

**Created:**
- `supabase/migrations/066_ai_blocks.sql`
- `supabase/functions/crm-run-automations/actions/ai.ts` — all 5 handlers + `callClaude` + `logFailure`
- `src/services/supabase/aiBlocks.ts` — types + `listRuns`, `getUsage`, `setUsageCap`
- `src/hooks/useAiUsage.ts` — current month usage + cap, realtime subscribed
- `src/components/settings/AiUsageSettingsTab.tsx` — two-panel admin UI
- `tests/unit/aiBlocks.test.ts` — pure-function tests (cost calc, parsers)

**Modified:**
- `supabase/functions/crm-run-automations/actions/index.ts` — register 5 new handlers
- `supabase/functions/crm-run-automations/shared/types.ts` — extend `ActionType` union + `ActionContext` with `aiOutputs`
- `supabase/functions/crm-run-automations/shared/substitute.ts` — resolve `{{ai.*}}` placeholders
- `supabase/functions/crm-run-automations/index.ts` — stash `meta.ai_output*` into `ctx.aiOutputs` between actions
- `src/services/supabase/automations.ts` — extend `ACTION_TYPES` + `ACTION_LABEL` constants
- `src/components/settings/RecipeBuilder.tsx` — 5 new `ActionConfigEditor` cases + hint after `ai_draft_email`
- `src/pages/Settings.tsx` — add AI Usage tab after Automations
- `supabase/functions/crm-rotate-turnstile-salt/index.ts` — prune `ai_block_runs` >90d

---

## Task 1: Migration 066 — tables, RPCs, RLS

**Files:**
- Create: `supabase/migrations/066_ai_blocks.sql`

- [ ] **Step 1: Branch off main**

```bash
cd c:/Users/faraz/task/Project-Management-
git checkout main && git pull origin main
git checkout -b feature/crm-ai-blocks
```

- [ ] **Step 2: Write the migration**

```sql
-- 066_ai_blocks.sql
-- AI block actions for the automation engine: per-run telemetry +
-- per-org monthly soft cap.

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

-- Atomic cap check + increment. Resets the counter on month rollover.
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

-- Admin-only RPC for the AI Usage tab.
create or replace function public.set_ai_block_cap(p_org uuid, p_cap int)
returns void
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_cap < 0 or p_cap > 1000000 then
    raise exception 'Cap must be 0-1,000,000' using errcode = '22023';
  end if;
  insert into public.ai_block_usage_caps (organization_id, monthly_run_cap)
  values (p_org, p_cap)
  on conflict (organization_id) do update set monthly_run_cap = p_cap;
end;
$$;

grant execute on function public.set_ai_block_cap(uuid, int) to authenticated;

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

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/066_ai_blocks.sql
git commit -m "feat(crm): ai_block_runs + ai_block_usage_caps + cap RPC"
```

(Do not run `supabase db push` yet — that's a separate manual step the user runs after deploying.)

---

## Task 2: Extend ActionType + ActionContext + ACTION_TYPES constants

**Files:**
- Modify: `supabase/functions/crm-run-automations/shared/types.ts`
- Modify: `src/services/supabase/automations.ts`

- [ ] **Step 1: Read current types**

```bash
cat supabase/functions/crm-run-automations/shared/types.ts
```

Note the existing `ActionType` union and `ActionContext` interface.

- [ ] **Step 2: Extend `ActionType` in the worker types**

In `supabase/functions/crm-run-automations/shared/types.ts`, find the `ActionType` union and add five entries:

```ts
export type ActionType =
  | "create_task" | "tag" | "set_field" | "change_owner"
  | "add_note" | "move_deal_stage" | "webhook" | "slack_post" | "send_email"
  | "ai_summarize" | "ai_classify_lead" | "ai_draft_email"
  | "ai_extract" | "ai_translate";
```

And extend `ActionContext` so the worker can pass accumulated AI outputs between actions in a recipe run:

```ts
export interface ActionContext {
  admin: any;
  orgId: string;
  event: AutomationEvent;
  recipeId: string;
  recipeName: string;
  runStartedAt: Date;
  // Outputs from preceding ai_* actions in this recipe run, e.g.
  // { ai_output: "...", ai_output_subject: "...", ai_output_body: "..." }
  // Available to substitute() as {{ai.output}}, {{ai.output_subject}}, etc.
  aiOutputs?: Record<string, string>;
}
```

- [ ] **Step 3: Extend the service-layer constants**

In `src/services/supabase/automations.ts`, find `ACTION_TYPES` and append:

```ts
export const ACTION_TYPES = [
  "create_task", "tag", "set_field", "change_owner",
  "add_note", "move_deal_stage", "webhook", "slack_post", "send_email",
  "ai_summarize", "ai_classify_lead", "ai_draft_email",
  "ai_extract", "ai_translate",
] as const;
```

If the file has an `ACTION_LABEL` record used by `RecipeBuilder`, extend it. Otherwise add it next to `ACTION_TYPES`:

```ts
export const ACTION_LABEL: Record<ActionType, string> = {
  create_task: "Create task",
  tag: "Tag client",
  set_field: "Set field",
  change_owner: "Change owner",
  add_note: "Add note",
  move_deal_stage: "Move deal to stage",
  webhook: "Call webhook",
  slack_post: "Post to Slack",
  send_email: "Send email",
  ai_summarize: "AI: summarize",
  ai_classify_lead: "AI: classify lead",
  ai_draft_email: "AI: draft email",
  ai_extract: "AI: extract fields",
  ai_translate: "AI: translate",
};
```

(If the existing `RecipeBuilder` has its own local `ACTION_LABEL`, mirror the same shape there in Task 7.)

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors. Anything else means a stale reference — fix before committing.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-run-automations/shared/types.ts \
        src/services/supabase/automations.ts
git commit -m "feat(crm): extend ActionType + ACTION_LABEL with ai_* entries"
```

---

## Task 3: Extend substitute() to resolve `{{ai.*}}`

**Files:**
- Modify: `supabase/functions/crm-run-automations/shared/substitute.ts`
- Modify: `tests/unit/substitute.test.ts`

- [ ] **Step 1: Read the current substitute() and existing tests**

```bash
cat supabase/functions/crm-run-automations/shared/substitute.ts
cat tests/unit/substitute.test.ts
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/unit/substitute.test.ts`:

```ts
describe("substitute — ai.* keys", () => {
  it("resolves {{ai.output}} from aiOutputs", () => {
    expect(
      substitute("Drafted: {{ai.output}}", { aiOutputs: { ai_output: "Hello world" } } as any),
    ).toBe("Drafted: Hello world");
  });

  it("resolves {{ai.output_subject}} and {{ai.output_body}}", () => {
    const ctx = { aiOutputs: { ai_output_subject: "Re: Quote", ai_output_body: "Hi!" } } as any;
    expect(substitute("S:{{ai.output_subject}} B:{{ai.output_body}}", ctx))
      .toBe("S:Re: Quote B:Hi!");
  });

  it("passes through {{ai.foo}} when key is missing", () => {
    expect(substitute("{{ai.foo}}", { aiOutputs: {} } as any)).toBe("{{ai.foo}}");
  });

  it("does not require aiOutputs to be present", () => {
    expect(substitute("{{ai.output}}", {} as any)).toBe("{{ai.output}}");
  });
});
```

Run: `npm test -- substitute.test.ts`
Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement `ai.*` resolution**

Modify the `resolve` function inside `supabase/functions/crm-run-automations/shared/substitute.ts` to special-case `ai.*` paths reading from `ctx.aiOutputs`:

```ts
const resolve = (path: string, ctx: SubstituteContext): unknown => {
  // ai.* shortcut: reads from ctx.aiOutputs, where action handlers stash
  // meta.ai_output* keys so subsequent actions in the recipe can chain.
  if (path.startsWith("ai.")) {
    const key = "ai_" + path.slice(3); // "ai.output" -> "ai_output"
    const outputs = (ctx as { aiOutputs?: Record<string, string> }).aiOutputs;
    return outputs?.[key];
  }
  const parts = path.split(".");
  let v: any = ctx;
  for (const p of parts) {
    if (v === null || v === undefined) return undefined;
    v = v[p];
  }
  return v;
};
```

Also extend the exported `SubstituteContext` interface to acknowledge the new key (purely for type readers):

```ts
export interface SubstituteContext {
  deal?: { title?: string; value?: number; currency?: string; stage?: string; url?: string };
  client?: { name?: string; email?: string; industry?: string; url?: string };
  actor?: string;
  recipe?: { name?: string };
  aiOutputs?: Record<string, string>;
  [k: string]: unknown;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- substitute.test.ts
```

Expected: all tests pass (existing 4 + new 4 = 8).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-run-automations/shared/substitute.ts \
        tests/unit/substitute.test.ts
git commit -m "feat(crm): substitute() resolves {{ai.*}} from ctx.aiOutputs"
```

---

## Task 4: Worker stashes ai_output* between actions

**Files:**
- Modify: `supabase/functions/crm-run-automations/index.ts`

- [ ] **Step 1: Locate the per-recipe action loop**

```bash
grep -n "for (const actionSpec of recipe.actions" supabase/functions/crm-run-automations/index.ts
```

You should see `runRecipe(...)` from Batch 2a. The loop iterates `recipe.actions`, invokes each handler, collects results.

- [ ] **Step 2: Initialize `ctx.aiOutputs` per recipe run and merge `meta.ai_output*` after each action**

Inside `runRecipe`, before the for-loop, initialize the accumulator:

```ts
const aiOutputs: Record<string, string> = {};
```

In the per-action handler call, pass `aiOutputs` into the ActionContext you build:

```ts
const r = await handler(
  {
    admin,
    orgId: event.organization_id,
    event,
    recipeId: recipe.recipe_id,
    recipeName: recipe.name,
    runStartedAt: started,
    aiOutputs,
  },
  actionSpec.config ?? {},
);
```

After the handler returns, copy any `meta` keys starting with `ai_output` into `aiOutputs`:

```ts
if (r.meta && typeof r.meta === "object") {
  for (const [k, v] of Object.entries(r.meta)) {
    if (k.startsWith("ai_output") && typeof v === "string") {
      aiOutputs[k] = v;
    }
  }
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero new errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-run-automations/index.ts
git commit -m "feat(crm): worker stashes meta.ai_output* between actions for {{ai.*}} chaining"
```

---

## Task 5: Pure-function tests for AI helpers (cost + parsers)

**Files:**
- Create: `tests/unit/aiBlocks.test.ts`

This task writes the failing tests BEFORE the implementation in Task 6, so TDD red→green is real.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/aiBlocks.test.ts
import { describe, it, expect } from "vitest";
import {
  computeCostCents,
  parseClassifyResponse,
  parseDraftEmailResponse,
  parseExtractResponse,
} from "../../supabase/functions/crm-run-automations/actions/ai.ts";

describe("AI block — pure helpers", () => {
  describe("computeCostCents", () => {
    it("applies Sonnet 4.6 pricing (input 0.0003¢/tok, output 0.0015¢/tok)", () => {
      expect(computeCostCents(1000, 500)).toBeCloseTo(0.3 + 0.75, 4); // 1.05¢
    });
    it("handles zero tokens", () => {
      expect(computeCostCents(0, 0)).toBe(0);
    });
  });

  describe("parseClassifyResponse", () => {
    it("accepts hot/warm/cold case-insensitive with surrounding whitespace", () => {
      expect(parseClassifyResponse("Hot")).toBe("hot");
      expect(parseClassifyResponse("  warm  ")).toBe("warm");
      expect(parseClassifyResponse("COLD")).toBe("cold");
    });
    it("takes the first word when model adds prose", () => {
      expect(parseClassifyResponse("Hot — strong engagement signals")).toBe("hot");
    });
    it("returns null when no valid band found", () => {
      expect(parseClassifyResponse("I am unable to classify")).toBe(null);
      expect(parseClassifyResponse("")).toBe(null);
    });
  });

  describe("parseDraftEmailResponse", () => {
    it("splits on first blank line into subject + body", () => {
      const out = parseDraftEmailResponse("Re: Your quote\n\nHi Faraz,\n\nThanks!");
      expect(out.subject).toBe("Re: Your quote");
      expect(out.body).toBe("Hi Faraz,\n\nThanks!");
    });
    it("strips a leading 'Subject:' prefix if the model adds one", () => {
      const out = parseDraftEmailResponse("Subject: Hi there\n\nBody here");
      expect(out.subject).toBe("Hi there");
      expect(out.body).toBe("Body here");
    });
    it("falls back to empty subject and full text as body when no blank line", () => {
      const out = parseDraftEmailResponse("Just a body, no subject line.");
      expect(out.subject).toBe("");
      expect(out.body).toBe("Just a body, no subject line.");
    });
  });

  describe("parseExtractResponse", () => {
    it("parses a clean JSON object", () => {
      expect(parseExtractResponse('{"company_size":"50-100","intent":"buy"}'))
        .toEqual({ company_size: "50-100", intent: "buy" });
    });
    it("strips ```json fences if model adds them", () => {
      expect(parseExtractResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });
    it("returns null when JSON is malformed", () => {
      expect(parseExtractResponse("not json at all")).toBe(null);
      expect(parseExtractResponse('{"unterminated":')).toBe(null);
    });
  });
});
```

- [ ] **Step 2: Verify red**

```bash
npm test -- aiBlocks.test.ts
```

Expected: FAIL with `Failed to resolve import "../../supabase/functions/crm-run-automations/actions/ai.ts"` (file doesn't exist yet — that's Task 6).

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/unit/aiBlocks.test.ts
git commit -m "test(crm): failing tests for AI block helpers (cost + parsers)"
```

---

## Task 6: AI handlers + callClaude — the worker file

**Files:**
- Create: `supabase/functions/crm-run-automations/actions/ai.ts`

This task ships **all five handlers + shared helpers** in one file. Long, but it stays a single file per the spec's file structure.

- [ ] **Step 1: Write the file**

```ts
// supabase/functions/crm-run-automations/actions/ai.ts
//
// AI block actions for the automation engine. All five handlers + shared
// callClaude helper + pure parser helpers (the parsers are exported for unit
// tests; the helpers stay in the same file to keep the prompt-and-shape
// definition next to the function that uses it).

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.30.0";
import { ActionContext, ActionHandler, ActionResult } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";

const client = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

// Sonnet 4.6 pricing (May 2026): input $3/Mtok, output $15/Mtok.
//   $3  / 1_000_000 tokens = $0.000003 / token = 0.0003 cents / token
//   $15 / 1_000_000 tokens = $0.000015 / token = 0.0015 cents / token
export function computeCostCents(inputTokens: number, outputTokens: number): number {
  return inputTokens * 0.0003 + outputTokens * 0.0015;
}

// Validate + normalise the classify_lead response to one of hot|warm|cold.
// Returns null if the model produced an unparseable response.
export function parseClassifyResponse(raw: string): "hot" | "warm" | "cold" | null {
  if (!raw) return null;
  const firstWord = raw.trim().toLowerCase().split(/[\s.,—-]+/, 1)[0];
  if (firstWord === "hot" || firstWord === "warm" || firstWord === "cold") {
    return firstWord;
  }
  return null;
}

// Split the draft_email response into subject + body. Tolerates an optional
// leading "Subject:" prefix. Falls back to ("", fullText) if no blank line.
export function parseDraftEmailResponse(raw: string): { subject: string; body: string } {
  const text = raw.replace(/^\s*Subject:\s*/i, "");
  const idx = text.indexOf("\n\n");
  if (idx === -1) {
    return { subject: "", body: text.trim() };
  }
  return {
    subject: text.slice(0, idx).trim(),
    body: text.slice(idx + 2).trim(),
  };
}

// Parse the extract response as JSON. Strips ```json fences if model added
// them. Returns null on parse failure so the caller can mark the run as failed.
export function parseExtractResponse(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim();
  // Strip markdown fences like ```json ... ```
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

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

  // Atomic cap check + increment. Throws ai_quota_exceeded if over the cap.
  const { data: allowed } = await ctx.admin.rpc("check_and_increment_ai_cap", { p_org: ctx.orgId });
  if (allowed === false) throw new Error("ai_quota_exceeded");

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
    ((res.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0) +
    ((res.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0);
  const outputTokens = res.usage.output_tokens ?? 0;
  const costCents = computeCostCents(inputTokens, outputTokens);
  const durationMs = Date.now() - t0;

  // Best-effort logging; never let logging failure kill the action.
  await ctx.admin.from("ai_block_runs").insert({
    organization_id: ctx.orgId,
    recipe_id: ctx.recipeId,
    action_type: opts.actionType,
    model: MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd_cents: costCents.toFixed(4),
    status: "success",
    duration_ms: durationMs,
  }).then(() => undefined, () => undefined);

  return { text, inputTokens, outputTokens, costCents, durationMs };
}

async function logFailure(ctx: ActionContext, actionType: string, message: string): Promise<void> {
  await ctx.admin.from("ai_block_runs").insert({
    organization_id: ctx.orgId,
    recipe_id: ctx.recipeId,
    action_type: actionType,
    model: MODEL,
    status: "failure",
    error_message: message,
  }).then(() => undefined, () => undefined);
}

// Convert ai_quota_exceeded errors into ActionResult.skipped; everything else
// becomes ActionResult.failure. Centralised so each handler stays small.
function intoActionResult(err: unknown): ActionResult {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "ai_quota_exceeded") {
    return { status: "skipped", message: "ai_quota_exceeded" };
  }
  return { status: "failure", message: msg };
}

// ──────────────────────────────────────────────────────────────────────────
// ai_summarize
// ──────────────────────────────────────────────────────────────────────────

export const aiSummarize: ActionHandler = async (ctx, config) => {
  const actionType = "ai_summarize";
  try {
    const source = (config.source as string) ?? "client_notes";
    const limit = Number(config.limit ?? 5);
    const clientId = (ctx.event.payload as { client_id?: string }).client_id;

    let input = "";
    if (source === "client_notes") {
      if (!clientId) return { status: "skipped", message: "No client_id in event payload" };
      const { data: notes } = await ctx.admin
        .from("client_notes")
        .select("body, occurred_at, kind")
        .eq("client_id", clientId)
        .order("occurred_at", { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 20));
      input = (notes ?? [])
        .map((n: { occurred_at: string; kind: string; body: string }) =>
          `[${n.occurred_at}] (${n.kind}) ${n.body ?? ""}`)
        .join("\n\n");
      if (!input.trim()) {
        return { status: "skipped", message: "No notes to summarise" };
      }
    } else if (source === "free_text") {
      input = substitute(String(config.text ?? ""), ctx as any);
    } else {
      return { status: "failure", message: `Unknown source: ${source}` };
    }

    const result = await callClaude(ctx, {
      actionType,
      system:
        "You summarise CRM customer activity into a 2-sentence brief for a busy sales rep. " +
        "Be concrete: mention specific things mentioned, deals, blockers. " +
        "Two sentences max. No bullet points, no headings.",
      user: input,
      maxTokens: 256,
    });

    // Write the summary as a note on the client (if we have one).
    let noteId: string | null = null;
    if (clientId) {
      const { data: noteRow } = await ctx.admin
        .from("client_notes")
        .insert({
          organization_id: ctx.orgId,
          client_id: clientId,
          kind: "note",
          subject: `AI summary (${ctx.recipeName})`,
          body: result.text,
          occurred_at: new Date().toISOString(),
          author_name: `Automation: ${ctx.recipeName}`,
        })
        .select("note_id")
        .single();
      noteId = (noteRow as { note_id?: string } | null)?.note_id ?? null;
    }

    return {
      status: "success",
      meta: {
        ai_output: result.text,
        note_id: noteId,
        cost_cents: result.costCents,
      },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};

// ──────────────────────────────────────────────────────────────────────────
// ai_classify_lead
// ──────────────────────────────────────────────────────────────────────────

export const aiClassifyLead: ActionHandler = async (ctx, _config) => {
  const actionType = "ai_classify_lead";
  try {
    const clientId = (ctx.event.payload as { client_id?: string }).client_id;
    if (!clientId) return { status: "skipped", message: "No client_id in event payload" };

    const { data: clientRow } = await ctx.admin
      .from("clients")
      .select("name, industry, employee_count, annual_revenue, country, score, score_band")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!clientRow) return { status: "failure", message: "Client not found" };

    const { data: notes } = await ctx.admin
      .from("client_notes")
      .select("body, occurred_at")
      .eq("client_id", clientId)
      .order("occurred_at", { ascending: false })
      .limit(5);

    const { count: openDealCount } = await ctx.admin
      .from("deals")
      .select("deal_id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .not("stage_id", "is", null);

    const input = [
      `Client: ${JSON.stringify(clientRow)}`,
      `Open deals (count): ${openDealCount ?? 0}`,
      "Recent notes (newest first):",
      ...(notes ?? []).map((n: { occurred_at: string; body: string }) =>
        `  [${n.occurred_at}] ${n.body ?? ""}`),
    ].join("\n");

    const result = await callClaude(ctx, {
      actionType,
      system:
        "You classify a CRM lead as `hot`, `warm`, or `cold` based on the data. " +
        "Respond with EXACTLY one word: hot, warm, or cold. " +
        "Consider engagement recency, deal size, and stage progression. " +
        "No explanation, no punctuation, just the word.",
      user: input,
      maxTokens: 8,
    });

    const band = parseClassifyResponse(result.text);
    if (!band) {
      await logFailure(ctx, actionType, `Could not parse classify response: ${result.text}`);
      return { status: "failure", message: `Invalid classify response: "${result.text}"` };
    }

    await ctx.admin.from("clients").update({ score_band: band }).eq("client_id", clientId);

    return {
      status: "success",
      meta: { ai_output: band, cost_cents: result.costCents },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};

// ──────────────────────────────────────────────────────────────────────────
// ai_draft_email
// ──────────────────────────────────────────────────────────────────────────

export const aiDraftEmail: ActionHandler = async (ctx, config) => {
  const actionType = "ai_draft_email";
  try {
    const goal = (config.goal as string)?.trim();
    if (!goal) return { status: "failure", message: "goal config required" };
    const tone = (config.tone as string) ?? "formal";
    const length = (config.length as string) ?? "short";

    const clientId = (ctx.event.payload as { client_id?: string }).client_id;
    let clientCtx = "";
    if (clientId) {
      const { data: c } = await ctx.admin
        .from("clients")
        .select("name, email, industry, country")
        .eq("client_id", clientId)
        .maybeSingle();
      if (c) clientCtx = `Client: ${JSON.stringify(c)}`;
    }

    const dealId = (ctx.event.payload as { deal_id?: string }).deal_id;
    let dealCtx = "";
    if (dealId) {
      const { data: d } = await ctx.admin
        .from("deals")
        .select("title, value, currency, stage")
        .eq("deal_id", dealId)
        .maybeSingle();
      if (d) dealCtx = `Deal: ${JSON.stringify(d)}`;
    }

    const lengthHint = length === "medium"
      ? "Length: medium — 5 sentences max."
      : "Length: short — 3 sentences max.";

    const input = [
      `Goal: ${goal}`,
      clientCtx, dealCtx,
    ].filter(Boolean).join("\n");

    const result = await callClaude(ctx, {
      actionType,
      system:
        "You draft outbound sales emails. " +
        "Output format: subject line on first line, blank line, then body. " +
        `Tone: ${tone}. ${lengthHint} ` +
        "Do not include greeting or signature — the system adds those. " +
        "No markdown, plain text only.",
      user: input,
      maxTokens: 512,
    });

    const { subject, body } = parseDraftEmailResponse(result.text);

    return {
      status: "success",
      meta: {
        ai_output: result.text,
        ai_output_subject: subject,
        ai_output_body: body,
        cost_cents: result.costCents,
      },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};

// ──────────────────────────────────────────────────────────────────────────
// ai_extract
// ──────────────────────────────────────────────────────────────────────────

export const aiExtract: ActionHandler = async (ctx, config) => {
  const actionType = "ai_extract";
  try {
    const sourceText = substitute(String(config.source_text ?? ""), ctx as any);
    const fields = Array.isArray(config.fields) ? (config.fields as string[]) : [];
    if (!sourceText.trim()) return { status: "skipped", message: "Empty source_text" };
    if (fields.length === 0) return { status: "failure", message: "fields config required" };

    const result = await callClaude(ctx, {
      actionType,
      system:
        "Extract these fields from the text. " +
        "Respond as a JSON object only — no prose, no markdown, no code fences. " +
        `Fields: ${fields.join(", ")}. ` +
        "Use null for any field not present in the text.",
      user: sourceText,
      maxTokens: 512,
    });

    const extracted = parseExtractResponse(result.text);
    if (!extracted) {
      await logFailure(ctx, actionType, `Could not parse extract response as JSON: ${result.text.slice(0, 200)}`);
      return { status: "failure", message: "Could not parse AI response as JSON" };
    }

    const clientId = (ctx.event.payload as { client_id?: string }).client_id;
    if (clientId) {
      // Postgres JSONB concat: existing keys overwritten, new keys appended.
      const { data: existing } = await ctx.admin
        .from("clients")
        .select("custom_fields")
        .eq("client_id", clientId)
        .maybeSingle();
      const merged = { ...(existing?.custom_fields ?? {}), ...extracted };
      await ctx.admin.from("clients").update({ custom_fields: merged }).eq("client_id", clientId);
    }

    return {
      status: "success",
      meta: {
        ai_output: JSON.stringify(extracted),
        fields_extracted: Object.keys(extracted),
        cost_cents: result.costCents,
      },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};

// ──────────────────────────────────────────────────────────────────────────
// ai_translate
// ──────────────────────────────────────────────────────────────────────────

export const aiTranslate: ActionHandler = async (ctx, config) => {
  const actionType = "ai_translate";
  try {
    const sourceText = substitute(String(config.source_text ?? ""), ctx as any);
    const target = (config.target_language as string)?.trim();
    if (!sourceText.trim()) return { status: "skipped", message: "Empty source_text" };
    if (!target) return { status: "failure", message: "target_language config required" };

    const result = await callClaude(ctx, {
      actionType,
      system:
        `Translate the following text to ${target}. ` +
        "Preserve formatting and line breaks. " +
        "Output only the translation, no explanation, no markdown.",
      user: sourceText,
      maxTokens: 1024,
    });

    return {
      status: "success",
      meta: { ai_output: result.text, cost_cents: result.costCents },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};
```

- [ ] **Step 2: Run the pure-function tests from Task 5**

```bash
npm test -- aiBlocks.test.ts
```

Expected: all 11 tests pass (cost: 2, classify: 3, draft: 3, extract: 3).

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-run-automations/actions/ai.ts
git commit -m "feat(crm): 5 AI block handlers + callClaude + pure parsers"
```

---

## Task 7: Register the 5 handlers + add RecipeBuilder UI cases

**Files:**
- Modify: `supabase/functions/crm-run-automations/actions/index.ts`
- Modify: `src/components/settings/RecipeBuilder.tsx`

- [ ] **Step 1: Register the handlers**

In `supabase/functions/crm-run-automations/actions/index.ts`, add imports + registry entries:

```ts
import { aiSummarize, aiClassifyLead, aiDraftEmail, aiExtract, aiTranslate } from "./ai.ts";

export const ACTION_REGISTRY: Record<ActionType, ActionHandler> = {
  // … existing 9 entries …
  ai_summarize: aiSummarize,
  ai_classify_lead: aiClassifyLead,
  ai_draft_email: aiDraftEmail,
  ai_extract: aiExtract,
  ai_translate: aiTranslate,
};
```

- [ ] **Step 2: Add ActionConfigEditor cases to RecipeBuilder**

In `src/components/settings/RecipeBuilder.tsx`, find the `ActionConfigEditor` subcomponent's `switch (action.type)` and add five cases. Insert before the `default:` clause:

```tsx
case "ai_summarize":
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div>
        <Label>Source</Label>
        <Select
          value={(cfg.source as string) ?? "client_notes"}
          onValueChange={(v) => set({ source: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="client_notes">Last N client notes</SelectItem>
            <SelectItem value="free_text">Custom text (with placeholders)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Last N notes</Label>
        <Input
          type="number"
          value={Number(cfg.limit ?? 5)}
          onChange={(e) => set({ limit: Number(e.target.value) })}
        />
      </div>
      {cfg.source === "free_text" && (
        <div className="col-span-2">
          <Label>Text</Label>
          <Input
            value={(cfg.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="Free text or {{placeholders}}"
          />
        </div>
      )}
    </div>
  );

case "ai_classify_lead":
  return (
    <p className="text-xs text-muted-foreground">
      Classifies the event's client as hot/warm/cold and writes to{" "}
      <code>clients.score_band</code>. No config needed.
    </p>
  );

case "ai_draft_email":
  return (
    <div className="grid grid-cols-1 gap-2">
      <div>
        <Label>Goal of the email</Label>
        <Input
          value={(cfg.goal as string) ?? ""}
          onChange={(e) => set({ goal: e.target.value })}
          placeholder="e.g. follow up after 7 days of no reply"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Tone</Label>
          <Select value={(cfg.tone as string) ?? "formal"} onValueChange={(v) => set({ tone: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="formal">Formal</SelectItem>
              <SelectItem value="casual">Casual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Length</Label>
          <Select value={(cfg.length as string) ?? "short"} onValueChange={(v) => set({ length: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Reference {`{{ai.output_subject}}`} and {`{{ai.output_body}}`} in a
        following send_email action to actually send the draft.
      </p>
    </div>
  );

case "ai_extract":
  return (
    <div className="grid grid-cols-1 gap-2">
      <div>
        <Label>Source text</Label>
        <Input
          value={(cfg.source_text as string) ?? ""}
          onChange={(e) => set({ source_text: e.target.value })}
          placeholder="{{form_submission.notes}}"
        />
      </div>
      <div>
        <Label>Fields to extract (comma-separated)</Label>
        <Input
          value={Array.isArray(cfg.fields) ? (cfg.fields as string[]).join(",") : ""}
          onChange={(e) => set({
            fields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
          })}
          placeholder="company_size, intent, budget_band"
        />
      </div>
    </div>
  );

case "ai_translate":
  return (
    <div className="grid grid-cols-1 gap-2">
      <Input
        value={(cfg.source_text as string) ?? ""}
        onChange={(e) => set({ source_text: e.target.value })}
        placeholder="Text to translate (or {{placeholders}})"
      />
      <Input
        value={(cfg.target_language as string) ?? "English"}
        onChange={(e) => set({ target_language: e.target.value })}
        placeholder="Target language (e.g. English, French)"
      />
    </div>
  );
```

If `RecipeBuilder` has its own local `ACTION_LABEL` mapping, also extend it with the 5 entries shown in Task 2 Step 3 (`"AI: summarize"` etc.).

- [ ] **Step 3: tsc + test**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: tsc clean, all existing + new tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-run-automations/actions/index.ts \
        src/components/settings/RecipeBuilder.tsx
git commit -m "feat(crm): register 5 ai_* handlers + recipe builder UI cases"
```

---

## Task 8: aiBlocks service module

**Files:**
- Create: `src/services/supabase/aiBlocks.ts`

- [ ] **Step 1: Write the service**

```ts
// src/services/supabase/aiBlocks.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface AiBlockRun {
  runId: string;
  organizationId: string;
  recipeId: string | null;
  actionType: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsdCents: number | null;
  status: "success" | "failure" | "skipped";
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface AiBlockUsage {
  monthlyRunCap: number;
  currentMonthRuns: number;
  currentMonthSpendCents: number;
  currentMonthStartedAt: Date;
}

const mapRun = (r: Record<string, unknown>): AiBlockRun => ({
  runId: r.run_id as string,
  organizationId: r.organization_id as string,
  recipeId: (r.recipe_id as string) ?? null,
  actionType: r.action_type as string,
  model: r.model as string,
  inputTokens: r.input_tokens != null ? Number(r.input_tokens) : null,
  outputTokens: r.output_tokens != null ? Number(r.output_tokens) : null,
  costUsdCents: r.cost_usd_cents != null ? Number(r.cost_usd_cents) : null,
  status: r.status as AiBlockRun["status"],
  errorMessage: (r.error_message as string) ?? null,
  durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
  createdAt: new Date(r.created_at as string),
});

export const listRuns = async (
  organizationId: string,
  limit = 50,
): Promise<AiBlockRun[]> => {
  const { data, error } = await supabase
    .from("ai_block_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    logger.error("Failed to load AI block runs:", error);
    return [];
  }
  return (data || []).map(mapRun);
};

export const getUsage = async (organizationId: string): Promise<AiBlockUsage> => {
  const { data: cap } = await supabase
    .from("ai_block_usage_caps")
    .select("monthly_run_cap, current_month_runs, current_month_started_at")
    .eq("organization_id", organizationId)
    .maybeSingle();

  // The DB function lazily creates the row on first AI call. Default if not present.
  const monthlyRunCap = (cap?.monthly_run_cap as number) ?? 1000;
  const currentMonthRuns = (cap?.current_month_runs as number) ?? 0;
  const currentMonthStartedAt = cap?.current_month_started_at
    ? new Date(cap.current_month_started_at as string)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  // Sum current-month spend by querying ai_block_runs.
  const monthStart = new Date(currentMonthStartedAt);
  const { data: rows } = await supabase
    .from("ai_block_runs")
    .select("cost_usd_cents")
    .eq("organization_id", organizationId)
    .gte("created_at", monthStart.toISOString());
  const currentMonthSpendCents = (rows ?? []).reduce(
    (sum, r) => sum + Number((r as { cost_usd_cents?: number }).cost_usd_cents ?? 0),
    0,
  );

  return {
    monthlyRunCap,
    currentMonthRuns,
    currentMonthSpendCents,
    currentMonthStartedAt,
  };
};

export const setUsageCap = async (
  organizationId: string,
  newCap: number,
): Promise<void> => {
  const { error } = await supabase.rpc("set_ai_block_cap", {
    p_org: organizationId,
    p_cap: newCap,
  });
  if (error) throw error;
};
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add src/services/supabase/aiBlocks.ts
git commit -m "feat(crm): aiBlocks service (listRuns, getUsage, setUsageCap)"
```

---

## Task 9: useAiUsage hook with realtime subscription

**Files:**
- Create: `src/hooks/useAiUsage.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useAiUsage.ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { AiBlockUsage, getUsage } from "@/services/supabase/aiBlocks";
import { supabase } from "@/services/supabase/config";

export const useAiUsage = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [usage, setUsage] = useState<AiBlockUsage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setUsage(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getUsage(orgId).then((u) => {
      if (cancelled) return;
      setUsage(u);
      setLoading(false);
    });
    const channel = supabase
      .channel(`ai-usage-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "ai_block_runs",
        filter: `organization_id=eq.${orgId}`,
      }, () => getUsage(orgId).then(setUsage))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "ai_block_usage_caps",
        filter: `organization_id=eq.${orgId}`,
      }, () => getUsage(orgId).then(setUsage))
      .subscribe();
    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [orgId]);

  return { organizationId: orgId, usage, loading, canManage: isOwner || isAdmin };
};
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAiUsage.ts
git commit -m "feat(crm): useAiUsage hook with realtime subscription"
```

---

## Task 10: AI Usage Settings tab

**Files:**
- Create: `src/components/settings/AiUsageSettingsTab.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Write the tab**

```tsx
// src/components/settings/AiUsageSettingsTab.tsx
import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { useAiUsage } from "@/hooks/useAiUsage";
import { AiBlockRun, listRuns, setUsageCap } from "@/services/supabase/aiBlocks";
import { toast } from "sonner";

const STATUS_ICON: Record<AiBlockRun["status"], React.FC<{ className?: string }>> = {
  success: CheckCircle2,
  failure: XCircle,
  skipped: MinusCircle,
};

const STATUS_COLOR: Record<AiBlockRun["status"], string> = {
  success: "text-emerald-600",
  failure: "text-destructive",
  skipped: "text-muted-foreground",
};

const formatUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export const AiUsageSettingsTab: React.FC = () => {
  const { organizationId, usage, loading, canManage } = useAiUsage();
  const [runs, setRuns] = useState<AiBlockRun[]>([]);
  const [capDraft, setCapDraft] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    listRuns(organizationId, 50).then(setRuns);
  }, [organizationId]);

  useEffect(() => {
    if (usage) setCapDraft(usage.monthlyRunCap);
  }, [usage?.monthlyRunCap]);

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Only admins can view AI usage.</p>;
  }
  if (loading || !usage) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading AI usage…
      </p>
    );
  }

  const pct = usage.monthlyRunCap > 0
    ? Math.min(100, Math.round((usage.currentMonthRuns / usage.monthlyRunCap) * 100))
    : 0;

  const avgCost = usage.currentMonthRuns > 0
    ? usage.currentMonthSpendCents / usage.currentMonthRuns
    : 0;

  // Reset date = first of next month.
  const next = new Date(usage.currentMonthStartedAt);
  next.setMonth(next.getMonth() + 1);

  const saveCap = async () => {
    if (!organizationId) return;
    setSaving(true);
    try {
      await setUsageCap(organizationId, capDraft);
      toast.success("Cap updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* Left — This month */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            This month
          </h2>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Runs used</span>
              <span className="font-mono">{usage.currentMonthRuns} / {usage.monthlyRunCap}</span>
            </div>
            <Progress value={pct} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">{pct}%</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Spend</p>
              <p className="font-mono text-lg">{formatUsd(usage.currentMonthSpendCents)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Avg / run</p>
              <p className="font-mono text-lg">{formatUsd(avgCost)}</p>
            </div>
          </div>
          <div className="border-t pt-3 space-y-2">
            <Label>Monthly cap</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={capDraft}
                onChange={(e) => setCapDraft(Number(e.target.value))}
                min={0}
                max={1000000}
              />
              <Button onClick={saveCap} disabled={saving}>
                {saving ? "Saving…" : "Update"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Resets on {next.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          {usage.currentMonthRuns >= usage.monthlyRunCap && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              AI quota for this month exhausted. Recipes using AI actions will
              skip those steps until reset or until you raise the cap above.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right — Recent runs */}
      <Card>
        <CardContent className="pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Recent runs
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI runs yet.</p>
          ) : (
            <div className="space-y-1 max-h-[26rem] overflow-y-auto pr-1">
              {runs.map((run) => {
                const Icon = STATUS_ICON[run.status];
                return (
                  <div key={run.runId} className="flex items-center gap-2 text-xs py-1 border-b border-border/40">
                    <span className="text-muted-foreground tabular-nums w-[5.5rem] shrink-0">
                      {run.createdAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {run.actionType.replace("ai_", "")}
                    </Badge>
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${STATUS_COLOR[run.status]}`} />
                    <span className="flex-1 min-w-0 truncate text-muted-foreground">
                      {run.errorMessage ?? `${run.inputTokens ?? 0}→${run.outputTokens ?? 0} tok`}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                      {run.costUsdCents != null ? formatUsd(run.costUsdCents) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
```

- [ ] **Step 2: Add the tab to Settings.tsx**

In `src/pages/Settings.tsx`, find the Automations tab (added in Batch 2a) and insert the AI Usage tab right after it.

Add the import alongside other settings components:

```tsx
import { AiUsageSettingsTab } from "@/components/settings/AiUsageSettingsTab";
```

If the Lucide import doesn't include `Sparkles`, add it:

```tsx
import { …, Sparkles, … } from "lucide-react";
```

In the `<TabsList>`, after the `automations` trigger:

```tsx
<TabsTrigger value="ai-usage" className="gap-2">
  <Sparkles className="w-4 h-4" />
  AI Usage
</TabsTrigger>
```

In the TabsContent section, after the automations content:

```tsx
<TabsContent value="ai-usage">
  <AiUsageSettingsTab />
</TabsContent>
```

- [ ] **Step 3: tsc + test**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: clean, no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/AiUsageSettingsTab.tsx src/pages/Settings.tsx
git commit -m "feat(crm): AI Usage settings tab + integration into Settings page"
```

---

## Task 11: Daily cleanup of ai_block_runs

**Files:**
- Modify: `supabase/functions/crm-rotate-turnstile-salt/index.ts`

- [ ] **Step 1: Add the third DELETE**

In `supabase/functions/crm-rotate-turnstile-salt/index.ts`, before the final `return` statement, alongside the existing `automation_runs` + `automation_events` deletes, insert:

```ts
await admin.from("ai_block_runs")
  .delete()
  .lt("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/crm-rotate-turnstile-salt/index.ts
git commit -m "feat(crm): prune ai_block_runs older than 90 days in daily cleanup"
```

---

## Task 12: Merge to main + push

**Files:** none (git operations only)

- [ ] **Step 1: Verify everything still builds + passes**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: tsc clean, all tests pass (Batch 2a's 42 + new substitute tests + 11 new aiBlocks tests).

- [ ] **Step 2: Switch to main, merge no-ff, push**

```bash
git checkout main
git pull origin main
git merge --no-ff feature/crm-ai-blocks -m "Merge branch 'feature/crm-ai-blocks'

CRM Batch 2b — AI Blocks. 5 LLM-powered automation action handlers
(ai_summarize, ai_classify_lead, ai_draft_email, ai_extract, ai_translate)
using Claude Sonnet 4.6 with prompt caching. Per-org monthly soft cap
(1000 runs default). Per-call cost logging in ai_block_runs. Admin
Settings page (AI Usage) with usage bar + cap controls + recent runs."
git push origin main
```

- [ ] **Step 3: Tell the user what they need to deploy**

The merge is on `main`. User needs to (in their own terminal):

```bash
npx supabase secrets set ANTHROPIC_API_KEY=<their key from console.anthropic.com>
npx supabase db push                                       # applies 066
npx supabase functions deploy crm-run-automations          # picks up the new handlers
npx supabase functions deploy crm-rotate-turnstile-salt    # picks up the prune
```

Then redeploy the frontend (Vite build) so the new AI Usage settings tab appears.

---

## Self-Review

Walking through the spec section by section to confirm coverage:

| Spec requirement | Task covering it |
|---|---|
| Goal: 5 AI action handlers | Task 6 |
| Sonnet 4.6 + `@anthropic-ai/sdk` + prompt caching | Task 6 (`callClaude` helper, `cache_control: 'ephemeral'`) |
| Per-org monthly soft cap, atomic check+increment | Task 1 (`check_and_increment_ai_cap` RPC) |
| Per-call logging in `ai_block_runs` | Task 1 (table) + Task 6 (insert in `callClaude` success path + `logFailure`) |
| Admin Settings page with usage bar + recent runs + cap edit | Tasks 8 (service) + 9 (hook) + 10 (tab) |
| `{{ai.output}}`, `{{ai.output_subject}}`, `{{ai.output_body}}` chaining | Task 3 (substitute) + Task 4 (worker stash) + Task 6 (handlers populate meta) |
| Non-goal: prompt editing | Not implemented anywhere — hard-coded prompts in Task 6 |
| Non-goal: per-block model override | MODEL constant in Task 6, no UI for override |
| Cost calculation Sonnet 4.6 pricing | Task 5 (test) + Task 6 (`computeCostCents`) |
| `set_ai_block_cap` admin-only RPC | Task 1 (definition) + Task 8 (`setUsageCap`) |
| Quota-exceeded → skipped, NOT logged in ai_block_runs | Task 6 (`intoActionResult` returns `skipped` for `ai_quota_exceeded` BEFORE any logging happens) |
| RLS: members read, no write policy | Task 1 (policies wrapped in `drop policy if exists`) |
| `aiOutputs` accumulator in `ActionContext` | Task 2 (type) + Task 4 (worker stash) |
| Daily prune of `ai_block_runs` > 90d | Task 11 |
| `ANTHROPIC_API_KEY` secret | Task 12 step 3 (user instruction) |

**Type consistency check:** `ActionHandler`, `ActionContext`, `ActionResult`, `ActionType` all match the existing engine. `aiOutputs` consistently typed as `Record<string, string>` in `types.ts` (Task 2), `index.ts` worker (Task 4), and `substitute.ts` (Task 3). `AiBlockUsage` shape matches between `aiBlocks.ts` (Task 8) and `useAiUsage` hook (Task 9) and the tab (Task 10).

**Placeholder scan:** zero TBDs, every code step contains the actual code, no "similar to Task N" references.

Plan is ready.
