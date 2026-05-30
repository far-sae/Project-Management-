# CRM Email Sequences — Batch 2c

**Date:** 2026-05-17
**Status:** Draft — pending user review
**Scope:** Multi-step email cadences built on the recipe engine. New `wait` action, rewrite of `sendEmail.ts` to call Gmail directly, SendGrid Inbound Parse webhook for reply detection, send-window enforcement, and a Sequences view in Settings. AI Sales Agent (2d) is a separate spec.

---

## Goals

1. New `wait` action type on the recipe engine. Recipes become multi-step sequences.
2. **Rewrite `sendEmail.ts`** so it actually sends via the Gmail API (currently delegates to a stub) — same surgical pattern as the recent `slackPost.ts` rewrite.
3. **Reply detection** via Reply-To rewriting + SendGrid Inbound Parse: outgoing emails get `Reply-To: reply+<recipeRunId>@inbound.taskcalendar.co.uk`; a new public webhook receives inbound replies, marks the run as `reply_received`, stops any pending follow-ups for that recipe run.
4. **Send window**: per-recipe 9am–6pm Mon–Fri default in the org's timezone, overridable per recipe in the builder. Waits that resolve outside the window defer to the next valid hour.
5. **Hard stop conditions**:
   - Linked deal moves to a stage with `is_won = true` or `is_lost = true` → all pending waits for that deal's recipes cancelled.
   - Admin clicks "Stop sequence" in run history.
   - Hard ceiling: a recipe run that's enqueued 10+ `wait` actions stops with `recursion_limit`.
6. **UI lens**: new `Settings → Sequences` tab that filters `automation_recipes` to those containing at least one `send_email + wait` pair, with a different summary card (enrollment count, last send, reply rate).

## Non-goals (v1)

