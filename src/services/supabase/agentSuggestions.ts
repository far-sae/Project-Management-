import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type SuggestionStatus =
  | "pending" | "approved" | "sent" | "rejected"
  | "snoozed" | "expired" | "failed" | "cap_reached";

export interface AgentDraft {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  confidence: number;
  reasoning: string;
  suggestedNextStageId: string | null;
}

export interface AgentSuggestion {
  suggestionId: string;
  organizationId: string;
  triggerType: "intake" | "re_engagement";
  clientId: string | null;
  dealId: string | null;
  draft: AgentDraft;
  enrichment: Record<string, unknown> | null;
  confidence: number | null;
  reasoning: string | null;
  status: SuggestionStatus;
  snoozeUntil: Date | null;
  rejectedReasons: string[] | null;
  rejectedNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export const mapDraft = (raw: Record<string, unknown> | null | undefined): AgentDraft => ({
  subject: (raw?.subject as string) ?? "",
  bodyText: (raw?.body_text as string) ?? "",
  bodyHtml: (raw?.body_html as string) ?? "",
  confidence: typeof raw?.confidence === "number" ? (raw.confidence as number) : 0,
  reasoning: (raw?.reasoning as string) ?? "",
  suggestedNextStageId: (raw?.suggested_next_stage_id as string) ?? null,
});

export const mapSuggestion = (r: Record<string, unknown>): AgentSuggestion => ({
  suggestionId: r.id as string,
  organizationId: r.organization_id as string,
  triggerType: r.trigger_type as "intake" | "re_engagement",
  clientId: (r.client_id as string) ?? null,
  dealId: (r.deal_id as string) ?? null,
  draft: mapDraft(r.draft as Record<string, unknown> | null),
  enrichment: (r.enrichment_snapshot as Record<string, unknown> | null) ?? null,
  confidence: r.confidence != null ? Number(r.confidence) : null,
  reasoning: (r.reasoning as string) ?? null,
  status: r.status as SuggestionStatus,
  snoozeUntil: r.snooze_until ? new Date(r.snooze_until as string) : null,
  rejectedReasons: (r.rejected_reasons as string[]) ?? null,
  rejectedNote: (r.rejected_note as string) ?? null,
  decidedBy: (r.decided_by as string) ?? null,
  decidedAt: r.decided_at ? new Date(r.decided_at as string) : null,
  createdAt: new Date(r.created_at as string),
});

export const listPendingSuggestions = async (
  organizationId: string,
): Promise<AgentSuggestion[]> => {
  const { data, error } = await supabase
    .from("agent_suggestions")
    .select("*")
    .eq("organization_id", organizationId)
    .in("status", ["pending"])
    .order("confidence", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    logger.error("Failed to load suggestions:", error);
    return [];
  }
  return (data ?? []).map(mapSuggestion);
};

export const listSuggestionActivity = async (
  organizationId: string,
  sinceDays = 7,
): Promise<AgentSuggestion[]> => {
  const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("agent_suggestions")
    .select("*")
    .eq("organization_id", organizationId)
    .in("status", ["sent", "rejected", "expired", "failed", "cap_reached"])
    .gte("decided_at", since)
    .order("decided_at", { ascending: false })
    .limit(200);
  if (error) {
    logger.error("Failed to load suggestion activity:", error);
    return [];
  }
  return (data ?? []).map(mapSuggestion);
};

export interface DecideArgs {
  suggestionId: string;
  action: "send" | "reject" | "snooze";
  draftOverride?: Partial<AgentDraft>;
  snoozeDays?: number;
  rejectReasons?: string[];
  rejectNote?: string;
}

export const decideSuggestion = async (a: DecideArgs): Promise<void> => {
  const body: Record<string, unknown> = {
    suggestion_id: a.suggestionId,
    action: a.action,
  };
  if (a.draftOverride) {
    body.draft_override = {
      subject: a.draftOverride.subject,
      body_text: a.draftOverride.bodyText,
      body_html: a.draftOverride.bodyHtml,
    };
  }
  if (a.snoozeDays) body.snooze_days = a.snoozeDays;
  if (a.rejectReasons) body.reject_reasons = a.rejectReasons;
  if (a.rejectNote) body.reject_note = a.rejectNote;

  const { error } = await supabase.functions.invoke("ai-agent-approve", { body });
  if (error) throw error;
};
