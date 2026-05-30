# CRM Automation Engine — Batch 2a

**Date:** 2026-05-17
**Status:** Draft — pending user review
**Scope:** Configurable per-org recipe automation engine (Monday-style "when X happens, do Y"). First plank of Batch 2; AI Blocks, Sequences, and AI Sales Agent are separate specs.

---

## Goals

1. Admins build recipes in a single sentence-builder modal: *When [trigger], if [conditions], then [actions]*.
2. Async evaluation via DB triggers → event queue → 60-second cron worker. A broken recipe never rolls back the user's underlying action.
3. **Eight triggers**: deal stage entered, deal score band changed, deal field changed, form submitted, client created, client tagged, task overdue, scheduled time.
4. **Nine actions**: create task, add/remove tag, set field value, change owner, add note, move deal stage, webhook POST, Slack message, send email.
5. Run history visible per recipe with per-action timing and failure reasons.
6. Extensible: Batch 2b (AI Blocks) plugs in by adding new action handlers — no engine redesign.

## Non-goals (v1)

- Branching / wait-N-days flows (Batch 2c — sequences).
- Cross-recipe chaining exposed in the UI.
- Inline code or formula expressions in conditions.
- Per-user recipes — recipes are always org-scoped.
- Custom recipe templates / marketplace.
- Recipe versioning / rollback.

## Coordination

