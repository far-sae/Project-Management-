import Papa from "papaparse";
import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { encryptSecret } from "@/lib/email/crypto";
import { dedupeRecipients, filterSuppressed, normalizeEmail } from "@/lib/email/suppression";
import type {
  AccountStatus,
  CampaignKind,
  CampaignStatus,
  EmailAccount,
  EmailCampaign,
  EmailMessage,
  EmailSuppression,
  MessageStatus,
  SuppressionReason,
} from "@/lib/email/types";

/** A recipient collected from CRM contacts, a pasted list, or a CSV upload. */
export interface Recipient {
  email: string;
  name?: string;
  contactId?: string;
  mergeData: Record<string, unknown>;
}

export interface CreateAccountInput {
  organizationId: string;
  workspaceId?: string | null;
  userId?: string | null;
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  /** Plaintext SMTP password. Never stored as-is — encrypted client-side and
   *  written through `saveAccountSecret`. */
  password: string;
  dailyLimit?: number;
  hourlyLimit?: number;
}

export interface CreateCampaignInput {
  organizationId: string;
  workspaceId?: string | null;
  createdBy?: string | null;
  accountId: string;
  kind: CampaignKind;
  name: string;
  subject: string;
  bodyHtml: string;
  scheduledAt?: Date | null;
  ratePerHour?: number;
}

/** Raw shape of an `email_accounts` row as returned by PostgREST. */
interface EmailAccountRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  user_id: string | null;
  label: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_username: string;
  daily_limit: number;
  hourly_limit: number;
  status: AccountStatus;
  last_error: string | null;
  last_verified_at: string | null;
  created_at: string;
}

/** Raw shape of an `email_campaigns` row as returned by PostgREST. */
interface EmailCampaignRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  created_by: string | null;
  account_id: string;
  kind: CampaignKind;
  name: string;
  subject: string;
  body_html: string;
  status: CampaignStatus;
  scheduled_at: string | null;
  rate_per_hour: number;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  suppressed_count: number;
  created_at: string;
}

/** Raw shape of an `email_messages` row as returned by PostgREST. */
interface EmailMessageRow {
  id: string;
  campaign_id: string;
  organization_id: string;
  contact_id: string | null;
  to_email: string;
  to_name: string | null;
  merge_data: Record<string, unknown> | null;
  status: MessageStatus;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
}

/** Raw shape of an `email_suppressions` row as returned by PostgREST. */
interface EmailSuppressionRow {
  id: string;
  organization_id: string;
  email: string;
  reason: SuppressionReason;
  created_at: string;
}

/** Raw shape of the `crm_contacts` columns `contactsForCampaign` selects. */
interface CrmContactRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  company_id: string | null;
}

export const mapAccountRow = (row: EmailAccountRow): EmailAccount => ({
  id: row.id,
  organizationId: row.organization_id,
  workspaceId: row.workspace_id,
  userId: row.user_id,
  label: row.label,
  fromName: row.from_name,
  fromEmail: row.from_email,
  replyTo: row.reply_to,
  smtpHost: row.smtp_host,
  smtpPort: row.smtp_port,
  smtpSecure: row.smtp_secure,
  smtpUsername: row.smtp_username,
  dailyLimit: row.daily_limit,
  hourlyLimit: row.hourly_limit,
  status: row.status,
  lastError: row.last_error,
  lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at) : null,
  createdAt: new Date(row.created_at),
});

export const mapCampaignRow = (row: EmailCampaignRow): EmailCampaign => ({
  id: row.id,
  organizationId: row.organization_id,
  workspaceId: row.workspace_id,
  createdBy: row.created_by,
  accountId: row.account_id,
  kind: row.kind,
  name: row.name,
  subject: row.subject,
  bodyHtml: row.body_html,
  status: row.status,
  scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
  ratePerHour: row.rate_per_hour,
  queuedCount: row.queued_count,
  sentCount: row.sent_count,
  failedCount: row.failed_count,
  suppressedCount: row.suppressed_count,
  createdAt: new Date(row.created_at),
});

