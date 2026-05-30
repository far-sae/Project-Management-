# CRM Automation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a configurable recipe automation engine for the TaskCalendar CRM — DB triggers enqueue events, a 60-second cron Edge Function drains the queue, evaluates per-org recipes, and runs nine action types (six internal + webhook + Slack + email).

**Architecture:** Async event-queue: DB triggers on `deals`, `clients`, `form_submissions` insert into `automation_events`; a Deno Edge Function `crm-run-automations` runs every minute, claims a batch with an advisory lock, evaluates trigger config + conditions per recipe, executes ordered actions, writes per-run history to `automation_runs`. Slack/email actions delegate to the existing `integrations-action` Edge Function and skip cleanly when the integration isn't configured. Loop prevention via per-recipe burst detection (auto-disable if >100 runs in 60s).

**Tech Stack:** Supabase Postgres + Edge Functions (Deno), React + Vite + TypeScript, shadcn/ui, vitest. Reuses patterns from Batch 1: realtime channels, SECURITY DEFINER RPCs, `is_org_admin`/`is_org_member` gates, partial unique indexes, error-code translation.

**Note on env:** working dir `c:/Users/faraz/task/Project-Management-`, branch (to be created) `feature/crm-automation-engine`, parent `main`. The user has opted into `supabase db push` against remote production, so migrations should be production-safe (idempotent, no destructive defaults, no long-running locks).

---

## File Structure

**Created:**
- `supabase/migrations/065_automation_engine.sql` — tables, helper RPCs, DB triggers, RLS
- `supabase/functions/crm-run-automations/index.ts` — top-level handler
- `supabase/functions/crm-run-automations/shared/client.ts` — admin Supabase client factory
- `supabase/functions/crm-run-automations/shared/types.ts` — shared types
- `supabase/functions/crm-run-automations/shared/runLog.ts` — writes `automation_runs` rows
- `supabase/functions/crm-run-automations/shared/substitute.ts` — `{{placeholder}}` engine
- `supabase/functions/crm-run-automations/triggers/matchers.ts` — trigger_config matcher
- `supabase/functions/crm-run-automations/triggers/cron.ts` — `task_overdue` + `scheduled` enqueue
- `supabase/functions/crm-run-automations/conditions/evaluator.ts` — conditions[] evaluator
- `supabase/functions/crm-run-automations/actions/index.ts` — action registry
- `supabase/functions/crm-run-automations/actions/createTask.ts`
- `supabase/functions/crm-run-automations/actions/tagClient.ts`
- `supabase/functions/crm-run-automations/actions/setField.ts`
- `supabase/functions/crm-run-automations/actions/changeOwner.ts`
- `supabase/functions/crm-run-automations/actions/addNote.ts`
- `supabase/functions/crm-run-automations/actions/moveDealStage.ts`
- `supabase/functions/crm-run-automations/actions/webhook.ts`
- `supabase/functions/crm-run-automations/actions/slackPost.ts`
- `supabase/functions/crm-run-automations/actions/sendEmail.ts`
- `src/services/supabase/automations.ts` — types + CRUD + constants for the UI
- `src/hooks/useAutomations.ts` — list + realtime subscription
- `src/components/settings/AutomationsSettingsTab.tsx` — outer settings tab
- `src/components/settings/RecipeBuilder.tsx` — modal sentence-builder
- `src/components/settings/RecipeRunsList.tsx` — run history side-panel
- `tests/unit/automations.test.ts` — service validation
- `tests/unit/conditionEvaluator.test.ts`
- `tests/unit/triggerMatchers.test.ts`
- `tests/unit/substitute.test.ts`

**Modified:**
- `src/pages/Settings.tsx` — add Automations tab
- `supabase/functions/crm-rotate-turnstile-salt/index.ts` — add two cleanup DELETEs

---

## Task 1: Migration 065 — tables, RLS, helper RPCs (no DB triggers yet)

**Files:**
- Create: `supabase/migrations/065_automation_engine.sql`

- [ ] **Step 1: Create the migration file with tables and RLS**

```sql
-- 065_automation_engine.sql
-- CRM automation engine: per-org recipes, event queue, run history, worker heartbeat.
-- DB triggers + cleanup hooks land in a later append within this same file.

create table if not exists public.automation_recipes (
  recipe_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  name text not null,
  description text,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null,
  enabled boolean not null default true,
  run_count int not null default 0,
  fail_count int not null default 0,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organization_id, name)
);

create index if not exists automation_recipes_org_enabled_idx
  on public.automation_recipes(organization_id, trigger_type)
  where enabled;

create table if not exists public.automation_events (
  event_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  source_table text,
  source_id uuid,
  depth int not null default 0,
  enqueued_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists automation_events_pending_idx
  on public.automation_events(organization_id, enqueued_at)
  where processed_at is null;

create table if not exists public.automation_runs (
  run_id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null
    references public.automation_recipes(recipe_id) on delete cascade,
  event_id uuid references public.automation_events(event_id) on delete set null,
  organization_id uuid not null,
  status text not null check (status in ('success','failure','skipped','partial')),
  action_results jsonb not null default '[]'::jsonb,
  started_at timestamptz not null,
  finished_at timestamptz not null
);

create index if not exists automation_runs_recipe_time_idx
  on public.automation_runs(recipe_id, started_at desc);

create index if not exists automation_runs_org_time_idx
  on public.automation_runs(organization_id, started_at desc);

create table if not exists public.automation_worker_heartbeat (
  id smallint primary key default 1 check (id = 1),
  last_run_at timestamptz not null,
  last_batch_size int not null,
  last_duration_ms int not null
);

-- Atomic counter bump used by the worker after each recipe run.
create or replace function public.increment_recipe_counters(
  p_recipe_id uuid,
  p_failed boolean
) returns void
language sql security definer
set search_path = public, pg_temp as $$
  update public.automation_recipes
  set run_count  = run_count + 1,
      fail_count = fail_count + (case when p_failed then 1 else 0 end),
      last_run_at = now(),
      updated_at  = now()
  where recipe_id = p_recipe_id;
$$;

grant execute on function public.increment_recipe_counters(uuid, boolean)
  to service_role;

-- Auto-disable used by the worker when burst detection trips.
create or replace function public.disable_recipe_for_runaway(p_recipe_id uuid)
returns void
language sql security definer
set search_path = public, pg_temp as $$
  update public.automation_recipes
  set enabled = false, updated_at = now()
  where recipe_id = p_recipe_id;
$$;

grant execute on function public.disable_recipe_for_runaway(uuid)
  to service_role;

-- Admin-only CRUD via SECURITY DEFINER. The frontend calls these; direct
-- writes through PostgREST are forbidden by the absence of write policies.
create or replace function public.crm_upsert_recipe(
  p_recipe_id uuid,             -- null on create
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_trigger_config jsonb,
  p_conditions jsonb,
  p_actions jsonb,
  p_enabled boolean
) returns public.automation_recipes
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_row public.automation_recipes;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Recipe name is required' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_actions, '[]'::jsonb)) = 0 then
    raise exception 'Recipe must have at least one action' using errcode = '22023';
  end if;

  if p_recipe_id is null then
    insert into public.automation_recipes (
      organization_id, name, description, trigger_type, trigger_config,
      conditions, actions, enabled, created_by
    ) values (
      p_organization_id, btrim(p_name), p_description, p_trigger_type,
      coalesce(p_trigger_config, '{}'::jsonb),
      coalesce(p_conditions, '[]'::jsonb),
      p_actions,
      coalesce(p_enabled, true),
      auth.uid()
    )
    returning * into v_row;
  else
    update public.automation_recipes
    set name = btrim(p_name),
        description = p_description,
        trigger_type = p_trigger_type,
        trigger_config = coalesce(p_trigger_config, '{}'::jsonb),
        conditions = coalesce(p_conditions, '[]'::jsonb),
        actions = p_actions,
        enabled = coalesce(p_enabled, true),
        updated_at = now()
    where recipe_id = p_recipe_id
      and organization_id = p_organization_id
    returning * into v_row;
    if v_row.recipe_id is null then
      raise exception 'Recipe not found' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.crm_upsert_recipe(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, boolean)
  to authenticated;

create or replace function public.crm_delete_recipe(p_recipe_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.automation_recipes where recipe_id = p_recipe_id;
  if v_org is null then return; end if;
  if not public.is_org_admin(v_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.automation_recipes where recipe_id = p_recipe_id;
end;
$$;

grant execute on function public.crm_delete_recipe(uuid) to authenticated;

-- RLS: members read, no direct writes (use the RPCs above).
alter table public.automation_recipes enable row level security;
alter table public.automation_runs    enable row level security;

drop policy if exists "automation_recipes read for org members" on public.automation_recipes;
create policy "automation_recipes read for org members"
  on public.automation_recipes for select
  using (public.is_org_member(organization_id));

drop policy if exists "automation_runs read for org members" on public.automation_runs;
create policy "automation_runs read for org members"
  on public.automation_runs for select
  using (public.is_org_member(organization_id));

-- automation_events: service role only, no public access. RLS enabled with no
-- policies means PostgREST consumers see nothing.
alter table public.automation_events enable row level security;
```

- [ ] **Step 2: Commit**

```bash
git checkout -b feature/crm-automation-engine
git add supabase/migrations/065_automation_engine.sql
git commit -m "feat(crm): automation engine tables + CRUD RPCs"
```

---

## Task 2: Migration 065 (append) — DB triggers for event enqueueing

**Files:**
- Modify: `supabase/migrations/065_automation_engine.sql` (append to end)

- [ ] **Step 1: Append the DB trigger functions and triggers**

Append this to the end of `supabase/migrations/065_automation_engine.sql`:

