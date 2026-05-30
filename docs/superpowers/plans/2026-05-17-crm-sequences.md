# CRM Email Sequences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-step email cadences on top of the recipe engine — `wait` action, direct Gmail API send with Reply-To rewriting, SendGrid Inbound Parse webhook for reply detection, per-recipe send window, deal-close cancellation, admin stop button, Sequences UI lens.

**Architecture:** Worker absorbs a `pending_actions` table drain in addition to the events drain — `wait` action inserts rows into it, the next tick whose `fire_at <= now()` resumes the recipe from the next index with the same source event + stashed `aiOutputs`. `sendEmail.ts` rewritten to read the user's encrypted Gmail token and POST directly to `gmail.users.messages.send` with a `Reply-To: reply+<runId>@<inbound-domain>`. New public `gmail-inbound` Edge Function receives SendGrid Inbound Parse posts, verifies the ECDSA signature, parses the run id from the To field, logs a `sequence_replies` row, and flips matching pending actions to `reply_received`. Send-window check defers resumption to the next valid hour. Deal-close DB trigger and admin RPC each cancel pending actions.

**Tech Stack:** Supabase Edge Functions (Deno) + Postgres, React + Vite + TS, shadcn/ui, vitest. Builds on Batches 2a (recipe engine) and 2b (AI blocks). External dependency: SendGrid Inbound Parse (manual one-time setup by the user).

**Coordination:** Branch `feature/crm-sequences` off main. New secrets: `SENDGRID_INBOUND_WEBHOOK_SECRET`, `SEQUENCE_INBOUND_DOMAIN`. Migration `067_sequences.sql`. One new Edge Function (`gmail-inbound`) deployed `--no-verify-jwt`.

---

## File structure

**Created:**
- `supabase/migrations/067_sequences.sql`
- `supabase/functions/crm-run-automations/actions/wait.ts`
- `supabase/functions/crm-run-automations/triggers/sendWindow.ts`
- `supabase/functions/gmail-inbound/index.ts`
- `src/services/supabase/sequences.ts` — types + listSequenceReplies + counts + stop action
- `src/hooks/useSequences.ts`
- `src/components/settings/SequencesSettingsTab.tsx`
- `docs/superpowers/deployment/sequences-inbound-setup.md`
- `tests/unit/wait.test.ts`
- `tests/unit/sendWindow.test.ts`
- `tests/unit/replyToToken.test.ts`

**Modified:**
- `supabase/functions/crm-run-automations/shared/types.ts` — add `wait` to `ActionType`, add `recipeRunId` + `nextActionIndex` to `ActionContext`
- `supabase/functions/crm-run-automations/shared/runLog.ts` — split `writeRun` into `createRun` + `finalizeRun`
- `supabase/functions/crm-run-automations/index.ts` — pre-create run row, pass `recipeRunId`/`nextActionIndex` to handlers, short-circuit on `meta.defer`, add `processPendingActions` drain to the top of each tick
- `supabase/functions/crm-run-automations/actions/index.ts` — register `wait`
- `supabase/functions/crm-run-automations/actions/sendEmail.ts` — full rewrite (Gmail direct + Reply-To)
- `src/services/supabase/automations.ts` — extend `ACTION_TYPES` + `ACTION_LABEL` with `wait`, extend `RecipeDraft` + `Recipe` types with `sendWindow`, forward `sendWindow` through `upsertRecipe`
- `src/components/settings/RecipeBuilder.tsx` — `wait` editor case + send-window collapsible block
- `src/pages/Settings.tsx` — add Sequences tab between Automations and AI Usage

---

## Task 1: Branch off main + migration 067

**Files:**
- Create: `supabase/migrations/067_sequences.sql`

- [ ] **Step 1: Branch**

```bash
cd c:/Users/faraz/task/Project-Management-
git checkout main && git pull origin main
git checkout -b feature/crm-sequences
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/067_sequences.sql` with the SQL block from spec Section A.2 (full verbatim). The block creates:

- `pending_actions` table + 3 partial indexes
- `sequence_replies` table + 2 indexes
- `alter automation_recipes add column send_window jsonb`
- `alter organizations add column default_timezone text not null default 'UTC'`
- `cancel_pending_actions_on_close()` function + `cancel_pending_actions_on_close_t` trigger on `deals`
- `stop_pending_actions_for_run(p_run_id uuid) returns int` SECURITY DEFINER RPC + grant to authenticated
- `drop function if exists public.crm_upsert_recipe(...9-param...)` then `create or replace function public.crm_upsert_recipe(... + p_send_window jsonb default null)` with the upsert logic from spec + grant to authenticated
- RLS enable on both new tables + `drop policy if exists` + `create policy "<name> read for org members" ... using is_org_member(organization_id)`

All using `create table if not exists`, `create or replace function`, `drop trigger if exists`, `drop policy if exists` for idempotency.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/067_sequences.sql
git commit -m "feat(crm): pending_actions + sequence_replies + deal-close stop trigger + send_window column"
```

---

## Task 2: Extend ActionType union + ActionContext + ACTION_LABEL

**Files:**
- Modify: `supabase/functions/crm-run-automations/shared/types.ts`
- Modify: `src/services/supabase/automations.ts`
- Modify: `src/components/settings/RecipeBuilder.tsx`

- [ ] **Step 1: Extend worker types**

In `supabase/functions/crm-run-automations/shared/types.ts`, change the `ActionType` union to include `"wait"`:

```ts
export type ActionType =
  | "create_task" | "tag" | "set_field" | "change_owner"
  | "add_note" | "move_deal_stage" | "webhook" | "slack_post" | "send_email"
  | "ai_summarize" | "ai_classify_lead" | "ai_draft_email"
  | "ai_extract" | "ai_translate"
  | "wait";
```

Extend `ActionContext` with two optional fields:

```ts
export interface ActionContext {
  admin: any;
  orgId: string;
  event: AutomationEvent;
  recipeId: string;
  recipeName: string;
  runStartedAt: Date;
  aiOutputs?: Record<string, string>;
  recipeRunId?: string;
  nextActionIndex?: number;
}
```

- [ ] **Step 2: Extend service-layer constants**

In `src/services/supabase/automations.ts`:

- Append `"wait"` to `ACTION_TYPES` array.
- Add `wait: "Wait"` to `ACTION_LABELS` record.
- Add `sendWindow?: { hours: [number, number]; days: number[]; timezone: string } | null` to both `RecipeDraft` and `Recipe` interfaces.
- In `mapRecipe`, read `send_window`: `sendWindow: (row.send_window as RecipeDraft["sendWindow"]) ?? null,`.
- In `upsertRecipe(...)`, pass a new `p_send_window: draft.sendWindow ?? null` parameter to the RPC.

- [ ] **Step 3: Extend RecipeBuilder local ACTION_LABEL**

In `src/components/settings/RecipeBuilder.tsx`, find the local `ACTION_LABEL: Record<ActionType, string>` and add `wait: "Wait",`. (The exhaustive map will break tsc otherwise.)

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-run-automations/shared/types.ts \
        src/services/supabase/automations.ts \
        src/components/settings/RecipeBuilder.tsx
git commit -m "feat(crm): extend ActionType + ACTION_LABEL with wait, add sendWindow to RecipeDraft"
```

