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
