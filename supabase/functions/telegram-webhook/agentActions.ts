// Thin wrapper that binds the shared agent core to provider='telegram'.
// Canonical source: supabase/functions/_shared/agent/agentActions.ts
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveIntent as _resolveIntent,
  executePending as _executePending,
  loadConvo as _loadConvo,
  clearConvo as _clearConvo,
} from "../_shared/agent/agentActions.ts";
import type {
  AgentReply, Intent, LinkedAccount,
} from "../_shared/agent/types.ts";

export type { LoadedConvo } from "../_shared/agent/agentActions.ts";

export const resolveIntent = (
  admin: SupabaseClient,
  account: LinkedAccount,
  chatId: string,
  intent: Intent,
): Promise<AgentReply> => _resolveIntent(admin, "telegram", account, chatId, intent);

export const loadConvo = (admin: SupabaseClient, chatId: string) =>
  _loadConvo(admin, "telegram", chatId);

export const clearConvo = (admin: SupabaseClient, chatId: string) =>
  _clearConvo(admin, "telegram", chatId);

export const executePending = _executePending;