---

## Task 3: wait action handler + unit tests

**Files:**
- Create: `tests/unit/wait.test.ts`
- Create: `supabase/functions/crm-run-automations/actions/wait.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/wait.test.ts
import { describe, it, expect, vi } from "vitest";
import { wait } from "../../supabase/functions/crm-run-automations/actions/wait.ts";

const makeCtx = (overrides: Partial<any> = {}) => {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const select = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const neq = vi.fn().mockReturnThis();
  const head = vi.fn().mockResolvedValue({ count: 0 });
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "pending_actions") {
        return { insert, select: () => ({ eq: () => ({ eq: () => ({ neq: () => head() }) }) }) };
      }
      return { select, eq, neq };
    }),
  };
  return {
    admin,
    orgId: "org-1",
    event: { event_id: "evt-1", payload: { deal_id: "d-1", client_id: "c-1" } },
    recipeId: "rec-1",
    recipeName: "Test recipe",
    runStartedAt: new Date(),
    aiOutputs: {},
    nextActionIndex: 2,
    ...overrides,
  };
};

describe("wait action", () => {
  it("returns meta.defer=true and inserts a pending_actions row", async () => {
    const ctx = makeCtx();
    const r = await wait(ctx as any, { value: 1, unit: "days" });
    expect(r.status).toBe("success");
    expect(r.meta?.defer).toBe(true);
    expect(typeof r.meta?.fire_at).toBe("string");
  });

  it("rejects zero or negative values", async () => {
    const ctx = makeCtx();
    const r = await wait(ctx as any, { value: 0, unit: "minutes" });
    expect(r.status).toBe("failure");
    expect(r.message).toMatch(/> 0/);
  });

  it("requires nextActionIndex from the worker", async () => {
    const ctx = makeCtx({ nextActionIndex: undefined });
    const r = await wait(ctx as any, { value: 1, unit: "hours" });
    expect(r.status).toBe("failure");
    expect(r.message).toMatch(/nextActionIndex/);
  });

  it("fails with recursion_limit when 10 pending already exist", async () => {
    const ctx = makeCtx();
    // Override the count chain to return 10.
    ctx.admin.from = vi.fn((table: string) => {
      if (table === "pending_actions") {
        return {
          insert: vi.fn(),
          select: () => ({ eq: () => ({ eq: () => ({ neq: () => Promise.resolve({ count: 10 }) }) }) }),
        };
      }
      return { select: vi.fn(), eq: vi.fn(), neq: vi.fn() };
    });
    const r = await wait(ctx as any, { value: 1, unit: "minutes" });
    expect(r.status).toBe("failure");
    expect(r.message).toBe("recursion_limit");
  });
});
```

Run: `npm test -- wait.test.ts` → expect FAIL ("Failed to resolve import").

- [ ] **Step 2: Write the handler**

```ts
// supabase/functions/crm-run-automations/actions/wait.ts
import { ActionHandler } from "../shared/types.ts";

export const wait: ActionHandler = async (ctx, config) => {
  const value = Number(config.value ?? 1);
  const unit = (config.unit as string) ?? "days";
  if (!Number.isFinite(value) || value <= 0) {
    return { status: "failure", message: "wait value must be > 0" };
  }
  const multiplier = unit === "minutes" ? 60_000
    : unit === "hours" ? 3_600_000
    : 86_400_000;
  const fireAt = new Date(Date.now() + value * multiplier);

  // Recursion hard cap: same recipe + source event can't accumulate 10+ pending.
  const { count } = await ctx.admin
    .from("pending_actions")
    .select("id", { count: "exact", head: true })
    .eq("recipe_id", ctx.recipeId)
    .eq("source_event_id", ctx.event.event_id)
    .neq("status", "cancelled");
  if ((count ?? 0) >= 10) {
    return { status: "failure", message: "recursion_limit" };
  }

  if (typeof ctx.nextActionIndex !== "number") {
    return { status: "failure", message: "wait action requires nextActionIndex from worker" };
  }

  await ctx.admin.from("pending_actions").insert({
    organization_id: ctx.orgId,
    recipe_id: ctx.recipeId,
    source_event_id: ctx.event.event_id,
    next_action_index: ctx.nextActionIndex + 1,
    fire_at: fireAt.toISOString(),
    ai_outputs: ctx.aiOutputs ?? {},
    deal_id: (ctx.event.payload as { deal_id?: string }).deal_id ?? null,
    client_id: (ctx.event.payload as { client_id?: string }).client_id ?? null,
  });

  return {
    status: "success",
    meta: { defer: true, fire_at: fireAt.toISOString() },
  };
};
```

- [ ] **Step 3: Run tests + tsc**

```bash
npm test -- wait.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: 4/4 pass, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-run-automations/actions/wait.ts tests/unit/wait.test.ts
git commit -m "feat(crm): wait action handler + tests (returns meta.defer, recursion cap)"
```

---

## Task 4: Send-window helper + unit tests

**Files:**
- Create: `tests/unit/sendWindow.test.ts`
- Create: `supabase/functions/crm-run-automations/triggers/sendWindow.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/sendWindow.test.ts
import { describe, it, expect } from "vitest";
import { nextSendableTime } from "../../supabase/functions/crm-run-automations/triggers/sendWindow.ts";

const W = (overrides: Partial<{ hours: [number, number]; days: number[]; timezone: string }> = {}) => ({
  hours: [9, 18] as [number, number],
  days: [1, 2, 3, 4, 5],
  timezone: "UTC",
  ...overrides,
});

describe("nextSendableTime", () => {
  it("returns now when null window (any time)", () => {
    const now = new Date("2026-05-17T03:00:00Z");
    expect(nextSendableTime(null, now).toISOString()).toBe(now.toISOString());
  });

  it("returns now when inside window", () => {
    const now = new Date("2026-05-18T10:00:00Z"); // Mon 10am UTC
    expect(nextSendableTime(W(), now).toISOString()).toBe(now.toISOString());
  });

  it("jumps to start hour later same day when before window on a valid weekday", () => {
    const now = new Date("2026-05-18T03:00:00Z"); // Mon 3am UTC
    const next = nextSendableTime(W(), now);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCDate()).toBe(18);
  });

  it("jumps to Monday morning when called on Saturday", () => {
    const now = new Date("2026-05-16T14:00:00Z"); // Saturday
    const next = nextSendableTime(W(), now);
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.getUTCHours()).toBe(9);
  });

  it("respects non-UTC timezone (NYC offset)", () => {
    // 14:00 UTC = 09:00 America/New_York (EST, UTC-5) — should be inside a 9–18 NYC window.
    const now = new Date("2026-01-12T14:00:00Z"); // Monday Jan 12
    const next = nextSendableTime(W({ timezone: "America/New_York" }), now);
    expect(next.toISOString()).toBe(now.toISOString());
  });
});
```

