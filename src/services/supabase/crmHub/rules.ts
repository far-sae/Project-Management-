import { supabase } from '../config';
import { RULE_ACTIONS, RULE_EVENTS, tidyRule, type CrmRule, type RuleAction, type RuleDraft, type RuleEvent } from '@/lib/crmRules';

/** Shown when rules have no place in the database yet. */
export const RULES_NOT_SET_UP_MESSAGE =
  'Rules are not set up yet: run supabase/migrations/201_crm_rules.sql in the Supabase SQL editor.';

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string };
const fail = (error: DbError, fallback: string): Error =>
  new Error(error.code === '42P01' || error.code === 'PGRST205' ? RULES_NOT_SET_UP_MESSAGE : error.message || fallback);

const COLUMNS = 'id, enabled, event, stage_id, source_contains, action, person_id, body, due_days';

const ruleFrom = (r: Row): CrmRule => ({
  id: String(r.id),
  enabled: r.enabled !== false,
  event: ((RULE_EVENTS as readonly string[]).includes(String(r.event)) ? r.event : 'lead_created') as RuleEvent,
  stageId: typeof r.stage_id === 'string' ? r.stage_id : null,
  sourceContains: typeof r.source_contains === 'string' ? r.source_contains : '',
  action: ((RULE_ACTIONS as readonly string[]).includes(String(r.action)) ? r.action : 'notify') as RuleAction,
  personId: typeof r.person_id === 'string' ? r.person_id : null,
  body: typeof r.body === 'string' ? r.body : '',
  dueDays: Number.isInteger(r.due_days) ? (r.due_days as number) : 1,
});

export async function listRules(workspaceId: string): Promise<CrmRule[]> {
  const { data, error } = await supabase.from('crm_rules').select(COLUMNS).eq('workspace_id', workspaceId).order('created_at', { ascending: true });
  if (error) throw fail(error, 'The rules could not be loaded.');
  return ((data ?? []) as Row[]).map(ruleFrom);
}

export async function createRule(organizationId: string, workspaceId: string, draft: RuleDraft): Promise<CrmRule> {
  const rule = tidyRule(draft);
  const { data, error } = await supabase
    .from('crm_rules')
    .insert({
      organization_id: organizationId,
      workspace_id: workspaceId,
      event: rule.event,
      stage_id: rule.stageId,
      source_contains: rule.sourceContains,
      action: rule.action,
      person_id: rule.personId,
      body: rule.body,
      due_days: rule.dueDays,
    })
    .select(COLUMNS)
    .single();
  if (error) throw fail(error, 'The rule could not be saved.');
  return ruleFrom(data as Row);
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('crm_rules').update({ enabled }).eq('id', id);
  if (error) throw fail(error, 'The rule could not be changed.');
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase.from('crm_rules').delete().eq('id', id);
  if (error) throw fail(error, 'The rule could not be removed.');
}