```sql
-- ===========================================================================
-- DB triggers that enqueue automation_events. These all use AFTER triggers
-- so they see the committed row. Each function inserts 0..N events depending
-- on what changed.
-- ===========================================================================

-- Deal update: emits deal_stage_entered and/or deal_field_changed.
create or replace function public.automation_enqueue_deal_update()
returns trigger language plpgsql as $$
declare
  v_payload jsonb;
  v_changed jsonb := '[]'::jsonb;
begin
  if new.stage_id is distinct from old.stage_id then
    insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
    values (
      new.organization_id, 'deal_stage_entered',
      jsonb_build_object(
        'deal_id', new.deal_id,
        'client_id', new.client_id,
        'stage_id', new.stage_id,
        'prev_stage_id', old.stage_id,
        'pipeline_id', new.pipeline_id,
        'value', new.value,
        'currency', new.currency,
        'owner_id', new.owner_id,
        'title', new.title
      ),
      'deals', new.deal_id
    );
  end if;

  if new.value is distinct from old.value then
    v_changed := v_changed || jsonb_build_array('value');
  end if;
  if new.owner_id is distinct from old.owner_id then
    v_changed := v_changed || jsonb_build_array('owner_id');
  end if;
  if new.expected_close_date is distinct from old.expected_close_date then
    v_changed := v_changed || jsonb_build_array('expected_close_date');
  end if;
  if new.probability is distinct from old.probability then
    v_changed := v_changed || jsonb_build_array('probability');
  end if;

  if jsonb_array_length(v_changed) > 0 then
    insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
    values (
      new.organization_id, 'deal_field_changed',
      jsonb_build_object(
        'deal_id', new.deal_id,
        'client_id', new.client_id,
        'changed_fields', v_changed,
        'new_values', jsonb_build_object(
          'value', new.value,
          'owner_id', new.owner_id,
          'expected_close_date', new.expected_close_date,
          'probability', new.probability,
          'currency', new.currency
        ),
        'old_values', jsonb_build_object(
          'value', old.value,
          'owner_id', old.owner_id,
          'expected_close_date', old.expected_close_date,
          'probability', old.probability,
          'currency', old.currency
        )
      ),
      'deals', new.deal_id
    );
  end if;

  return null;
end;
$$;

drop trigger if exists automation_enqueue_deal_update_t on public.deals;
create trigger automation_enqueue_deal_update_t
  after update on public.deals
  for each row execute function public.automation_enqueue_deal_update();

-- Client insert: emits client_created.
create or replace function public.automation_enqueue_client_insert()
returns trigger language plpgsql as $$
begin
  insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
  values (
    new.organization_id, 'client_created',
    jsonb_build_object('client_id', new.client_id, 'name', new.name, 'type', new.type, 'source', new.source),
    'clients', new.client_id
  );
  return null;
end;
$$;

drop trigger if exists automation_enqueue_client_insert_t on public.clients;
create trigger automation_enqueue_client_insert_t
  after insert on public.clients
  for each row execute function public.automation_enqueue_client_insert();

-- Client update: emits deal_score_band_changed and/or client_tagged (one event per new tag).
create or replace function public.automation_enqueue_client_update()
returns trigger language plpgsql as $$
declare
  v_added text[];
  t text;
begin
  if new.score_band is distinct from old.score_band then
    insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
    values (
      new.organization_id, 'deal_score_band_changed',
      jsonb_build_object(
        'client_id', new.client_id,
        'new_band', new.score_band,
        'prev_band', old.score_band,
        'score', new.score
      ),
      'clients', new.client_id
    );
  end if;

  v_added := array(
    select unnest(coalesce(new.tags, '{}'::text[]))
    except
    select unnest(coalesce(old.tags, '{}'::text[]))
  );

  foreach t in array v_added loop
    insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
    values (
      new.organization_id, 'client_tagged',
      jsonb_build_object('client_id', new.client_id, 'tag', t),
      'clients', new.client_id
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists automation_enqueue_client_update_t on public.clients;
create trigger automation_enqueue_client_update_t
  after update on public.clients
  for each row execute function public.automation_enqueue_client_update();

-- Form submission insert: emits form_submitted (only for non-rejected non-honeypot rows).
create or replace function public.automation_enqueue_form_submission()
returns trigger language plpgsql as $$
begin
  if new.rejected_reason is null and not coalesce(new.honeypot_tripped, false) then
    insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
    values (
      new.organization_id, 'form_submitted',
      jsonb_build_object(
        'submission_id', new.submission_id,
        'form_id', new.form_id,
        'form_slug', new.form_slug,
        'client_id', new.client_id,
        'deal_id', new.deal_id
      ),
      'form_submissions', new.submission_id
    );
  end if;
  return null;
end;
$$;

drop trigger if exists automation_enqueue_form_submission_t on public.form_submissions;
create trigger automation_enqueue_form_submission_t
  after insert on public.form_submissions
  for each row execute function public.automation_enqueue_form_submission();
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/065_automation_engine.sql
git commit -m "feat(crm): DB triggers that enqueue automation_events"
```

---

## Task 3: Service module + types + tests

**Files:**
- Create: `src/services/supabase/automations.ts`
- Create: `tests/unit/automations.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/automations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TRIGGER_TYPES,
  ACTION_TYPES,
  validateRecipeDraft,
  summarizeRecipe,
} from "@/services/supabase/automations";

describe("automations service", () => {
  it("rejects empty name", () => {
    expect(() => validateRecipeDraft({
      name: "", enabled: true,
      trigger: { type: "deal_stage_entered", config: {} },
      conditions: [], actions: [{ type: "create_task", config: { title: "x" } }],
    })).toThrow();
  });

  it("rejects empty actions array", () => {
    expect(() => validateRecipeDraft({
      name: "x", enabled: true,
      trigger: { type: "deal_stage_entered", config: {} },
      conditions: [], actions: [],
    })).toThrow();
  });

  it("rejects unknown trigger type", () => {
    expect(() => validateRecipeDraft({
      name: "x", enabled: true,
      trigger: { type: "bogus" as any, config: {} },
      conditions: [], actions: [{ type: "create_task", config: { title: "x" } }],
    })).toThrow();
  });

  it("accepts a valid minimal recipe", () => {
    expect(() => validateRecipeDraft({
      name: "Won handoff", enabled: true,
      trigger: { type: "deal_stage_entered", config: { stage_id: "abc" } },
      conditions: [],
      actions: [{ type: "create_task", config: { title: "Kickoff", assignee: "deal_owner", due_in_days: 3 } }],
    })).not.toThrow();
  });

  it("summarizes a recipe into a sentence", () => {
    expect(summarizeRecipe({
      trigger_type: "deal_stage_entered",
      actions: [{ type: "create_task" }, { type: "slack_post" }],
    } as any)).toBe("When deal enters stage, then create task, post to Slack");
  });

  it("includes every registered trigger and action", () => {
    expect(TRIGGER_TYPES).toContain("deal_stage_entered");
    expect(TRIGGER_TYPES).toContain("scheduled");
    expect(ACTION_TYPES).toContain("create_task");
    expect(ACTION_TYPES).toContain("send_email");
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `npm test -- automations.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Write the service**

`src/services/supabase/automations.ts`:

```ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export const TRIGGER_TYPES = [
  "deal_stage_entered",
  "deal_score_band_changed",
  "deal_field_changed",
  "form_submitted",
  "client_created",
  "client_tagged",
  "task_overdue",
  "scheduled",
] as const;

export const ACTION_TYPES = [
  "create_task",
  "tag",
  "set_field",
  "change_owner",
  "add_note",
  "move_deal_stage",
  "webhook",
  "slack_post",
  "send_email",
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type ActionType = (typeof ACTION_TYPES)[number];

export interface RecipeCondition {
  field: string;
  operator: "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in" | "contains" | "exists";
  value: unknown;
}

export interface RecipeAction {
  type: ActionType;
  config: Record<string, unknown>;
}

export interface RecipeDraft {
  name: string;
  description?: string | null;
  enabled: boolean;
  trigger: { type: TriggerType; config: Record<string, unknown> };
  conditions: RecipeCondition[];
  actions: RecipeAction[];
}

export interface Recipe {
  recipeId: string;
  organizationId: string;
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  conditions: RecipeCondition[];
  actions: RecipeAction[];
  enabled: boolean;
  runCount: number;
  failCount: number;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipeRun {
  runId: string;
  recipeId: string;
  eventId: string | null;
  organizationId: string;
  status: "success" | "failure" | "skipped" | "partial";
  actionResults: Array<{
    type: ActionType;
    status: "success" | "failure" | "skipped";
    duration_ms?: number;
    message?: string | null;
    meta?: Record<string, unknown>;
  }>;
  startedAt: Date;
  finishedAt: Date;
}

export const validateRecipeDraft = (draft: RecipeDraft): void => {
  if (!draft.name || !draft.name.trim()) {
    throw new Error("Recipe name is required");
  }
  if (!TRIGGER_TYPES.includes(draft.trigger.type)) {
    throw new Error(`Unknown trigger type: ${draft.trigger.type}`);
  }
  if (!Array.isArray(draft.actions) || draft.actions.length === 0) {
    throw new Error("Recipe must have at least one action");
  }
  for (const a of draft.actions) {
    if (!ACTION_TYPES.includes(a.type)) {
      throw new Error(`Unknown action type: ${a.type}`);
    }
    if (a.type === "create_task" && !(a.config?.title as string)?.trim()) {
      throw new Error("create_task requires a title");
    }
    if (a.type === "webhook" && !(a.config?.url as string)) {
      throw new Error("webhook requires a url");
    }
    if (a.type === "slack_post" && !(a.config?.channel_id as string)) {
      throw new Error("slack_post requires a channel_id");
    }
    if (a.type === "send_email") {
      const cfg = a.config as Record<string, unknown> | undefined;
      if (!cfg?.to || !cfg?.subject) {
        throw new Error("send_email requires `to` and `subject`");
      }
    }
  }
};

const TRIGGER_LABELS: Record<TriggerType, string> = {
  deal_stage_entered: "deal enters stage",
  deal_score_band_changed: "deal score band changes",
  deal_field_changed: "deal field changes",
  form_submitted: "form is submitted",
  client_created: "client is created",
  client_tagged: "client is tagged",
  task_overdue: "task becomes overdue",
  scheduled: "scheduled time",
};

const ACTION_LABELS: Record<ActionType, string> = {
  create_task: "create task",
  tag: "tag client",
  set_field: "set field",
  change_owner: "change owner",
  add_note: "add note",
  move_deal_stage: "move deal",
  webhook: "call webhook",
  slack_post: "post to Slack",
  send_email: "send email",
};

export const summarizeRecipe = (r: Pick<Recipe, "triggerType" | "actions">): string => {
  const t = TRIGGER_LABELS[r.triggerType] ?? r.triggerType;
  const a = r.actions.map((x) => ACTION_LABELS[x.type] ?? x.type).join(", ");
  return `When ${t}, then ${a}`;
};

const mapRecipe = (row: Record<string, unknown>): Recipe => ({
  recipeId: row.recipe_id as string,
  organizationId: row.organization_id as string,
  name: row.name as string,
  description: (row.description as string) ?? null,
  triggerType: row.trigger_type as TriggerType,
  triggerConfig: (row.trigger_config as Record<string, unknown>) ?? {},
  conditions: Array.isArray(row.conditions) ? (row.conditions as RecipeCondition[]) : [],
  actions: Array.isArray(row.actions) ? (row.actions as RecipeAction[]) : [],
  enabled: Boolean(row.enabled),
  runCount: Number(row.run_count ?? 0),
  failCount: Number(row.fail_count ?? 0),
  lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const mapRun = (row: Record<string, unknown>): RecipeRun => ({
  runId: row.run_id as string,
  recipeId: row.recipe_id as string,
  eventId: (row.event_id as string) ?? null,
  organizationId: row.organization_id as string,
  status: row.status as RecipeRun["status"],
  actionResults: Array.isArray(row.action_results) ? (row.action_results as RecipeRun["actionResults"]) : [],
  startedAt: new Date(row.started_at as string),
  finishedAt: new Date(row.finished_at as string),
});

export const listRecipes = async (organizationId: string): Promise<Recipe[]> => {
  const { data, error } = await supabase
    .from("automation_recipes")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) {
    logger.error("Failed to load automation recipes:", error);
    return [];
  }
  return (data || []).map(mapRecipe);
};

export const upsertRecipe = async (
  organizationId: string,
  recipeId: string | null,
  draft: RecipeDraft,
): Promise<Recipe> => {
  validateRecipeDraft(draft);
  const { data, error } = await supabase.rpc("crm_upsert_recipe", {
    p_recipe_id: recipeId,
    p_organization_id: organizationId,
    p_name: draft.name,
    p_description: draft.description ?? null,
    p_trigger_type: draft.trigger.type,
    p_trigger_config: draft.trigger.config,
    p_conditions: draft.conditions,
    p_actions: draft.actions,
    p_enabled: draft.enabled,
  }).single();
  if (error) throw error;
  return mapRecipe(data as Record<string, unknown>);
};

export const deleteRecipe = async (recipeId: string): Promise<void> => {
  const { error } = await supabase.rpc("crm_delete_recipe", { p_recipe_id: recipeId });
  if (error) throw error;
};

export const setRecipeEnabled = async (recipeId: string, enabled: boolean): Promise<void> => {
  // Use the upsert RPC indirectly by loading + re-saving; cheap and avoids a second RPC.
  // For toggle UX we expose this thin wrapper that the AutomationsSettingsTab calls.
  const { data, error: loadErr } = await supabase
    .from("automation_recipes")
    .select("*")
    .eq("recipe_id", recipeId)
    .maybeSingle();
  if (loadErr || !data) throw loadErr ?? new Error("Recipe not found");
  await upsertRecipe(data.organization_id, recipeId, {
    name: data.name,
    description: data.description,
    enabled,
    trigger: { type: data.trigger_type, config: data.trigger_config ?? {} },
    conditions: data.conditions ?? [],
    actions: data.actions ?? [],
  });
};

export const listRuns = async (
  recipeId: string,
  limit = 50,
): Promise<RecipeRun[]> => {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("*")
    .eq("recipe_id", recipeId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    logger.error("Failed to load automation runs:", error);
    return [];
  }
  return (data || []).map(mapRun);
};
```

