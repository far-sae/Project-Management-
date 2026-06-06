// supabase/functions/_shared/agent/types.ts
// Shared types for the chat-bot agent. Used by both telegram-webhook and
// whatsapp-webhook.

export type AgentProvider = "telegram" | "whatsapp";

export type AgentActionType =
  | "create_workspace"
  | "create_project"
  | "create_task"
  | "create_client"
  | "create_client_task"
  // CRM-side intents — let reps run the full sales workflow from
  // Telegram / WhatsApp, not just project tasks. Each one writes to
  // the matching CRM table via the service-role admin client.
  | "create_lead"
  | "create_contact"
  | "create_deal"
  | "create_meeting"
  | "create_call"
  | "log_note"
  | "query"
  | "list_workspaces"
  | "list_projects"
  | "update"
  | "switch_org"
  | "list_orgs"
  | "help"
  | "unknown";

export interface Intent {
  action: AgentActionType;
  // Free-form names from the message; resolution happens in agentActions.
  workspace?: string | null;
  project?: string | null;
  client?: string | null;
  title?: string | null;
  name?: string | null;
  description?: string | null;
  due?: string | null;          // ISO 8601
  // CRM extras — every field is optional; the LLM fills in what it
  // can pull from the message.
  email?: string | null;        // lead/contact email
  phone?: string | null;        // lead/contact phone
  company?: string | null;      // lead's company (when distinct from client name)
  stage?: string | null;        // deal stage (Lead / Qualified / Proposal / Negotiation)
  value?: number | null;        // deal value
  currency?: string | null;     // ISO currency code, defaults to org currency
  deal?: string | null;         // free-form deal name reference for meetings/calls
  outcome?: string | null;      // call outcome / meeting notes summary
  body?: string | null;         // note body
  // Query (read) fields.
  entity?:
    | "task" | "client_task" | "deal" | "lead" | "client" | "meeting" | "call"
    | "workspace" | "project"
    | null;
  scope?: "mine" | "all" | null;
  timeframe?: "today" | "this_week" | "this_month" | "overdue" | "upcoming" | null;
  status?: string | null;       // filter for query: e.g. "done", "todo", "inprogress"
  // Edit fields. `target` is the name/title used to FIND the record;
  // the change itself reuses status/stage/due/title/value/currency/priority.
  target?: string | null;
  priority?: string | null;
  /** Internal: ids resolved via disambiguation, keyed by "<entity>_id"
   *  (e.g. project_id, client_id). Carried through a choice tap so
   *  resolveIntent can skip the name lookup. Never set by the parser. */
  resolved_ids?: Record<string, string>;
  confidence?: number;
}

export interface PendingAction {
  id: string;
  provider: AgentProvider;
  chat_id: string;
  user_id: string;
  org_id: string;
  action: Intent & { resolved_ids?: Record<string, string> };
  expires_at: string;
}

export type AgentReply =
  | { kind: "text"; text: string }
  | {
      kind: "confirm";
      summary: string;
      pendingActionId: string;
    }
  | {
      kind: "choices";
      prompt: string;
      choices: Array<{ label: string; callback: string }>;
    }
  | { kind: "noop" };

export interface LinkedAccount {
  user_id: string;
  current_org_id: string;
  /** Platform-specific identifier: telegram_user_id (number) or WhatsApp
   *  E.164 phone number (string). Stored as string for cross-platform reuse. */
  external_id: string;
}