- Migrations `065_automation_engine.sql` (only new migration in this batch).
- New Edge Function `supabase/functions/crm-run-automations/` — file structure under section C.1.
- Cleanup additions to existing `crm-rotate-turnstile-salt` cron (Batch 1) — adds two prune queries; one-line code change in that function.
- Slack/email actions call the in-flight `integrations-action` Edge Function (other agent's lane). Both fail gracefully with `status: 'skipped'` if no active integration row exists for the org.

---

## Section A — Architecture overview & new tables

### A.1 Flow

```
User mutates a row (e.g. drag deal to Won)
  ↓
DB trigger fires AFTER UPDATE → inserts row into automation_events
  ↓
Cron Edge Function crm-run-automations (every minute)
  ↓
  1. Bulk pass: enqueue cron-derived events (task_overdue, scheduled)
  2. Pull batch of ≤200 unprocessed events
  3. Per event:
       a. Load enabled recipes for the org with matching trigger_type
       b. Check trigger_config filters
       c. Evaluate conditions[]
       d. Run actions[] in order; collect per-action results
       e. INSERT automation_runs row
       f. Mark event processed_at
  4. Update automation_worker_heartbeat
```

### A.2 Tables — `065_automation_engine.sql`

```sql
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

create index automation_recipes_org_enabled_idx
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

create index automation_events_pending_idx
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

create index automation_runs_recipe_time_idx
  on public.automation_runs(recipe_id, started_at desc);

create table if not exists public.automation_worker_heartbeat (
  id smallint primary key default 1 check (id = 1),
  last_run_at timestamptz not null,
  last_batch_size int not null,
  last_duration_ms int not null
);

-- RLS: admin writes via SECURITY DEFINER service functions; members read.
alter table public.automation_recipes enable row level security;
alter table public.automation_events  enable row level security;
alter table public.automation_runs    enable row level security;

drop policy if exists "automation_recipes read for org members" on public.automation_recipes;
create policy "automation_recipes read for org members"
  on public.automation_recipes for select
  using (public.is_org_member(organization_id));

drop policy if exists "automation_runs read for org members" on public.automation_runs;
create policy "automation_runs read for org members"
  on public.automation_runs for select
  using (public.is_org_member(organization_id));

-- automation_events is internal — no read policy needed; service role only.
```

### A.3 Trigger types → event types

| Trigger | event_type | Source |
|---|---|---|
| Deal entered stage | `deal_stage_entered` | trigger on `deals` AFTER UPDATE |
| Deal score band changed | `deal_score_band_changed` | trigger on `clients` (score_band changed) |
| Deal field changed | `deal_field_changed` | trigger on `deals` AFTER UPDATE |
| Form submitted | `form_submitted` | trigger on `form_submissions` AFTER INSERT |
| Client created | `client_created` | trigger on `clients` AFTER INSERT |
| Client tagged | `client_tagged` | trigger on `clients` AFTER UPDATE (tags array changed) |
| Task overdue | `task_overdue` | cron — worker enqueues for newly-overdue tasks |
| Scheduled time | `scheduled` | cron — worker matches schedules against now() |

### A.4 Action types → handlers

| Action | Handler file | Dependencies |
|---|---|---|
| Create task | `actions/createTask.ts` | none |
| Add/remove tag | `actions/tagClient.ts` | none |
| Set field value | `actions/setField.ts` | none |
| Change owner | `actions/changeOwner.ts` | none |
| Add note | `actions/addNote.ts` | none |
| Move deal stage | `actions/moveDealStage.ts` | gating trigger from Batch 1 |
| Webhook POST | `actions/webhook.ts` | none (SSRF guards required) |
| Slack message | `actions/slackPost.ts` | `integrations-action` Edge Fn (other agent) |
| Send email | `actions/sendEmail.ts` | `integrations-action` Edge Fn (other agent) |

---

## Section B — Trigger plumbing (event enqueueing)

All triggers live in `065_automation_engine.sql`. Each plpgsql function:
1. Detects whether the row change is automation-relevant.
2. Builds a `payload jsonb` with the fields the worker will read.
3. Inserts into `automation_events`. Reads `automation.depth` GUC for recursion tracking.

### B.1 Deal-update trigger

Detects two event types from one trigger:
- `deal_stage_entered` when `stage_id` changed.
- `deal_field_changed` when any whitelisted column (`value`, `owner_id`, `expected_close_date`, `probability`) changed.

Watched-column whitelist prevents event spam on noisy columns (`updated_at`).

### B.2 Client-insert trigger

Fires `client_created` with `{client_id, name, type, source}`.

### B.3 Client-update trigger

- `deal_score_band_changed` when `score_band` changed.
- `client_tagged` — one event per newly-added tag (computed via `unnest(new.tags) except unnest(old.tags)`).

### B.4 Form-submission trigger

`form_submitted` with `{submission_id, form_id, form_slug, client_id, deal_id}`, only for non-rejected non-honeypot submissions.

### B.5 Cron-derived triggers (live in the worker)

- **`task_overdue`** — every run, the worker scans `client_tasks` (or `tasks`) for rows with `due_date < current_date AND status != 'done'` that haven't already produced a `task_overdue` event in the past 24h.
- **`scheduled`** — every run, the worker enumerates enabled recipes with `trigger_type = 'scheduled'` and evaluates each one's `trigger_config` (cron expression or relative offset) against `now()`. Matching recipes get a synthetic event.

### B.6 Cleanup

The existing daily `crm-rotate-turnstile-salt` cron from Batch 1 grows two extra DELETEs:
```sql
delete from public.automation_events where enqueued_at < now() - interval '30 days';
delete from public.automation_runs   where started_at < now() - interval '90 days';
```

---

## Section C — Worker Edge Function

### C.1 File layout

```
supabase/functions/crm-run-automations/
├── index.ts                  ← Deno.serve handler + top-level loop
├── triggers/
│   ├── matchers.ts           ← does this event match this trigger_config?
│   └── cron.ts               ← enqueue task_overdue / scheduled events
├── conditions/
│   └── evaluator.ts          ← evaluates conditions[] against the event payload
├── actions/
│   ├── index.ts              ← action registry: type → handler
│   ├── createTask.ts
│   ├── tagClient.ts          ← add + remove tag
│   ├── setField.ts
│   ├── changeOwner.ts
│   ├── addNote.ts
│   ├── moveDealStage.ts
│   ├── webhook.ts
│   ├── slackPost.ts          ← delegates to integrations-action
│   └── sendEmail.ts          ← delegates to integrations-action
└── shared/
    ├── runLog.ts             ← writes automation_runs rows
    ├── substitute.ts         ← {{deal.title}} template engine
    └── client.ts             ← shared admin Supabase client
```

### C.2 Top-level handler

```ts
Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }});
  const start = Date.now();

  // Single-flight: skip if another worker is mid-batch.
  const locked = await tryAdvisoryLock(admin, 0xC8AE0001);
  if (!locked) return new Response(JSON.stringify({ ok: true, skipped: 'already_running' }));

  try {
    await enqueueCronEvents(admin);            // task_overdue + scheduled
    const events = await pullPendingBatch(admin, 200);
    for (const event of events) {
      await processEvent(admin, event);        // matches recipes, runs actions, logs runs
    }
    await heartbeat(admin, events.length, Date.now() - start);
    return new Response(JSON.stringify({ ok: true, processed: events.length }));
  } finally {
    await releaseAdvisoryLock(admin, 0xC8AE0001);
  }
});
```

### C.3 Per-event processing

```ts
async function processEvent(admin: SupabaseClient, event: AutomationEvent) {
  const recipes = await loadMatchingRecipes(admin, event);
  for (const recipe of recipes) {
    if (!triggerConfigMatches(recipe.trigger_config, event)) continue;
    if (!evaluateConditions(recipe.conditions, event)) continue;
    // Burst-detection guard — auto-disable runaway recipes.
    if (await isBurstingPast60s(admin, recipe.recipe_id, 100)) {
      await disableRecipe(admin, recipe, 'auto_disabled_runaway');
      continue;
    }
    await runRecipe(admin, recipe, event);
  }
  await markProcessed(admin, event.event_id);
}
```

### C.4 Per-recipe execution

```ts
async function runRecipe(admin, recipe, event) {
  const started = new Date();
  const results: ActionResult[] = [];
  let overall: RunStatus = 'success';

  for (const actionSpec of recipe.actions) {
    const handler = ACTION_REGISTRY[actionSpec.type];
    if (!handler) {
      results.push({ type: actionSpec.type, status: 'failure', message: 'Unknown action type' });
      overall = 'failure';
      break;
    }
    const t0 = Date.now();
    try {
      const r = await handler({ admin, orgId: event.organization_id, event, recipeId: recipe.recipe_id, runStartedAt: started }, actionSpec.config);
      results.push({ ...r, type: actionSpec.type, duration_ms: Date.now() - t0 });
      if (r.status === 'failure') { overall = 'failure'; break; }
      if (r.status === 'skipped' && overall === 'success') overall = 'partial';
    } catch (err) {
      results.push({ type: actionSpec.type, status: 'failure', message: err.message, duration_ms: Date.now() - t0 });
      overall = 'failure';
      break;
    }
  }

  await admin.from('automation_runs').insert({
    recipe_id: recipe.recipe_id,
    event_id: event.event_id,
    organization_id: event.organization_id,
    status: overall,
    action_results: results,
    started_at: started,
    finished_at: new Date(),
  });

  await admin.rpc('increment_recipe_counters', { p_recipe_id: recipe.recipe_id, p_failed: overall === 'failure' });
}
```

`increment_recipe_counters` is a small RPC defined in 065 that bumps `run_count` and `fail_count` atomically and sets `last_run_at = now()`.

### C.5 Concurrency

`pg_try_advisory_lock(0xC8AE0001)` ensures only one worker processes events at a time. Lock released in `finally`. A run capped at 200 events × ~50ms each = ~10s, well under the 5-minute Edge Function ceiling.

---

## Section D — Action handlers

Each handler is a small file. Shared signature:

```ts
export type ActionHandler = (
  ctx: ActionContext,
  config: Record<string, unknown>,
) => Promise<{ status: 'success'|'failure'|'skipped'; message?: string; meta?: Record<string, unknown> }>;
```

### D.1 Internal actions (no integration dependencies)

| Handler | config | Behavior |
|---|---|---|
| `createTask` | `{ title, assignee, due_in_days, target: 'client_task'|'project_task', dedupe_key? }` | Resolves `assignee` ('deal_owner'/'client_owner'/`<uuid>`) to a real user_id. INSERTs into `client_tasks` (default) or `tasks`. If `dedupe_key` set and exists, skips. |
| `tagClient` | `{ tag, mode: 'add'|'remove' }` | Reads current tags, computes new array, UPDATE. |
| `setField` | `{ entity: 'deal'|'client', field, value }` | Field whitelist enforced. |
| `changeOwner` | `{ entity: 'deal'|'client', owner_id }` (`owner_id` can be uuid or `'previous_owner'`/`'creator'`) | UPDATEs both id and denormalized name. |
| `addNote` | `{ kind, subject, body }` | Inserts into `client_notes` with author `"Automation: <recipe name>"`. Subject/body support `{{placeholders}}`. |
| `moveDealStage` | `{ stage_id: <uuid>|'next'|'previous' }` | Resolves `'next'`/`'previous'` via `pipeline_stages.position`. Catches `P0001` from gating trigger and returns it as failure message. |

**Field whitelist for `setField`:**
- `deal`: `value`, `currency`, `expected_close_date`, `description`, `source`, `tags`
- `client`: `industry`, `status`, `rating`, `source`, `country`, `description`

### D.2 Webhook action

```ts
// config: { url: string, headers?: Record<string,string>, secret?: string }
```

- POSTs `{event, recipe_id, run_id}` to `config.url`.
- HMAC-SHA256 signature in `X-CRM-Signature: sha256=<hex>` if `secret` set.
- `X-CRM-Idempotency-Key: <run_id>` always included.
- 30s timeout via `AbortController`.
- SSRF protection: reject `http://` (https only), `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `metadata.google.internal`.
- 2xx → `success`. 4xx/5xx/timeout/SSRF rejection → `failure` with message.

### D.3 Slack + email actions

Both check for an active row in `public.integrations` for the org with matching `provider`:

```sql
select id from public.integrations
where org_id = ? and provider = ? and status = 'active' limit 1;
```

- **Missing**: `{ status: 'skipped', message: 'No active <provider> integration' }`. Recipe overall status → `partial` (or `success` if every action was skipped — debatable; spec choice: skipped-only-actions don't downgrade to partial, they stay success with all-skipped meta).
- **Present**: POST internally to `${SUPABASE_URL}/functions/v1/integrations-action` with the appropriate payload (`{action: 'slack-post', org_id, channel_id, text/blocks}` or `{action: 'send-email', org_id, to, subject, body_html}`). Bubble the response into `ActionResult`.

### D.4 Template substitution

`substitute(template, event, ctx)` does mustache-style replacement. Resolves:

- `{{deal.title}}, {{deal.value}}, {{deal.currency}}, {{deal.stage}}, {{deal.url}}`
- `{{client.name}}, {{client.email}}, {{client.industry}}, {{client.url}}`
- `{{actor}}` — display name of whoever caused the event (`"System"` for cron)
- `{{recipe.name}}`

URLs derived from `APP_ORIGIN`. Unknown placeholders pass through unchanged.

### D.5 Per-action result row shape

```jsonb
{
  "type": "create_task",
  "status": "success",
  "duration_ms": 42,
  "message": null,
  "meta": { "task_id": "uuid" }
}
```

---

## Section E — UI

### E.1 New files

- `src/services/supabase/automations.ts` — types + CRUD (`createRecipe`, `updateRecipe`, `deleteRecipe`, `listRecipes`, `listRuns`).
- `src/hooks/useAutomations.ts` — list + realtime subscription on `automation_recipes` and `automation_runs` (for live toast in E.5).
- `src/components/settings/AutomationsSettingsTab.tsx` — outer tab.
- `src/components/settings/RecipeBuilder.tsx` — modal builder.
- `src/components/settings/RecipeRunsList.tsx` — run history side-panel.

### E.2 Settings.tsx insertion

Insert after the Lead Forms tab from Batch 1 Plan 4:
```tsx
<TabsTrigger value="automations" className="gap-2">
  <Zap className="w-4 h-4" />
  Automations
</TabsTrigger>
// …
<TabsContent value="automations"><AutomationsSettingsTab /></TabsContent>
```

Add `Zap` to the existing Lucide import.

### E.3 RecipeBuilder draft shape

```ts
interface RecipeDraft {
  name: string;
  enabled: boolean;
  trigger: { type: TriggerType; config: Record<string, unknown> };
  conditions: Array<{ field: string; operator: string; value: unknown }>;
  actions: Array<{ type: ActionType; config: Record<string, unknown> }>;
}
```

Save calls `createRecipe(orgId, draft)` or `updateRecipe(recipeId, draft)`. Inline validation: name non-empty, trigger.type required, at least one action, each action's required fields populated.

### E.4 Settings tab layout

Two-pane on wide viewports, stacked on mobile:
- Left: recipe list (cards with name, summary, run/fail counts, Edit/Disable/Delete, Active toggle).
- Right: run history for the selected recipe (50 most recent rows from `automation_runs`).

Cards show short summary string ("When deal enters Won, then create task + post Slack") generated client-side from the recipe's `trigger.type` + `actions[].type` array.

### E.5 Live-run toasts

A realtime channel subscribed to `automation_runs` for the org. On INSERT:
- `success` / `partial` → `sonner` toast with link to that run.
- `failure` → toast `variant="destructive"` with link.
- `skipped` → suppressed (too chatty).

The toast is org-wide, so any member who triggered an event sees their own recipe firing in real time.

### E.6 Permissions

- Admin-only (`canManageSettings`). Non-admins see *"Only admins can manage automations"* and no list/builder.
- Toast in E.5 fires for all members; the linked run history is admin-gated server-side.

---

## Section F — Loop prevention, idempotency, observability, testing

### F.1 Loop prevention — burst detection

Cross-transaction GUC tracking doesn't work reliably with supabase-js's auto-batched implicit transactions, so the spec uses a simpler primary defense: **per-recipe burst detection**.

- Before evaluating a recipe, the worker counts its `automation_runs` rows in the past 60 seconds.
- If `count >= 100`, the worker:
  1. Sets `automation_recipes.enabled = false` for that recipe.
  2. Writes a `skipped` run with `message: 'auto_disabled_runaway'`.
  3. Surfaces an admin notification (`notifications` table) — "Recipe '<name>' was auto-disabled after firing 100 times in 60 seconds; likely a loop."
- Admin must manually re-enable the recipe after fixing the configuration.

Secondary defense — the same hard 24h ceiling described in F.3 (1000 runs / rolling 24h) catches slower loops.

The `automation_events.depth` column stays in the schema as a debugging breadcrumb (the worker writes `event.depth + 1` on events it spawns), but it does **not** participate in enforcement. Triggers always write `depth = 0`.

### F.2 Idempotency

- No unique constraint on `automation_events` (multiple recipes may share an event).
- `createTask` supports optional `dedupe_key`; existing dedupe_key → skipped.
- `webhook` sends `X-CRM-Idempotency-Key: <run_id>` so downstream can dedupe.
- Worker marks events processed unconditionally — failed runs are logged, never replayed.

### F.3 Rate limiting

- **Per-recipe ceiling**: 1000 runs / rolling 24h. Worker reads count before evaluating; over → `skipped` with `message: 'rate_limited'`.
- **Webhook**: 60 calls/minute/org via an in-memory bucket inside the worker (resets each invocation — best-effort).
- **Slack/email**: rely on `integrations-action`'s existing rate-limit handling.

### F.4 Observability

- `automation_runs` is the primary log; admin UI exposes the last 50 per recipe.
- `automation_worker_heartbeat` (singleton row) updated every invocation. The org's admin "Health" card surfaces a warning if `last_run_at` is >5 minutes old.
- Edge Function logs capture stack traces; the user-visible run row carries `message` extracted from `err.message`.

### F.5 Testing

**Unit (vitest):**
- `triggers/matchers.ts` — every trigger type × representative payload × expected match/no-match.
- `conditions/evaluator.ts` — operator coverage (eq/neq/gte/lte/in/contains/exists) over scalar/array/null inputs.
- Each action handler — mocked Supabase client, asserts correct INSERT/UPDATE + correct `ActionResult.status` on failure.
- `substitute.ts` — table-driven placeholder coverage.

**Integration (manual until DB test harness exists):**
- `supabase functions serve crm-run-automations`; insert recipe via SQL; trigger event; assert `automation_runs` row.
- Loop test — a recipe whose action triggers itself; confirm depth → 5 → skipped.

### F.6 Out of scope (explicit)

- Branching / if-else within a recipe.
- Wait / delay actions (defers to Sequences, Batch 2c).
- Cross-recipe chaining exposed in UI.
- Custom code / formula expressions.
- Recipe versioning, rollback, diffs.
- Recipe templates / marketplace.
- Per-user recipes.

---

## Security

- All recipe writes go through admin-only RPC (gated by `is_org_admin`); no direct INSERT/UPDATE policies on `automation_recipes`.
- Webhook action's SSRF allowlist prevents calling internal endpoints.
- HMAC signing of webhook payloads is optional but always sent if a secret is configured.
- Slack/email actions can only fire if the org has explicitly connected the integration; no token leakage possible from a recipe definition.
- All operations the worker performs go through SECURITY DEFINER helpers so RLS scoping is enforced; no RLS-bypass leaks via the service role.

## Rollout

1. Migration 065 applied. Triggers go live but no recipes exist yet — engine is dormant.
2. Edge Function deployed; scheduled every 1 minute. Heartbeat starts ticking.
3. New Settings tab visible to admins; recipe builder available.
4. Beta: enable 1–2 recipes per org for a week; watch `automation_runs` for unexpected failures.
5. General rollout — no feature flag (the tab itself is admin-only; non-admins never see it).

## Open questions

1. **Worker invocation cadence** — 60s is the spec choice. For "task_overdue" detection this means up to 60s lag between task crossing the date boundary and the recipe firing. Acceptable; revisit if customers ask for shorter.
2. **Action failure tolerance** — current spec stops on first failure within a recipe. Alternative: continue and mark `partial` even when later actions could have succeeded. Choice: stop on first failure (simpler mental model, mirrors most CI runners).
3. **Per-org recipe limit** — none enforced in v1. Add `automation_recipes_max` to plan limits if customers create unreasonable counts.

## V2 / Future work

- **Batch 2b — AI Blocks**: new action handlers (`aiSummarize`, `aiClassify`, `aiDraftEmail`) registered in `ACTION_REGISTRY`. Needs per-org Claude API key config or org-funded billing model (decision needed).
- **Batch 2c — Sequences**: depends on Gmail integration. Adds wait/delay actions + sequence-level stop conditions (e.g. "stop on reply"). Lives on top of the same engine.
- **Batch 2d — AI Sales Agent**: a separate autonomous component that *creates* recipes and runs unattended actions like enrichment, scoring, draft outreach. Out of scope for the engine itself.
- **Branching**: `actions[]` becomes a tree; the evaluator walks each branch.
- **Recipe versioning**: snapshot before each edit; rollback button.
- **Visual editor**: drag-and-drop nodes instead of sentence builder (Zapier Editor style).
