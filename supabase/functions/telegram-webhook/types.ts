// Re-export shared agent types so existing imports keep working.
// Canonical source: supabase/functions/_shared/agent/types.ts
export type {
  AgentProvider, AgentActionType, Intent, PendingAction, AgentReply, LinkedAccount,
} from "../_shared/agent/types.ts";
