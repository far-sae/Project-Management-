const VALID_TRIGGERS = new Set(['client_created', 'deal_stage_entered', 'scheduled', 'client_tagged', 'deal_score_band_changed']);
const VALID_ACTIONS = new Set(['send_email', 'notify', 'create_task', 'slack_post', 'wait']);

export const sanitizeDraft = (input: unknown): any | null => {
  if (!input || typeof input !== 'object') return null;
  const draft = input as any;
  if (!draft.trigger || !VALID_TRIGGERS.has(draft.trigger.type)) return null;
  const actions = Array.isArray(draft.actions)
    ? draft.actions.filter((action: any) => action && VALID_ACTIONS.has(action.type))
    : [];
  if (actions.length === 0) return null;
  return { ...draft, actions };
};
