export type CampaignKind = 'single' | 'bulk';
export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'suppressed';
export type CampaignStatus =
  | 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'failed';
export type AccountStatus = 'unverified' | 'active' | 'error';
export type SuppressionReason = 'unsubscribed' | 'bounced' | 'complaint' | 'manual';

export interface EmailAccount {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  userId: string | null;
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  dailyLimit: number;
  hourlyLimit: number;
  status: AccountStatus;
  lastError: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

export interface EmailCampaign {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  createdBy: string | null;
  accountId: string;
  kind: CampaignKind;
  name: string;
  subject: string;
  bodyHtml: string;
  status: CampaignStatus;
  scheduledAt: Date | null;
  ratePerHour: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  createdAt: Date;
}

export interface EmailMessage {
  id: string;
  campaignId: string;
  organizationId: string;
  contactId: string | null;
  toEmail: string;
  toName: string | null;
  mergeData: Record<string, unknown>;
  status: MessageStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
}

export interface EmailSuppression {
  id: string;
  organizationId: string;
  email: string;
  reason: SuppressionReason;
  createdAt: Date;
}
