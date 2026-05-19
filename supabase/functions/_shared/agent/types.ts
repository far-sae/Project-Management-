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