export const mapMessageRow = (row: EmailMessageRow): EmailMessage => ({
  id: row.id,
  campaignId: row.campaign_id,
  organizationId: row.organization_id,
  contactId: row.contact_id,
  toEmail: row.to_email,
  toName: row.to_name,
  mergeData: row.merge_data ?? {},
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
  sentAt: row.sent_at ? new Date(row.sent_at) : null,
});

export const mapSuppressionRow = (row: EmailSuppressionRow): EmailSuppression => ({
  id: row.id,
  organizationId: row.organization_id,
  email: row.email,
  reason: row.reason,
  createdAt: new Date(row.created_at),
});

// ── Accounts ──────────────────────────────────────────────────────────

export const listAccounts = async (orgId: string): Promise<EmailAccount[]> => {
  const { data, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to list email accounts:", error);
    throw error;
  }

  return ((data ?? []) as EmailAccountRow[]).map(mapAccountRow);
};

export const createAccount = async (input: CreateAccountInput): Promise<EmailAccount> => {
  const row = {
    organization_id: input.organizationId,
    workspace_id: input.workspaceId ?? null,
    user_id: input.userId ?? null,
    label: input.label,
    from_name: input.fromName,
    from_email: input.fromEmail,
    reply_to: input.replyTo ?? null,
    smtp_host: input.smtpHost,
    smtp_port: input.smtpPort,
    smtp_secure: input.smtpSecure,
    smtp_username: input.smtpUsername,
    ...(input.dailyLimit !== undefined ? { daily_limit: input.dailyLimit } : {}),
    ...(input.hourlyLimit !== undefined ? { hourly_limit: input.hourlyLimit } : {}),
  };

  const { data, error } = await supabase
    .from("email_accounts")
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create email account:", error);
    throw error;
  }

  const account = mapAccountRow(data as EmailAccountRow);
  await saveAccountSecret(account.id, input.password);
  return account;
};

/**
 * Encrypts the SMTP password in the browser and writes it through
 * `POST /api/email/account-secret`. `email_account_secrets` denies all
 * access to `authenticated` (migration 152), so a direct insert from here
 * would always fail — the ciphertext has to go through a service-role route.
 */
export const saveAccountSecret = async (accountId: string, password: string): Promise<void> => {
  const key = import.meta.env.VITE_INTEGRATION_TOKEN_KEY as string | undefined;
  if (!key) {
    throw new Error(
      "Missing required env var: VITE_INTEGRATION_TOKEN_KEY. Set it before saving an SMTP password.",
    );
  }

  const secretEncrypted = await encryptSecret(password, key);

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch("/api/email/account-secret", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ accountId, secretEncrypted }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const message = body.error ?? `Failed to save account secret: ${res.status}`;
    logger.error("Failed to save account secret:", message);
    throw new Error(message);
  }
};

export const deleteAccount = async (accountId: string): Promise<void> => {
  const { error } = await supabase.from("email_accounts").delete().eq("id", accountId);

  if (error) {
    logger.error("Failed to delete email account:", error);
    throw error;
  }
};

// ── Campaigns ─────────────────────────────────────────────────────────

export const listCampaigns = async (
  orgId: string,
  workspaceId: string | null,
): Promise<EmailCampaign[]> => {
  let query = supabase.from("email_campaigns").select("*").eq("organization_id", orgId);
  if (workspaceId !== null) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to list email campaigns:", error);
    throw error;
  }

  return ((data ?? []) as EmailCampaignRow[]).map(mapCampaignRow);
};

export const createCampaign = async (input: CreateCampaignInput): Promise<EmailCampaign> => {
  const row = {
    organization_id: input.organizationId,
    workspace_id: input.workspaceId ?? null,
    created_by: input.createdBy ?? null,
    account_id: input.accountId,
    kind: input.kind,
    name: input.name,
    subject: input.subject,
    body_html: input.bodyHtml,
    scheduled_at: input.scheduledAt ? input.scheduledAt.toISOString() : null,
    ...(input.ratePerHour !== undefined ? { rate_per_hour: input.ratePerHour } : {}),
  };

  const { data, error } = await supabase
    .from("email_campaigns")
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create email campaign:", error);
    throw error;
  }

  return mapCampaignRow(data as EmailCampaignRow);
};