- [ ] **Step 4: Run tests**

Run: `npm test -- automations.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: 6 tests pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/supabase/automations.ts tests/unit/automations.test.ts
git commit -m "feat(crm): automations service + validation + tests"
```

---

## Task 4: useAutomations hook

**Files:**
- Create: `src/hooks/useAutomations.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { Recipe, listRecipes } from "@/services/supabase/automations";
import { supabase } from "@/services/supabase/config";

export const useAutomations = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setRecipes([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listRecipes(orgId).then((next) => {
      if (cancelled) return;
      setRecipes(next);
      setLoading(false);
    });
    const channel = supabase
      .channel(`automation-recipes-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "automation_recipes",
        filter: `organization_id=eq.${orgId}`,
      }, () => listRecipes(orgId).then(setRecipes))
      .subscribe();
    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [orgId]);

  return { organizationId: orgId, recipes, loading, canManage: isOwner || isAdmin };
};
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/hooks/useAutomations.ts
git commit -m "feat(crm): useAutomations hook"
```

---

## Task 5: Edge Function — shared scaffolding

**Files:**
- Create: `supabase/functions/crm-run-automations/shared/types.ts`
- Create: `supabase/functions/crm-run-automations/shared/client.ts`
- Create: `supabase/functions/crm-run-automations/shared/runLog.ts`
- Create: `supabase/functions/crm-run-automations/shared/substitute.ts`
- Create: `tests/unit/substitute.test.ts`

- [ ] **Step 1: types.ts**

```ts
// supabase/functions/crm-run-automations/shared/types.ts
export type TriggerType =
  | "deal_stage_entered" | "deal_score_band_changed" | "deal_field_changed"
  | "form_submitted" | "client_created" | "client_tagged"
  | "task_overdue" | "scheduled";

export type ActionType =
  | "create_task" | "tag" | "set_field" | "change_owner"
  | "add_note" | "move_deal_stage" | "webhook" | "slack_post" | "send_email";

export type RunStatus = "success" | "failure" | "skipped" | "partial";

export interface AutomationEvent {
  event_id: string;
  organization_id: string;
  event_type: TriggerType;
  payload: Record<string, unknown>;
  source_table: string | null;
  source_id: string | null;
  depth: number;
  enqueued_at: string;
  processed_at: string | null;
}

export interface Recipe {
  recipe_id: string;
  organization_id: string;
  name: string;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  conditions: Array<{ field: string; operator: string; value: unknown }>;
  actions: Array<{ type: ActionType; config: Record<string, unknown> }>;
}

export interface ActionResult {
  type: ActionType;
  status: "success" | "failure" | "skipped";
  duration_ms?: number;
  message?: string | null;
  meta?: Record<string, unknown>;
}

export interface ActionContext {
  admin: any;            // SupabaseClient — kept loose because deno types differ
  orgId: string;
  event: AutomationEvent;
  recipeId: string;
  recipeName: string;
  runStartedAt: Date;
}

export type ActionHandler = (
  ctx: ActionContext,
  config: Record<string, unknown>,
) => Promise<ActionResult>;
```

- [ ] **Step 2: client.ts**

```ts
// supabase/functions/crm-run-automations/shared/client.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://app.taskcalendar.com";

export const makeAdmin = () =>
  createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
```

- [ ] **Step 3: runLog.ts**

```ts
// supabase/functions/crm-run-automations/shared/runLog.ts
import { ActionResult, RunStatus } from "./types.ts";

export const overallStatus = (results: ActionResult[]): RunStatus => {
  if (results.some((r) => r.status === "failure")) return "failure";
  if (results.length > 0 && results.every((r) => r.status === "skipped")) return "skipped";
  if (results.some((r) => r.status === "skipped")) return "partial";
  return "success";
};

export const writeRun = async (
  admin: any,
  args: {
    recipeId: string;
    eventId: string;
    organizationId: string;
    results: ActionResult[];
    startedAt: Date;
    finishedAt: Date;
  },
): Promise<void> => {
  const status = overallStatus(args.results);
  await admin.from("automation_runs").insert({
    recipe_id: args.recipeId,
    event_id: args.eventId,
    organization_id: args.organizationId,
    status,
    action_results: args.results,
    started_at: args.startedAt.toISOString(),
    finished_at: args.finishedAt.toISOString(),
  });
  await admin.rpc("increment_recipe_counters", {
    p_recipe_id: args.recipeId,
    p_failed: status === "failure",
  });
};
```

- [ ] **Step 4: substitute.ts with failing tests**

`tests/unit/substitute.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// Note: substitute.ts lives in the deno-targeted Edge Function folder; the test
// imports it via a relative path. Vitest with TypeScript handles .ts imports.
import { substitute } from "../../supabase/functions/crm-run-automations/shared/substitute.ts";

describe("substitute", () => {
  it("replaces known placeholders", () => {
    expect(substitute("Hello {{client.name}}", { client: { name: "Acme" } } as any))
      .toBe("Hello Acme");
  });

  it("passes through unknown placeholders unchanged", () => {
    expect(substitute("{{not.a.thing}}", {} as any)).toBe("{{not.a.thing}}");
  });

  it("handles missing context paths gracefully", () => {
    expect(substitute("X {{deal.title}} Y", { deal: undefined } as any))
      .toBe("X {{deal.title}} Y");
  });

  it("supports actor and recipe placeholders", () => {
    expect(substitute("by {{actor}} for {{recipe.name}}",
      { actor: "Faraz", recipe: { name: "Won handoff" } } as any))
      .toBe("by Faraz for Won handoff");
  });
});
```

`supabase/functions/crm-run-automations/shared/substitute.ts`:

```ts
// Mustache-lite. Resolves dotted paths into the provided ctx object.
// Unknown placeholders pass through unchanged so a typo doesn't kill a run.

