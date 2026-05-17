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
  activeEnrollments: number;
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
