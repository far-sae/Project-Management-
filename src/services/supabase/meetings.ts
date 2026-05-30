// src/services/supabase/meetings.ts
//
// CRUD for the Activities-hub Meeting object (migration 115). Mirrors
// the shape of clients.ts / deals.ts: snake_case rows → camelCase
// domain types via mapMeeting, plus a small CustomEvent so other tabs
// in the same browser refetch when a meeting changes.

import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type MeetingStatus = "scheduled" | "held" | "cancelled" | "no_show";
export type RelatedToType = "client" | "deal" | "lead" | "contact" | "account";

export interface MeetingParticipant {
  /** 'user' = internal org user; 'contact' = CRM contact row;
   *  'email' = external invitee with no CRM record. */
  kind: "user" | "contact" | "email";
  id?: string | null;
  name: string;
  email?: string | null;
}

export interface Meeting {
  meetingId: string;
  organizationId: string;
  workspaceId: string | null;
  title: string;
  location: string | null;
  allDay: boolean;
  startAt: Date;
  endAt: Date;
  hostUserId: string | null;
  hostName: string | null;
  relatedToType: RelatedToType | null;
  relatedToId: string | null;
  clientId: string | null;
  dealId: string | null;
  participants: MeetingParticipant[];
  description: string | null;
  status: MeetingStatus;
  sendInvites: boolean;
  googleMeetLink: string | null;
  googleEventId: string | null;
  createdAt: Date;
  createdBy: string | null;
  createdByName: string | null;
  updatedAt: Date;
}

export interface CreateMeetingInput {
  organizationId: string;
  workspaceId?: string | null;
  title: string;
  location?: string | null;
  allDay?: boolean;
  startAt: Date;
  endAt: Date;
  hostUserId?: string | null;
  hostName?: string | null;
  relatedToType?: RelatedToType | null;
  relatedToId?: string | null;
  clientId?: string | null;
  dealId?: string | null;
  participants?: MeetingParticipant[];
  description?: string | null;
  sendInvites?: boolean;
  createdBy?: string | null;
  createdByName?: string | null;
}

const MEETINGS_CHANGED_EVENT = "taskcalendar:meetings-changed";

export const onMeetingsChanged = (cb: (orgId: string) => void) => {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ organizationId: string }>).detail;
    if (detail?.organizationId) cb(detail.organizationId);
  };
  window.addEventListener(MEETINGS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(MEETINGS_CHANGED_EVENT, handler);
};

const notifyMeetingsChanged = (organizationId: string) => {
  window.dispatchEvent(new CustomEvent(MEETINGS_CHANGED_EVENT, {
    detail: { organizationId },
  }));
};

const mapMeeting = (row: Record<string, unknown>): Meeting => ({
  meetingId: row.meeting_id as string,
  organizationId: row.organization_id as string,
  workspaceId: (row.workspace_id as string | null) ?? null,
  title: row.title as string,
  location: (row.location as string | null) ?? null,
  allDay: Boolean(row.all_day),
  startAt: new Date(row.start_at as string),
  endAt: new Date(row.end_at as string),
  hostUserId: (row.host_user_id as string | null) ?? null,
  hostName: (row.host_name as string | null) ?? null,
  relatedToType: (row.related_to_type as RelatedToType | null) ?? null,
  relatedToId: (row.related_to_id as string | null) ?? null,
  clientId: (row.client_id as string | null) ?? null,
  dealId: (row.deal_id as string | null) ?? null,
  participants: Array.isArray(row.participants) ? row.participants as MeetingParticipant[] : [],
  description: (row.description as string | null) ?? null,
  status: ((row.status as MeetingStatus) ?? "scheduled"),
  sendInvites: Boolean(row.send_invites),
  googleMeetLink: (row.google_meet_link as string | null) ?? null,
  googleEventId: (row.google_event_id as string | null) ?? null,
  createdAt: new Date(row.created_at as string),
  createdBy: (row.created_by as string | null) ?? null,
  createdByName: (row.created_by_name as string | null) ?? null,
  updatedAt: new Date(row.updated_at as string),
});

export const listMeetings = async (
  organizationId: string,
  opts: { workspaceId?: string | null } = {},
): Promise<Meeting[]> => {
  let q = supabase.from("meetings").select("*").eq("organization_id", organizationId);
  if (opts.workspaceId !== undefined) {
    if (opts.workspaceId === null) q = q.is("workspace_id", null);
    else q = q.eq("workspace_id", opts.workspaceId);
  }
  const { data, error } = await q.order("start_at", { ascending: false });
  if (error) {
    logger.error("listMeetings failed:", error);
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => mapMeeting(r as Record<string, unknown>));
};

export const createMeeting = async (input: CreateMeetingInput): Promise<Meeting> => {
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    workspace_id: input.workspaceId ?? null,
    title: input.title.trim(),
    location: input.location?.trim() || null,
    all_day: input.allDay ?? false,
    start_at: input.startAt.toISOString(),
    end_at: input.endAt.toISOString(),
    host_user_id: input.hostUserId ?? null,
    host_name: input.hostName ?? null,
    related_to_type: input.relatedToType ?? null,
    related_to_id: input.relatedToId ?? null,
    client_id: input.clientId ?? null,
    deal_id: input.dealId ?? null,
    participants: input.participants ?? [],
    description: input.description ?? null,
    send_invites: input.sendInvites ?? false,
    created_by: input.createdBy ?? null,
    created_by_name: input.createdByName ?? null,
  };
  const { data, error } = await supabase.from("meetings").insert(row).select("*").single();
  if (error) {
    logger.error("createMeeting failed:", error);
    throw new Error(error.message);
  }
  notifyMeetingsChanged(input.organizationId);
  return mapMeeting(data as Record<string, unknown>);
};

export const updateMeeting = async (
  meetingId: string,
  patch: Partial<CreateMeetingInput> & { status?: MeetingStatus },
): Promise<Meeting> => {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.location !== undefined) row.location = patch.location?.trim() || null;
  if (patch.allDay !== undefined) row.all_day = patch.allDay;
  if (patch.startAt) row.start_at = patch.startAt.toISOString();
  if (patch.endAt) row.end_at = patch.endAt.toISOString();
  if (patch.hostUserId !== undefined) row.host_user_id = patch.hostUserId;
  if (patch.hostName !== undefined) row.host_name = patch.hostName;
  if (patch.relatedToType !== undefined) row.related_to_type = patch.relatedToType;
  if (patch.relatedToId !== undefined) row.related_to_id = patch.relatedToId;
  if (patch.clientId !== undefined) row.client_id = patch.clientId;
  if (patch.dealId !== undefined) row.deal_id = patch.dealId;
  if (patch.participants !== undefined) row.participants = patch.participants;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.sendInvites !== undefined) row.send_invites = patch.sendInvites;

  const { data, error } = await supabase
    .from("meetings")
    .update(row)
    .eq("meeting_id", meetingId)
    .select("*")
    .single();
  if (error) {
    logger.error("updateMeeting failed:", error);
    throw new Error(error.message);
  }
  const mapped = mapMeeting(data as Record<string, unknown>);
  notifyMeetingsChanged(mapped.organizationId);
  return mapped;
};

export const deleteMeeting = async (meetingId: string, organizationId: string): Promise<void> => {
  const { error } = await supabase.from("meetings").delete().eq("meeting_id", meetingId);
  if (error) {
    logger.error("deleteMeeting failed:", error);
    throw new Error(error.message);
  }
  notifyMeetingsChanged(organizationId);
};
