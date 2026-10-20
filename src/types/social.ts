export type SocialProvider = 'linkedin' | 'facebook' | 'instagram' | 'x' | 'youtube' | 'tiktok' | 'other';
export type SocialContentStatus = 'draft' | 'in_review' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed';

export interface SocialAccount {
  id: string; organizationId: string; workspaceId: string; provider: SocialProvider;
  displayName: string; externalAccountId: string | null; status: 'disconnected' | 'connected' | 'error';
  lastError: string | null; createdAt: Date;
}
export interface SocialCampaign {
  id: string; organizationId: string; workspaceId: string; name: string; objective: string | null;
  crmContactId: string | null; crmCompanyId: string | null; projectId: string | null; taskId: string | null;
  status: 'draft' | 'active' | 'paused' | 'finished'; createdAt: Date;
}
export interface SocialContent {
  id: string; organizationId: string; workspaceId: string; campaignId: string | null;
  accountId: string | null; crmContactId: string | null; crmCompanyId: string | null;
  projectId: string | null; taskId: string | null; title: string; body: string;
  status: SocialContentStatus; scheduledAt: Date | null; publishedAt: Date | null;
  lastError: string | null; createdAt: Date;
}
export interface SocialMetric {
  contentId: string; impressions: number; reach: number; clicks: number;
  reactions: number; comments: number; shares: number;
}
