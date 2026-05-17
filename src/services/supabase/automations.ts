import { supabase } from "./config";
import { logger } from "@/lib/logger";

export const TRIGGER_TYPES = [
  "deal_stage_entered",
  "deal_score_band_changed",
  "deal_field_changed",
  "form_submitted",
  "client_created",
  "client_tagged",
  "task_overdue",
  "scheduled",
  "agent_intake",
  "slack_message_received",
] as const;

export const ACTION_TYPES = [
  "create_task",
  "tag",
  "set_field",
  "change_owner",
  "add_note",
  "move_deal_stage",
  "webhook",
  "slack_post",
  "send_email",
  "ai_summarize",
  "ai_classify_lead",
  "ai_draft_email",
  "ai_extract",
  "ai_translate",
  "wait",
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type ActionType = (typeof ACTION_TYPES)[number];

export interface RecipeCondition {
  field: string;
  operator: "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in" | "contains" | "exists";
  value: unknown;
}

export interface RecipeAction {
  type: ActionType;
  config: Record<string, unknown>;
}

export interface RecipeDraft {
  name: string;
  description?: string | null;
  enabled: boolean;
  trigger: { type: TriggerType; config: Record<string, unknown> };
  conditions: RecipeCondition[];
  actions: RecipeAction[];
  sendWindow?: { hours: [number, number]; days: number[]; timezone: string } | null;
}

export interface Recipe {
  recipeId: string;
  organizationId: string;
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  conditions: RecipeCondition[];
  actions: RecipeAction[];
  enabled: boolean;
  runCount: number;
  failCount: number;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sendWindow?: { hours: [number, number]; days: number[]; timezone: string } | null;
}

export interface RecipeRun {
  runId: string;
  recipeId: string;
  eventId: string | null;
  organizationId: string;
  status: "success" | "failure" | "skipped" | "partial";
  actionResults: Array<{
    type: ActionType;
    status: "success" | "failure" | "skipped";
    duration_ms?: number;
    message?: string | null;
    meta?: Record<string, unknown>;
  }>;
  startedAt: Date;
  finishedAt: Date;
  hasPendingActions?: boolean;
}

export const validateRecipeDraft = (draft: RecipeDraft): void => {
  if (!draft.name || !draft.name.trim()) {
    throw new Error("Recipe name is required");
  }
  if (!TRIGGER_TYPES.includes(draft.trigger.type)) {
    throw new Error(`Unknown trigger type: ${draft.trigger.type}`);
  }
  if (!Array.isArray(draft.actions) || draft.actions.length === 0) {
    throw new Error("Recipe must have at least one action");
  }
  for (const a of draft.actions) {
    if (!ACTION_TYPES.includes(a.type)) {
      throw new Error(`Unknown action type: ${a.type}`);
    }
    if (a.type === "create_task" && !(a.config?.title as string)?.trim()) {
      throw new Error("create_task requires a title");
    }
    if (a.type === "webhook" && !(a.config?.url as string)) {
      throw new Error("webhook requires a url");
    }
    if (a.type === "slack_post" && !(a.config?.channel_id as string)) {
      throw new Error("slack_post requires a channel_id");
    }
    if (a.type === "send_email") {
      const cfg = a.config as Record<string, unknown> | undefined;
      if (!cfg?.to || !cfg?.subject) {
        throw new Error("send_email requires `to` and `subject`");
      }
    }
  }
};

const TRIGGER_LABELS: Record<TriggerType, string> = {
  deal_stage_entered: "deal enters stage",
  deal_score_band_changed: "deal score band changes",
  deal_field_changed: "deal field changes",
  form_submitted: "form is submitted",
  client_created: "client is created",
  client_tagged: "client is tagged",
  task_overdue: "task becomes overdue",
  scheduled: "scheduled time",
  agent_intake: "AI agent drafts for new lead",
  slack_message_received: "a Slack message is posted",
};

const ACTION_LABELS: Record<ActionType, string> = {
  create_task: "create task",
  tag: "tag client",
  set_field: "set field",
  change_owner: "change owner",
  add_note: "add note",
  move_deal_stage: "move deal",
  webhook: "call webhook",
  slack_post: "post to Slack",
  send_email: "send email",
  ai_summarize: "AI: summarize",
  ai_classify_lead: "AI: classify lead",
  ai_draft_email: "AI: draft email",
  ai_extract: "AI: extract fields",
  ai_translate: "AI: translate",
  wait: "Wait",
};

export const summarizeRecipe = (r: Pick<Recipe, "triggerType" | "actions">): string => {
  const triggerType = (r.triggerType ?? (r as unknown as { trigger_type?: TriggerType }).trigger_type) as TriggerType;
  const t = TRIGGER_LABELS[triggerType] ?? triggerType;
  const a = r.actions.map((x) => ACTION_LABELS[x.type] ?? x.type).join(", ");
  return `When ${t}, then ${a}`;
};

const mapRecipe = (row: Record<string, unknown>): Recipe => ({
  recipeId: row.recipe_id as string,
  organizationId: row.organization_id as string,
  name: row.name as string,
  description: (row.description as string) ?? null,
  triggerType: row.trigger_type as TriggerType,
  triggerConfig: (row.trigger_config as Record<string, unknown>) ?? {},
  conditions: Array.isArray(row.conditions) ? (row.conditions as RecipeCondition[]) : [],
  actions: Array.isArray(row.actions) ? (row.actions as RecipeAction[]) : [],
  enabled: Boolean(row.enabled),
  runCount: Number(row.run_count ?? 0),
  failCount: Number(row.fail_count ?? 0),
  lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
  sendWindow: (row.send_window as Recipe["sendWindow"]) ?? null,
});

const mapRun = (row: Record<string, unknown>): RecipeRun => ({
  runId: row.run_id as string,
  recipeId: row.recipe_id as string,
  eventId: (row.event_id as string) ?? null,
  organizationId: row.organization_id as string,
  status: row.status as RecipeRun["status"],
  actionResults: Array.isArray(row.action_results) ? (row.action_results as RecipeRun["actionResults"]) : [],
  startedAt: new Date(row.started_at as string),
  finishedAt: new Date(row.finished_at as string),
});

export const listRecipes = async (organizationId: string): Promise<Recipe[]> => {
  const { data, error } = await supabase
    .from("automation_recipes")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) {
    logger.error("Failed to load automation recipes:", error);
    return [];
  }
  return (data || []).map(mapRecipe);
};

