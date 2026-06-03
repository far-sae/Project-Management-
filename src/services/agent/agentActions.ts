// src/services/agent/agentActions.ts
// Shared types + the pure permission gate for AI-proposed actions executed
// client-side. Keeps the gating logic testable and in one place.
export type AgentActionType =
  | "draft_email" | "move_deal_stage"
  | "create_client" | "create_lead" | "create_contact" | "create_deal"
  | "create_meeting" | "create_call" | "log_note"
  | "update_deal" | "update_lead_status"
  | "create_client_task" | "create_pm_task" | "assign_task"
  | "create_project" | "create_workspace";

export interface ProposedAction {
  type: AgentActionType;
  label: string;
  payload: Record<string, unknown>;
}

export interface ActionPerms {
  isAdmin: boolean;
  canEditModule: (m: "deals" | "leads") => boolean;
}

const DEAL_ACTIONS = new Set<AgentActionType>(["create_deal", "update_deal", "move_deal_stage"]);
const LEAD_ACTIONS = new Set<AgentActionType>(["create_lead", "update_lead_status"]);

/** Whether the current user may run a proposed action.
 *  deal_* / lead_* need the #4 module edit grant;
 *  everything else needs admin/owner. draft_email always ok. */
export const canRunAction = (type: AgentActionType, perms: ActionPerms): boolean => {
  if (type === "draft_email") return true;
  if (DEAL_ACTIONS.has(type)) return perms.canEditModule("deals");
  if (LEAD_ACTIONS.has(type)) return perms.canEditModule("leads");
  return perms.isAdmin;
};
