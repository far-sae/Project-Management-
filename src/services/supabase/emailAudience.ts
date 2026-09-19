// Reads and writes for the audience half of the email feature: groups,
// templates, and the prospects both of them describe.
//
// Kept apart from services/supabase/email.ts, which is already a thousand
// lines and is about sending. This file is about who you are writing to and
// what you are writing — it shares the client and nothing else.
//
// Two rules run through it, and both come from the spec:
//
//   * PROSPECTS ARE crm_contacts. There is no second contact table. Those rows
//     already exist, email_messages.contact_id already references them, and
//     the CRM hub's removal in migration 143 left them with no screen rather
//     than deleting them. A second list would mean two places to fix somebody's
//     email address.
//   * "DO NOT MAIL" LIVES IN email_suppressions. It is never written onto the
//     contact. That table is what claim_email_batch() enforces on every send,
//     what the unsubscribe endpoint writes and what a hard bounce adds to; a
//     flag on the contact would be a second source of truth for the one
//     question the law cares about, and the two would disagree within a week.

import { supabase } from "./config";
import { logger } from "@/lib/logger";
import type {
  EmailGroup,
  EmailProspect,
  EmailTemplate,
  SuppressionReason,
} from "@/lib/email/types";

/* ------------------------------------------------------------------- rows */

interface EmailGroupRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  name: string;
  angle: string | null;
  created_at: string;
  updated_at: string;
}

interface EmailTemplateRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  created_by: string | null;
  name: string;
  subject: string | null;
  body_html: string | null;
  created_at: string;
  updated_at: string;
}

interface ProspectRow {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  pain_point?: string | null;
  group_id?: string | null;
  last_contacted_at: string | null;
  created_at: string;
}

