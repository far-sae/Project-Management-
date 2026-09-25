export const mapDraft = (draft: any = {}) => ({
  subject: draft.subject ?? '',
  bodyText: draft.body_text ?? draft.bodyText ?? '',
  bodyHtml: draft.body_html ?? draft.bodyHtml ?? '',
  confidence: draft.confidence ?? 0,
  reasoning: draft.reasoning ?? '',
  suggestedNextStageId: draft.suggested_next_stage_id ?? draft.suggestedNextStageId ?? null,
});

export const mapSuggestion = (row: any) => ({
  suggestionId: row.id,
  organizationId: row.organization_id,
  triggerType: row.trigger_type,
  clientId: row.client_id,
  dealId: row.deal_id,
  draft: mapDraft(row.draft),
  enrichment: row.enrichment_snapshot ?? null,
  confidence: row.confidence ?? row.draft?.confidence ?? 0,
  reasoning: row.reasoning ?? row.draft?.reasoning ?? '',
  status: row.status,
  createdAt: new Date(row.created_at),
});
