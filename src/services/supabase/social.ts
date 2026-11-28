import { supabase } from './config';
import type { SocialAccount, SocialCampaign, SocialContent, SocialContentStatus, SocialMetric, SocialProvider } from '@/types/social';
import type { PostMedia } from '../../../api/_social/shared/platforms';

type Row = Record<string, unknown>;
const date = (value: unknown) => value ? new Date(String(value)) : null;
const mapAccount = (r: Row): SocialAccount => ({ id: String(r.id), organizationId: String(r.organization_id), workspaceId: String(r.workspace_id), provider: r.provider as SocialProvider, displayName: String(r.display_name), externalAccountId: r.external_account_id ? String(r.external_account_id) : null, status: r.status as SocialAccount['status'], lastError: r.last_error ? String(r.last_error) : null, createdAt: date(r.created_at)! });
const mapCampaign = (r: Row): SocialCampaign => ({ id: String(r.id), organizationId: String(r.organization_id), workspaceId: String(r.workspace_id), name: String(r.name), objective: r.objective ? String(r.objective) : null, crmContactId: r.crm_contact_id ? String(r.crm_contact_id) : null, crmCompanyId: r.crm_company_id ? String(r.crm_company_id) : null, projectId: r.project_id ? String(r.project_id) : null, taskId: r.task_id ? String(r.task_id) : null, status: r.status as SocialCampaign['status'], createdAt: date(r.created_at)! });
const VIDEO_FILE = /\.(mp4|mov|m4v|webm)(\?|#|$)/i;
/** The file of a post: what the composer saved, or the address an older post carried. */
const mapMedia = (r: Row): PostMedia | null => {
  const first = Array.isArray(r.media) ? (r.media[0] as Record<string, unknown> | undefined) : undefined;
  if (first && typeof first.url === 'string' && first.url) {
    return { url: first.url, kind: first.kind === 'video' ? 'video' : 'image', mime: String(first.mime ?? ''), bytes: Number(first.bytes) || 0, name: String(first.name ?? '') };
  }
  const url = Array.isArray(r.media_urls) && typeof r.media_urls[0] === 'string' ? r.media_urls[0] : '';
  if (!url) return null;
  const video = VIDEO_FILE.test(url);
  return { url, kind: video ? 'video' : 'image', mime: video ? 'video/mp4' : 'image/jpeg', bytes: 0, name: '' };
};
const mapContent = (r: Row): SocialContent => ({ origin: r.origin === 'autopilot' ? 'autopilot' : 'person', idea: r.origin === 'autopilot' && r.idea && typeof r.idea === 'object' && !Array.isArray(r.idea) ? r.idea as SocialContent['idea'] : null, externalPostId: r.external_post_id ? String(r.external_post_id) : null, postGroupId: r.post_group_id ? String(r.post_group_id) : null, media: mapMedia(r), options: r.options && typeof r.options === 'object' && !Array.isArray(r.options) ? r.options as Record<string, unknown> : {}, id: String(r.id), organizationId: String(r.organization_id), workspaceId: String(r.workspace_id), campaignId: r.campaign_id ? String(r.campaign_id) : null, accountId: r.account_id ? String(r.account_id) : null, crmContactId: r.crm_contact_id ? String(r.crm_contact_id) : null, crmCompanyId: r.crm_company_id ? String(r.crm_company_id) : null, projectId: r.project_id ? String(r.project_id) : null, taskId: r.task_id ? String(r.task_id) : null, title: String(r.title), body: String(r.body ?? ''), status: r.status as SocialContentStatus, scheduledAt: date(r.scheduled_at), publishedAt: date(r.published_at), lastError: r.last_error ? String(r.last_error) : null, createdAt: date(r.created_at)! });

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

export const saveSocialAccountToken = async (accountId: string, accessToken: string, refreshToken?: string) => {
  const { data } = await supabase.auth.getSession();
  const bearer = data.session?.access_token;
  if (!bearer) throw new Error('Not authenticated');
  const response = await fetch('/api/social/account-secret', { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId, accessToken, ...(refreshToken ? { refreshToken } : {}) }) });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error ?? 'Could not connect social account'); }
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

/** Removes posts from the list for good. A post already on a platform stays there. */
export const deleteSocialContent = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  const { error } = await supabase.from('social_content').delete().in('id', ids);
  if (error) throw error;
};

// ── The composer: one file, one press, every account ─────────────────────

const SOCIAL_BUCKET = 'social-media';

/** Puts the picture or video where the platforms can fetch it, and answers with what a post needs to know about it. */
export const uploadSocialMedia = async (workspaceId: string, file: File): Promise<PostMedia> => {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-80) || 'file';
  const path = `${workspaceId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(SOCIAL_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
  if (error) throw error;
  const { data } = supabase.storage.from(SOCIAL_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, kind: file.type.startsWith('video/') ? 'video' : 'image', mime: file.type, bytes: file.size, name: file.name };
};

/** Takes an uploaded file away again (the person removed it before posting). Never throws: a file left behind does no harm. */
export const removeSocialMedia = async (media: PostMedia): Promise<void> => {
  const marker = `/object/public/${SOCIAL_BUCKET}/`;
  const at = media.url.indexOf(marker);
  if (at < 0) return;
  await supabase.storage.from(SOCIAL_BUCKET).remove([decodeURIComponent(media.url.slice(at + marker.length))]).catch(() => undefined);
};

export interface NewSocialPosts {
  organizationId: string;
  workspaceId: string;
  userId?: string;
  title: string;
  body: string;
  media: PostMedia | null;
  /** When the posts go out. Now when left out. */
  scheduledAt?: Date;
  /** The campaign these posts belong to, when there is one. */
  campaignId?: string | null;
  /** One for each account the post goes to, with what that platform needs. */
  posts: Array<{ accountId: string; options: Record<string, unknown> }>;
}

/**
 * One press: a queued post for every chosen account, all in one group. They
 * are approved by the person who pressed, and go out at `scheduledAt` (now by
 * default). Answers with the group's id.
 */
export const createSocialPosts = async (input: NewSocialPosts): Promise<string> => {
  const groupId = crypto.randomUUID();
  const when = (input.scheduledAt ?? new Date()).toISOString();
  const approvedAt = new Date().toISOString();
  const { error } = await supabase.from('social_content').insert(input.posts.map((post) => ({
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    account_id: post.accountId,
    campaign_id: input.campaignId || null,
    post_group_id: groupId,
    title: input.title,
    body: input.body,
    media: input.media ? [input.media] : [],
    media_urls: input.media ? [input.media.url] : [],
    options: post.options,
    status: 'scheduled',
    scheduled_at: when,
    approved_by: input.userId ?? null,
    approved_at: approvedAt,
    created_by: input.userId ?? null,
  })));
  if (error) throw error;
  return groupId;
};

/**
 * Asks the server to send the posts that are due, now, instead of at its next
 * five-minute run. Resolves when that run has ended, which can take minutes
 * for a video. A failure here loses nothing: the posts stay queued.
 */
export const runSocialPublish = async (): Promise<void> => {
  const { data } = await supabase.auth.getSession();
  const bearer = data.session?.access_token;
  if (!bearer) return;
  await fetch('/api/social/publish', { method: 'POST', headers: { Authorization: `Bearer ${bearer}` } }).catch(() => undefined);
};
