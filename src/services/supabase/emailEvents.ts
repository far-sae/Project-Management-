// src/services/supabase/emailEvents.ts
//
// Read-side for the per-entity email log (public.email_events,
// migration 116). Inserts happen from the notify-send-gmail edge
// function (outbound) and gmail-inbound (inbound) — the frontend just
// lists.

import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type EmailDirection = "outbound" | "inbound";
export type EmailStatus = "sent" | "delivered" | "failed" | "received";
export type EmailEntityType = "lead" | "contact" | "client" | "deal";

export interface EmailEvent {
  eventId: string;
  organizationId: string;
  entityType: EmailEntityType | null;
  entityId: string | null;
  direction: EmailDirection;
  status: EmailStatus;
  subject: string | null;
  snippet: string | null;
  fromEmail: string | null;
  toEmails: string[];
  ccEmails: string[];
  messageId: string | null;
  threadId: string | null;
  gmailId: string | null;
  senderUserId: string | null;
  senderName: string | null;
  metadata: Record<string, unknown>;
  occurredAt: Date;
  createdAt: Date;
}

const mapEmail = (row: Record<string, unknown>): EmailEvent => ({
  eventId: row.event_id as string,
  organizationId: row.organization_id as string,
  entityType: (row.entity_type as EmailEntityType | null) ?? null,
  entityId: (row.entity_id as string | null) ?? null,
  direction: row.direction as EmailDirection,
  status: (row.status as EmailStatus) ?? "sent",
  subject: (row.subject as string | null) ?? null,
  snippet: (row.snippet as string | null) ?? null,
  fromEmail: (row.from_email as string | null) ?? null,
  toEmails: Array.isArray(row.to_emails) ? (row.to_emails as string[]) : [],
  ccEmails: Array.isArray(row.cc_emails) ? (row.cc_emails as string[]) : [],
  messageId: (row.message_id as string | null) ?? null,
  threadId: (row.thread_id as string | null) ?? null,
  gmailId: (row.gmail_id as string | null) ?? null,
  senderUserId: (row.sender_user_id as string | null) ?? null,
  senderName: (row.sender_name as string | null) ?? null,
  metadata: (row.metadata as Record<string, unknown>) ?? {},
  occurredAt: new Date(row.occurred_at as string),
  createdAt: new Date(row.created_at as string),
});

/** Per-entity timeline. Newest first. Falls back to empty array on
 *  schema-drift errors (table not yet migrated). */
export const listEntityEmails = async (
  organizationId: string,
  entityType: EmailEntityType,
  entityId: string,
): Promise<EmailEvent[]> => {
  const { data, error } = await supabase
    .from("email_events")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("occurred_at", { ascending: false });
  if (error) {
    // 42P01 = "relation does not exist" → migration 116 not applied
    // yet. Return [] so the section renders an empty state instead of
    // a red error banner. Other errors still log.
    const code = (error as { code?: string }).code ?? "";
    if (code !== "42P01") logger.error("listEntityEmails failed:", error);
    return [];
  }
  return (data ?? []).map((r) => mapEmail(r as Record<string, unknown>));
};

/** Used by the Send Email button on Lead/Contact drawers when we
 *  can't route through the edge function (e.g. EmailJS fallback) —
 *  logs the outbound event client-side so the timeline still updates. */
export const logManualOutboundEmail = async (params: {
  organizationId: string;
  entityType: EmailEntityType;
  entityId: string;
  toEmail: string;
  subject: string;
  body: string;
  senderUserId: string | null;
  senderName: string | null;
}): Promise<void> => {
  const { organizationId, entityType, entityId, toEmail, subject, body, senderUserId, senderName } = params;
  const { error } = await supabase.from("email_events").insert({
    organization_id: organizationId,
    entity_type: entityType,
    entity_id: entityId,
    direction: "outbound",
    status: "sent",
    subject,
    snippet: body.slice(0, 200),
    to_emails: [toEmail],
    sender_user_id: senderUserId,
    sender_name: senderName,
  });
  if (error) logger.warn("logManualOutboundEmail failed:", error);
};
