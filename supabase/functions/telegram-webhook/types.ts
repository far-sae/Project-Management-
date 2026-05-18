// supabase/functions/telegram-webhook/types.ts

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
  // Entity payload fields:
  title?: string | null;
  name?: string | null;
  description?: string | null;
  due?: string | null;          // ISO 8601
  // Confidence is informational only — we still run the full resolver.
  confidence?: number;
}

export interface PendingAction {
  id: string;
  provider: "telegram" | "whatsapp";
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
      // Each choice carries the data we need to re-run resolution.
      choices: Array<{ label: string; callback: string }>;
    }
  | { kind: "noop" };

export interface LinkedAccount {
  user_id: string;
  current_org_id: string;
  telegram_user_id: number;
}
