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
// WITHOUT bumping recipe counters (the original run already did).
export const finalizeResumedRun = async (
  admin: any,
  args: {
    runId: string;
    newResults: ActionResult[];
    finishedAt: Date;
  },
): Promise<void> => {
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
