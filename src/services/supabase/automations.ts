export const TRIGGER_TYPES = [
  'deal_stage_entered',
  'client_created',
  'client_tagged',
  'deal_score_band_changed',
  'scheduled',
] as const;

export const ACTION_TYPES = ['create_task', 'send_email', 'slack_post', 'notify', 'wait'] as const;

const TRIGGER_LABELS: Record<string, string> = {
  deal_stage_entered: 'deal enters stage',
  client_created: 'client is created',
  client_tagged: 'client is tagged',
  deal_score_band_changed: 'deal score band changes',
  scheduled: 'scheduled time arrives',
};

const ACTION_LABELS: Record<string, string> = {
  create_task: 'create task',
  send_email: 'send email',
  slack_post: 'post to Slack',
  notify: 'notify',
  wait: 'wait',
};

export const validateRecipeDraft = (draft: any) => {
  if (!draft.name?.trim()) throw new Error('Automation name is required');
  if (!TRIGGER_TYPES.includes(draft.trigger?.type)) throw new Error('Unknown trigger type');
  if (!Array.isArray(draft.actions) || draft.actions.length === 0) throw new Error('At least one action is required');
  for (const action of draft.actions) {
    if (!ACTION_TYPES.includes(action.type)) throw new Error('Unknown action type');
  }
};

export const summarizeRecipe = (recipe: any): string => {
  const trigger = TRIGGER_LABELS[recipe.trigger_type] ?? recipe.trigger_type;
  const actions = (recipe.actions ?? []).map((action: any) => ACTION_LABELS[action.type] ?? action.type).join(', ');
  return `When ${trigger}, then ${actions}`;
};