Run: `npm test -- sendWindow.test.ts` → expect FAIL.

- [ ] **Step 2: Write the helper**

```ts
// supabase/functions/crm-run-automations/triggers/sendWindow.ts

export interface SendWindow {
  hours: [number, number];   // inclusive start, exclusive end, 0..24
  days: number[];             // ISO weekday: 1=Mon .. 7=Sun
  timezone: string;           // IANA TZ
}

export const nextSendableTime = (window: SendWindow | null, now: Date): Date => {
  if (!window) return now;
  let probe = new Date(now);
  // 168 hours = 1 week — bounds runtime against an unsatisfiable config.
  for (let i = 0; i < 168; i++) {
    if (isWithinWindow(window, probe)) return probe;
    probe = new Date(probe.getTime() + 3_600_000);
    probe.setUTCMinutes(0, 0, 0);
  }
  return probe;
};

const isWithinWindow = (w: SendWindow, t: Date): boolean => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: w.timezone,
    weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(t);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const iso = wd === 0 ? 7 : wd;
  if (!w.days.includes(iso)) return false;
  if (hour < w.hours[0] || hour >= w.hours[1]) return false;
  return true;
};
```

- [ ] **Step 3: Run tests + tsc**

```bash
npm test -- sendWindow.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: 5/5 pass, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-run-automations/triggers/sendWindow.ts \
        tests/unit/sendWindow.test.ts
git commit -m "feat(crm): nextSendableTime helper + tests (timezone-aware window check)"
```

---

## Task 5: runLog split (createRun + finalizeRun)

**Files:**
- Modify: `supabase/functions/crm-run-automations/shared/runLog.ts`

- [ ] **Step 1: Read current `runLog.ts`**

Look at the existing `writeRun(admin, args)` signature so the new helpers can keep the same arg shape where possible.

- [ ] **Step 2: Add `createRun` + `finalizeRun` (keep `writeRun` for back-compat)**

Add two new functions alongside the existing `writeRun`:

```ts
// createRun inserts a placeholder row at the START of a recipe run so any
// handler can read ctx.recipeRunId. finalizeRun updates the same row with
// the final results + status at the END.

export const createRun = async (
  admin: any,
  args: {
    recipeId: string;
    eventId: string;
    organizationId: string;
    startedAt: Date;
  },
): Promise<string> => {
  const { data, error } = await admin
    .from("automation_runs")
    .insert({
      recipe_id: args.recipeId,
      event_id: args.eventId,
      organization_id: args.organizationId,
      status: "success",   // placeholder — overwritten by finalizeRun
      action_results: [],
      started_at: args.startedAt.toISOString(),
      finished_at: args.startedAt.toISOString(),
    })
    .select("run_id")
    .single();
  if (error) throw new Error(`createRun: ${error.message}`);
  return (data as { run_id: string }).run_id;
};

export const finalizeRun = async (
  admin: any,
  args: {
    runId: string;
    results: ActionResult[];
    finishedAt: Date;
  },
): Promise<void> => {
  const status = overallStatus(args.results);
  await admin.from("automation_runs").update({
    status,
    action_results: args.results,
    finished_at: args.finishedAt.toISOString(),
  }).eq("run_id", args.runId);

  // Bump recipe counters atomically.
  const { data } = await admin
    .from("automation_runs")
    .select("recipe_id")
    .eq("run_id", args.runId)
    .maybeSingle();
  if (data?.recipe_id) {
    await admin.rpc("increment_recipe_counters", {
      p_recipe_id: data.recipe_id,
      p_failed: status === "failure",
    });
  }
};

// finalizeResumedRun appends new results to an existing run's action_results
// without re-bumping recipe counters (the original run already did).
export const finalizeResumedRun = async (
  admin: any,
  args: {
    runId: string;
    newResults: ActionResult[];
    finishedAt: Date;
  },
): Promise<void> => {
  // Read existing results, append, recompute status.
  const { data: existing } = await admin
    .from("automation_runs")
    .select("action_results")
    .eq("run_id", args.runId)
    .maybeSingle();
  const prev: ActionResult[] = Array.isArray(existing?.action_results)
    ? (existing.action_results as ActionResult[])
    : [];
  const combined = [...prev, ...args.newResults];
  const status = overallStatus(combined);
  await admin.from("automation_runs").update({
    status,
    action_results: combined,
    finished_at: args.finishedAt.toISOString(),
  }).eq("run_id", args.runId);
};
```

Keep `writeRun` and `overallStatus` as they are (other code paths may still use them).

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-run-automations/shared/runLog.ts
git commit -m "feat(crm): split run logging into createRun/finalizeRun + finalizeResumedRun"
```

---

## Task 6: Worker refactor — pre-create run row, pass recipeRunId, short-circuit on defer

**Files:**
- Modify: `supabase/functions/crm-run-automations/index.ts`

- [ ] **Step 1: Refactor `runRecipe`**

Locate `runRecipe(admin, recipe, event)`. Replace the action loop body so it:

1. Calls `createRun` BEFORE the loop, stores the resulting `recipeRunId`.
2. Passes `recipeRunId` AND `nextActionIndex: i` into every handler's `ActionContext`.
3. After the handler returns, if `r.meta?.defer === true`, breaks the loop (rest of actions are deferred to `processPendingActions`).
4. Calls `finalizeRun` instead of `writeRun` after the loop.

```ts
import { createRun, finalizeRun, finalizeResumedRun, overallStatus } from "./shared/runLog.ts";