export interface SubstituteContext {
  deal?: { title?: string; value?: number; currency?: string; stage?: string; url?: string };
  client?: { name?: string; email?: string; industry?: string; url?: string };
  actor?: string;
  recipe?: { name?: string };
  [k: string]: unknown;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

const resolve = (path: string, ctx: SubstituteContext): unknown => {
  const parts = path.split(".");
  let v: any = ctx;
  for (const p of parts) {
    if (v === null || v === undefined) return undefined;
    v = v[p];
  }
  return v;
};

export const substitute = (template: string, ctx: SubstituteContext): string =>
  template.replace(PLACEHOLDER_RE, (full, path) => {
    const v = resolve(path, ctx);
    return v === undefined || v === null ? full : String(v);
  });
```

Run: `npm test -- substitute.test.ts`. Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-run-automations/shared/ tests/unit/substitute.test.ts
git commit -m "feat(crm): automation worker shared scaffolding (types, admin client, runLog, substitute)"
```

---

## Task 6: Trigger matchers + condition evaluator + tests

**Files:**
- Create: `supabase/functions/crm-run-automations/triggers/matchers.ts`
- Create: `supabase/functions/crm-run-automations/conditions/evaluator.ts`
- Create: `tests/unit/triggerMatchers.test.ts`
- Create: `tests/unit/conditionEvaluator.test.ts`

- [ ] **Step 1: Failing tests for matchers**

`tests/unit/triggerMatchers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { triggerConfigMatches } from "../../supabase/functions/crm-run-automations/triggers/matchers.ts";

describe("triggerConfigMatches", () => {
  it("deal_stage_entered with stage_id filter matches only that stage", () => {
    const event = { event_type: "deal_stage_entered", payload: { stage_id: "won-uuid" } } as any;
    expect(triggerConfigMatches({ stage_id: "won-uuid" }, event)).toBe(true);
    expect(triggerConfigMatches({ stage_id: "lost-uuid" }, event)).toBe(false);
  });

  it("deal_stage_entered with no filter matches any stage", () => {
    const event = { event_type: "deal_stage_entered", payload: { stage_id: "x" } } as any;
    expect(triggerConfigMatches({}, event)).toBe(true);
  });

  it("client_tagged matches the named tag", () => {
    const event = { event_type: "client_tagged", payload: { tag: "VIP" } } as any;
    expect(triggerConfigMatches({ tag: "VIP" }, event)).toBe(true);
    expect(triggerConfigMatches({ tag: "junk" }, event)).toBe(false);
  });

  it("deal_score_band_changed filters by new_band", () => {
    const event = { event_type: "deal_score_band_changed", payload: { new_band: "hot" } } as any;
    expect(triggerConfigMatches({ band: "hot" }, event)).toBe(true);
    expect(triggerConfigMatches({ band: "warm" }, event)).toBe(false);
  });
});
```

- [ ] **Step 2: matchers.ts**

```ts
// supabase/functions/crm-run-automations/triggers/matchers.ts
import { AutomationEvent } from "../shared/types.ts";

export const triggerConfigMatches = (
  config: Record<string, unknown>,
  event: AutomationEvent,
): boolean => {
  const payload = event.payload ?? {};
  switch (event.event_type) {
    case "deal_stage_entered":
      if (config.stage_id && payload.stage_id !== config.stage_id) return false;
      if (config.pipeline_id && payload.pipeline_id !== config.pipeline_id) return false;
      return true;

    case "deal_score_band_changed":
      if (config.band && payload.new_band !== config.band) return false;
      return true;

    case "deal_field_changed": {
      const fields = config.fields as string[] | undefined;
      if (!fields || fields.length === 0) return true;
      const changed = (payload.changed_fields as string[]) ?? [];
      return fields.some((f) => changed.includes(f));
    }

    case "form_submitted":
      if (config.form_id && payload.form_id !== config.form_id) return false;
      return true;

    case "client_tagged":
      if (config.tag && payload.tag !== config.tag) return false;
      return true;

    case "client_created":
      if (config.source && payload.source !== config.source) return false;
      return true;

    case "task_overdue":
    case "scheduled":
      return true;

    default:
      return false;
  }
};
```

- [ ] **Step 3: Failing tests for evaluator**

`tests/unit/conditionEvaluator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateConditions } from "../../supabase/functions/crm-run-automations/conditions/evaluator.ts";

describe("evaluateConditions", () => {
  const event = {
    event_type: "deal_stage_entered",
    payload: { value: 12000, currency: "USD", client_id: "c1", title: "Renewal" },
  } as any;
  const ctx = {
    deal: { value: 12000, currency: "USD", owner_id: "u1" },
    client: { industry: "SaaS", country: "US", tags: ["VIP", "prospect"] },
  };

  it("empty conditions → true", () => {
    expect(evaluateConditions([], event, ctx)).toBe(true);
  });

  it("gte on deal.value passes", () => {
    expect(evaluateConditions([{ field: "deal.value", operator: "gte", value: 1000 }], event, ctx)).toBe(true);
  });

  it("gte on deal.value fails", () => {
    expect(evaluateConditions([{ field: "deal.value", operator: "gte", value: 100000 }], event, ctx)).toBe(false);
  });

  it("in on client.industry passes", () => {
    expect(evaluateConditions(
      [{ field: "client.industry", operator: "in", value: ["SaaS", "FinTech"] }],
      event, ctx,
    )).toBe(true);
  });

  it("contains on client.tags passes when tag present", () => {
    expect(evaluateConditions(
      [{ field: "client.tags", operator: "contains", value: "VIP" }],
      event, ctx,
    )).toBe(true);
  });

  it("AND semantics: all must pass", () => {
    expect(evaluateConditions([
      { field: "deal.value", operator: "gte", value: 1000 },
      { field: "client.country", operator: "eq", value: "US" },
    ], event, ctx)).toBe(true);
    expect(evaluateConditions([
      { field: "deal.value", operator: "gte", value: 1000 },
      { field: "client.country", operator: "eq", value: "FR" },
    ], event, ctx)).toBe(false);
  });
});
```

- [ ] **Step 4: evaluator.ts**

```ts
// supabase/functions/crm-run-automations/conditions/evaluator.ts
import { AutomationEvent } from "../shared/types.ts";
import { SubstituteContext } from "../shared/substitute.ts";

interface Condition {
  field: string;
  operator: string;
  value: unknown;
}

const resolveField = (
  field: string,
  event: AutomationEvent,
  ctx: SubstituteContext,
): unknown => {
  // Dotted-path resolution against ctx; falls back to event.payload[field]
  // for trigger-payload-specific fields like `new_band`.
  const parts = field.split(".");
  if (parts.length > 1) {
    let v: any = ctx;
    for (const p of parts) {
      if (v === null || v === undefined) return undefined;
      v = v[p];
    }
    return v;
  }
  return (event.payload as Record<string, unknown>)[field];
};

const cmpEq = (a: unknown, b: unknown) =>
  Array.isArray(a) ? a.includes(b) : a === b;

const cmpNumeric = (a: unknown, b: unknown, op: ">"|">="|"<"|"<="): boolean => {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  switch (op) {
    case ">":  return na >  nb;
    case ">=": return na >= nb;
    case "<":  return na <  nb;
    case "<=": return na <= nb;
  }
};

export const evaluateConditions = (
  conditions: Condition[],
  event: AutomationEvent,
  ctx: SubstituteContext,
): boolean => {
  for (const c of conditions) {
    const lhs = resolveField(c.field, event, ctx);
    let pass: boolean;
    switch (c.operator) {
      case "eq":       pass = cmpEq(lhs, c.value); break;
      case "neq":      pass = !cmpEq(lhs, c.value); break;
      case "gt":       pass = cmpNumeric(lhs, c.value, ">");  break;
      case "gte":      pass = cmpNumeric(lhs, c.value, ">="); break;
      case "lt":       pass = cmpNumeric(lhs, c.value, "<");  break;
      case "lte":      pass = cmpNumeric(lhs, c.value, "<="); break;
      case "in":
        pass = Array.isArray(c.value) && (c.value as unknown[]).includes(lhs);
        break;
      case "contains":
        if (Array.isArray(lhs)) {
          pass = lhs.includes(c.value);
        } else if (typeof lhs === "string") {
          pass = lhs.toLowerCase().includes(String(c.value).toLowerCase());
        } else {
          pass = false;
        }
        break;
      case "exists":
        pass = lhs !== null && lhs !== undefined && lhs !== "";
        break;
      default:
        pass = false;
    }
    if (!pass) return false;
  }
  return true;
};
```

- [ ] **Step 5: Run tests + commit**

Run: `npm test -- triggerMatchers.test.ts conditionEvaluator.test.ts`
Expected: 10 tests pass.

```bash
git add supabase/functions/crm-run-automations/triggers/matchers.ts \
        supabase/functions/crm-run-automations/conditions/evaluator.ts \
        tests/unit/triggerMatchers.test.ts tests/unit/conditionEvaluator.test.ts
git commit -m "feat(crm): trigger matcher + condition evaluator + tests"
```

---

## Task 7: Internal action handlers (six handlers + registry)

**Files:**
- Create: `supabase/functions/crm-run-automations/actions/createTask.ts`
- Create: `supabase/functions/crm-run-automations/actions/tagClient.ts`
- Create: `supabase/functions/crm-run-automations/actions/setField.ts`
- Create: `supabase/functions/crm-run-automations/actions/changeOwner.ts`
- Create: `supabase/functions/crm-run-automations/actions/addNote.ts`
- Create: `supabase/functions/crm-run-automations/actions/moveDealStage.ts`
- Create: `supabase/functions/crm-run-automations/actions/index.ts`

- [ ] **Step 1: createTask.ts**

```ts
// supabase/functions/crm-run-automations/actions/createTask.ts
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

export const createTask: ActionHandler = async (ctx, config) => {
  const dealId = (ctx.event.payload as any).deal_id as string | undefined;
  const clientId = (ctx.event.payload as any).client_id as string | undefined;

  if (!clientId && !dealId) {
    return { status: "skipped", message: "No client or deal in event payload" };
  }

  // Resolve assignee.
  let assigneeId: string | null = null;
  const assignee = config.assignee as string | undefined;
  if (!assignee || assignee === "deal_owner") {
    if (dealId) {
      const { data } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
      assigneeId = data?.owner_id ?? null;
    }
  } else if (assignee === "client_owner") {
    if (clientId) {
      const { data } = await ctx.admin.from("clients").select("account_owner_id").eq("client_id", clientId).maybeSingle();
      assigneeId = data?.account_owner_id ?? null;
    }
  } else {
    assigneeId = assignee;
  }

  const dueInDays = Number(config.due_in_days ?? 3);
  const due = new Date(Date.now() + dueInDays * 86400_000);

  const title = substitute(String(config.title ?? "Untitled task"), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
  });

  // Optional dedupe — title-based de-duplication scoped to this client.
  const dedupeKey = config.dedupe_key as string | undefined;
  if (dedupeKey && clientId) {
    const { data: existing } = await ctx.admin
      .from("client_tasks")
      .select("task_id")
      .eq("client_id", clientId)
      .eq("title", dedupeKey)
      .maybeSingle();
    if (existing) {
      return { status: "skipped", message: "duplicate_dedupe_key" };
    }
  }

  const { data, error } = await ctx.admin
    .from("client_tasks")
    .insert({
      organization_id: ctx.orgId,
      client_id: clientId ?? null,
      title,
      status: "pending",
      due_date: due.toISOString().slice(0, 10),
      assigned_to: assigneeId,
      created_by: assigneeId,
      created_by_name: `Automation: ${ctx.recipeName}`,
    })
    .select("task_id")
    .single();
  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { task_id: (data as any).task_id } };
};
```

- [ ] **Step 2: tagClient.ts**

```ts
// supabase/functions/crm-run-automations/actions/tagClient.ts
import { ActionHandler } from "../shared/types.ts";

export const tagClient: ActionHandler = async (ctx, config) => {
  const clientId = (ctx.event.payload as any).client_id as string | undefined;
  if (!clientId) return { status: "skipped", message: "No client_id in event payload" };

  const tag = config.tag as string;
  const mode = (config.mode as string) ?? "add";
  if (!tag) return { status: "failure", message: "tag config required" };

  const { data: row, error: readErr } = await ctx.admin
    .from("clients")
    .select("tags")
    .eq("client_id", clientId)
    .maybeSingle();
  if (readErr) return { status: "failure", message: readErr.message };
  const tags: string[] = Array.isArray(row?.tags) ? row.tags : [];

  let next: string[];
  if (mode === "remove") {
    next = tags.filter((t) => t !== tag);
  } else {
    next = tags.includes(tag) ? tags : [...tags, tag];
  }

  if (next.length === tags.length && JSON.stringify(next) === JSON.stringify(tags)) {
    return { status: "skipped", message: `Tag already ${mode === "remove" ? "absent" : "present"}` };
  }

  const { error } = await ctx.admin.from("clients").update({ tags: next }).eq("client_id", clientId);
  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { tag, mode } };
};
```

- [ ] **Step 3: setField.ts**

```ts
// supabase/functions/crm-run-automations/actions/setField.ts
import { ActionHandler } from "../shared/types.ts";

const DEAL_WHITELIST = new Set(["value", "currency", "expected_close_date", "description", "source", "tags"]);
const CLIENT_WHITELIST = new Set(["industry", "status", "rating", "source", "country", "description"]);

export const setField: ActionHandler = async (ctx, config) => {
  const entity = config.entity as string;
  const field = config.field as string;
  const value = config.value;

  if (entity !== "deal" && entity !== "client") {
    return { status: "failure", message: `Invalid entity '${entity}'` };
  }
  const allowed = entity === "deal" ? DEAL_WHITELIST : CLIENT_WHITELIST;
  if (!allowed.has(field)) {
    return { status: "failure", message: `Field '${field}' is not editable on ${entity}` };
  }

  const id = entity === "deal"
    ? (ctx.event.payload as any).deal_id
    : (ctx.event.payload as any).client_id;
  if (!id) return { status: "skipped", message: `No ${entity}_id in event payload` };

  const table = entity === "deal" ? "deals" : "clients";
  const idCol = entity === "deal" ? "deal_id" : "client_id";
  const { error } = await ctx.admin.from(table).update({ [field]: value }).eq(idCol, id);
  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { entity, field, value } };
};
```

- [ ] **Step 4: changeOwner.ts**

```ts
// supabase/functions/crm-run-automations/actions/changeOwner.ts
import { ActionHandler } from "../shared/types.ts";

export const changeOwner: ActionHandler = async (ctx, config) => {
  const entity = config.entity as string;
  const ownerSpec = config.owner_id as string;
  if (entity !== "deal" && entity !== "client") {
    return { status: "failure", message: `Invalid entity '${entity}'` };
  }
  if (!ownerSpec) return { status: "failure", message: "owner_id required" };

  const id = entity === "deal"
    ? (ctx.event.payload as any).deal_id
    : (ctx.event.payload as any).client_id;
  if (!id) return { status: "skipped", message: `No ${entity}_id in event payload` };

  let resolved = ownerSpec;
  if (ownerSpec === "previous_owner" || ownerSpec === "creator") {
    const table = entity === "deal" ? "deals" : "clients";
    const idCol = entity === "deal" ? "deal_id" : "client_id";
    const col = ownerSpec === "creator" ? "created_by" : (entity === "deal" ? "owner_id" : "account_owner_id");
    const { data } = await ctx.admin.from(table).select(col).eq(idCol, id).maybeSingle();
    resolved = (data as any)?.[col];
    if (!resolved) return { status: "skipped", message: `No ${ownerSpec} available` };
  }

  // Look up display name.
  const { data: prof } = await ctx.admin.from("profiles").select("display_name").eq("user_id", resolved).maybeSingle();
  const name = (prof as any)?.display_name ?? null;

  const table = entity === "deal" ? "deals" : "clients";
  const idCol = entity === "deal" ? "deal_id" : "client_id";
  const update = entity === "deal"
    ? { owner_id: resolved, owner_name: name }
    : { account_owner_id: resolved, account_owner_name: name };

  const { error } = await ctx.admin.from(table).update(update).eq(idCol, id);
  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { entity, owner_id: resolved } };
};
```

- [ ] **Step 5: addNote.ts**

```ts
// supabase/functions/crm-run-automations/actions/addNote.ts
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

export const addNote: ActionHandler = async (ctx, config) => {
  const clientId = (ctx.event.payload as any).client_id as string | undefined;
  if (!clientId) return { status: "skipped", message: "No client_id in event payload" };

  const kind = (config.kind as string) ?? "note";
  const subject = substitute(String(config.subject ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
  });
  const body = substitute(String(config.body ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
  });

  const { error } = await ctx.admin.from("client_notes").insert({
    organization_id: ctx.orgId,
    client_id: clientId,
    kind,
    subject: subject || null,
    body: body || null,
    occurred_at: new Date().toISOString(),
    author_name: `Automation: ${ctx.recipeName}`,
  });
  if (error) return { status: "failure", message: error.message };
  return { status: "success" };
};
```

- [ ] **Step 6: moveDealStage.ts**

```ts
// supabase/functions/crm-run-automations/actions/moveDealStage.ts
import { ActionHandler } from "../shared/types.ts";

export const moveDealStage: ActionHandler = async (ctx, config) => {
  const dealId = (ctx.event.payload as any).deal_id as string | undefined;
  if (!dealId) return { status: "skipped", message: "No deal_id in event payload" };

  let targetStageId = config.stage_id as string;

  if (targetStageId === "next" || targetStageId === "previous") {
    const { data: deal } = await ctx.admin.from("deals").select("pipeline_id, stage_id").eq("deal_id", dealId).maybeSingle();
    if (!deal) return { status: "failure", message: "Deal not found" };
    const { data: stages } = await ctx.admin
      .from("pipeline_stages")
      .select("stage_id, position")
      .eq("pipeline_id", deal.pipeline_id)
      .order("position", { ascending: true });
    const arr = (stages ?? []) as Array<{ stage_id: string; position: number }>;
    const idx = arr.findIndex((s) => s.stage_id === deal.stage_id);
    const nextIdx = targetStageId === "next" ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= arr.length) {
      return { status: "skipped", message: `No ${targetStageId} stage available` };
    }
    targetStageId = arr[nextIdx].stage_id;
  }

  const { error } = await ctx.admin.from("deals").update({ stage_id: targetStageId }).eq("deal_id", dealId);
  if (error) {
    // P0001 = stage-gating trigger rejection from Batch 1.
    if ((error as any).code === "P0001") {
      return { status: "failure", message: (error as any).message };
    }
    return { status: "failure", message: error.message };
  }
  return { status: "success", meta: { stage_id: targetStageId } };
};
```

- [ ] **Step 7: actions/index.ts registry**

```ts
// supabase/functions/crm-run-automations/actions/index.ts
import { ActionHandler, ActionType } from "../shared/types.ts";
import { createTask } from "./createTask.ts";
import { tagClient } from "./tagClient.ts";
import { setField } from "./setField.ts";
import { changeOwner } from "./changeOwner.ts";
import { addNote } from "./addNote.ts";
import { moveDealStage } from "./moveDealStage.ts";
import { webhook } from "./webhook.ts";
import { slackPost } from "./slackPost.ts";
import { sendEmail } from "./sendEmail.ts";

export const ACTION_REGISTRY: Record<ActionType, ActionHandler> = {
  create_task: createTask,
  tag: tagClient,
  set_field: setField,
  change_owner: changeOwner,
  add_note: addNote,
  move_deal_stage: moveDealStage,
  webhook,
  slack_post: slackPost,
  send_email: sendEmail,
};
```

(The webhook / slackPost / sendEmail handlers are written in Tasks 8–9; the registry import lines are added now and will resolve once those files exist.)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/crm-run-automations/actions/createTask.ts \
        supabase/functions/crm-run-automations/actions/tagClient.ts \
        supabase/functions/crm-run-automations/actions/setField.ts \
        supabase/functions/crm-run-automations/actions/changeOwner.ts \
        supabase/functions/crm-run-automations/actions/addNote.ts \
        supabase/functions/crm-run-automations/actions/moveDealStage.ts \
        supabase/functions/crm-run-automations/actions/index.ts
git commit -m "feat(crm): six internal action handlers + registry"
```

---

## Task 8: Webhook action with SSRF guards

**Files:**
- Create: `supabase/functions/crm-run-automations/actions/webhook.ts`

- [ ] **Step 1: webhook.ts**

```ts
// supabase/functions/crm-run-automations/actions/webhook.ts
import { ActionHandler } from "../shared/types.ts";

const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|metadata\.google\.internal)/i;

