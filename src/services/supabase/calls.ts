// src/services/supabase/calls.ts
//
// CRUD for the Activities-hub Call object (migration 115). Same shape +
// notify pattern as meetings.ts.

import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type CallType = "inbound" | "outbound" | "missed" | "scheduled" | "cancelled";
export type CallStatus = "scheduled" | "completed" | "missed" | "cancelled";

export interface Call {
  callId: string;
  organizationId: string;
  workspaceId: string | null;
  subject: string;
  callType: CallType;
  callStatus: CallStatus;
  callStartAt: Date | null;
  callDurationSeconds: number | null;
  callerUserId: string | null;
  callerName: string | null;
  relatedToType: string | null;
  relatedToId: string | null;
  clientId: string | null;
  dealId: string | null;
  leadId: string | null;
  contactPhone: string | null;
  contactName: string | null;
  description: string | null;
  outcome: string | null;
  createdAt: Date;
  createdBy: string | null;
  createdByName: string | null;
  updatedAt: Date;
}

export interface CreateCallInput {
  organizationId: string;
  workspaceId?: string | null;
  subject: string;
  callType?: CallType;
  callStatus?: CallStatus;
  callStartAt?: Date | null;
  callDurationSeconds?: number | null;
  callerUserId?: string | null;
  callerName?: string | null;
  relatedToType?: string | null;
  relatedToId?: string | null;
  clientId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  contactPhone?: string | null;
  contactName?: string | null;
  description?: string | null;
  outcome?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
}

const CALLS_CHANGED_EVENT = "taskcalendar:calls-changed";

export const onCallsChanged = (cb: (orgId: string) => void) => {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ organizationId: string }>).detail;
    if (detail?.organizationId) cb(detail.organizationId);
  };
  window.addEventListener(CALLS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(CALLS_CHANGED_EVENT, handler);
};

const notifyCallsChanged = (organizationId: string) => {
  window.dispatchEvent(new CustomEvent(CALLS_CHANGED_EVENT, {
    detail: { organizationId },
  }));
};

const mapCall = (row: Record<string, unknown>): Call => ({
  callId: row.call_id as string,
  organizationId: row.organization_id as string,
  workspaceId: (row.workspace_id as string | null) ?? null,
  subject: row.subject as string,
  callType: (row.call_type as CallType) ?? "outbound",
  callStatus: (row.call_status as CallStatus) ?? "scheduled",
  callStartAt: row.call_start_at ? new Date(row.call_start_at as string) : null,
  callDurationSeconds: (row.call_duration_seconds as number | null) ?? null,
  callerUserId: (row.caller_user_id as string | null) ?? null,
  callerName: (row.caller_name as string | null) ?? null,
  relatedToType: (row.related_to_type as string | null) ?? null,
  relatedToId: (row.related_to_id as string | null) ?? null,
  clientId: (row.client_id as string | null) ?? null,
  dealId: (row.deal_id as string | null) ?? null,
  leadId: (row.lead_id as string | null) ?? null,
  contactPhone: (row.contact_phone as string | null) ?? null,
  contactName: (row.contact_name as string | null) ?? null,
  description: (row.description as string | null) ?? null,
  outcome: (row.outcome as string | null) ?? null,
  createdAt: new Date(row.created_at as string),
  createdBy: (row.created_by as string | null) ?? null,
  createdByName: (row.created_by_name as string | null) ?? null,
  updatedAt: new Date(row.updated_at as string),
});

export const listCalls = async (
  organizationId: string,
  opts: { workspaceId?: string | null } = {},
): Promise<Call[]> => {
  let q = supabase.from("calls").select("*").eq("organization_id", organizationId);
  if (opts.workspaceId !== undefined) {
    if (opts.workspaceId === null) q = q.is("workspace_id", null);
    else q = q.eq("workspace_id", opts.workspaceId);
  }
  // call_start_at can be null for "scheduled but no time yet" calls —
  // surface those last; recent completed calls first.
  const { data, error } = await q.order("call_start_at", { ascending: false, nullsFirst: false });
  if (error) {
    logger.error("listCalls failed:", error);
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => mapCall(r as Record<string, unknown>));
};

export const createCall = async (input: CreateCallInput): Promise<Call> => {
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    workspace_id: input.workspaceId ?? null,
    subject: input.subject.trim(),
    call_type: input.callType ?? "outbound",
    call_status: input.callStatus ?? "scheduled",
    call_start_at: input.callStartAt ? input.callStartAt.toISOString() : null,
    call_duration_seconds: input.callDurationSeconds ?? null,
    caller_user_id: input.callerUserId ?? null,
    caller_name: input.callerName ?? null,
    related_to_type: input.relatedToType ?? null,
    related_to_id: input.relatedToId ?? null,
    client_id: input.clientId ?? null,
    deal_id: input.dealId ?? null,
    lead_id: input.leadId ?? null,
    contact_phone: input.contactPhone ?? null,
    contact_name: input.contactName ?? null,
    description: input.description ?? null,
    outcome: input.outcome ?? null,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  };
  const { data, error } = await supabase.from("calls").insert(row).select("*").single();
  if (error) {
    logger.error("createCall failed:", error);
    throw new Error(error.message);
  }
  notifyCallsChanged(input.organizationId);
  return mapCall(data as Record<string, unknown>);
};

export const updateCall = async (
  callId: string,
  patch: Partial<CreateCallInput>,
): Promise<Call> => {
  const row: Record<string, unknown> = {};
  if (patch.subject !== undefined) row.subject = patch.subject.trim();
  if (patch.callType !== undefined) row.call_type = patch.callType;
  if (patch.callStatus !== undefined) row.call_status = patch.callStatus;
  if (patch.callStartAt !== undefined) row.call_start_at = patch.callStartAt ? patch.callStartAt.toISOString() : null;
  if (patch.callDurationSeconds !== undefined) row.call_duration_seconds = patch.callDurationSeconds;
  if (patch.callerUserId !== undefined) row.caller_user_id = patch.callerUserId;
  if (patch.callerName !== undefined) row.caller_name = patch.callerName;
  if (patch.relatedToType !== undefined) row.related_to_type = patch.relatedToType;
  if (patch.relatedToId !== undefined) row.related_to_id = patch.relatedToId;
  if (patch.clientId !== undefined) row.client_id = patch.clientId;
  if (patch.dealId !== undefined) row.deal_id = patch.dealId;
  if (patch.leadId !== undefined) row.lead_id = patch.leadId;
  if (patch.contactPhone !== undefined) row.contact_phone = patch.contactPhone;
  if (patch.contactName !== undefined) row.contact_name = patch.contactName;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.outcome !== undefined) row.outcome = patch.outcome;

  const { data, error } = await supabase
    .from("calls").update(row).eq("call_id", callId).select("*").single();
  if (error) {
    logger.error("updateCall failed:", error);
    throw new Error(error.message);
  }
  const mapped = mapCall(data as Record<string, unknown>);
  notifyCallsChanged(mapped.organizationId);
  return mapped;
};

export const deleteCall = async (callId: string, organizationId: string): Promise<void> => {
  const { error } = await supabase.from("calls").delete().eq("call_id", callId);
  if (error) {
    logger.error("deleteCall failed:", error);
    throw new Error(error.message);
  }
  notifyCallsChanged(organizationId);
};