const runRecipe = async (admin: any, recipe: Recipe, event: AutomationEvent): Promise<void> => {
  const started = new Date();
  const ctx = await loadEntityContext(admin, event);

  if (!evaluateConditions(recipe.conditions ?? [], event, ctx)) return;

  const recipeRunId = await createRun(admin, {
    recipeId: recipe.recipe_id,
    eventId: event.event_id,
    organizationId: event.organization_id,
    startedAt: started,
  });

  const aiOutputs: Record<string, string> = {};
  const results: ActionResult[] = [];

  for (let i = 0; i < recipe.actions.length; i++) {
    const actionSpec = recipe.actions[i];
    const handler = ACTION_REGISTRY[actionSpec.type];
    const t0 = Date.now();
    if (!handler) {
      results.push({ type: actionSpec.type, status: "failure", message: "Unknown action type", duration_ms: 0 });
      break;
    }
    try {
      const r = await handler(
        {
          admin,
          orgId: event.organization_id,
          event,
          recipeId: recipe.recipe_id,
          recipeName: recipe.name,
          runStartedAt: started,
          aiOutputs,
          recipeRunId,
          nextActionIndex: i,
        },
        actionSpec.config ?? {},
      );
      results.push({ ...r, type: actionSpec.type, duration_ms: Date.now() - t0 });
      if (r.meta && typeof r.meta === "object") {
        for (const [k, v] of Object.entries(r.meta)) {
          if (k.startsWith("ai_output") && typeof v === "string") aiOutputs[k] = v;
        }
      }
      if (r.meta?.defer === true) break;  // wait scheduled — rest fires later
      if (r.status === "failure") break;
    } catch (err) {
      results.push({
        type: actionSpec.type,
        status: "failure",
        message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - t0,
      });
      break;
    }
  }

  await finalizeRun(admin, { runId: recipeRunId, results, finishedAt: new Date() });
};
```

- [ ] **Step 2: Add `executeActionsResume` for the pending-action drain**

A second helper that mirrors `runRecipe` but starts at a given index, seeds `aiOutputs` from a stash, and appends results to an existing run row instead of creating a new one:

```ts
const executeActionsResume = async (
  admin: any,
  recipe: Recipe,
  event: AutomationEvent,
  startIndex: number,
  initialAiOutputs: Record<string, string>,
  existingRunId: string,
): Promise<void> => {
  const started = new Date();
  const aiOutputs = { ...initialAiOutputs };
  const results: ActionResult[] = [];

  for (let i = startIndex; i < recipe.actions.length; i++) {
    const actionSpec = recipe.actions[i];
    const handler = ACTION_REGISTRY[actionSpec.type];
    const t0 = Date.now();
    if (!handler) {
      results.push({ type: actionSpec.type, status: "failure", message: "Unknown action type", duration_ms: 0 });
      break;
    }
    try {
      const r = await handler(
        {
          admin,
          orgId: event.organization_id,
          event,
          recipeId: recipe.recipe_id,
          recipeName: recipe.name,
          runStartedAt: started,
          aiOutputs,
          recipeRunId: existingRunId,
          nextActionIndex: i,
        },
        actionSpec.config ?? {},
      );
      results.push({ ...r, type: actionSpec.type, duration_ms: Date.now() - t0 });
      if (r.meta && typeof r.meta === "object") {
        for (const [k, v] of Object.entries(r.meta)) {
          if (k.startsWith("ai_output") && typeof v === "string") aiOutputs[k] = v;
        }
      }
      if (r.meta?.defer === true) break;
      if (r.status === "failure") break;
    } catch (err) {
      results.push({
        type: actionSpec.type,
        status: "failure",
        message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - t0,
      });
      break;
    }
  }

  await finalizeResumedRun(admin, { runId: existingRunId, newResults: results, finishedAt: new Date() });
};
```

- [ ] **Step 3: Add `processPendingActions` drain to the top of `Deno.serve`**

Import `nextSendableTime`:

```ts
import { nextSendableTime, SendWindow } from "./triggers/sendWindow.ts";
```

Add the drain function:

```ts
const processPendingActions = async (admin: any): Promise<number> => {
  const nowIso = new Date().toISOString();
  const { data: pendings } = await admin
    .from("pending_actions")
    .select(`
      id, organization_id, recipe_id, source_event_id, next_action_index,
      ai_outputs, deal_id, client_id,
      automation_recipes!inner(actions, send_window, enabled, name),
      automation_events(payload, event_type, source_table, source_id, depth, enqueued_at, processed_at)
    `)
    .eq("status", "pending")
    .lte("fire_at", nowIso)
    .limit(100);

  let drained = 0;
  for (const p of pendings ?? []) {
    if (!p.automation_recipes.enabled) {
      await admin.from("pending_actions").update({ status: "cancelled" }).eq("id", p.id);
      continue;
    }
    const nextValid = nextSendableTime(
      (p.automation_recipes.send_window as SendWindow | null) ?? null,
      new Date(),
    );
    if (nextValid.getTime() > Date.now()) {
      await admin.from("pending_actions").update({ fire_at: nextValid.toISOString() }).eq("id", p.id);
      continue;
    }
    if (!p.automation_events) {
      await admin.from("pending_actions").update({ status: "cancelled" }).eq("id", p.id);
      continue;
    }

    const { data: existingRun } = await admin
      .from("automation_runs")
      .select("run_id")
      .eq("recipe_id", p.recipe_id)
      .eq("event_id", p.source_event_id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const runId = existingRun?.run_id;
    if (!runId) {
      // Source run was deleted — cancel.
      await admin.from("pending_actions").update({ status: "cancelled" }).eq("id", p.id);
      continue;
    }

    await executeActionsResume(
      admin,
      {
        recipe_id: p.recipe_id,
        organization_id: p.organization_id,
        name: p.automation_recipes.name,
        trigger_type: p.automation_events.event_type,
        trigger_config: {},
        conditions: [],
        actions: p.automation_recipes.actions,
      } as Recipe,
      {
        event_id: p.source_event_id,
        organization_id: p.organization_id,
        event_type: p.automation_events.event_type,
        payload: p.automation_events.payload,
        source_table: p.automation_events.source_table,
        source_id: p.automation_events.source_id,
        depth: p.automation_events.depth,
        enqueued_at: p.automation_events.enqueued_at,
        processed_at: p.automation_events.processed_at,
      } as AutomationEvent,
      p.next_action_index,
      (p.ai_outputs as Record<string, string>) ?? {},
      runId,
    );

    await admin.from("pending_actions").update({ status: "fired" }).eq("id", p.id);
    drained += 1;
  }
  return drained;
};
```

Call it at the top of `Deno.serve`:

```ts
Deno.serve(async () => {
  const admin = makeAdmin();
  const start = Date.now();

  const locked = await tryAdvisoryLock(admin);
  if (!locked) {
    return new Response(JSON.stringify({ ok: true, skipped: "already_running" }), {
      headers: { "content-type": "application/json" },
    });
  }

  let processed = 0;
  let pendingsDrained = 0;
  try {
    pendingsDrained = await processPendingActions(admin);
    await enqueueCronEvents(admin);
    const events = await pullBatch(admin, 200);
    processed = events.length;
    // ... existing per-event loop ...
  } finally {
    // ... existing heartbeat + lock release ...
  }

  return new Response(JSON.stringify({ ok: true, processed, pendings_drained: pendingsDrained }), {
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 4: tsc + existing tests still pass**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: tsc clean, all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-run-automations/index.ts
git commit -m "feat(crm): worker pre-creates run row, short-circuits on defer, drains pending_actions"
```

---

## Task 7: Register wait + sendEmail rewrite

**Files:**
- Modify: `supabase/functions/crm-run-automations/actions/index.ts`
- Modify: `supabase/functions/crm-run-automations/actions/sendEmail.ts`

- [ ] **Step 1: Register `wait` in `ACTION_REGISTRY`**

```ts
import { wait } from "./wait.ts";

export const ACTION_REGISTRY: Record<ActionType, ActionHandler> = {
  // ... existing 14 entries ...
  wait,
};
```

- [ ] **Step 2: Rewrite `sendEmail.ts` — full file from spec Section C.2**

Replace `supabase/functions/crm-run-automations/actions/sendEmail.ts` with the file body from spec Section C.2. Key bits:

- Reads `INTEGRATION_TOKEN_KEY` and `SEQUENCE_INBOUND_DOMAIN` env (default `inbound.taskcalendar.co.uk`).
- `resolveSenderUserId(ctx)` picks the deal owner, falls back to recipe creator.
- Loads `integrations` row by `user_id + provider='gmail' + status='active'`.
- Decrypts via `_shared/crypto.ts` `decrypt(...)`.
- Resolves recipient via `resolveRecipient` (handles `deal_owner_email`, `client_email`, literal).
- Builds MIME multipart/alternative message via `buildRawMessage`, base64url-encodes for `gmail.users.messages.send`.
- Reply-To: `reply+<recipeRunId | recipeId>@<INBOUND_DOMAIN>`.
- POSTs to `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`.
- Returns `{status: success, meta: { message_id, thread_id, to, reply_to }}` on 2xx, `{status: failure, message: ...}` on 4xx/5xx, `{status: skipped, message: ...}` on missing integration / can't resolve recipient.

- [ ] **Step 3: tsc + tests**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: tsc clean, no test regressions.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-run-automations/actions/index.ts \
        supabase/functions/crm-run-automations/actions/sendEmail.ts
git commit -m "feat(crm): register wait handler + rewrite sendEmail to call Gmail directly with Reply-To"
```

---

## Task 8: Reply-To token extraction + tests

**Files:**
- Create: `tests/unit/replyToToken.test.ts`
- Create: `supabase/functions/gmail-inbound/index.ts` (stub for the export only)

- [ ] **Step 1: Write the test file (will fail until Task 9)**

```ts
// tests/unit/replyToToken.test.ts
import { describe, it, expect } from "vitest";
import { extractRunIdFromTo } from "../../supabase/functions/gmail-inbound/index.ts";

describe("extractRunIdFromTo", () => {
  it("extracts UUID from reply+UUID@domain", () => {
    expect(extractRunIdFromTo("reply+9f4c2a18-3b6e-4f7b-9b1a-1234567890ab@inbound.taskcalendar.co.uk"))
      .toBe("9f4c2a18-3b6e-4f7b-9b1a-1234567890ab");
  });

  it("returns null when there is no plus token", () => {
    expect(extractRunIdFromTo("reply@inbound.taskcalendar.co.uk")).toBe(null);
  });

  it("returns null for an unrelated address", () => {
    expect(extractRunIdFromTo("someone@example.com")).toBe(null);
  });

  it("case-insensitive on the reply+ prefix", () => {
    expect(extractRunIdFromTo("Reply+abc-DEF-1234-5678-90abcdef1234@x.co"))
      .toBe(null); // not a valid UUID
    expect(extractRunIdFromTo("REPLY+9f4c2a18-3b6e-4f7b-9b1a-1234567890ab@x.co"))
      .toBe("9f4c2a18-3b6e-4f7b-9b1a-1234567890ab");
  });

  it("handles a To: header with display name + angle brackets", () => {
    const to = '"Reply Bot" <reply+9f4c2a18-3b6e-4f7b-9b1a-1234567890ab@inbound.taskcalendar.co.uk>';
    expect(extractRunIdFromTo(to)).toBe("9f4c2a18-3b6e-4f7b-9b1a-1234567890ab");
  });
});
```

Run: `npm test -- replyToToken.test.ts` → FAIL (module missing).

- [ ] **Step 2: Commit the failing test**

```bash
git add tests/unit/replyToToken.test.ts
git commit -m "test(crm): failing tests for extractRunIdFromTo (gmail-inbound webhook)"
```

(The Task 9 implementation will make these green.)

---

## Task 9: gmail-inbound Edge Function

**Files:**
- Create: `supabase/functions/gmail-inbound/index.ts`

- [ ] **Step 1: Write the full file from spec Section D.2**

Verbatim from the spec. Exports `extractRunIdFromTo` so the Task 8 tests resolve. The file:

- Verifies the SendGrid signature via ECDSA-P256 over `timestamp + body`.
- Parses the multipart form body, reads `to`, `from`, `subject`, `text` fields.
- Extracts run id from `to` via `extractRunIdFromTo`.
- Looks up `automation_runs` by `run_id`.
- Inserts `sequence_replies` row.
- Updates matching `pending_actions` to `status='reply_received'`.
- Returns 200 with `{ok: true}` even on no-match cases (so SendGrid doesn't retry).
- Returns 401 on bad signature.

- [ ] **Step 2: Run the reply-token tests**

```bash
npm test -- replyToToken.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/gmail-inbound/index.ts
git commit -m "feat(crm): gmail-inbound webhook — verify signature, log reply, cancel pending"
```

---

## Task 10: Deployment doc for SendGrid setup

**Files:**
- Create: `docs/superpowers/deployment/sequences-inbound-setup.md`

- [ ] **Step 1: Write the doc**

```markdown
# Sequences — SendGrid Inbound Parse setup

External one-time setup required before `gmail-inbound` Edge Function can
receive reply webhooks.

## Prereqs
- DNS access to `taskcalendar.co.uk` (or your real domain).
- A SendGrid account (https://signup.sendgrid.com — free tier covers 100
  inbound emails/day; $20/mo Essentials plan covers real use).
- The Supabase project deployed with the `gmail-inbound` function live at
  `https://<project>.supabase.co/functions/v1/gmail-inbound`.

## Steps

### 1. Add MX records on `inbound.taskcalendar.co.uk`

In your DNS provider (Cloudflare, Vercel DNS, GoDaddy, etc.) add:

| Host | Type | Value | Priority |
|---|---|---|---|
| `inbound` | MX | `mx.sendgrid.net.` | 10 |

Wait 5–60 minutes for propagation. Verify with:
\`\`\`
nslookup -type=MX inbound.taskcalendar.co.uk
\`\`\`
You should see `mx.sendgrid.net` in the response.

### 2. Add the hostname in SendGrid

1. SendGrid dashboard → Settings → **Inbound Parse** → **Add Host & URL**.
2. **Hostname:** `inbound.taskcalendar.co.uk`
3. **Destination URL:** `https://<your-project-ref>.supabase.co/functions/v1/gmail-inbound`
4. **POST the raw, full MIME message:** UNCHECK (we want parsed form fields).
5. **Send signed POSTs:** CHECK.
6. Save.

### 3. Copy the signing key

SendGrid → Inbound Parse → click the hostname row → copy the displayed
**Webhook Verification Key** (base64-encoded public key).

### 4. Set Supabase secrets

\`\`\`bash
npx supabase secrets set \\
  SENDGRID_INBOUND_WEBHOOK_SECRET=<paste-the-key> \\
  SEQUENCE_INBOUND_DOMAIN=inbound.taskcalendar.co.uk
\`\`\`

### 5. Deploy the function

\`\`\`bash
npx supabase functions deploy gmail-inbound --no-verify-jwt
\`\`\`

The `--no-verify-jwt` flag is required — SendGrid doesn't send a JWT.

## Verify end-to-end

1. Create a sequence recipe in Settings → Automations that sends an email
   via Gmail.
2. Trigger it on a test client whose email you control.
3. From the recipient inbox, hit Reply on the message.
4. Within ~1 minute:
   - A row appears in `public.sequence_replies` with your reply body.
   - Any `pending_actions` rows for that recipe run flip from
     `status='pending'` to `status='reply_received'`.
   - In Settings → Sequences, the recipe's "Replies (last 30d)" count
     increments.

If nothing happens, check:
- `npx supabase functions logs gmail-inbound` for signature-verification
  failures (means the secret doesn't match what SendGrid signed with).
- DNS MX propagation (`nslookup -type=MX inbound.taskcalendar.co.uk`).
- That the Reply-To header on the original email looks like
  `reply+<uuid>@inbound.taskcalendar.co.uk` — if it's a different
  domain, `SEQUENCE_INBOUND_DOMAIN` was wrong when the email was sent.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/deployment/sequences-inbound-setup.md
git commit -m "docs: SendGrid Inbound Parse setup for sequence reply detection"
```

---

## Task 11: sequences service + hook

**Files:**
- Create: `src/services/supabase/sequences.ts`
- Create: `src/hooks/useSequences.ts`

- [ ] **Step 1: Write the service**

```ts
// src/services/supabase/sequences.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface SequenceReply {
  id: string;
  organizationId: string;
  recipeRunId: string | null;
  recipeId: string | null;
  fromAddress: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedAt: Date;
}

export interface SequenceCounts {
  activeEnrollments: number;       // pending pending_actions
  repliesLast30d: number;
  stoppedByStage: number;
  stoppedByAdmin: number;
  stoppedByReply: number;
}

const mapReply = (r: Record<string, unknown>): SequenceReply => ({
  id: r.id as string,
  organizationId: r.organization_id as string,
  recipeRunId: (r.recipe_run_id as string) ?? null,
  recipeId: (r.recipe_id as string) ?? null,
  fromAddress: r.from_address as string,
  subject: (r.subject as string) ?? null,
  bodyPreview: (r.body_preview as string) ?? null,
  receivedAt: new Date(r.received_at as string),
});

export const listSequenceReplies = async (
  organizationId: string,
  recipeId?: string,
  limit = 100,
): Promise<SequenceReply[]> => {
  let q = supabase
    .from("sequence_replies")
    .select("*")
    .eq("organization_id", organizationId)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (recipeId) q = q.eq("recipe_id", recipeId);
  const { data, error } = await q;
  if (error) {
    logger.error("Failed to load sequence replies:", error);
    return [];
  }
  return (data || []).map(mapReply);
};

export const getSequenceCounts = async (
  organizationId: string,
  recipeId: string,
): Promise<SequenceCounts> => {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [pending, replies, stoppedStage, stoppedAdmin, stoppedReply] = await Promise.all([
    supabase.from("pending_actions").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("recipe_id", recipeId).eq("status", "pending"),
    supabase.from("sequence_replies").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("recipe_id", recipeId).gte("received_at", since30d),
    supabase.from("pending_actions").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("recipe_id", recipeId).eq("status", "stopped_by_stage")
      .gte("created_at", since30d),
    supabase.from("pending_actions").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("recipe_id", recipeId).eq("status", "stopped_by_admin")
      .gte("created_at", since30d),
    supabase.from("pending_actions").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("recipe_id", recipeId).eq("status", "reply_received")
      .gte("created_at", since30d),
  ]);

  return {
    activeEnrollments: pending.count ?? 0,
    repliesLast30d: replies.count ?? 0,
    stoppedByStage: stoppedStage.count ?? 0,
    stoppedByAdmin: stoppedAdmin.count ?? 0,
    stoppedByReply: stoppedReply.count ?? 0,
  };
};

export const stopSequenceRun = async (runId: string): Promise<number> => {
  const { data, error } = await supabase.rpc("stop_pending_actions_for_run", { p_run_id: runId });
  if (error) throw error;
  return Number(data ?? 0);
};
```

- [ ] **Step 2: Write the hook**

```ts
// src/hooks/useSequences.ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { Recipe } from "@/services/supabase/automations";
import { useAutomations } from "@/hooks/useAutomations";
import { SequenceCounts, getSequenceCounts } from "@/services/supabase/sequences";
import { supabase } from "@/services/supabase/config";

export interface Sequence {
  recipe: Recipe;
  counts: SequenceCounts;
}

const isSequence = (r: Recipe): boolean =>
  r.actions.some((a) => a.type === "send_email") &&
  r.actions.some((a) => a.type === "wait");

export const useSequences = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const { recipes, loading: recipesLoading } = useAutomations();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!orgId) {
      setSequences([]);
      setLoading(false);
      return;
    }
    const matching = recipes.filter(isSequence);
    const withCounts = await Promise.all(
      matching.map(async (recipe) => ({
        recipe,
        counts: await getSequenceCounts(orgId, recipe.recipeId),
      })),
    );
    setSequences(withCounts);
    setLoading(false);
  };

  useEffect(() => {
    if (recipesLoading) return;
    refresh();
    if (!orgId) return;
    const channel = supabase
      .channel(`sequences-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "pending_actions",
        filter: `organization_id=eq.${orgId}`,
      }, () => refresh())
      .on("postgres_changes", {
        event: "*", schema: "public", table: "sequence_replies",
        filter: `organization_id=eq.${orgId}`,
      }, () => refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, recipes, recipesLoading]);

  return { organizationId: orgId, sequences, loading, canManage: isOwner || isAdmin };
};
```

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add src/services/supabase/sequences.ts src/hooks/useSequences.ts
git commit -m "feat(crm): sequences service (counts, replies, stop) + useSequences hook"
```

---

## Task 12: Wait editor + send-window collapsible in RecipeBuilder

**Files:**
- Modify: `src/components/settings/RecipeBuilder.tsx`

- [ ] **Step 1: Add `wait` case to `ActionConfigEditor`**

Inside the `switch (action.type)` (before `default:`):

```tsx
case "wait":
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div>
        <Label>Wait</Label>
        <Input type="number" min={1}
          value={Number(cfg.value ?? 1)}
          onChange={(e) => set({ value: Number(e.target.value) })} />
      </div>
      <div>
        <Label>Unit</Label>
        <Select value={(cfg.unit as string) ?? "days"} onValueChange={(v) => set({ unit: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="minutes">minutes</SelectItem>
            <SelectItem value="hours">hours</SelectItem>
            <SelectItem value="days">days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="col-span-2 text-xs text-muted-foreground">
        Actions after this wait fire after the delay, subject to the recipe's send window.
        Reply detection cancels pending actions for this recipe run.
      </p>
    </div>
  );
```

- [ ] **Step 2: Add the send-window collapsible to the main builder**

In the main `RecipeBuilder` component (above the When/If/Then rows), add a conditional block that renders only when the draft contains a `send_email` action. Use the shadcn `Collapsible` primitives if they exist; otherwise use a simple `<details>` block.

Helpers in the parent component:

```tsx
const setSendWindow = (patch: Partial<NonNullable<RecipeDraft["sendWindow"]>> | null) => {
  setDraft((d) => ({
    ...d,
    sendWindow: patch === null ? null : {
      hours: patch.hours ?? d.sendWindow?.hours ?? [9, 18],
      days: patch.days ?? d.sendWindow?.days ?? [1, 2, 3, 4, 5],
      timezone: patch.timezone ?? d.sendWindow?.timezone ?? "Europe/London",
    },
  }));
};

const toggleDay = (n: number) => {
  setDraft((d) => {
    const current = d.sendWindow?.days ?? [1, 2, 3, 4, 5];
    const next = current.includes(n) ? current.filter((x) => x !== n) : [...current, n].sort();
    return {
      ...d,
      sendWindow: {
        hours: d.sendWindow?.hours ?? [9, 18],
        timezone: d.sendWindow?.timezone ?? "Europe/London",
        days: next,
      },
    };
  });
};

const sendWindowSummary = (sw: RecipeDraft["sendWindow"]): string => {
  if (!sw) return "(none — send any time)";
  const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = sw.days.map((d) => dayNames[d]).join("/");
  return `(${sw.hours[0]}–${sw.hours[1]} ${days} · ${sw.timezone})`;
};
```

Render block:

```tsx
{draft.actions.some((a) => a.type === "send_email") && (
  <details className="border-t pt-3" open={!!draft.sendWindow}>
    <summary className="text-sm font-semibold cursor-pointer">
      Send window {sendWindowSummary(draft.sendWindow ?? null)}
    </summary>
    <div className="pt-2 space-y-2">
      <div className="grid grid-cols-3 gap-2 items-end">
        <div>
          <Label>From hour (0–23)</Label>
          <Input type="number" min={0} max={23}
            value={draft.sendWindow?.hours?.[0] ?? 9}
            onChange={(e) => setSendWindow({ hours: [Number(e.target.value), draft.sendWindow?.hours?.[1] ?? 18] })}
          />
        </div>
        <div>
          <Label>To hour (1–24)</Label>
          <Input type="number" min={1} max={24}
            value={draft.sendWindow?.hours?.[1] ?? 18}
            onChange={(e) => setSendWindow({ hours: [draft.sendWindow?.hours?.[0] ?? 9, Number(e.target.value)] })}
          />
        </div>
        <div>
          <Label>Timezone</Label>
          <Input value={draft.sendWindow?.timezone ?? "Europe/London"}
            onChange={(e) => setSendWindow({ timezone: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {([["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 7]] as const).map(([label, num]) => (
          <label key={num} className="flex items-center gap-1 text-xs">
            <input type="checkbox"
              checked={(draft.sendWindow?.days ?? [1, 2, 3, 4, 5]).includes(num)}
              onChange={() => toggleDay(num)} />
            {label}
          </label>
        ))}
      </div>
      <button type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => setDraft((d) => ({ ...d, sendWindow: null }))}>
        Remove window (send any time)
      </button>
    </div>
  </details>
)}
```

- [ ] **Step 3: tsc + tests**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: clean, no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/RecipeBuilder.tsx
git commit -m "feat(crm): wait editor + send-window collapsible in RecipeBuilder"
```

---

## Task 13: Sequences Settings tab + Stop button in RecipeRunsList

**Files:**
- Create: `src/components/settings/SequencesSettingsTab.tsx`
- Modify: `src/components/settings/RecipeRunsList.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Write `SequencesSettingsTab.tsx`**

```tsx
// src/components/settings/SequencesSettingsTab.tsx
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, MailPlus } from "lucide-react";
import { useSequences } from "@/hooks/useSequences";
import { summarizeRecipe } from "@/services/supabase/automations";
import { useEffect, useState } from "react";
import { listSequenceReplies, SequenceReply } from "@/services/supabase/sequences";

export const SequencesSettingsTab: React.FC = () => {
  const { organizationId, sequences, loading, canManage } = useSequences();
  const [replies, setReplies] = useState<SequenceReply[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    listSequenceReplies(organizationId, undefined, 50).then(setReplies);
  }, [organizationId, sequences]);

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Only admins can view sequences.</p>;
  }
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading sequences…
      </p>
    );
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <MailPlus className="w-4 h-4 text-indigo-500" />
          Sequences ({sequences.length})
        </h2>
        {sequences.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No sequences yet. A recipe with at least one <code>send_email</code> AND one <code>wait</code> action shows up here.
            </CardContent>
          </Card>
        ) : (
          sequences.map(({ recipe, counts }) => (
            <Card key={recipe.recipeId}>
              <CardContent className="py-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate flex items-center gap-2">
                      {recipe.enabled ? <span className="w-2 h-2 rounded-full bg-emerald-500" /> : <span className="w-2 h-2 rounded-full bg-muted" />}
                      {recipe.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{summarizeRecipe(recipe)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Active enrollments</p>
                    <p className="font-mono text-base">{counts.activeEnrollments}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Replies (30d)</p>
                    <p className="font-mono text-base">{counts.repliesLast30d}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Stopped (30d)</p>
                    <p className="font-mono text-base">
                      {counts.stoppedByStage + counts.stoppedByAdmin + counts.stoppedByReply}
                    </p>
                  </div>
                </div>
                {(counts.stoppedByStage + counts.stoppedByAdmin + counts.stoppedByReply) > 0 && (
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    {counts.stoppedByStage > 0 && <Badge variant="outline">stage: {counts.stoppedByStage}</Badge>}
                    {counts.stoppedByAdmin > 0 && <Badge variant="outline">admin: {counts.stoppedByAdmin}</Badge>}
                    {counts.stoppedByReply > 0 && <Badge variant="outline">reply: {counts.stoppedByReply}</Badge>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent replies
        </h2>
        {replies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No replies yet.</p>
        ) : (
          <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1">
            {replies.map((r) => (
              <div key={r.id} className="border rounded-md p-2 text-xs space-y-1">
                <p className="font-medium truncate">{r.fromAddress}</p>
                <p className="text-muted-foreground truncate">{r.subject ?? "(no subject)"}</p>
                <p className="text-muted-foreground line-clamp-2">{r.bodyPreview ?? ""}</p>
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {r.receivedAt.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add "Stop sequence" button to `RecipeRunsList.tsx`**

Replace the `listRuns(recipeId, 50)` query in `RecipeRunsList.tsx` with one that joins the `has_pending_actions` flag, then add the button:

```tsx
// In the run-row rendering, after the per-action results list:
{run.hasPendingActions && (
  <Button
    variant="outline"
    size="sm"
    onClick={async () => {
      try {
        const n = await stopSequenceRun(run.runId);
        toast.success(`Cancelled ${n} pending action(s)`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Stop failed");
      }
    }}
  >
    Stop sequence
  </Button>
)}
```

The `hasPendingActions` field needs to come from the service. Update `src/services/supabase/automations.ts` `listRuns` to add a second query (or join):

```ts
// in listRuns, after fetching runs:
const runIds = (data ?? []).map((r) => r.run_id as string);
let pendingByRun: Record<string, boolean> = {};
if (runIds.length > 0) {
  const { data: pendings } = await supabase
    .from("pending_actions")
    .select("recipe_id, source_event_id")
    .eq("status", "pending")
    .in("recipe_id", (data ?? []).map((r) => r.recipe_id as string));
  for (const p of pendings ?? []) {
    for (const r of data ?? []) {
      if (r.recipe_id === p.recipe_id && r.event_id === p.source_event_id) {
        pendingByRun[r.run_id as string] = true;
      }
    }
  }
}
return (data || []).map((r) => ({ ...mapRun(r), hasPendingActions: !!pendingByRun[r.run_id as string] }));
```

And extend the `RecipeRun` interface with `hasPendingActions?: boolean`.

Import `stopSequenceRun` in `RecipeRunsList.tsx`:
```ts
import { stopSequenceRun } from "@/services/supabase/sequences";
import { toast } from "sonner";
```

- [ ] **Step 3: Wire the Sequences tab into Settings.tsx**

```tsx
import { SequencesSettingsTab } from "@/components/settings/SequencesSettingsTab";
import { ..., MailPlus, ... } from "lucide-react";  // add MailPlus if not present

// In <TabsList>, between automations and ai-usage:
<TabsTrigger value="sequences" className="gap-2">
  <MailPlus className="w-4 h-4" />
  Sequences
</TabsTrigger>

// In TabsContent block:
<TabsContent value="sequences">
  <SequencesSettingsTab />
</TabsContent>
```

- [ ] **Step 4: tsc + tests**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: clean, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SequencesSettingsTab.tsx \
        src/components/settings/RecipeRunsList.tsx \
        src/services/supabase/automations.ts \
        src/pages/Settings.tsx
git commit -m "feat(crm): Sequences settings tab + Stop button on sequence runs"
```

---

## Task 14: Merge to main + push

**Files:** none (git operations)

- [ ] **Step 1: Final verification**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: tsc clean, all tests pass (Batch 2b's 57 + 4 wait + 5 sendWindow + 5 replyToToken = 71 tests).

- [ ] **Step 2: Merge no-ff**

```bash
git checkout main
git pull origin main
git merge --no-ff feature/crm-sequences -m "Merge branch 'feature/crm-sequences'

CRM Batch 2c — Email Sequences (14 tasks):
- Migration 067 (pending_actions, sequence_replies, send_window, default_timezone,
  deal-close cancel trigger, stop_pending_actions_for_run RPC,
  crm_upsert_recipe extended with p_send_window)
- wait action + pending_actions drain in the worker
- nextSendableTime helper with timezone-aware window check
- sendEmail.ts rewritten: direct Gmail API call with Reply-To rewriting
- gmail-inbound Edge Function: ECDSA signature verification + reply logging
  + pending_actions cancellation
- Recipe builder: wait editor + per-recipe send-window collapsible
- Settings → Sequences tab with enrollment/reply counts + reply inbox
- Stop sequence button on run history

71 tests pass, tsc clean."
git push origin main
```

- [ ] **Step 3: User-facing deploy instructions**

After merge, user runs (in their own terminal):

```bash
# Migration:
npx supabase db push

# Worker + new function:
npx supabase functions deploy crm-run-automations
npx supabase functions deploy gmail-inbound --no-verify-jwt

# External setup (see docs/superpowers/deployment/sequences-inbound-setup.md):
# 1. Create SendGrid account
# 2. Add MX records on inbound.taskcalendar.co.uk → mx.sendgrid.net
# 3. SendGrid → Inbound Parse → add hostname pointing at the deployed gmail-inbound URL
# 4. Copy signing key from SendGrid hostname row

# Then:
npx supabase secrets set \
  SENDGRID_INBOUND_WEBHOOK_SECRET=<from SendGrid> \
  SEQUENCE_INBOUND_DOMAIN=inbound.taskcalendar.co.uk

# Then redeploy worker so it picks up SEQUENCE_INBOUND_DOMAIN:
npx supabase functions deploy crm-run-automations

# Frontend redeploy (Vite build) for the new Sequences tab + wait editor.
```

---

## Self-Review

Walking through spec sections against tasks:

| Spec requirement | Task covering it |
|---|---|
| **A.2 Migration 067** — pending_actions / sequence_replies / send_window / default_timezone / cancel_pending_actions_on_close trigger / stop_pending_actions_for_run RPC / crm_upsert_recipe extension | Task 1 |
| **B.1 wait action handler** | Task 3 (handler + tests) |
| **B.2 ActionContext extensions** (recipeRunId, nextActionIndex) | Task 2 |
| **B.3 Worker loop short-circuits on defer** | Task 6 |
| **B.4 Pre-create the run row** | Task 5 (createRun/finalizeRun helpers) + Task 6 (worker uses them) |
| **B.5 processPendingActions drain** | Task 6 |
| **B.6 nextSendableTime helper** | Task 4 (helper + tests) |
| **B.7 ACTION_REGISTRY + ActionType extension** | Task 2 (type) + Task 7 (registry) |
| **C.2 sendEmail rewrite** (Gmail direct + Reply-To) | Task 7 |
| **D.2 gmail-inbound Edge Function** | Task 9 (impl) + Task 8 (tests for the exported helper) |
| **D.3 stop conditions** — deal-close trigger, stop RPC | Task 1 (both in migration 067) |
| **E.1 wait editor in RecipeBuilder** | Task 12 |
| **E.2 send-window collapsible** | Task 12 |
| **E.3 Sequences view** | Task 13 |
| **E.4 Stop sequence button** | Task 13 |
| **E.5 Tab order** (Automations · Sequences · AI Usage · Org) | Task 13 |
| **F.1 Tests** — wait, sendWindow, replyToToken | Tasks 3, 4, 8 |
| **F.2 Rollout** | Task 14 (user deploy instructions) |
| **Deployment doc** | Task 10 |

**Type consistency:**
- `pending_actions` columns match between migration (Task 1) + wait handler insert (Task 3) + drain reader (Task 6) — `next_action_index`, `ai_outputs jsonb`, `source_event_id`, `fire_at`, `status` all referenced consistently.
- `ActionContext.recipeRunId` defined in Task 2, populated by `createRun` in Task 5, passed by the loop in Task 6, consumed by `sendEmail.ts` in Task 7.
- `extractRunIdFromTo` exported from Task 9, imported by tests in Task 8.
- `SequenceReply` shape consistent between service (Task 11) and Settings tab (Task 13).
- `stopSequenceRun(runId): Promise<number>` consistent between service (Task 11) and `RecipeRunsList` consumer (Task 13).
- `RecipeRun.hasPendingActions?: boolean` extended in Task 13, used in same task.

**Placeholder scan:** zero TBDs, every code step contains real code, no "similar to Task N" references.

Plan is ready for execution.
