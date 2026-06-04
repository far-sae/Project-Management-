import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { sanitizeDraft } from "./automationDraft";

export const TRIGGER_TYPES = [
  "deal_stage_entered",
  "deal_score_band_changed",
  "deal_field_changed",
  "form_submitted",
  "client_created",
  "client_tagged",
  "workspace_created",
  "project_created",
  "task_created",
  "task_assigned",
  "task_status_changed",
  "email_reply_received",
  "task_overdue",
  "scheduled",
  "agent_intake",
  "slack_message_received",
  "slack_reaction_added",
  "date_relative",
  "deal_inactive",
] as const;

export const ACTION_TYPES = [
  "create_task",
  "create_workspace",
  "create_project",
  "create_project_task",
  "assign_task",
  "create_google_meet",
  "tag",
  "set_field",
  "change_owner",
  "add_note",
  "move_deal_stage",
  "webhook",
  "slack_post",
  "send_email",
  "send_sms",
  "notify",
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

export interface AutomationWorkerResult {
  ok?: boolean;
  processed?: number;
  pendings_drained?: number;
  skipped?: string;
}

let lastWorkerKickAt = 0;
let workerKickInFlight: Promise<AutomationWorkerResult | null> | null = null;

export const kickAutomationWorker = async (
  options: { force?: boolean } = {},
): Promise<AutomationWorkerResult | null> => {
  const now = Date.now();
  if (!options.force && now - lastWorkerKickAt < 15_000) {
    return null;
  }
  if (workerKickInFlight) return workerKickInFlight;

  lastWorkerKickAt = now;
  workerKickInFlight = supabase.functions
    .invoke("crm-run-automations", { body: { source: "app" } })
    .then(({ data, error }) => {
      if (error) {
        logger.warn("Automation worker did not run:", error);
        return null;
      }
      return (data as AutomationWorkerResult) ?? null;
    })
    .catch((err) => {
      logger.warn("Automation worker did not run:", err);
      return null;
    })
    .finally(() => {
      workerKickInFlight = null;
    });

  return workerKickInFlight;
};

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
    if (a.type === "create_workspace" && !(a.config?.name as string)?.trim()) {
      throw new Error("create_workspace requires a name");
    }
    if (a.type === "create_project" && !(a.config?.name as string)?.trim()) {
      throw new Error("create_project requires a name");
    }
    if (a.type === "create_project_task" && !(a.config?.title as string)?.trim()) {
      throw new Error("create_project_task requires a title");
    }
    if (a.type === "assign_task" && !(a.config?.assignee_id as string)?.trim()) {
      throw new Error("assign_task requires an assignee_id");
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
    if (a.type === "send_sms") {
      const cfg = a.config as Record<string, unknown> | undefined;
      if (!(cfg?.to as string)?.trim()) throw new Error("send_sms requires a `to` phone / template");
      if (!(cfg?.body as string)?.trim()) throw new Error("send_sms requires a `body` message");
    }
    if (a.type === "notify") {
      const cfg = a.config as Record<string, unknown> | undefined;
      if (!(cfg?.user as string)?.trim()) throw new Error("notify requires a `user` recipient");
      if (!(cfg?.title as string)?.trim()) throw new Error("notify requires a `title`");
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
  workspace_created: "workspace is created",
  project_created: "project is created",
  task_created: "task is created",
  task_assigned: "task is assigned",
  task_status_changed: "task status changes",
  email_reply_received: "email reply is received",
  task_overdue: "task becomes overdue",
  scheduled: "scheduled time",
  agent_intake: "AI agent drafts for new lead",
  slack_message_received: "a Slack message is posted",
  slack_reaction_added: "an emoji reaction is added",
  date_relative: "a date is N days away (deal)",
  deal_inactive: "a deal goes quiet for N days",
};

const ACTION_LABELS: Record<ActionType, string> = {
  create_task: "create task",
  create_workspace: "create workspace",
  create_project: "create project",
  create_project_task: "create project task",
  assign_task: "assign task",
  create_google_meet: "create Google Meet link",
  tag: "tag client",
  set_field: "set field",
  change_owner: "change owner",
  add_note: "add note",
  move_deal_stage: "move deal",
  webhook: "call webhook",
  slack_post: "post to Slack",
  send_email: "send email",
  send_sms: "send SMS",
  notify: "notify a user in-app",
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

// Cross-instance sync (same pattern as deals/clients/leads). The toggle
// switch in AutomationsSettingsTab needed a page reload before because
// the realtime subscription on `automation_recipes` only fires when the
// user's Supabase project has realtime enabled on that table — which it
// usually isn't for automation tables. The CustomEvent now fires
// alongside every successful upsert/toggle/delete so the same-tab
// useAutomations subscriber refetches and the switch reflects the new
// state without a refresh.
const RECIPES_CHANGED_EVENT = "pm-automations-changed";

export const notifyRecipesChanged = (organizationId: string) => {
  try {
    window.dispatchEvent(new CustomEvent(RECIPES_CHANGED_EVENT, { detail: { organizationId } }));
  } catch { /* ignore */ }
};

export const subscribeToRecipeChanges = (
  organizationId: string,
  onChange: () => void,
): (() => void) => {
  const handler = (e: Event) => {
    const ce = e as CustomEvent<{ organizationId: string }>;
    if (ce.detail?.organizationId !== organizationId) return;
    onChange();
  };
  window.addEventListener(RECIPES_CHANGED_EVENT, handler);
  return () => window.removeEventListener(RECIPES_CHANGED_EVENT, handler);
};

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

  // Primary path: the security-definer RPC. Handles auth + org check
  // server-side so members can save without tripping the admin-only RLS
  // on automation_recipes.
  let { data, error } = await supabase.rpc("crm_upsert_recipe", {
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

  // Fallback: if the RPC isn't deployed (PGRST202 / 42883) or returns a
  // PostgREST 400-class signature drift, try a direct upsert. RLS still
  // applies — admins can pass, members can't — so security isn't bypassed.
  if (error) {
    const e = error as { code?: string; message?: string };
    const code = String(e.code ?? "");
    const isMissingRpc = code === "PGRST202" || code === "42883";
    const isRpcDrift = code.startsWith("PGRST") || code === "22P02";
    if (isMissingRpc || isRpcDrift) {
      const composed = `${e.message ?? "unknown"} [${code || "unknown"}]`;
      logger.warn(
        `crm_upsert_recipe RPC failed (${composed}) — falling back to direct upsert. `
        + `Apply migration 065 if the function is genuinely missing.`,
      );
      const payload: Record<string, unknown> = {
        organization_id: organizationId,
        name: draft.name,
        description: draft.description ?? null,
        trigger_type: draft.trigger.type,
        trigger_config: draft.trigger.config,
        conditions: draft.conditions,
        actions: draft.actions,
        enabled: draft.enabled,
        send_window: draft.sendWindow ?? null,
      };
      if (recipeId) (payload as Record<string, unknown>).recipe_id = recipeId;
      const direct = recipeId
        ? await supabase.from("automation_recipes")
            .update(payload)
            .eq("recipe_id", recipeId)
            .eq("organization_id", organizationId)
            .select()
            .single()
        : await supabase.from("automation_recipes")
            .insert(payload)
            .select()
            .single();
      data = direct.data;
      error = direct.error;
    }
  }

  if (error) {
    const e = error as { code?: string; message?: string; details?: string; hint?: string };
    const composed = [e.message, e.details, e.hint && `(hint: ${e.hint})`, e.code && `[${e.code}]`]
      .filter(Boolean)
      .join(" — ");
    logger.error(`upsertRecipe failed: ${composed || "no reason returned"}`, error);
    throw new Error(
      composed
        || "Failed to save the automation. Make sure migration 065 is applied (crm_upsert_recipe RPC) and your role is admin/owner.",
    );
  }
  void kickAutomationWorker({ force: true });
  notifyRecipesChanged(organizationId);
  return mapRecipe(data as Record<string, unknown>);
};

export const deleteRecipe = async (recipeId: string): Promise<void> => {
  // Look up the org first so we can dispatch the cross-instance event,
  // since the RPC doesn't echo the recipe payload.
  const { data: row } = await supabase
    .from("automation_recipes")
    .select("organization_id")
    .eq("recipe_id", recipeId)
    .maybeSingle();
  const { error } = await supabase.rpc("crm_delete_recipe", { p_recipe_id: recipeId });
  if (error) throw error;
  void kickAutomationWorker({ force: true });
  if (row?.organization_id) notifyRecipesChanged(row.organization_id as string);
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
    sendWindow: data.send_window ?? null,
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

/**
 * Health snapshot of the automation queue for the org. Counts pending
 * events, recent runs, and the timestamp of the last successful run
 * — surfaced on the Automations settings tab so reps can tell at a
 * glance whether the worker is keeping up.
 */
export interface AutomationHealth {
  pendingEvents: number;
  runsLast24h: number;
  successLast24h: number;
  failuresLast24h: number;
  lastRunAt: Date | null;
  lastEventAt: Date | null;
}

export const getAutomationHealth = async (organizationId: string): Promise<AutomationHealth> => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [pending, runs, successes, failures, lastRun, lastEvent] = await Promise.all([
    supabase.from("automation_events").select("event_id", { count: "exact", head: true })
      .eq("organization_id", organizationId).is("processed_at", null),
    supabase.from("automation_runs").select("run_id", { count: "exact", head: true })
      .eq("organization_id", organizationId).gte("created_at", since),
    supabase.from("automation_runs").select("run_id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("status", "success").gte("created_at", since),
    supabase.from("automation_runs").select("run_id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("status", "failure").gte("created_at", since),
    supabase.from("automation_runs").select("finished_at, started_at, created_at")
      .eq("organization_id", organizationId).order("created_at", { ascending: false })
      .limit(1).maybeSingle(),
    supabase.from("automation_events").select("enqueued_at")
      .eq("organization_id", organizationId).order("enqueued_at", { ascending: false })
      .limit(1).maybeSingle(),
  ]);
  const lastRunData = (lastRun.data ?? null) as { finished_at?: string | null; started_at?: string | null; created_at?: string | null } | null;
  const lastEventData = (lastEvent.data ?? null) as { enqueued_at?: string | null } | null;
  return {
    pendingEvents: pending.count ?? 0,
    runsLast24h: runs.count ?? 0,
    successLast24h: successes.count ?? 0,
    failuresLast24h: failures.count ?? 0,
    lastRunAt: lastRunData
      ? new Date(lastRunData.finished_at ?? lastRunData.started_at ?? lastRunData.created_at ?? Date.now())
      : null,
    lastEventAt: lastEventData?.enqueued_at ? new Date(lastEventData.enqueued_at) : null,
  };
};

/**
 * Insert a no-op automation_events row so the rep can verify the
 * worker is alive and the RLS gate isn't blocking inserts. The event
 * uses a synthetic event_type ('manual_test') that no recipe matches
 * — it just sits in the queue, gets processed-but-no-op'd by the
 * worker, and increments the runs counter.
 *
 * Calls send_test_automation_event RPC (migration 121) — a direct
 * INSERT from the client would fail because automation_events has
 * no INSERT policy for authenticated roles. The RPC is SECURITY
 * DEFINER + checks org membership.
 */
export const sendTestAutomationEvent = async (organizationId: string): Promise<string> => {
  const { data, error } = await supabase
    .rpc("send_test_automation_event", { p_organization_id: organizationId });
  if (error) {
    logger.error("sendTestAutomationEvent failed:", error);
    throw new Error(error.message);
  }
  return String(data ?? "");
};

/**
 * Manually enrol a record into an automation / sequence recipe by
 * inserting a synthetic event of the recipe's trigger_type. The
 * background worker picks it up on its next tick.
 *
 * Backed by enroll_in_automation RPC (migration 120). Returns the
 * event_id so the caller can correlate with automation_runs in the
 * health card.
 */
export const enrollInAutomation = async (params: {
  recipeId: string;
  clientId?: string | null;
  dealId?: string | null;
}): Promise<string> => {
  const { data, error } = await supabase.rpc("enroll_in_automation", {
    p_recipe_id: params.recipeId,
    p_client_id: params.clientId ?? null,
    p_deal_id: params.dealId ?? null,
  });
  if (error) {
    logger.error("enrollInAutomation failed:", error);
    throw new Error(error.message);
  }
  return String(data ?? "");
};

/**
 * Call the `automation-author` edge function with a plain-English description
 * and return a sanitized RecipeDraft ready to be pre-filled in the builder.
 *
 * The edge fn returns `{ draft }` (raw JSON from Claude). We run it through
 * sanitizeDraft() to validate types and drop any unknown trigger/action values.
 * Throws a user-visible error if the draft can't be made valid.
 */
export const draftAutomationFromText = async (
  organizationId: string,
  description: string,
): Promise<RecipeDraft> => {
  const { data, error } = await supabase.functions.invoke("automation-author", {
    body: { organization_id: organizationId, description },
  });
  if (error) throw error;
  const draft = sanitizeDraft((data as { draft?: unknown })?.draft);
  if (!draft) {
    throw new Error(
      "Couldn't turn that into a valid automation — try describing the trigger and the action(s).",
    );
  }
  return draft;
};
