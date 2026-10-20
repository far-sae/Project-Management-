import { supabase } from './config';
import type { SocialAccount, SocialCampaign, SocialContent, SocialContentStatus, SocialMetric, SocialProvider } from '@/types/social';

type Row = Record<string, unknown>;
const date = (value: unknown) => value ? new Date(String(value)) : null;
const mapAccount = (r: Row): SocialAccount => ({ id: String(r.id), organizationId: String(r.organization_id), workspaceId: String(r.workspace_id), provider: r.provider as SocialProvider, displayName: String(r.display_name), externalAccountId: r.external_account_id ? String(r.external_account_id) : null, status: r.status as SocialAccount['status'], lastError: r.last_error ? String(r.last_error) : null, createdAt: date(r.created_at)! });
const mapCampaign = (r: Row): SocialCampaign => ({ id: String(r.id), organizationId: String(r.organization_id), workspaceId: String(r.workspace_id), name: String(r.name), objective: r.objective ? String(r.objective) : null, crmContactId: r.crm_contact_id ? String(r.crm_contact_id) : null, crmCompanyId: r.crm_company_id ? String(r.crm_company_id) : null, projectId: r.project_id ? String(r.project_id) : null, taskId: r.task_id ? String(r.task_id) : null, status: r.status as SocialCampaign['status'], createdAt: date(r.created_at)! });
const mapContent = (r: Row): SocialContent => ({ id: String(r.id), organizationId: String(r.organization_id), workspaceId: String(r.workspace_id), campaignId: r.campaign_id ? String(r.campaign_id) : null, accountId: r.account_id ? String(r.account_id) : null, crmContactId: r.crm_contact_id ? String(r.crm_contact_id) : null, crmCompanyId: r.crm_company_id ? String(r.crm_company_id) : null, projectId: r.project_id ? String(r.project_id) : null, taskId: r.task_id ? String(r.task_id) : null, title: String(r.title), body: String(r.body ?? ''), status: r.status as SocialContentStatus, scheduledAt: date(r.scheduled_at), publishedAt: date(r.published_at), lastError: r.last_error ? String(r.last_error) : null, createdAt: date(r.created_at)! });

export const listSocialData = async (workspaceId: string) => {
  const [accounts, campaigns, content, metrics] = await Promise.all([
    supabase.from('social_accounts').select('*').eq('workspace_id', workspaceId).order('created_at'),
    supabase.from('social_campaigns').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    supabase.from('social_content').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    supabase.from('social_content_metrics').select('*').eq('workspace_id', workspaceId),
  ]);
  const error = accounts.error ?? campaigns.error ?? content.error ?? metrics.error;
  if (error) throw error;
  return {
    accounts: ((accounts.data ?? []) as Row[]).map(mapAccount), campaigns: ((campaigns.data ?? []) as Row[]).map(mapCampaign),
    content: ((content.data ?? []) as Row[]).map(mapContent), metrics: ((metrics.data ?? []) as Row[]).map((r): SocialMetric => ({ contentId: String(r.content_id), impressions: Number(r.impressions), reach: Number(r.reach), clicks: Number(r.clicks), reactions: Number(r.reactions), comments: Number(r.comments), shares: Number(r.shares) })),
  };
};

export const createSocialAccount = async (input: { organizationId: string; workspaceId: string; provider: SocialProvider; displayName: string; externalAccountId?: string; userId?: string }) => {
  const { data, error } = await supabase.from('social_accounts').insert({ organization_id: input.organizationId, workspace_id: input.workspaceId, provider: input.provider, display_name: input.displayName, external_account_id: input.externalAccountId || null, status: 'disconnected', connected_by: input.userId ?? null }).select('id').single();
  if (error) throw error;
  return String(data.id);
};

export const saveSocialAccountToken = async (accountId: string, accessToken: string) => {
  const { data } = await supabase.auth.getSession();
  const bearer = data.session?.access_token;
  if (!bearer) throw new Error('Not authenticated');
  const response = await fetch('/api/social/account-secret', { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, accessToken }) });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error ?? 'Could not connect social account'); }
};
export const createSocialCampaign = async (input: { organizationId: string; workspaceId: string; name: string; objective?: string; projectId?: string; taskId?: string; crmContactId?: string; crmCompanyId?: string; userId?: string }) => {
  const { error } = await supabase.from('social_campaigns').insert({ organization_id: input.organizationId, workspace_id: input.workspaceId, name: input.name, objective: input.objective || null, project_id: input.projectId || null, task_id: input.taskId || null, crm_contact_id: input.crmContactId || null, crm_company_id: input.crmCompanyId || null, created_by: input.userId ?? null });
  if (error) throw error;
};
export const createSocialContent = async (input: { organizationId: string; workspaceId: string; title: string; body: string; mediaUrls?: string[]; campaignId?: string; accountId?: string; projectId?: string; taskId?: string; crmContactId?: string; crmCompanyId?: string; scheduledAt?: string; userId?: string }) => {
  const scheduled = Boolean(input.scheduledAt);
  const { error } = await supabase.from('social_content').insert({ organization_id: input.organizationId, workspace_id: input.workspaceId, title: input.title, body: input.body, media_urls: input.mediaUrls ?? [], campaign_id: input.campaignId || null, account_id: input.accountId || null, project_id: input.projectId || null, task_id: input.taskId || null, crm_contact_id: input.crmContactId || null, crm_company_id: input.crmCompanyId || null, scheduled_at: input.scheduledAt || null, status: scheduled ? 'in_review' : 'draft', created_by: input.userId ?? null });
  if (error) throw error;
};
export const updateSocialContentStatus = async (id: string, status: SocialContentStatus, userId?: string, scheduledAt?: Date | null) => {
  const updates: Row = { status };
  if (status === 'approved') { updates.approved_by = userId ?? null; updates.approved_at = new Date().toISOString(); }
  if (status === 'scheduled') { updates.last_error = null; updates.scheduled_at = (scheduledAt ?? new Date()).toISOString(); }
  const { error } = await supabase.from('social_content').update(updates).eq('id', id);
  if (error) throw error;
};

export const updateSocialCampaignStatus = async (id: string, status: SocialCampaign['status']) => {
  const { error } = await supabase.from('social_campaigns').update({ status }).eq('id', id);
  if (error) throw error;
};
