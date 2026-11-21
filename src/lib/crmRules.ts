/**
 * Simple CRM rules: "when this happens, do that". The rules themselves run in
 * the database (migration 201); this file is how the screens name them, check
 * a new one, and say an existing one as a sentence. Pure.
 */

export const RULE_EVENTS = ['lead_created', 'deal_created', 'deal_stage', 'deal_won', 'deal_lost'] as const;
export type RuleEvent = (typeof RULE_EVENTS)[number];

export const RULE_ACTIONS = ['follow_up', 'notify', 'assign'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const EVENT_LABEL: Record<RuleEvent, string> = {
  lead_created: 'A lead comes in',
  deal_created: 'A deal is made',
  deal_stage: 'A deal reaches a stage',
  deal_won: 'A deal is won',
  deal_lost: 'A deal is lost',
};

export const ACTION_LABEL: Record<RuleAction, string> = {
  follow_up: 'Add a follow-up',
  notify: 'Send a notice',
  assign: 'Give it to a person',
};

export interface CrmRule {
  id: string;
  enabled: boolean;
  event: RuleEvent;
  /** For "a deal reaches a stage". */
  stageId: string | null;
  /** For "a lead comes in": only leads whose source holds this text. Empty = every lead. */
  sourceContains: string;
  action: RuleAction;
  /** Who it is for. Null = the owner of the lead or deal. */
  personId: string | null;
  /** The follow-up's title or the notice's words. {name} becomes the lead's or deal's name. */
  body: string;
  dueDays: number;
}

export type RuleDraft = Omit<CrmRule, 'id' | 'enabled'>;

export const NEW_RULE: RuleDraft = {
  event: 'lead_created', stageId: null, sourceContains: '', action: 'follow_up', personId: null, body: 'Call {name}', dueDays: 1,
};

export const RULE_TEXT_MAX = 300;
export const RULES_LIMIT = 30;

/** A person can be given a record only at the moment it is made. */
export const canAssign = (event: RuleEvent): boolean => event === 'lead_created' || event === 'deal_created';

/** Why this rule cannot be saved, or null when it can. */
export function ruleProblem(draft: RuleDraft, existing: number): string | null {
  if (existing >= RULES_LIMIT) return `A workspace can have ${RULES_LIMIT} rules at most.`;
  if (draft.event === 'deal_stage' && !draft.stageId) return 'Choose the stage the deal must reach.';
  if (draft.action === 'assign') {
    if (!canAssign(draft.event)) return 'A lead or a deal can be given to a person only when it is made.';
    if (!draft.personId) return 'Choose the person to give it to.';
    return null;
  }
  if (!draft.body.trim()) return draft.action === 'follow_up' ? 'Write what the follow-up is called.' : 'Write what the notice says.';
  if (draft.body.length > RULE_TEXT_MAX) return `The text can have ${RULE_TEXT_MAX} letters at most.`;
  if (draft.action === 'follow_up' && (!Number.isInteger(draft.dueDays) || draft.dueDays < 0 || draft.dueDays > 365)) {
    return 'The follow-up can be due in 0 to 365 days.';
  }
  return null;
}

/** The rule as it is saved: fields that do not belong to its event or action are cleared. */
export function tidyRule(draft: RuleDraft): RuleDraft {
  return {
    event: draft.event,
    stageId: draft.event === 'deal_stage' ? draft.stageId : null,
    sourceContains: draft.event === 'lead_created' ? draft.sourceContains.trim() : '',
    action: draft.action,
    personId: draft.personId || null,
    body: draft.action === 'assign' ? '' : draft.body.trim(),
    dueDays: draft.action === 'follow_up' ? draft.dueDays : 1,
  };
}

export interface RuleNames {
  people: Map<string, string>;
  stages: Map<string, string>;
}

const when = (rule: CrmRule, names: RuleNames): string => {
  switch (rule.event) {
    case 'lead_created':
      return rule.sourceContains ? `When a lead comes in from “${rule.sourceContains}”` : 'When a lead comes in';
    case 'deal_created':
      return 'When a deal is made';
    case 'deal_stage':
      return `When a deal reaches “${(rule.stageId && names.stages.get(rule.stageId)) || 'a stage that was deleted'}”`;
    case 'deal_won':
      return 'When a deal is won';
    case 'deal_lost':
      return 'When a deal is lost';
  }
};

/** "When a deal is won, add the follow-up “Send the welcome pack” for its owner, due the next day." */
export function ruleSentence(rule: CrmRule, names: RuleNames): string {
  const person = rule.personId ? names.people.get(rule.personId) ?? 'someone who has left' : null;
  const start = when(rule, names);
  if (rule.action === 'assign') return `${start}, give it to ${person ?? 'nobody'}.`;
  const who = person ?? 'its owner';
  if (rule.action === 'notify') return `${start}, tell ${who}: “${rule.body}”.`;
  const due = rule.dueDays === 0 ? 'due the same day' : rule.dueDays === 1 ? 'due the next day' : `due in ${rule.dueDays} days`;
  return `${start}, add the follow-up “${rule.body}” for ${who}, ${due}.`;
}
