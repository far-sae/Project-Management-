// supabase/functions/crm-run-automations/shared/types.ts
export type TriggerType =
  | "deal_stage_entered" | "deal_score_band_changed" | "deal_field_changed"
  | "form_submitted" | "client_created" | "client_tagged"
  | "task_overdue" | "scheduled"
  | "agent_intake"
  | "slack_message_received"
  | "slack_reaction_added";

export type ActionType =
  | "create_task" | "tag" | "set_field" | "change_owner"
  | "add_note" | "move_deal_stage" | "webhook" | "slack_post" | "send_email"
  | "ai_summarize" | "ai_classify_lead" | "ai_draft_email"
  | "ai_extract" | "ai_translate"
  | "wait";

export type RunStatus = "success" | "failure" | "skipped" | "partial";

export interface AutomationEvent {
  event_id: string;
  organization_id: string;
  event_type: TriggerType;
  payload: Record<string, unknown>;
  source_table: string | null;
  source_id: string | null;
  depth: number;
  enqueued_at: string;
  processed_at: string | null;
}

export interface Recipe {
  recipe_id: string;
  organization_id: string;
  name: string;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  conditions: Array<{ field: string; operator: string; value: unknown }>;
  actions: Array<{ type: ActionType; config: Record<string, unknown> }>;
}

export interface ActionResult {
  type: ActionType;
  status: "success" | "failure" | "skipped";
  duration_ms?: number;
  message?: string | null;
  meta?: Record<string, unknown>;
}

export interface ActionContext {
  admin: any;            // SupabaseClient — kept loose because deno types differ
  orgId: string;
  event: AutomationEvent;
  recipeId: string;
  recipeName: string;
  runStartedAt: Date;
  // Outputs from preceding ai_* actions in this recipe run, e.g.
  // { ai_output: "...", ai_output_subject: "...", ai_output_body: "..." }
  // Available to substitute() as {{ai.output}}, {{ai.output_subject}}, etc.
  aiOutputs?: Record<string, string>;
  recipeRunId?: string;
  nextActionIndex?: number;
}

export type ActionHandler = (
  ctx: ActionContext,
  config: Record<string, unknown>,
) => Promise<ActionResult>;
