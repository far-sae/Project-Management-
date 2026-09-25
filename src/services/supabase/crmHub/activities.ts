import { supabase } from '../config';
import type { CrmActivity, CreateActivityInput, ActivityType } from '@/types/crmHub';
import { applyWorkspaceFilter } from './workspaceFilter';

interface ActivityRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  user_id: string | null;
  type: ActivityType;
  description: string | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  task_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const mapActivity = (r: ActivityRow): CrmActivity => ({
  id: r.id,
  organizationId: r.organization_id,
  workspaceId: r.workspace_id ?? null,
  userId: r.user_id,
  type: r.type,
  description: r.description,
  contactId: r.contact_id,
  companyId: r.company_id,
  dealId: r.deal_id,
  taskId: r.task_id,
  metadata: r.metadata ?? {},
  createdAt: new Date(r.created_at),
});

interface ListOptions {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  type?: ActivityType;
  limit?: number;
}

export const listActivities = async (
  organizationId: string,
  opts: ListOptions & { workspaceId?: string | null } = {},
): Promise<CrmActivity[]> => {
  let q = supabase
    .from('crm_activities')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (opts.contactId) q = q.eq('contact_id', opts.contactId);
  if (opts.companyId) q = q.eq('company_id', opts.companyId);
  if (opts.dealId) q = q.eq('deal_id', opts.dealId);
  if (opts.type) q = q.eq('type', opts.type);
  q = applyWorkspaceFilter(q, opts.workspaceId);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapActivity);
};

/** Log an activity. Failures are surfaced — the caller decides whether to
 *  suppress (e.g. when it's fire-and-forget after a successful entity write). */
export const logActivity = async (
  input: CreateActivityInput,
  userId: string | null,
): Promise<CrmActivity> => {
  const { data, error } = await supabase
    .from('crm_activities')
    .insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId ?? null,
      user_id: userId,
      type: input.type,
      description: input.description ?? null,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      deal_id: input.dealId ?? null,
      task_id: input.taskId ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return mapActivity(data);
};

/** Fire-and-forget: log an activity, swallow errors so entity writes never
 *  fail because of a downstream activity insert. */
export const tryLogActivity = (input: CreateActivityInput, userId: string | null): void => {
  void logActivity(input, userId).catch((err) => {
    console.warn('[crm] failed to log activity', err);
  });
};

export const deleteActivity = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_activities').delete().eq('id', id);
  if (error) throw error;
};