const hmacSha256Hex = async (secret: string, body: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const webhook: ActionHandler = async (ctx, config) => {
  const url = config.url as string;
  if (!url) return { status: "failure", message: "url config required" };

  let parsed: URL;
  try { parsed = new URL(url); }
  catch { return { status: "failure", message: "Invalid url" }; }
  if (parsed.protocol !== "https:") return { status: "failure", message: "Webhook url must be https" };
  if (PRIVATE_HOST_RE.test(parsed.hostname)) {
    return { status: "failure", message: "Webhook url points to a private address (blocked)" };
  }

  const body = JSON.stringify({
    event: ctx.event,
    recipe_id: ctx.recipeId,
    org_id: ctx.orgId,
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-crm-idempotency-key": ctx.event.event_id + ":" + ctx.recipeId,
    ...(config.headers as Record<string, string> | undefined ?? {}),
  };

  const secret = config.secret as string | undefined;
  if (secret) {
    headers["x-crm-signature"] = "sha256=" + await hmacSha256Hex(secret, body);
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return { status: "failure", message: `Webhook returned ${res.status}` };
    return { status: "success", meta: { http_status: res.status } };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failure", message: msg };
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/crm-run-automations/actions/webhook.ts
git commit -m "feat(crm): webhook action with SSRF guard + HMAC signing"
```

---

## Task 9: Slack + email actions (delegate to integrations-action)

**Files:**
- Create: `supabase/functions/crm-run-automations/actions/slackPost.ts`
- Create: `supabase/functions/crm-run-automations/actions/sendEmail.ts`

- [ ] **Step 1: slackPost.ts**

```ts
// supabase/functions/crm-run-automations/actions/slackPost.ts
import { ActionHandler } from "../shared/types.ts";
import { SUPABASE_URL, SERVICE_KEY } from "../shared/client.ts";
import { substitute } from "../shared/substitute.ts";

const checkIntegration = async (admin: any, orgId: string, provider: string): Promise<boolean> => {
  const { data } = await admin
    .from("integrations")
    .select("id")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
};

export const slackPost: ActionHandler = async (ctx, config) => {
  const channelId = config.channel_id as string;
  if (!channelId) return { status: "failure", message: "channel_id required" };

  if (!await checkIntegration(ctx.admin, ctx.orgId, "slack")) {
    return { status: "skipped", message: "No active Slack integration — connect in Settings" };
  }

  const text = substitute(String(config.text ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    actor: "Automation",
    recipe: { name: ctx.recipeName },
  });

  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      action: "slack-post",
      org_id: ctx.orgId,
      channel_id: channelId,
      text,
      blocks: config.blocks ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "failure", message: `Slack post failed: ${res.status} ${body.slice(0, 200)}` };
  }
  return { status: "success" };
};
```

- [ ] **Step 2: sendEmail.ts**

```ts
// supabase/functions/crm-run-automations/actions/sendEmail.ts
import { ActionHandler } from "../shared/types.ts";
import { SUPABASE_URL, SERVICE_KEY } from "../shared/client.ts";
import { substitute } from "../shared/substitute.ts";

const checkIntegration = async (admin: any, orgId: string, provider: string): Promise<boolean> => {
  const { data } = await admin
    .from("integrations")
    .select("id")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
};

const resolveRecipient = async (ctx: any, spec: string): Promise<string | null> => {
  if (spec === "deal_owner_email") {
    const dealId = ctx.event.payload?.deal_id;
    if (!dealId) return null;
    const { data: deal } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
    if (!deal?.owner_id) return null;
    const { data: prof } = await ctx.admin.from("profiles").select("email").eq("user_id", deal.owner_id).maybeSingle();
    return prof?.email ?? null;
  }
  if (spec === "client_email") {
    const clientId = ctx.event.payload?.client_id;
    if (!clientId) return null;
    const { data: client } = await ctx.admin.from("clients").select("email").eq("client_id", clientId).maybeSingle();
    return client?.email ?? null;
  }
  return spec; // assume literal address
};

export const sendEmail: ActionHandler = async (ctx, config) => {
  if (!await checkIntegration(ctx.admin, ctx.orgId, "gmail")) {
    return { status: "skipped", message: "No active Gmail integration — connect in Settings" };
  }
  const to = await resolveRecipient(ctx, String(config.to ?? ""));
  if (!to) return { status: "skipped", message: "Could not resolve recipient" };

  const subject = substitute(String(config.subject ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
  });
  const body_html = substitute(String(config.body_html ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
  });

  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      action: "send-email",
      org_id: ctx.orgId,
      to, subject, body_html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "failure", message: `Email send failed: ${res.status} ${body.slice(0, 200)}` };
  }
  return { status: "success", meta: { to } };
};
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/crm-run-automations/actions/slackPost.ts \
        supabase/functions/crm-run-automations/actions/sendEmail.ts