- Reply tracking inside Gmail (no `gmail.readonly` — no inbox access).
- A/B testing variants of a sequence step.
- Open/click tracking pixels (privacy + spam-folder risk).
- Per-recipient sequence state (each recipe run is one sequence; if you fire the same recipe for 100 contacts, that's 100 runs).
- "Pause" vs "stop" — you can stop, not pause + resume.
- Visual timeline editor (sequences appear in the same recipe builder modal you already have).
- Sequence templates.
- Service-role token refresh for Gmail (deferred — manual reconnect for v1).
- Bounced-email detection.
- Per-recipient "unsubscribe" link in the email footer.

## Coordination

- One new migration: `067_sequences.sql`.
- One new public Edge Function: `gmail-inbound` (deployed `--no-verify-jwt`).
- Existing `crm-run-automations` worker absorbs the `pending_actions` drain — no second worker.
- One new secret: `SENDGRID_INBOUND_WEBHOOK_SECRET`. One new config secret: `SEQUENCE_INBOUND_DOMAIN` (defaults to `inbound.taskcalendar.co.uk`).
- One external setup: SendGrid account ($20/mo Essentials) + MX records on `inbound.taskcalendar.co.uk` → `mx.sendgrid.net`.
- Recipe builder gets two new things: a `wait` editor block + a "Send window" collapsible.
- New `Settings → Sequences` tab between `Automations` and `AI Usage`.

---

## Section A — Architecture overview & new tables

### A.1 Flow

```
User triggers a recipe (e.g. deal entered stage X)
  ↓
Worker runs actions sequentially:
  - send_email             → POST to gmail.users.messages.send (direct, with Reply-To)
  - wait (3 days)          → inserts pending_actions row, returns meta.defer=true
                              (worker breaks loop here; remaining actions deferred)
  - send_email (deferred)  ← worker tick 3 days later finds pending_actions row,
                              checks send window, resumes recipe from next_action_index
                              with stashed aiOutputs
  - wait (5 days)          → another pending_actions row …

Recipient replies to email
  ↓
SendGrid Inbound Parse POSTs to gmail-inbound Edge Function
  ↓
gmail-inbound verifies SendGrid signature, extracts recipe_run_id from Reply-To,
  logs sequence_replies row, updates pending_actions for that run to
  status='reply_received' → those rows skipped on next worker tick.

Deal moves to Won/Lost stage
  ↓
DB trigger cancel_pending_actions_on_close_t marks all pending_actions for that
  deal as status='stopped_by_stage' → same skip-on-tick behaviour.

Admin clicks "Stop sequence" in run history
  ↓
RPC stop_pending_actions_for_run(run_id) marks status='stopped_by_admin'.
```

### A.2 Migration — `067_sequences.sql`

```sql
-- Deferred actions queued by the wait handler. The worker drains rows where
-- fire_at <= now() each tick, resuming recipes from the next action.
create table if not exists public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  recipe_id uuid not null
    references public.automation_recipes(recipe_id) on delete cascade,
  -- The seed event so the resumed actions see the same payload they would
  -- have if they ran inline.
  source_event_id uuid references public.automation_events(event_id) on delete set null,
  -- Resume the recipe from this index in actions[].
  next_action_index int not null,
  fire_at timestamptz not null,
  -- aiOutputs accumulator carried over from pre-wait actions so {{ai.*}}
  -- placeholders in post-wait actions still resolve.
  ai_outputs jsonb not null default '{}'::jsonb,
  -- For stop conditions: which deal/client is this sequence about.
  deal_id uuid references public.deals(deal_id) on delete cascade,
  client_id uuid references public.clients(client_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','fired','cancelled','reply_received','stopped_by_admin','stopped_by_stage')),
  created_at timestamptz default now()
);

create index if not exists pending_actions_fire_idx
  on public.pending_actions(fire_at) where status = 'pending';

create index if not exists pending_actions_deal_idx
  on public.pending_actions(deal_id) where status = 'pending';

create index if not exists pending_actions_recipe_event_idx
  on public.pending_actions(recipe_id, source_event_id) where status = 'pending';

-- Inbound reply tracking. SendGrid POSTs here via the webhook; we log + flip
-- pending_actions for the matching recipe_run.
create table if not exists public.sequence_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recipe_run_id uuid references public.automation_runs(run_id) on delete set null,
  recipe_id uuid references public.automation_recipes(recipe_id) on delete set null,
  from_address text not null,
  subject text,
  body_preview text,
  received_at timestamptz default now(),
  raw_payload jsonb
);

create index if not exists sequence_replies_recipe_run_idx
  on public.sequence_replies(recipe_run_id, received_at desc);

create index if not exists sequence_replies_org_time_idx
  on public.sequence_replies(organization_id, received_at desc);

-- Send-window config on recipes. NULL = "any time".
alter table public.automation_recipes
  add column if not exists send_window jsonb;
-- send_window shape: { hours: [9, 18], days: [1,2,3,4,5], timezone: "Europe/London" }
--   hours: [start, end] — inclusive start, exclusive end, 0..24
--   days:  ISO weekday integers (1=Mon .. 7=Sun)
--   timezone: IANA TZ string

-- Org default timezone (used when recipe.send_window omits one).
alter table public.organizations
  add column if not exists default_timezone text not null default 'UTC';

-- Stop trigger: cancel pending actions when a deal moves to a won/lost stage.
create or replace function public.cancel_pending_actions_on_close()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_new_stage public.pipeline_stages%rowtype;
begin
  if new.stage_id is not distinct from old.stage_id then return new; end if;
  select * into v_new_stage from public.pipeline_stages where stage_id = new.stage_id;
  if v_new_stage.is_won or v_new_stage.is_lost then
    update public.pending_actions
    set status = 'stopped_by_stage'
    where status = 'pending' and deal_id = new.deal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists cancel_pending_actions_on_close_t on public.deals;
create trigger cancel_pending_actions_on_close_t
  after update of stage_id on public.deals
  for each row execute function public.cancel_pending_actions_on_close();

-- Admin-only RPC for the Stop button in the Sequences UI.
create or replace function public.stop_pending_actions_for_run(p_run_id uuid)
returns int
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_recipe uuid;
  v_event uuid;
  v_count int;
begin
  select organization_id, recipe_id, event_id into v_org, v_recipe, v_event
  from public.automation_runs where run_id = p_run_id;
  if v_org is null then return 0; end if;
  if not public.is_org_admin(v_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.pending_actions
  set status = 'stopped_by_admin'
  where status = 'pending' and recipe_id = v_recipe and source_event_id = v_event;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.stop_pending_actions_for_run(uuid) to authenticated;

-- Extend crm_upsert_recipe to accept send_window. Drop + recreate to add the
-- new parameter; the new signature is backwards-compatible because callers
-- pass NULL when not setting a window.
drop function if exists public.crm_upsert_recipe(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, boolean);

create or replace function public.crm_upsert_recipe(
  p_recipe_id uuid,
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_trigger_config jsonb,
  p_conditions jsonb,
  p_actions jsonb,
  p_enabled boolean,
  p_send_window jsonb default null
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
      conditions, actions, enabled, send_window, created_by
    ) values (
      p_organization_id, btrim(p_name), p_description, p_trigger_type,
      coalesce(p_trigger_config, '{}'::jsonb),
      coalesce(p_conditions, '[]'::jsonb),
      p_actions,
      coalesce(p_enabled, true),
      p_send_window,
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
        send_window = p_send_window,
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

grant execute on function public.crm_upsert_recipe(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb)
  to authenticated;

-- RLS — pending_actions + sequence_replies readable by org members; no write
-- policies (service role only via the worker / webhook).
alter table public.pending_actions enable row level security;
alter table public.sequence_replies enable row level security;

drop policy if exists "pending_actions read for org members" on public.pending_actions;
create policy "pending_actions read for org members"
  on public.pending_actions for select
  using (public.is_org_member(organization_id));

drop policy if exists "sequence_replies read for org members" on public.sequence_replies;
create policy "sequence_replies read for org members"
  on public.sequence_replies for select
  using (public.is_org_member(organization_id));
```

---

## Section B — `wait` action + worker scheduler extension

### B.1 `wait` action handler

`supabase/functions/crm-run-automations/actions/wait.ts`:

```ts
// Schedules a future continuation in pending_actions and returns meta.defer
// so the worker stops processing the remaining actions in this run.

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

### B.2 `ActionContext` extensions

```ts
export interface ActionContext {
  // … existing fields …
  recipeRunId?: string;       // automation_runs.run_id — populated by worker after row insert
  nextActionIndex?: number;   // current index in recipe.actions[], populated by loop
}
```

### B.3 Worker loop short-circuits on `defer`

In `crm-run-automations/index.ts` `runRecipe()`:

```ts
for (let i = 0; i < recipe.actions.length; i++) {
  const actionSpec = recipe.actions[i];
  // … existing handler dispatch with the augmented ctx …
  const r = await handler({ …, nextActionIndex: i, recipeRunId }, actionSpec.config ?? {});
  results.push({ ...r, type: actionSpec.type, duration_ms: Date.now() - t0 });

  if (r.meta?.defer === true) {
    // Wait scheduled — rest of this recipe resumes from pending_actions drain.
    break;
  }
  if (r.status === "failure") break;
  // existing aiOutputs stash …
}
```

### B.4 Pre-create the run row so `recipeRunId` is available

Currently `runRecipe` calls `writeRun(...)` *after* the action loop. To make `recipeRunId` available to the `send_email` action (so it can build `Reply-To`), the worker must insert the `automation_runs` row first with empty `action_results`, then `UPDATE` it after the loop instead of `INSERT`.

`runLog.ts` gets two helpers:

```ts
export const createRun = async (admin, args) => {
  const { data } = await admin
    .from("automation_runs")
    .insert({
      recipe_id: args.recipeId,
      event_id: args.eventId,
      organization_id: args.organizationId,
      status: "success",        // placeholder, updated when actions finish
      action_results: [],
      started_at: args.startedAt.toISOString(),
      finished_at: args.startedAt.toISOString(),
    })
    .select("run_id")
    .single();
  return (data as { run_id: string }).run_id;
};

export const finalizeRun = async (admin, runId, results, startedAt, finishedAt) => {
  const status = overallStatus(results);
  await admin.from("automation_runs").update({
    status,
    action_results: results,
    finished_at: finishedAt.toISOString(),
  }).eq("run_id", runId);
  await admin.rpc("increment_recipe_counters", {
    p_recipe_id: (await admin.from("automation_runs").select("recipe_id").eq("run_id", runId).maybeSingle()).data?.recipe_id,
    p_failed: status === "failure",
  });
};
```

### B.5 Pending-action drain — `processPendingActions(admin)`

Runs at the top of each `Deno.serve` tick, before the events drain. Pulls ≤100 rows where `status='pending' AND fire_at <= now()`, resumes each, marks `fired`.

```ts
const processPendingActions = async (admin) => {
  const nowIso = new Date().toISOString();

  const { data: pendings } = await admin
    .from("pending_actions")
    .select(`
      id, organization_id, recipe_id, source_event_id, next_action_index,
      ai_outputs, deal_id, client_id,
      automation_recipes!inner(actions, send_window, enabled, name),
      automation_events(payload, event_type)
    `)
    .eq("status", "pending")
    .lte("fire_at", nowIso)
    .limit(100);

  for (const p of pendings ?? []) {
    if (!p.automation_recipes.enabled) {
      await admin.from("pending_actions").update({ status: "cancelled" }).eq("id", p.id);
      continue;
    }

    const nextValid = nextSendableTime(p.automation_recipes.send_window, new Date());
    if (nextValid.getTime() > Date.now()) {
      await admin.from("pending_actions").update({ fire_at: nextValid.toISOString() }).eq("id", p.id);
      continue;
    }

    if (!p.automation_events) {
      await admin.from("pending_actions").update({ status: "cancelled" }).eq("id", p.id);
      continue;
    }

    // Find the existing automation_runs row to keep appending to it.
    const { data: existingRun } = await admin
      .from("automation_runs")
      .select("run_id")
      .eq("recipe_id", p.recipe_id)
      .eq("event_id", p.source_event_id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await resumeRecipe(
      admin,
      p.automation_recipes,
      p.automation_events,
      p.next_action_index,
      p.ai_outputs,
      existingRun?.run_id ?? null,
    );

    await admin.from("pending_actions").update({ status: "fired" }).eq("id", p.id);
  }
};
```

`resumeRecipe` shares the action loop with `runRecipe` via an `executeActions(admin, recipe, event, startIndex, aiOutputs, existingRunId)` helper:

- If `existingRunId` is set, updates that row's `action_results` with the new results appended.
- If null, creates a new run row.

### B.6 Send-window helper — `triggers/sendWindow.ts`

```ts
interface SendWindow {
  hours: [number, number];   // [9, 18] inclusive start, exclusive end
  days: number[];             // ISO weekday: 1=Mon .. 7=Sun
  timezone: string;           // IANA TZ
}

export const nextSendableTime = (window: SendWindow | null, now: Date): Date => {
  if (!window) return now;
  let probe = new Date(now);
  // 168 hours = 1 week — protects against unsatisfiable windows.
  for (let i = 0; i < 168; i++) {
    if (isWithinWindow(window, probe)) return probe;
    probe = new Date(probe.getTime() + 3_600_000);
    probe.setMinutes(0, 0, 0);
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
  const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(weekday);
  const iso = wd === 0 ? 7 : wd;
  if (!w.days.includes(iso)) return false;
  if (hour < w.hours[0] || hour >= w.hours[1]) return false;
  return true;
};
```

### B.7 ACTION_REGISTRY + ActionType extension

`ActionType` union gains `"wait"`. `ACTION_TYPES` array gains `"wait"`. `ACTION_LABEL` gains `wait: "Wait"`. `ACTION_REGISTRY` gains `wait: wait` (from `actions/wait.ts`).

---

## Section C — `sendEmail.ts` rewrite (Gmail API direct + Reply-To)

### C.1 Why

Current `sendEmail.ts` delegates to `integrations-action`, which only handles `whoami`. Same indirection bug as the recent `slackPost.ts` fix. The new handler reads the encrypted Gmail token, decrypts it, calls Gmail's REST API directly, and includes a Reply-To header that routes inbound replies to the SendGrid webhook.

### C.2 New `sendEmail.ts`

```ts
// supabase/functions/crm-run-automations/actions/sendEmail.ts

import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";
import { decrypt } from "../../_shared/crypto.ts";

const TOKEN_KEY = Deno.env.get("INTEGRATION_TOKEN_KEY");
const INBOUND_DOMAIN = Deno.env.get("SEQUENCE_INBOUND_DOMAIN") ?? "inbound.taskcalendar.co.uk";

interface ResolveContext {
  admin: any;
  orgId: string;
  payload: Record<string, unknown>;
}

const resolveRecipient = async (ctx: ResolveContext, spec: string): Promise<string | null> => {
  if (spec === "deal_owner_email") {
    const dealId = ctx.payload.deal_id as string | undefined;
    if (!dealId) return null;
    const { data: deal } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
    if (!deal?.owner_id) return null;
    const { data: userResp } = await ctx.admin.auth.admin.getUserById(deal.owner_id);
    return userResp?.user?.email ?? null;
  }
  if (spec === "client_email") {
    const clientId = ctx.payload.client_id as string | undefined;
    if (!clientId) return null;
    const { data: client } = await ctx.admin.from("clients").select("email").eq("client_id", clientId).maybeSingle();
    return client?.email ?? null;
  }
  return spec; // literal address
};

// Sender user_id = deal owner, fallback to recipe creator.
const resolveSenderUserId = async (ctx: any): Promise<string | null> => {
  const dealId = (ctx.event.payload as { deal_id?: string }).deal_id;
  if (dealId) {
    const { data } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
    if (data?.owner_id) return data.owner_id;
  }
  const { data: recipe } = await ctx.admin
    .from("automation_recipes").select("created_by").eq("recipe_id", ctx.recipeId).maybeSingle();
  return recipe?.created_by ?? null;
};

const buildRawMessage = (
  fromEmail: string, fromName: string | null,
  to: string, replyTo: string, subject: string, bodyHtml: string,
): string => {
  const fromHeader = fromName ? `${fromName.replace(/"/g, "")} <${fromEmail}>` : fromEmail;
  const boundary = `tcb_${crypto.randomUUID()}`;
  const lines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    bodyHtml.replace(/<[^>]+>/g, ""),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    bodyHtml,
    "",
    `--${boundary}--`,
  ];
  const utf8 = new TextEncoder().encode(lines.join("\r\n"));
  let bin = "";
  utf8.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const sendEmail: ActionHandler = async (ctx, config) => {
  if (!TOKEN_KEY) {
    return { status: "failure", message: "INTEGRATION_TOKEN_KEY not set on the worker" };
  }

  const senderUserId = await resolveSenderUserId(ctx);
  if (!senderUserId) {
    return { status: "skipped", message: "Could not resolve sender for this event" };
  }

  const { data: integration } = await ctx.admin
    .from("integrations")
    .select("access_token_encrypted, status, metadata")
    .eq("user_id", senderUserId)
    .eq("provider", "gmail")
    .eq("status", "active")
    .maybeSingle();
  if (!integration) {
    return {
      status: "skipped",
      message: "No active Gmail integration for the sender — connect in Settings → Integrations",
    };
  }

  let accessToken: string;
  try {
    accessToken = await decrypt(integration.access_token_encrypted as string, TOKEN_KEY);
  } catch (err) {
    return { status: "failure", message: `Token decrypt failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const to = await resolveRecipient(
    { admin: ctx.admin, orgId: ctx.orgId, payload: ctx.event.payload as any },
    String(config.to ?? ""),
  );
  if (!to) return { status: "skipped", message: "Could not resolve recipient" };

  const subject = substitute(String(config.subject ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
    aiOutputs: ctx.aiOutputs,
  });
  const bodyHtml = substitute(String(config.body_html ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
    aiOutputs: ctx.aiOutputs,
  });

  const fromEmail = (integration.metadata as { email?: string })?.email;
  if (!fromEmail) {
    return { status: "failure", message: "Connected Gmail account has no email in metadata — reconnect to populate" };
  }
  const fromName = (integration.metadata as { name?: string })?.name ?? null;
  const replyTo = `reply+${ctx.recipeRunId ?? ctx.recipeId}@${INBOUND_DOMAIN}`;

  const raw = buildRawMessage(fromEmail, fromName, to, replyTo, subject, bodyHtml);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "failure", message: `Gmail HTTP ${res.status}: ${body.slice(0, 200)}` };
  }
  const respBody = await res.json();
  return {
    status: "success",
    meta: {
      message_id: (respBody as { id?: string }).id ?? null,
      thread_id: (respBody as { threadId?: string }).threadId ?? null,
      to,
      reply_to: replyTo,
    },
  };
};
```

### C.3 Failure modes (summary)

| Condition | Status | Message |
|---|---|---|
| No `INTEGRATION_TOKEN_KEY` | failure | "INTEGRATION_TOKEN_KEY not set on the worker" |
| No deal owner + no recipe creator | skipped | "Could not resolve sender for this event" |
| Sender has no active Gmail integration | skipped | "No active Gmail integration for the sender — connect in Settings → Integrations" |
| Token decrypt threw | failure | "Token decrypt failed: \<err>" |
| Can't resolve recipient | skipped | "Could not resolve recipient" |
| Integration row lacks `metadata.email` | failure | "Connected Gmail account has no email in metadata — reconnect to populate" |
| Gmail 4xx/5xx | failure | "Gmail HTTP \<status>: \<body>" |

---

## Section D — SendGrid Inbound Parse + reply detection

### D.1 External setup (one-time, done by the user before deploy)

1. Create SendGrid account at https://signup.sendgrid.com. Free tier covers 100 inbound emails/day; recommend $20/mo Essentials for real use.
2. Add MX records on `inbound.taskcalendar.co.uk` → `mx.sendgrid.net` priority 10.
3. SendGrid → Settings → Inbound Parse → Add Host & URL. Hostname `inbound.taskcalendar.co.uk`. Destination URL `https://<your-supabase-project>.supabase.co/functions/v1/gmail-inbound`. **Check "Send signed POSTs"**.
4. Copy the signing key from the SendGrid hostname row.
5. `npx supabase secrets set SENDGRID_INBOUND_WEBHOOK_SECRET=<key> SEQUENCE_INBOUND_DOMAIN=inbound.taskcalendar.co.uk`.
6. `npx supabase functions deploy gmail-inbound --no-verify-jwt`.

Document in `docs/superpowers/deployment/sequences-inbound-setup.md` (created as part of the plan).

### D.2 `gmail-inbound` Edge Function

`supabase/functions/gmail-inbound/index.ts`:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INBOUND_SECRET = Deno.env.get("SENDGRID_INBOUND_WEBHOOK_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, x-twilio-email-event-webhook-signature, x-twilio-email-event-webhook-timestamp",
};

const verifySignature = async (
  body: string, timestamp: string, signatureB64: string,
): Promise<boolean> => {
  if (!INBOUND_SECRET) return false;
  try {
    const publicKeyDer = Uint8Array.from(atob(INBOUND_SECRET), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "spki", publicKeyDer,
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    const signature = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    const data = new TextEncoder().encode(timestamp + body);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, data);
  } catch {
    return false;
  }
};

export const extractRunIdFromTo = (toHeader: string): string | null => {
  const m = toHeader.match(/reply\+([0-9a-f-]{36})@/i);
  return m ? m[1] : null;
};

const extractBoundary = (req: Request): string => {
  const ct = req.headers.get("content-type") ?? "";
  const m = ct.match(/boundary="?([^";]+)"?/);
  return m ? m[1] : "----";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const rawBody = await req.text();
  const sig = req.headers.get("x-twilio-email-event-webhook-signature") ?? "";
  const ts = req.headers.get("x-twilio-email-event-webhook-timestamp") ?? "";
  if (!await verifySignature(rawBody, ts, sig)) {
    return new Response(JSON.stringify({ error: "invalid_signature" }), {
      status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const form = await new Request(
    "data:multipart/form-data;boundary=" + extractBoundary(req),
    { method: "POST", body: rawBody, headers: { "content-type": req.headers.get("content-type") ?? "" } },
  ).formData();

  const toField = String(form.get("to") ?? "");
  const fromField = String(form.get("from") ?? "");
  const subject = String(form.get("subject") ?? "");
  const text = String(form.get("text") ?? "");

  const runId = extractRunIdFromTo(toField);
  if (!runId) {
    return new Response(JSON.stringify({ ok: true, note: "no run id" }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: run } = await admin
    .from("automation_runs")
    .select("recipe_id, organization_id, event_id")
    .eq("run_id", runId)
    .maybeSingle();
  if (!run) {
    return new Response(JSON.stringify({ ok: true, note: "run not found" }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  await admin.from("sequence_replies").insert({
    organization_id: run.organization_id,
    recipe_run_id: runId,
    recipe_id: run.recipe_id,
    from_address: fromField.slice(0, 320),
    subject: subject.slice(0, 1000),
    body_preview: text.slice(0, 500),
    raw_payload: Object.fromEntries(form),
  });

  await admin.from("pending_actions")
    .update({ status: "reply_received" })
    .eq("status", "pending")
    .eq("recipe_id", run.recipe_id)
    .eq("source_event_id", run.event_id);

  return new Response(JSON.stringify({ ok: true, cancelled_run: runId }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
```

### D.3 Stop conditions (recap)

- **Deal stage → won/lost**: DB trigger `cancel_pending_actions_on_close_t` in migration 067.
- **Admin clicks Stop**: `stop_pending_actions_for_run(p_run_id)` RPC in migration 067, invoked from `RecipeRunsList` UI.
- **Recipient reply**: handled by `gmail-inbound` above.
- **Hard recursion limit**: `wait` handler returns failure after 10 pending actions for the same (recipe, event).

---

## Section E — Recipe builder additions + Sequences UI lens

### E.1 New `wait` editor in `RecipeBuilder.tsx`

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
        Actions after this wait fire after the delay, subject to the recipe's
        send window. Reply detection cancels pending actions for this recipe run.
      </p>
    </div>
  );
```

`ACTION_LABEL` gains `wait: "Wait"`.

### E.2 Send-window collapsible (only shown when recipe contains a `send_email` action)

A new section inside the RecipeBuilder modal, between the Name row and the When/If/Then rows. Uses a shadcn `Collapsible` for compactness. State lives in `RecipeDraft.sendWindow: { hours, days, timezone } | null`.

Three inputs for hours start/end + timezone, seven checkboxes for days, a "Remove window (send any time)" button to clear it.

`upsertRecipe(orgId, recipeId, draft)` forwards `sendWindow` via the new `p_send_window jsonb` parameter on `crm_upsert_recipe`.

### E.3 Sequences view — `Settings → Sequences`

New file `src/components/settings/SequencesSettingsTab.tsx`. Reuses `useAutomations()` and filters:

```ts
const sequences = recipes.filter((r) =>
  r.actions.some((a) => a.type === "send_email") &&
  r.actions.some((a) => a.type === "wait")
);
```

Each card shows:
- Sequence name + active toggle
- One-line summary: *"When client_created · Then 3 emails over 7 days"*
- Active enrollments (count of `pending_actions` with `status='pending'` for this recipe)
- Replies in the last 30 days (count of `sequence_replies` for this recipe)
- Stopped breakdown (group `pending_actions.status` by reason, last 30 days)
- Buttons: View runs (jumps to Automations tab filtered to this recipe), Edit, Delete

Numbers refresh via realtime channel on `pending_actions` + `sequence_replies` (same pattern as `useAutomations`).

A second pane (or tab) inside the Sequences view: **Replies inbox** — last 100 `sequence_replies` rows, click → drawer with full body, link to the recipe run.

### E.4 "Stop sequence" button in run history

`RecipeRunsList.tsx` gets one new feature: per-row "Stop sequence" button visible when the row has any matching `pending_actions` with `status='pending'`. Calls `stop_pending_actions_for_run(run_id)` RPC. Toasts the count of cancelled actions.

The runs query joins:

```sql
select r.*, exists(
  select 1 from pending_actions p
  where p.recipe_id = r.recipe_id
    and p.source_event_id = r.event_id
    and p.status = 'pending'
) as has_pending_actions
from automation_runs r
where r.recipe_id = ?
order by r.started_at desc
limit 50
```

### E.5 Settings tab order

```
… Automations · Sequences · AI Usage · Organization
```

Inserted between Automations and AI Usage. Sidebar/root nav unchanged.

---

## Section F — Testing, rollout, open questions

### F.1 Testing

**Unit (vitest):**
- `tests/unit/sendWindow.test.ts` — within window, outside hours, outside days, timezone offset.
- `tests/unit/wait.test.ts` — defer meta, reject zero/negative, hard cap at 10.
- `tests/unit/replyToToken.test.ts` — `extractRunIdFromTo` matrix.

**Integration (manual, until DB test harness):**
- Recipe with `When client_created → send_email → wait 1 min → send_email`. Create client. Confirm two emails, pending row goes pending → fired.
- Same recipe, move deal to Won mid-wait. Confirm second email skipped, status `stopped_by_stage`.
- Reply detection (after SendGrid setup): reply to first email. Confirm `sequence_replies` row + pending row → `reply_received`.
- Send window: wait that resolves at 3am Saturday with a 9–17 weekday window. Confirm `fire_at` advances to 9am Monday.

### F.2 Rollout

1. Apply migration `067_sequences.sql`.
2. Deploy `crm-run-automations` (wait handler + pending drain + send-window check + sendEmail rewrite).
3. Deploy `gmail-inbound --no-verify-jwt`.
4. External setup: SendGrid account, MX records, hostname config, copy signing key.
5. Set `SENDGRID_INBOUND_WEBHOOK_SECRET` + `SEQUENCE_INBOUND_DOMAIN` secrets.
6. Frontend redeploy with wait editor + send-window block + Sequences tab.
7. Beta: build one short-cycle recipe (1-minute waits) end-to-end. Verify reply detection.

### F.3 Operational concerns

- **Pending backlog**: worker drains ≤100 per tick. Org sending 100 sequences/day fits easily. Backlog >1000 in one tick means worker exceeds 55s — flag if you ever hit it.
- **SendGrid bill**: free tier 100 inbound/day; $20/mo Essentials covers real use.
- **Token refresh**: `sendEmail.ts` does not auto-refresh expired Gmail tokens. When expired, send fails with HTTP 401 → user reconnects. **Follow-up**: service-role token refresh.
- **Reply-To spoofing**: UUID v4 = 122 bits of entropy; brute-force infeasible. SendGrid signature verification means only emails delivered to your inbound subdomain count.
- **Trigger interaction with deal-close**: a recipe with `When deal enters Won → send_email → wait → send_email` will have its second email cancelled by the same trigger that fired it. Flag in the builder if trigger stage is won/lost AND recipe contains wait+send. Out of scope for v1 enforcement; document.

### F.4 Out of scope

- Auto-refresh of expired Gmail tokens from cron.
- Open/click tracking.
- A/B variant testing.
- Bulk enrollment UI (sequences fire from triggers only).
- Pause + resume (only stop).
- Per-recipient unsubscribe link.
- Bounce detection.
- Multiple Gmail accounts per user.

### F.5 Open questions

1. **Org default timezone**: defaults to `UTC`. Document where to change it (Settings → Organization).
2. **Drain limit per tick (100)**: shared with events drain. If sequences crowd out events, split workers in v2.
3. **Reply-To token format**: spec uses run_id only. Recipe_id is recoverable via the `automation_runs` lookup; including it in the token would let us match across deleted runs but that's a corner case.

### F.6 V2 / future work

- Service-role token refresh for Gmail.
- Tracking pixel for opens (opt-in per org).
- Sequence templates ("starter sequences").
- Subject-line A/B testing.
- Snooze / pause-until.
- AI-suggested send times.
- Multiple Gmail accounts per user.
