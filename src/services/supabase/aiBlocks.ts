// src/services/supabase/aiBlocks.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface AiBlockRun {
  runId: string;
  organizationId: string;
  recipeId: string | null;
  actionType: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsdCents: number | null;
  status: "success" | "failure" | "skipped";
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface AiBlockUsage {
  monthlyRunCap: number;
  currentMonthRuns: number;
  currentMonthSpendCents: number;
  currentMonthStartedAt: Date;
}

const mapRun = (r: Record<string, unknown>): AiBlockRun => ({
  runId: r.run_id as string,
  organizationId: r.organization_id as string,
  recipeId: (r.recipe_id as string) ?? null,
  actionType: r.action_type as string,
  model: r.model as string,
  inputTokens: r.input_tokens != null ? Number(r.input_tokens) : null,
  outputTokens: r.output_tokens != null ? Number(r.output_tokens) : null,
  costUsdCents: r.cost_usd_cents != null ? Number(r.cost_usd_cents) : null,
  status: r.status as AiBlockRun["status"],
  errorMessage: (r.error_message as string) ?? null,
  durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
  createdAt: new Date(r.created_at as string),
});

export const listRuns = async (
  organizationId: string,
  limit = 50,
): Promise<AiBlockRun[]> => {
  const { data, error } = await supabase
    .from("ai_block_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    logger.error("Failed to load AI block runs:", error);
    return [];
  }
  return (data || []).map(mapRun);
};

export const getUsage = async (organizationId: string): Promise<AiBlockUsage> => {
  const { data: cap } = await supabase
    .from("ai_block_usage_caps")
    .select("monthly_run_cap, current_month_runs, current_month_started_at")
    .eq("organization_id", organizationId)
    .maybeSingle();

  // The DB function lazily creates the row on first AI call. Default if not present.
  const monthlyRunCap = (cap?.monthly_run_cap as number) ?? 1000;
  const calendarMonthStartedAt = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const capMonthStartedAt = cap?.current_month_started_at
    ? new Date(cap.current_month_started_at as string)
    : calendarMonthStartedAt;
  const currentMonthStartedAt = capMonthStartedAt < calendarMonthStartedAt
    ? calendarMonthStartedAt
    : capMonthStartedAt;

  // Count actual run rows so AI Agent usage is reflected even when it writes
  // telemetry directly instead of going through check_and_increment_ai_cap().
  const monthStart = new Date(currentMonthStartedAt);
  const { count: currentMonthRuns } = await supabase
    .from("ai_block_runs")
    .select("run_id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", monthStart.toISOString());

  // Sum current-month spend by querying ai_block_runs.
  const { data: rows } = await supabase
    .from("ai_block_runs")
    .select("cost_usd_cents")
    .eq("organization_id", organizationId)
    .gte("created_at", monthStart.toISOString());
  const currentMonthSpendCents = (rows ?? []).reduce(
    (sum, r) => sum + Number((r as { cost_usd_cents?: number }).cost_usd_cents ?? 0),
    0,
  );

  return {
    monthlyRunCap,
    currentMonthRuns: currentMonthRuns ?? 0,
    currentMonthSpendCents,
    currentMonthStartedAt,
  };
};

export const setUsageCap = async (
  organizationId: string,
  newCap: number,
): Promise<void> => {
  const { error } = await supabase.rpc("set_ai_block_cap", {
    p_org: organizationId,
    p_cap: newCap,
  });
  if (error) throw error;
};
