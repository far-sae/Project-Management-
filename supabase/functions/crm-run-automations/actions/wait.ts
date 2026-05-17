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