const mapGroup = (row: EmailGroupRow): EmailGroup => ({
  id: row.id,
  organizationId: row.organization_id,
  workspaceId: row.workspace_id,
  name: row.name,
  angle: row.angle ?? "",
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const mapTemplate = (row: EmailTemplateRow): EmailTemplate => ({
  id: row.id,
  organizationId: row.organization_id,
  workspaceId: row.workspace_id,
  createdBy: row.created_by,
  name: row.name,
  subject: row.subject ?? "",
  bodyHtml: row.body_html ?? "",
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

/* ----------------------------------------------------------------- groups */

export const listGroups = async (
  orgId: string,
  workspaceId: string | null = null,
): Promise<EmailGroup[]> => {
  let query = supabase.from("email_groups").select("*").eq("organization_id", orgId);
  if (workspaceId !== null) query = query.eq("workspace_id", workspaceId);

  const { data, error } = await query.order("name", { ascending: true });

  if (error) {
    logger.error("Failed to list email groups:", error);
    throw error;
  }
  return ((data ?? []) as EmailGroupRow[]).map(mapGroup);
};

export const saveGroup = async (input: {
  id?: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  angle: string;
}): Promise<EmailGroup> => {
  const row = {
    ...(input.id ? { id: input.id } : {}),
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    name: input.name.trim(),
    angle: input.angle.trim(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("email_groups")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    logger.error("Failed to save an email group:", error);
    throw error;
  }
  return mapGroup(data as EmailGroupRow);
};

/**
 * Removes a group. Its contacts are released, not deleted — `group_id` is
 * `on delete set null` (migration 162d), which is the only acceptable
 * behaviour: a segment is a label, and deleting a label must never delete
 * people.
 */
export const deleteGroup = async (id: string): Promise<void> => {
  const { error } = await supabase.from("email_groups").delete().eq("id", id);
  if (error) {
    logger.error("Failed to delete an email group:", error);
    throw error;
  }
};

/* -------------------------------------------------------------- templates */

export const listTemplates = async (
  orgId: string,
  workspaceId: string | null = null,
): Promise<EmailTemplate[]> => {
  let query = supabase.from("email_templates").select("*").eq("organization_id", orgId);
  if (workspaceId !== null) query = query.eq("workspace_id", workspaceId);

  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    logger.error("Failed to list email templates:", error);
    throw error;
  }
  return ((data ?? []) as EmailTemplateRow[]).map(mapTemplate);
};

export const saveTemplate = async (input: {
  id?: string;
  organizationId: string;
  workspaceId: string | null;
  createdBy: string | null;
  name: string;
  subject: string;
  bodyHtml: string;
}): Promise<EmailTemplate> => {
  const row = {
    ...(input.id ? { id: input.id } : {}),
    organization_id: input.organizationId,
    workspace_id: input.workspaceId,
    created_by: input.createdBy,
    name: input.name.trim(),
    subject: input.subject,
    body_html: input.bodyHtml,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("email_templates")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    logger.error("Failed to save an email template:", error);
    throw error;
  }
  return mapTemplate(data as EmailTemplateRow);
};

/**
 * Removes a template.
 *
 * The campaigns written from it keep their own subject and body and simply
 * lose the record of where the wording came from — `template_id` is
 * `on delete set null` (162c). Their stats stop being attributed to this
 * template, which is correct: the template no longer exists to have stats.
 */
export const deleteTemplate = async (id: string): Promise<void> => {
  const { error } = await supabase.from("email_templates").delete().eq("id", id);
  if (error) {
    logger.error("Failed to delete an email template:", error);
    throw error;
  }
};

/* -------------------------------------------------------------- prospects */

/**
 * The people this organization can write to, with their suppression state.
 *
 * Two reads rather than a join, deliberately: `email_suppressions` is keyed by
 * address and `crm_contacts` by id, and PostgREST cannot express that join
 * without a foreign key that should not exist — the suppression list is about
 * addresses, and an address does not belong to a contact row.
 */
export const listProspects = async (
  orgId: string,
  workspaceId: string | null = null,
): Promise<EmailProspect[]> => {
  let query = supabase
    .from("crm_contacts")
    .select(
      "id, organization_id, first_name, last_name, email, job_title, pain_point, group_id, last_contacted_at, created_at",
    )
    .eq("organization_id", orgId);
  if (workspaceId !== null) query = query.eq("workspace_id", workspaceId);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to list prospects:", error);
    throw error;
  }

  const rows = (data ?? []) as ProspectRow[];

  // One read for the whole list. Suppression is organization-wide, so this is
  // the same set for every row and there is nothing to page per contact.
  const suppressed = new Map<string, SuppressionReason>();
  const { data: suppressions, error: suppressionError } = await supabase
    .from("email_suppressions")
    .select("email, reason")
    .eq("organization_id", orgId);

  if (suppressionError) {
    // Reported, not thrown. A prospect list that loads without the badges is
    // worth more than an error page — and the badges are informational: what
    // actually stops mail going out is claim_email_batch(), which reads the
    // same table server-side on every send.
    logger.error("Failed to read suppressions for the prospect list:", suppressionError);
  } else {
    for (const row of (suppressions ?? []) as Array<{ email: string; reason: SuppressionReason }>) {
      suppressed.set(String(row.email).trim().toLowerCase(), row.reason);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    jobTitle: row.job_title,
    painPoint: row.pain_point ?? null,
    groupId: row.group_id ?? null,
    suppressedReason: row.email
      ? (suppressed.get(row.email.trim().toLowerCase()) ?? null)
      : null,
    lastContactedAt: row.last_contacted_at ? new Date(row.last_contacted_at) : null,
    createdAt: new Date(row.created_at),
  }));
};

export const saveProspect = async (input: {
  id?: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  painPoint: string;
  groupId: string | null;
}): Promise<void> => {
  const row = {
    ...(input.id ? { id: input.id } : {}),
    organization_id: input.organizationId,
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim() || null,
    email: input.email.trim().toLowerCase() || null,
    job_title: input.jobTitle.trim() || null,
    pain_point: input.painPoint.trim() || null,
    group_id: input.groupId,
  };

  const { error } = await supabase.from("crm_contacts").upsert(row, { onConflict: "id" });

  if (error) {
    logger.error("Failed to save a prospect:", error);
    throw error;
  }
};

/**
 * Puts every contact in `ids` into `groupId`, or takes them out of any group
 * when it is null.
 *
 * One statement rather than a loop: assigning a hundred prospects to a segment
 * is the ordinary case, and a hundred round trips would half of them fail
 * somewhere in the middle with no way to say which.
 */
export const assignGroup = async (ids: string[], groupId: string | null): Promise<void> => {
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("crm_contacts")
    .update({ group_id: groupId })
    .in("id", ids);

  if (error) {
    logger.error("Failed to assign prospects to a group:", error);
    throw error;
  }
};

/**
 * Removes a prospect from the outreach list.
 *
 * This deletes the contact row, which is what the Prospects screen is for —
 * but note what it does NOT do: it does not remove them from
 * `email_suppressions`. Somebody who unsubscribed stays unsubscribed after
 * their contact record is deleted, because the suppression is about the
 * ADDRESS and re-importing them must not quietly resume mailing them.
 */
export const deleteProspect = async (id: string): Promise<void> => {
  const { error } = await supabase.from("crm_contacts").delete().eq("id", id);
  if (error) {
    logger.error("Failed to delete a prospect:", error);
    throw error;
  }
};