git commit -m "feat(crm): slack + email actions delegating to integrations-action"
```

---

## Task 10: Worker top-level (index.ts + cron triggers + main loop)

**Files:**
- Create: `supabase/functions/crm-run-automations/triggers/cron.ts`
- Create: `supabase/functions/crm-run-automations/index.ts`

- [ ] **Step 1: triggers/cron.ts**

```ts
// supabase/functions/crm-run-automations/triggers/cron.ts
// Enqueues task_overdue + scheduled events that aren't fired by DB row changes.

export const enqueueCronEvents = async (admin: any): Promise<void> => {
  await enqueueTaskOverdue(admin);
  await enqueueScheduledRecipes(admin);
};

const enqueueTaskOverdue = async (admin: any): Promise<void> => {
  const today = new Date().toISOString().slice(0, 10);

  // Find newly-overdue tasks for which we haven't already enqueued an event in 24h.
  const { data: tasks } = await admin
    .from("client_tasks")
    .select("task_id, organization_id, client_id, title, due_date")
    .lt("due_date", today)
    .neq("status", "done")
    .limit(500);

  for (const t of tasks ?? []) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: prior } = await admin
      .from("automation_events")
      .select("event_id")
      .eq("event_type", "task_overdue")
      .eq("source_id", t.task_id)
      .gt("enqueued_at", since)
      .maybeSingle();
    if (prior) continue;

    await admin.from("automation_events").insert({
      organization_id: t.organization_id,
      event_type: "task_overdue",
      payload: { task_id: t.task_id, client_id: t.client_id, title: t.title, due_date: t.due_date },
      source_table: "client_tasks",
      source_id: t.task_id,
    });
  }
};

const enqueueScheduledRecipes = async (admin: any): Promise<void> => {
  // For v1, "scheduled" recipes use cron config like { "every": "0 9 * * 1" } (cron expr)
  // or { "minutes_past_hour": 0 } for hourly. The worker checks rough fit per minute.
  const { data: recipes } = await admin
    .from("automation_recipes")
    .select("recipe_id, organization_id, trigger_config")
    .eq("trigger_type", "scheduled")
    .eq("enabled", true);

  const now = new Date();
  for (const r of recipes ?? []) {
    if (!shouldFireSchedule(r.trigger_config ?? {}, now)) continue;

    await admin.from("automation_events").insert({
      organization_id: r.organization_id,
      event_type: "scheduled",
      payload: { recipe_id: r.recipe_id, now: now.toISOString() },
      source_table: "automation_recipes",
      source_id: r.recipe_id,
    });
  }
};

const shouldFireSchedule = (config: Record<string, unknown>, now: Date): boolean => {
  // Minimal cron-like fit for v1: { weekday, hour, minute }
  const weekday = config.weekday as number | undefined;   // 0=Sun .. 6=Sat
  const hour = config.hour as number | undefined;
  const minute = config.minute as number | undefined;
  if (weekday !== undefined && now.getUTCDay() !== weekday) return false;
  if (hour !== undefined && now.getUTCHours() !== hour) return false;
  if (minute !== undefined && now.getUTCMinutes() !== minute) return false;
  // If none provided, fire every minute (probably not desired but explicit).
  return weekday !== undefined || hour !== undefined || minute !== undefined;
};
```

- [ ] **Step 2: index.ts (main handler)**

```ts
// supabase/functions/crm-run-automations/index.ts
import { makeAdmin } from "./shared/client.ts";
import { writeRun } from "./shared/runLog.ts";
import { triggerConfigMatches } from "./triggers/matchers.ts";
import { evaluateConditions } from "./conditions/evaluator.ts";
import { enqueueCronEvents } from "./triggers/cron.ts";
import { ACTION_REGISTRY } from "./actions/index.ts";
import { AutomationEvent, Recipe, ActionResult } from "./shared/types.ts";

const ADVISORY_LOCK_KEY = 0xC8AE0001;

const tryAdvisoryLock = async (admin: any): Promise<boolean> => {
  const { data } = await admin.rpc("pg_try_advisory_lock", { key: ADVISORY_LOCK_KEY });
  return Boolean(data);
};

const releaseAdvisoryLock = async (admin: any): Promise<void> => {
  await admin.rpc("pg_advisory_unlock", { key: ADVISORY_LOCK_KEY });
};