export const upsertRecipe = async (
  organizationId: string,
  recipeId: string | null,
  draft: RecipeDraft,
): Promise<Recipe> => {
  validateRecipeDraft(draft);
  const { data, error } = await supabase.rpc("crm_upsert_recipe", {
    p_recipe_id: recipeId,
    p_organization_id: organizationId,
    p_name: draft.name,
    p_description: draft.description ?? null,
    p_trigger_type: draft.trigger.type,
    p_trigger_config: draft.trigger.config,
    p_conditions: draft.conditions,
    p_actions: draft.actions,
    p_enabled: draft.enabled,
    p_send_window: draft.sendWindow ?? null,
  }).single();
  if (error) throw error;
  return mapRecipe(data as Record<string, unknown>);
};

export const deleteRecipe = async (recipeId: string): Promise<void> => {
  const { error } = await supabase.rpc("crm_delete_recipe", { p_recipe_id: recipeId });
  if (error) throw error;
};

export const setRecipeEnabled = async (recipeId: string, enabled: boolean): Promise<void> => {
  // Use the upsert RPC indirectly by loading + re-saving; cheap and avoids a second RPC.
  // For toggle UX we expose this thin wrapper that the AutomationsSettingsTab calls.
  const { data, error: loadErr } = await supabase
    .from("automation_recipes")
    .select("*")
    .eq("recipe_id", recipeId)
    .maybeSingle();
  if (loadErr || !data) throw loadErr ?? new Error("Recipe not found");
  await upsertRecipe(data.organization_id, recipeId, {
    name: data.name,
    description: data.description,
    enabled,
    trigger: { type: data.trigger_type, config: data.trigger_config ?? {} },
    conditions: data.conditions ?? [],
    actions: data.actions ?? [],
  });
};

export const listRuns = async (
  recipeId: string,
  limit = 50,
): Promise<RecipeRun[]> => {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("*")
    .eq("recipe_id", recipeId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    logger.error("Failed to load automation runs:", error);
    return [];
  }

  const rows = data ?? [];
  const pendingByEvent: Record<string, boolean> = {};
  if (rows.length > 0) {
    const { data: pendings } = await supabase
      .from("pending_actions")
      .select("source_event_id")
      .eq("recipe_id", recipeId)
      .eq("status", "pending");
    for (const p of pendings ?? []) {
      const eventId = p.source_event_id as string | null;
      if (eventId) pendingByEvent[eventId] = true;
    }
  }

  return rows.map((r) => ({
    ...mapRun(r),
    hasPendingActions: !!pendingByEvent[(r.event_id as string) ?? ""],
  }));
};

// ============================================================
// Slack channel list — used by the recipe builder's channel picker
// when the trigger is slack_message_received.
// ============================================================
export interface SlackChannel { id: string; name: string }

export const listSlackChannels = async (): Promise<SlackChannel[]> => {
  const { data, error } = await supabase.functions.invoke("slack-list-channels", {
    body: {},
  });
  if (error) {
    logger.error("Failed to load Slack channels:", error);
    return [];
  }
  const channels = ((data as { channels?: SlackChannel[] })?.channels ?? []);
  return channels;
};
