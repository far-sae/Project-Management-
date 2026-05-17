// src/services/supabase/leadScoring.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type ScoreBand = "hot" | "warm" | "cold";

export type ScoringField =
  | "industry" | "annual_revenue" | "employee_count" | "source"
  | "status" | "type" | "rating" | "country"
  | "recent_activity_days" | "open_deals_count" | "tag_present";

export type ScoringOperator =
  | "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in" | "contains" | "exists";

export interface LeadScoringRule {
  ruleId: string;
  organizationId: string;
  label: string;
  field: ScoringField;
  operator: ScoringOperator;
  value: unknown;
  points: number;
  position: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Thresholds {
  hot: number;
  warm: number;
}

export const mapRuleRow = (r: Record<string, unknown>): LeadScoringRule => ({
  ruleId: r.rule_id as string,
  organizationId: r.organization_id as string,
  label: r.label as string,
  field: r.field as ScoringField,
  operator: r.operator as ScoringOperator,
  value: r.value,
  points: Number(r.points ?? 0),
  position: Number(r.position ?? 0),
  enabled: Boolean(r.enabled),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const VALID_OPERATORS: ScoringOperator[] = [
  "eq","neq","gte","lte","gt","lt","in","contains","exists",
];

const VALID_FIELDS: ScoringField[] = [
  "industry","annual_revenue","employee_count","source","status","type",
  "rating","country","recent_activity_days","open_deals_count","tag_present",
];

export interface RuleInput {
  label: string;
  field: ScoringField;
  operator: ScoringOperator;
  value: unknown;
  points: number;
  position?: number;
  enabled?: boolean;
}

export const validateRuleInput = (input: RuleInput): void => {
  if (!input.label?.trim()) throw new Error("Rule label is required");
  if (!VALID_FIELDS.includes(input.field)) throw new Error("Invalid field");
  if (!VALID_OPERATORS.includes(input.operator)) throw new Error("Invalid operator");
  if (!Number.isFinite(input.points)) throw new Error("Points must be a number");
  if (input.points < -100 || input.points > 100) throw new Error("Points out of range");
};

export const bandFromScore = (score: number, t: Thresholds): ScoreBand =>
  score >= t.hot ? "hot" : score >= t.warm ? "warm" : "cold";

export const getRules = async (organizationId: string): Promise<LeadScoringRule[]> => {
  const { data, error } = await supabase
    .from("lead_scoring_rules")
    .select("*")
    .eq("organization_id", organizationId)
    .order("position", { ascending: true });
  if (error) {
    logger.error("Failed to load lead scoring rules:", error);
    return [];
  }
  return (data || []).map(mapRuleRow);
};

export const getThresholds = async (organizationId: string): Promise<Thresholds> => {
  const { data } = await supabase
    .from("lead_scoring_thresholds")
    .select("hot, warm")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return { hot: data?.hot ?? 70, warm: data?.warm ?? 40 };
};

export const createRule = async (
  organizationId: string,
  input: RuleInput,
): Promise<LeadScoringRule> => {
  validateRuleInput(input);
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("crm_create_lead_scoring_rule", {
      p_organization_id: organizationId,
      p_label: input.label.trim(),
      p_field: input.field,
      p_operator: input.operator,
      p_value: input.value,
      p_points: input.points,
      p_position: input.position ?? 1,
      p_enabled: input.enabled ?? true,
    })
    .single();
  if (!rpcError && rpcData) return mapRuleRow(rpcData as Record<string, unknown>);
  if (rpcError && !isMissingRpcError(rpcError)) throw rpcError;

  const { data, error } = await supabase
    .from("lead_scoring_rules")
    .insert({
      organization_id: organizationId,
      label: input.label.trim(),
      field: input.field,
      operator: input.operator,
      value: input.value,
      points: input.points,
      position: input.position ?? 1,
      enabled: input.enabled ?? true,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRuleRow(data);
};

export const updateRule = async (
  ruleId: string,
  input: Partial<RuleInput>,
): Promise<LeadScoringRule> => {
  if (input.operator && !VALID_OPERATORS.includes(input.operator)) {
    throw new Error("Invalid operator");
  }
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("crm_update_lead_scoring_rule", {
      p_rule_id: ruleId,
      p_patch: input,
    })
    .single();
  if (!rpcError && rpcData) return mapRuleRow(rpcData as Record<string, unknown>);
  if (rpcError && !isMissingRpcError(rpcError)) throw rpcError;

  const update: Record<string, unknown> = {};
  if (input.label !== undefined) update.label = input.label.trim();
  if (input.field !== undefined) update.field = input.field;
  if (input.operator !== undefined) update.operator = input.operator;
  if (input.value !== undefined) update.value = input.value;
  if (input.points !== undefined) update.points = input.points;
  if (input.position !== undefined) update.position = input.position;
  if (input.enabled !== undefined) update.enabled = input.enabled;
  const { data, error } = await supabase
    .from("lead_scoring_rules")
    .update(update)
    .eq("rule_id", ruleId)
    .select()
    .single();
  if (error) throw error;
  return mapRuleRow(data);
};

export const deleteRule = async (ruleId: string): Promise<void> => {
  const { error: rpcError } = await supabase.rpc("crm_delete_lead_scoring_rule", {
    p_rule_id: ruleId,
  });
  if (!rpcError) return;
  if (!isMissingRpcError(rpcError)) throw rpcError;

  const { error } = await supabase.from("lead_scoring_rules").delete().eq("rule_id", ruleId);
  if (error) throw error;
};

export const saveThresholds = async (
  organizationId: string,
  t: Thresholds,
): Promise<Thresholds> => {
  if (t.hot < t.warm) throw new Error("Hot threshold must be ≥ warm");
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("crm_save_lead_scoring_thresholds", {
      p_organization_id: organizationId,
      p_hot: t.hot,
      p_warm: t.warm,
    })
    .single();
  if (!rpcError && rpcData) {
    return {
      hot: Number((rpcData as Record<string, unknown>).hot),
      warm: Number((rpcData as Record<string, unknown>).warm),
    };
  }
  if (rpcError && !isMissingRpcError(rpcError)) throw rpcError;

  const { data, error } = await supabase
    .from("lead_scoring_thresholds")
    .upsert({ organization_id: organizationId, hot: t.hot, warm: t.warm })
    .select("hot, warm")
    .single();
  if (error) throw error;
  return { hot: data.hot, warm: data.warm };
};

const isMissingRpcError = (error: { code?: string; message?: string }): boolean => {
  const message = (error.message ?? "").toLowerCase();
  return error.code === "42883" || message.includes("function") && message.includes("does not exist");
};
