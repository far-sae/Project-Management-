// supabase/functions/crm-run-automations/shared/types.ts
export type TriggerType =
  | "deal_stage_entered" | "deal_score_band_changed" | "deal_field_changed"
  | "form_submitted" | "client_created" | "client_tagged"
  | "task_overdue" | "scheduled";

export type ActionType =
  | "create_task" | "tag" | "set_field" | "change_owner"
  | "add_note" | "move_deal_stage" | "webhook" | "slack_post" | "send_email";

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
}

export type ActionHandler = (
  ctx: ActionContext,
  config: Record<string, unknown>,
) => Promise<ActionResult>;
