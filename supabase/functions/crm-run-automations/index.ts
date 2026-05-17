// supabase/functions/crm-run-automations/index.ts
import { makeAdmin } from "./shared/client.ts";
import { writeRun, createRun, finalizeRun, finalizeResumedRun } from "./shared/runLog.ts";
import { triggerConfigMatches } from "./triggers/matchers.ts";
import { evaluateConditions } from "./conditions/evaluator.ts";
import { enqueueCronEvents } from "./triggers/cron.ts";
import { nextSendableTime, SendWindow } from "./triggers/sendWindow.ts";
import { ACTION_REGISTRY } from "./actions/index.ts";
import { AutomationEvent, Recipe, ActionResult } from "./shared/types.ts";
import { matchesSlackTrigger, matchesSlackReaction } from "./triggers/slackMatch.ts";

// Look up the Slack bot_user_id for an org (cached in integration metadata
// at OAuth time). Returns null if no Slack integration or no bot_user_id.
const loadSlackBotUserId = async (admin: any, orgId: string): Promise<string | null> => {
  const { data } = await admin.from("integrations")
    .select("metadata")
    .eq("organization_id", orgId)
    .eq("provider", "slack")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return ((data?.metadata as { bot_user_id?: string })?.bot_user_id) ?? null;
};

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
  const workspaceId = (event.payload as any).workspace_id as string | undefined;
  const projectId = (event.payload as any).project_id as string | undefined;
  const taskId = (event.payload as any).task_id as string | undefined;
  const ctx: any = {};
  if (dealId) {
    const { data } = await admin.from("deals").select("title, value, currency, stage, owner_id, owner_name").eq("deal_id", dealId).maybeSingle();
    if (data) ctx.deal = data;
  }
  if (clientId) {
    const { data } = await admin.from("clients").select("name, email, industry, country, tags").eq("client_id", clientId).maybeSingle();
    if (data) ctx.client = data;
  }
  if (workspaceId) {
    const { data } = await admin.from("workspaces").select("workspace_id, name, is_default").eq("workspace_id", workspaceId).maybeSingle();
    if (data) ctx.workspace = data;
  }
  if (projectId) {
    const { data } = await admin.from("projects").select("project_id, name, description, owner_id, workspace_id, end_date").eq("project_id", projectId).maybeSingle();
    if (data) ctx.project = data;
  }
  if (taskId) {
    const { data } = await admin.from("tasks").select("task_id, title, description, status, priority, due_date, assignees, project_id").eq("task_id", taskId).maybeSingle();
    if (data) ctx.task = data;
  }
  return ctx;
};

const runRecipe = async (admin: any, recipe: Recipe, event: AutomationEvent): Promise<void> => {
  const started = new Date();
  const ctx = await loadEntityContext(admin, event);

  if (recipe.trigger_type === "slack_message_received") {
    const cfg = (recipe.trigger_config ?? {}) as {
      channels?: string[]; keyword?: string; mention_only?: boolean;
    };
    const botUserId = cfg.mention_only
      ? await loadSlackBotUserId(admin, event.organization_id)
      : null;
    if (!matchesSlackTrigger(
      cfg,
      (event.payload ?? {}) as { channel_id?: string; text?: string },
      { botUserId },
    )) return;
  }

  if (recipe.trigger_type === "slack_reaction_added") {
    if (!matchesSlackReaction(
      (recipe.trigger_config ?? {}) as { reactions?: string[]; channels?: string[] },
      (event.payload ?? {}) as { reaction?: string; channel_id?: string },
    )) return;
  }

  if (!evaluateConditions(recipe.conditions ?? [], event, ctx)) return;

  // Special trigger: agent_intake delegates to ai-agent-suggest and skips
  // the normal action loop entirely (the agent IS the action).
  if (recipe.trigger_type === "agent_intake" && event.event_type === "client_created") {
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-agent-suggest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trigger_type: "intake",
          organization_id: event.organization_id,
          client_id: (event.payload as { client_id?: string }).client_id,
          source_event_id: event.event_id,
        }),
      });
    } catch (e) {
      console.error("agent_intake dispatch failed:", e);
    }
    return;
  }

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

  return new Response(JSON.stringify({ ok: true, processed, pendings_drained: pendingsDrained }), {
    headers: { "content-type": "application/json" },
  });
});