const pullBatch = async (admin: any, limit: number): Promise<AutomationEvent[]> => {
  const { data, error } = await admin
    .from("automation_events")
    .select("*")
    .is("processed_at", null)
    .order("enqueued_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`pullBatch: ${error.message}`);
  return (data ?? []) as AutomationEvent[];
};

const markProcessed = async (admin: any, eventId: string): Promise<void> => {
  await admin.from("automation_events").update({ processed_at: new Date().toISOString() }).eq("event_id", eventId);
};

const loadMatchingRecipes = async (admin: any, event: AutomationEvent): Promise<Recipe[]> => {
  const { data } = await admin
    .from("automation_recipes")
    .select("recipe_id, organization_id, name, trigger_type, trigger_config, conditions, actions")
    .eq("organization_id", event.organization_id)
    .eq("enabled", true)
    .eq("trigger_type", event.event_type);
  return (data ?? []) as Recipe[];
};

const isBursting = async (admin: any, recipeId: string): Promise<boolean> => {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("automation_runs")
    .select("run_id", { count: "exact", head: true })
    .eq("recipe_id", recipeId)
    .gt("started_at", since);
  return (count ?? 0) >= 100;
};

const loadEntityContext = async (admin: any, event: AutomationEvent) => {
  const dealId = (event.payload as any).deal_id as string | undefined;
  const clientId = (event.payload as any).client_id as string | undefined;
  const ctx: any = {};
  if (dealId) {
    const { data } = await admin.from("deals").select("title, value, currency, stage, owner_id, owner_name").eq("deal_id", dealId).maybeSingle();
    if (data) ctx.deal = data;
  }
  if (clientId) {
    const { data } = await admin.from("clients").select("name, email, industry, country, tags").eq("client_id", clientId).maybeSingle();
    if (data) ctx.client = data;
  }
  return ctx;
};

const runRecipe = async (admin: any, recipe: Recipe, event: AutomationEvent): Promise<void> => {
  const started = new Date();
  const ctx = await loadEntityContext(admin, event);

  if (!evaluateConditions(recipe.conditions ?? [], event, ctx)) {
    return; // conditions fail → not a run, just no-op
  }

  const results: ActionResult[] = [];
  for (const actionSpec of recipe.actions) {
    const handler = ACTION_REGISTRY[actionSpec.type];
    const t0 = Date.now();
    if (!handler) {
      results.push({ type: actionSpec.type, status: "failure", message: "Unknown action type" });
      break;
    }
    try {
      const r = await handler(
        { admin, orgId: event.organization_id, event, recipeId: recipe.recipe_id, recipeName: recipe.name, runStartedAt: started },
        actionSpec.config ?? {},
      );
      results.push({ ...r, type: actionSpec.type, duration_ms: Date.now() - t0 });
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

  await writeRun(admin, {
    recipeId: recipe.recipe_id,
    eventId: event.event_id,
    organizationId: event.organization_id,
    results,
    startedAt: started,
    finishedAt: new Date(),
  });
};

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
  try {
    await enqueueCronEvents(admin);
    const events = await pullBatch(admin, 200);
    processed = events.length;

    for (const event of events) {
      try {
        const recipes = await loadMatchingRecipes(admin, event);
        for (const recipe of recipes) {
          if (!triggerConfigMatches(recipe.trigger_config ?? {}, event)) continue;
          if (await isBursting(admin, recipe.recipe_id)) {
            await admin.rpc("disable_recipe_for_runaway", { p_recipe_id: recipe.recipe_id });
            await writeRun(admin, {
              recipeId: recipe.recipe_id,
              eventId: event.event_id,
              organizationId: event.organization_id,
              results: [{ type: "create_task", status: "skipped", message: "auto_disabled_runaway" }],
              startedAt: new Date(),
              finishedAt: new Date(),
            });
            continue;
          }
          await runRecipe(admin, recipe, event);
        }
      } finally {
        await markProcessed(admin, event.event_id);
      }
    }
  } finally {
    await admin.from("automation_worker_heartbeat").upsert({
      id: 1,
      last_run_at: new Date().toISOString(),
      last_batch_size: processed,
      last_duration_ms: Date.now() - start,
    });
    await releaseAdvisoryLock(admin);
  }

  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 3: Add `pg_try_advisory_lock` / `pg_advisory_unlock` RPC wrappers to migration 065**

Append to `supabase/migrations/065_automation_engine.sql`:

```sql
-- Wrappers so supabase-js can call advisory locks via .rpc().
create or replace function public.pg_try_advisory_lock(key bigint)
returns boolean language sql security definer
set search_path = pg_catalog as $$
  select pg_catalog.pg_try_advisory_lock(key);
$$;

create or replace function public.pg_advisory_unlock(key bigint)
returns boolean language sql security definer
set search_path = pg_catalog as $$
  select pg_catalog.pg_advisory_unlock(key);
$$;

grant execute on function public.pg_try_advisory_lock(bigint) to service_role;
grant execute on function public.pg_advisory_unlock(bigint) to service_role;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-run-automations/triggers/cron.ts \
        supabase/functions/crm-run-automations/index.ts \
        supabase/migrations/065_automation_engine.sql
git commit -m "feat(crm): automation worker top-level + cron triggers + advisory-lock wrappers"
```

---

## Task 11: Cleanup additions to existing rotate-salt cron

**Files:**
- Modify: `supabase/functions/crm-rotate-turnstile-salt/index.ts`

- [ ] **Step 1: Add two prune queries**

In `supabase/functions/crm-rotate-turnstile-salt/index.ts`, before the final return statement, insert:

```ts
// Prune automation runs > 90d and events > 30d. Same daily cadence as the salt rotation.
await admin.from("automation_runs")
  .delete()
  .lt("started_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
await admin.from("automation_events")
  .delete()
  .lt("enqueued_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/crm-rotate-turnstile-salt/index.ts
git commit -m "feat(crm): daily cleanup of automation_runs + automation_events"
```

---

## Task 12: AutomationsSettingsTab + RecipeRunsList

**Files:**
- Create: `src/components/settings/RecipeRunsList.tsx`
- Create: `src/components/settings/AutomationsSettingsTab.tsx`

- [ ] **Step 1: RecipeRunsList.tsx**

```tsx
import React, { useEffect, useState } from "react";
import { listRuns, RecipeRun } from "@/services/supabase/automations";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const STATUS_ICON: Record<RecipeRun["status"], React.FC<{ className?: string }>> = {
  success: CheckCircle2,
  failure: XCircle,
  partial: AlertTriangle,
  skipped: MinusCircle,
};

const STATUS_COLOR: Record<RecipeRun["status"], string> = {
  success: "text-emerald-600",
  failure: "text-destructive",
  partial: "text-amber-600",
  skipped: "text-muted-foreground",
};

interface Props { recipeId: string }

export const RecipeRunsList: React.FC<Props> = ({ recipeId }) => {
  const [runs, setRuns] = useState<RecipeRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listRuns(recipeId, 50).then((rs) => {
      setRuns(rs);
      setLoading(false);
    });
  }, [recipeId]);

  if (loading) return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading runs…
    </p>
  );
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>;

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const Icon = STATUS_ICON[run.status];
        return (
          <div key={run.runId} className="border rounded-md p-2 text-xs space-y-1">
            <div className={`flex items-center gap-2 font-medium ${STATUS_COLOR[run.status]}`}>
              <Icon className="w-3.5 h-3.5" />
              <span className="capitalize">{run.status}</span>
              <span className="text-muted-foreground font-normal">
                · {run.startedAt.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                · {Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime())}ms
              </span>
            </div>
            {run.actionResults.length > 0 && (
              <ul className="pl-5 list-none space-y-0.5">
                {run.actionResults.map((a, i) => (
                  <li key={i} className={STATUS_COLOR[a.status as RecipeRun["status"]]}>
                    {a.status === "success" ? "✓" : a.status === "failure" ? "✗" : "·"} {a.type}
                    {a.message && <span className="text-muted-foreground"> — {a.message}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <Button variant="ghost" size="sm" onClick={() => listRuns(recipeId, 50).then(setRuns)}>
        Refresh
      </Button>
    </div>
  );
};
```

- [ ] **Step 2: AutomationsSettingsTab.tsx**

```tsx
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Zap, AlertCircle } from "lucide-react";
import { useAutomations } from "@/hooks/useAutomations";
import { Recipe, deleteRecipe, setRecipeEnabled, summarizeRecipe } from "@/services/supabase/automations";
import { RecipeBuilder } from "./RecipeBuilder";
import { RecipeRunsList } from "./RecipeRunsList";
import { toast } from "sonner";

export const AutomationsSettingsTab: React.FC = () => {
  const { organizationId, recipes, loading, canManage } = useAutomations();
  const [editing, setEditing] = useState<Recipe | "new" | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Only admins can manage automations.</p>;
  }
  if (!organizationId) return null;

  const toggle = async (recipe: Recipe, next: boolean) => {
    try {
      await setRecipeEnabled(recipe.recipeId, next);
      toast.success(next ? "Recipe enabled" : "Recipe disabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Toggle failed");
    }
  };

  const remove = async (recipe: Recipe) => {
    if (!confirm(`Delete "${recipe.name}"?`)) return;
    try {
      await deleteRecipe(recipe.recipeId);
      toast.success("Recipe deleted");
      if (selectedRecipeId === recipe.recipeId) setSelectedRecipeId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Automations
          </h2>
          <Button onClick={() => setEditing("new")}>
            <Plus className="w-4 h-4 mr-1" /> New automation
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : recipes.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No automations yet. Click <strong>New automation</strong> to create one.
            </CardContent>
          </Card>
        ) : (
          recipes.map((r) => (
            <Card
              key={r.recipeId}
              className={selectedRecipeId === r.recipeId ? "ring-2 ring-primary/40" : ""}
            >
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Switch checked={r.enabled} onCheckedChange={(v) => toggle(r, v)} />
                    <button
                      className="font-medium text-left truncate"
                      onClick={() => setSelectedRecipeId(r.recipeId)}
                    >
                      {r.name}
                    </button>
                    {r.failCount > 0 && (
                      <Badge variant="outline" className="text-destructive border-destructive/40">
                        <AlertCircle className="w-3 h-3 mr-1" /> {r.failCount} failed
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(r)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{summarizeRecipe(r as any)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.runCount} runs · {r.lastRunAt ? `last ${r.lastRunAt.toLocaleString()}` : "never run"}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Run history
        </h3>
        {selectedRecipeId ? (
          <RecipeRunsList recipeId={selectedRecipeId} />
        ) : (
          <p className="text-xs text-muted-foreground">Select a recipe to view its run history.</p>
        )}
      </div>

      {editing && (
        <RecipeBuilder
          organizationId={organizationId}
          recipe={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/AutomationsSettingsTab.tsx \
        src/components/settings/RecipeRunsList.tsx
git commit -m "feat(crm): automations settings tab + run history list"
```

---

## Task 13: RecipeBuilder modal

**Files:**
- Create: `src/components/settings/RecipeBuilder.tsx`

- [ ] **Step 1: RecipeBuilder.tsx**

```tsx
import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import {
  ACTION_TYPES, TRIGGER_TYPES,
  Recipe, RecipeAction, RecipeCondition, RecipeDraft, TriggerType, ActionType,
  upsertRecipe,
} from "@/services/supabase/automations";
import { toast } from "sonner";

interface Props {
  organizationId: string;
  recipe: Recipe | null;
  onClose: () => void;
}

const TRIGGER_LABEL: Record<TriggerType, string> = {
  deal_stage_entered: "a deal enters stage",
  deal_score_band_changed: "a deal's score band changes",
  deal_field_changed: "a deal field changes",
  form_submitted: "a form is submitted",
  client_created: "a client is created",
  client_tagged: "a client is tagged",
  task_overdue: "a task becomes overdue",
  scheduled: "scheduled time",
};

const ACTION_LABEL: Record<ActionType, string> = {
  create_task: "create task",
  tag: "tag client",
  set_field: "set field",
  change_owner: "change owner",
  add_note: "add note",
  move_deal_stage: "move deal to stage",
  webhook: "call webhook",
  slack_post: "post to Slack",
  send_email: "send email",
};

const OPERATORS = ["eq", "neq", "gte", "lte", "gt", "lt", "in", "contains", "exists"] as const;

const draftFromRecipe = (r: Recipe | null): RecipeDraft => r
  ? {
      name: r.name,
      description: r.description ?? "",
      enabled: r.enabled,
      trigger: { type: r.triggerType, config: r.triggerConfig },
      conditions: r.conditions,
      actions: r.actions,
    }
  : {
      name: "",
      description: "",
      enabled: true,
      trigger: { type: "deal_stage_entered", config: {} },
      conditions: [],
      actions: [{ type: "create_task", config: { title: "", assignee: "deal_owner", due_in_days: 3 } }],
    };

export const RecipeBuilder: React.FC<Props> = ({ organizationId, recipe, onClose }) => {
  const [draft, setDraft] = useState<RecipeDraft>(() => draftFromRecipe(recipe));
  const [saving, setSaving] = useState(false);

  const setConfig = (path: "trigger", patch: Record<string, unknown>) => {
    setDraft((d) => ({ ...d, [path]: { ...d[path], config: { ...d[path].config, ...patch } } }));
  };

  const addCondition = () => {
    setDraft((d) => ({ ...d, conditions: [...d.conditions, { field: "deal.value", operator: "gte", value: 0 }] }));
  };

  const updateCondition = (i: number, patch: Partial<RecipeCondition>) => {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.map((c, ci) => (ci === i ? { ...c, ...patch } : c)),
    }));
  };

  const removeCondition = (i: number) => {
    setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, ci) => ci !== i) }));
  };

  const addAction = () => {
    setDraft((d) => ({ ...d, actions: [...d.actions, { type: "create_task", config: { title: "", assignee: "deal_owner", due_in_days: 3 } }] }));
  };

  const updateAction = (i: number, patch: Partial<RecipeAction>) => {
    setDraft((d) => ({
      ...d,
      actions: d.actions.map((a, ai) => (ai === i ? { ...a, ...patch } : a)),
    }));
  };

  const removeAction = (i: number) => {
    setDraft((d) => ({ ...d, actions: d.actions.filter((_, ai) => ai !== i) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await upsertRecipe(organizationId, recipe?.recipeId ?? null, draft);
      toast.success(recipe ? "Recipe updated" : "Recipe created");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{recipe ? "Edit automation" : "New automation"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-2">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              <Label>Active</Label>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold w-16">When</span>
              <Select value={draft.trigger.type} onValueChange={(v) => setDraft({ ...draft, trigger: { type: v as TriggerType, config: {} } })}>
                <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_TYPES.map((t) => <SelectItem key={t} value={t}>{TRIGGER_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* Stage picker for deal_stage_entered. For other triggers, key/value text input below. */}
              {draft.trigger.type === "deal_stage_entered" && (
                <Input
                  placeholder="Stage UUID (or leave blank for any)"
                  value={(draft.trigger.config.stage_id as string) ?? ""}
                  onChange={(e) => setConfig("trigger", { stage_id: e.target.value || undefined })}
                />
              )}
              {draft.trigger.type === "client_tagged" && (
                <Input
                  placeholder="Tag (or blank for any)"
                  value={(draft.trigger.config.tag as string) ?? ""}
                  onChange={(e) => setConfig("trigger", { tag: e.target.value || undefined })}
                />
              )}
              {draft.trigger.type === "deal_score_band_changed" && (
                <Select
                  value={(draft.trigger.config.band as string) ?? "any"}
                  onValueChange={(v) => setConfig("trigger", { band: v === "any" ? undefined : v })}
                >
                  <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">any</SelectItem>
                    <SelectItem value="hot">hot</SelectItem>
                    <SelectItem value="warm">warm</SelectItem>
                    <SelectItem value="cold">cold</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex items-start gap-3">
              <span className="text-sm font-semibold w-16 mt-1">If</span>
              <div className="flex-1 space-y-2">
                {draft.conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value })} className="w-[180px]" placeholder="deal.value" />
                    <Select value={c.operator} onValueChange={(v) => updateCondition(i, { operator: v as any })}>
                      <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      value={typeof c.value === "string" ? c.value : JSON.stringify(c.value)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        let v: unknown = raw;
                        try { v = JSON.parse(raw); } catch { /* keep raw */ }
                        updateCondition(i, { value: v });
                      }}
                      placeholder='1000 or "VIP" or ["a","b"]'
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeCondition(i)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addCondition}>
                  <Plus className="w-3 h-3 mr-1" /> Add condition
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="text-sm font-semibold w-16 mt-1">Then</span>
              <div className="flex-1 space-y-3">
                {draft.actions.map((a, i) => (
                  <div key={i} className="border rounded-md p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Select value={a.type} onValueChange={(v) => updateAction(i, { type: v as ActionType, config: {} })}>
                        <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{ACTION_LABEL[t]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => removeAction(i)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <ActionConfigEditor
                      action={a}
                      onChange={(cfg) => updateAction(i, { config: cfg })}
                    />
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addAction}>
                  <Plus className="w-3 h-3 mr-1" /> Add action
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Per-action-type config editor. Keeps the main builder file tight.
// ────────────────────────────────────────────────────────────────────────────

const ActionConfigEditor: React.FC<{ action: RecipeAction; onChange: (cfg: Record<string, unknown>) => void }> = ({ action, onChange }) => {
  const cfg = action.config ?? {};
  const set = (patch: Record<string, unknown>) => onChange({ ...cfg, ...patch });

  switch (action.type) {
    case "create_task":
      return (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="col-span-2">
            <Label>Title</Label>
            <Input value={(cfg.title as string) ?? ""} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div>
            <Label>Due in (days)</Label>
            <Input type="number" value={Number(cfg.due_in_days ?? 3)} onChange={(e) => set({ due_in_days: Number(e.target.value) })} />
          </div>
          <div className="col-span-3">
            <Label>Assignee</Label>
            <Select value={(cfg.assignee as string) ?? "deal_owner"} onValueChange={(v) => set({ assignee: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deal_owner">Deal owner</SelectItem>
                <SelectItem value="client_owner">Client account owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    case "tag":
      return (
        <div className="grid grid-cols-3 gap-2">
          <Input value={(cfg.tag as string) ?? ""} onChange={(e) => set({ tag: e.target.value })} placeholder="tag" />
          <Select value={(cfg.mode as string) ?? "add"} onValueChange={(v) => set({ mode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="add">add</SelectItem>
              <SelectItem value="remove">remove</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );

    case "set_field":
      return (
        <div className="grid grid-cols-3 gap-2">
          <Select value={(cfg.entity as string) ?? "deal"} onValueChange={(v) => set({ entity: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="deal">deal</SelectItem>
              <SelectItem value="client">client</SelectItem>
            </SelectContent>
          </Select>
          <Input value={(cfg.field as string) ?? ""} onChange={(e) => set({ field: e.target.value })} placeholder="field name" />
          <Input value={typeof cfg.value === "string" ? cfg.value : JSON.stringify(cfg.value ?? "")} onChange={(e) => {
            const raw = e.target.value;
            let v: unknown = raw;
            try { v = JSON.parse(raw); } catch {}
            set({ value: v });
          }} placeholder="value" />
        </div>
      );

    case "change_owner":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Select value={(cfg.entity as string) ?? "deal"} onValueChange={(v) => set({ entity: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="deal">deal</SelectItem>
              <SelectItem value="client">client</SelectItem>
            </SelectContent>
          </Select>
          <Input value={(cfg.owner_id as string) ?? ""} onChange={(e) => set({ owner_id: e.target.value })} placeholder="user uuid or 'creator' / 'previous_owner'" />
        </div>
      );

    case "add_note":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input value={(cfg.subject as string) ?? ""} onChange={(e) => set({ subject: e.target.value })} placeholder="Subject (supports {{placeholders}})" />
          <Input value={(cfg.body as string) ?? ""} onChange={(e) => set({ body: e.target.value })} placeholder="Body" />
        </div>
      );

    case "move_deal_stage":
      return (
        <Input value={(cfg.stage_id as string) ?? ""} onChange={(e) => set({ stage_id: e.target.value })} placeholder="stage uuid or 'next'/'previous'" />
      );

    case "webhook":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input value={(cfg.url as string) ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/hook" />
          <Input value={(cfg.secret as string) ?? ""} onChange={(e) => set({ secret: e.target.value })} placeholder="HMAC secret (optional)" />
        </div>
      );

    case "slack_post":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input value={(cfg.channel_id as string) ?? ""} onChange={(e) => set({ channel_id: e.target.value })} placeholder="Channel ID" />
          <Input value={(cfg.text as string) ?? ""} onChange={(e) => set({ text: e.target.value })} placeholder="Message text" />
        </div>
      );

    case "send_email":
      return (
        <div className="grid grid-cols-1 gap-2">
          <Input value={(cfg.to as string) ?? ""} onChange={(e) => set({ to: e.target.value })} placeholder="deal_owner_email | client_email | literal@addr" />
          <Input value={(cfg.subject as string) ?? ""} onChange={(e) => set({ subject: e.target.value })} placeholder="Subject" />
          <Input value={(cfg.body_html as string) ?? ""} onChange={(e) => set({ body_html: e.target.value })} placeholder="HTML body" />
        </div>
      );

    default:
      return null;
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/RecipeBuilder.tsx
git commit -m "feat(crm): recipe builder modal with per-action config editor"
```

---

## Task 14: Wire Automations tab into Settings.tsx + live-run toast

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/hooks/useAutomations.ts` (add toast effect)

- [ ] **Step 1: Extend `useAutomations` with run-toast subscription**

Edit `src/hooks/useAutomations.ts` to add a second realtime subscription on `automation_runs` that surfaces toasts:

```ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { Recipe, listRecipes } from "@/services/supabase/automations";
import { supabase } from "@/services/supabase/config";
import { toast } from "sonner";

export const useAutomations = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setRecipes([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listRecipes(orgId).then((next) => {
      if (cancelled) return;
      setRecipes(next);
      setLoading(false);
    });

    const recipeChannel = supabase
      .channel(`automation-recipes-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "automation_recipes",
        filter: `organization_id=eq.${orgId}`,
      }, () => listRecipes(orgId).then(setRecipes))
      .subscribe();

    const runChannel = supabase
      .channel(`automation-runs-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "automation_runs",
        filter: `organization_id=eq.${orgId}`,
      }, (payload) => {
        const row = payload.new as { status: string; recipe_id: string };
        const recipe = recipes.find((r) => r.recipeId === row.recipe_id);
        const name = recipe?.name ?? "Automation";
        if (row.status === "success") toast.success(`${name} ran`);
        if (row.status === "failure") toast.error(`${name} failed`);
        if (row.status === "partial") toast.warning(`${name} ran with skipped actions`);
        // skipped suppressed — too chatty
      })
      .subscribe();

    return () => {
      cancelled = true;
      recipeChannel.unsubscribe();
      runChannel.unsubscribe();
    };
  }, [orgId, recipes]);

  return { organizationId: orgId, recipes, loading, canManage: isOwner || isAdmin };
};
```

- [ ] **Step 2: Add the tab to Settings.tsx**

In `src/pages/Settings.tsx`:

```ts
import { AutomationsSettingsTab } from "@/components/settings/AutomationsSettingsTab";
import { …, Zap, … } from "lucide-react";  // add Zap if not already imported
```

In the `<TabsList>`, after the `lead-forms` trigger:

```tsx
<TabsTrigger value="automations" className="gap-2">
  <Zap className="w-4 h-4" />
  Automations
</TabsTrigger>
```

In the `<TabsContent>` section, after the lead-forms content:

```tsx
<TabsContent value="automations">
  <AutomationsSettingsTab />
</TabsContent>
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: tsc clean, all existing tests still pass.

```bash
git add src/hooks/useAutomations.ts src/pages/Settings.tsx
git commit -m "feat(crm): wire Automations tab into Settings + live-run toasts"
```

---

## Self-Review

Run against the spec one section at a time:

1. **Spec § A (architecture + tables):** Task 1 creates all four tables, RLS, CRUD RPCs. Heartbeat table covered. ✓
2. **Spec § B (DB trigger plumbing):** Task 2 creates the four trigger functions + triggers. ✓
3. **Spec § C (worker):** Tasks 5, 6, 10 — shared scaffolding, matchers/evaluator, top-level handler + cron + advisory locks. ✓
4. **Spec § D (9 actions):** Tasks 7 (six internal), 8 (webhook), 9 (slack + email). Action registry in Task 7 step 7. ✓
5. **Spec § E (UI):** Tasks 3 (service), 4 (hook), 12 (settings tab + runs list), 13 (builder), 14 (Settings.tsx wiring + toast). ✓
6. **Spec § F (loop / idempotency / observability / testing):** Burst detection in Task 10. Webhook idempotency-key header in Task 8. Heartbeat in Task 10. Cleanup cron in Task 11. Unit tests in Tasks 3, 5, 6. ✓
7. **Placeholder scan:** All steps contain real code. No "TBD" / "TODO" / "fill in" anywhere. ✓
8. **Type consistency:** `ActionType` / `TriggerType` defined identically in `src/services/supabase/automations.ts` and `supabase/functions/crm-run-automations/shared/types.ts`. Both files list the same nine actions + eight triggers. ✓
9. **Naming:** `recipe_id` everywhere (not `id`); `event_id` / `run_id` consistent. ✓
10. **Migration idempotency:** every CREATE uses `if not exists`, every CREATE POLICY paired with DROP POLICY IF EXISTS, every CREATE FUNCTION is `CREATE OR REPLACE`. ✓

Findings: none. Plan ready for execution.
