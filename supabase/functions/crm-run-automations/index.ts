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