/**
 * Flips a campaign's status — e.g. out of the table's default `'draft'` and
 * into `'sending'` or `'scheduled'` once its outbox rows exist. Nothing else
 * does this: `createCampaign` never sets a status on insert, and
 * `claim_email_batch` (the worker's claim query) only picks up messages
 * whose campaign is already `'sending'` or `'scheduled'`, so a campaign left
 * at `'draft'` would sit forever.
 */
export const setCampaignStatus = async (campaignId: string, status: CampaignStatus): Promise<void> => {
  const { error } = await supabase
    .from("email_campaigns")
    .update({ status })
    .eq("id", campaignId);

  if (error) {
    logger.error("Failed to update campaign status:", error);
    throw error;
  }
};

const QUEUE_CHUNK_SIZE = 500;

/**
 * Splits `recipients` against the org's suppression list and inserts one
 * `email_messages` row per sendable recipient, in chunks of 500. Suppressed
 * recipients are filtered out by `filterSuppressed` *before* any insert is
 * built, so the insert payload never contains one — there is no code path
 * where a suppressed address reaches `.insert(...)`.
 *
 * `sendAfter`, when given, is written onto every inserted row's `send_after`
 * so a scheduled campaign's messages aren't claimable by the worker until
 * that time (`claim_email_batch` gates on `send_after <= now()`). Omit it —
 * or pass `null` — to keep the column's default of `now()`, i.e. claimable
 * immediately.
 */
export const queueRecipients = async (
  campaignId: string,
  orgId: string,
  recipients: Recipient[],
  sendAfter?: Date | null,
): Promise<{ queued: number; suppressed: number }> => {
  const { data: suppressionRows, error: suppressionError } = await supabase
    .from("email_suppressions")
    .select("email")
    .eq("organization_id", orgId);

  if (suppressionError) {
    logger.error("Failed to load suppressions for queueRecipients:", suppressionError);
    throw suppressionError;
  }

  const suppressedEmails = ((suppressionRows ?? []) as { email: string }[]).map((r) => r.email);
  const { sendable, suppressed } = filterSuppressed(recipients, suppressedEmails);

  for (let i = 0; i < sendable.length; i += QUEUE_CHUNK_SIZE) {
    const chunk = sendable.slice(i, i + QUEUE_CHUNK_SIZE).map((r) => ({
      campaign_id: campaignId,
      organization_id: orgId,
      contact_id: r.contactId ?? null,
      to_email: r.email,
      to_name: r.name ?? null,
      merge_data: r.mergeData ?? {},
      ...(sendAfter ? { send_after: sendAfter.toISOString() } : {}),
    }));

    const { error } = await supabase.from("email_messages").insert(chunk);
    if (error) {
      logger.error("Failed to queue email_messages batch:", error);
      throw error;
    }
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from("email_campaigns")
    .select("queued_count, suppressed_count")
    .eq("id", campaignId)
    .single();

  if (campaignError) {
    logger.error("Failed to load campaign for count update:", campaignError);
    throw campaignError;
  }

  const queuedCount = (campaignRow?.queued_count ?? 0) + sendable.length;
  const suppressedCount = (campaignRow?.suppressed_count ?? 0) + suppressed.length;

  const { error: updateError } = await supabase
    .from("email_campaigns")
    .update({ queued_count: queuedCount, suppressed_count: suppressedCount })
    .eq("id", campaignId);

  if (updateError) {
    logger.error("Failed to update campaign counts:", updateError);
    throw updateError;
  }

  return { queued: sendable.length, suppressed: suppressed.length };
};

export const listMessages = async (campaignId: string): Promise<EmailMessage[]> => {
  const { data, error } = await supabase
    .from("email_messages")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("Failed to list email messages:", error);
    throw error;
  }

  return ((data ?? []) as EmailMessageRow[]).map(mapMessageRow);
};

