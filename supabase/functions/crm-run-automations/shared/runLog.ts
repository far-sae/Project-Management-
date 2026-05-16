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