// ── Suppressions ──────────────────────────────────────────────────────

export const listSuppressions = async (orgId: string): Promise<EmailSuppression[]> => {
  const { data, error } = await supabase
    .from("email_suppressions")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to list email suppressions:", error);
    throw error;
  }

  return ((data ?? []) as EmailSuppressionRow[]).map(mapSuppressionRow);
};

export const addSuppression = async (orgId: string, email: string): Promise<void> => {
  const { error } = await supabase.from("email_suppressions").upsert(
    { organization_id: orgId, email: normalizeEmail(email), reason: "manual" },
    { onConflict: "organization_id,email" },
  );

  if (error) {
    logger.error("Failed to add email suppression:", error);
    throw error;
  }
};

export const removeSuppression = async (id: string): Promise<void> => {
  const { error } = await supabase.from("email_suppressions").delete().eq("id", id);

  if (error) {
    logger.error("Failed to remove email suppression:", error);
    throw error;
  }
};

// ── Recipients ────────────────────────────────────────────────────────

export const contactsForCampaign = async (
  orgId: string,
  workspaceId: string | null,
): Promise<Recipient[]> => {
  let query = supabase
    .from("crm_contacts")
    .select("id, first_name, last_name, email, company_id")
    .eq("organization_id", orgId)
    .not("email", "is", null);
  if (workspaceId !== null) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    logger.error("Failed to load CRM contacts for campaign:", error);
    throw error;
  }

  return ((data ?? []) as CrmContactRow[]).map((row) => {
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    return {
      email: row.email as string,
      name: fullName || undefined,
      contactId: row.id,
      mergeData: {
        first_name: row.first_name,
        last_name: row.last_name ?? "",
        full_name: fullName,
        email: row.email,
      },
    };
  });
};

const PASTED_SEPARATOR_RE = /[\n,;]+/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_EMAIL_RE = /^(.*)<([^<>]+)>$/;

export const parsePastedRecipients = (
  text: string,
): { recipients: Recipient[]; errors: string[] } => {
  const entries = text
    .split(PASTED_SEPARATOR_RE)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const errors: string[] = [];
  const parsed: Recipient[] = [];

  for (const entry of entries) {
    let email = entry;
    let name: string | undefined;

    const match = entry.match(NAME_EMAIL_RE);
    if (match) {
      name = match[1].trim() || undefined;
      email = match[2].trim();
    }

    if (!EMAIL_RE.test(email)) {
      errors.push(`Not a valid email address: ${entry}`);
      continue;
    }

    parsed.push({ email, name, mergeData: {} });
  }

  return { recipients: dedupeRecipients(parsed), errors };
};

/** Normalizes a header for matching the email column: strips whitespace,
 *  underscores and hyphens entirely so "Email Address", "email_address" and
 *  "EmailAddress" all match. */
const normalizeHeaderForMatch = (header: string): string =>
  header.trim().toLowerCase().replace(/[\s_-]+/g, "");

/** Normalizes a header into a snake_case merge-data key, keeping word
 *  boundaries (unlike the stricter match-only normalization above). */
const normalizeHeaderToSnakeCase = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

export const parseRecipientsCsv = (
  text: string,
): { recipients: Recipient[]; errors: string[] } => {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = result.meta?.fields ?? [];
  const emailHeader = headers.find((header) => {
    const key = normalizeHeaderForMatch(header);
    return key === "email" || key === "emailaddress";
  });

  if (!emailHeader) {
    return { recipients: [], errors: ['No "email" column found in the CSV'] };
  }

  const mergeHeaders = headers.filter((header) => header !== emailHeader);

  const recipients: Recipient[] = [];
  for (const row of result.data ?? []) {
    const email = String(row[emailHeader] ?? "").trim();
    if (!email) continue;

    const mergeData: Record<string, unknown> = {};
    for (const header of mergeHeaders) {
      mergeData[normalizeHeaderToSnakeCase(header)] = row[header];
    }

    recipients.push({ email, mergeData });
  }

  return { recipients, errors: [] };
};
