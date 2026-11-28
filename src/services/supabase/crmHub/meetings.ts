// Video meetings with a lead or a client (crm_meetings, migration 221).
//
// Planning one takes three steps, each with its own owner:
//   1. the call server makes a room for it and signs the guest's link
//      (createMeetingInvite in services/livekit/guestApi);
//   2. the meeting is written down here, so the people of the workspace find
//      it on the lead and the host can join the same room;
//   3. the app's server emails the link to the lead (emailMeetingInvite).
import { supabase } from '@/services/supabase/config';
import { automationClient } from '@/services/automation/client';

export interface CrmMeeting {
  id: string;
  organizationId: string;
  workspaceId: string;
  contactId: string | null;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  /** The call room the host joins. */
  roomName: string;
  /** The link the guest opens. */
  joinUrl: string;
  notes: string | null;
  invitedEmail: string | null;
  invitedAt: Date | null;
  cancelledAt: Date | null;
}

type Row = {
  id: string; organization_id: string; workspace_id: string; contact_id: string | null; title: string; starts_at: string;
  duration_minutes: number; room_name: string; join_url: string; notes: string | null; invited_email: string | null;
  invited_at: string | null; cancelled_at: string | null;
};

const map = (row: Row): CrmMeeting => ({
  id: row.id, organizationId: row.organization_id, workspaceId: row.workspace_id, contactId: row.contact_id, title: row.title,
  startsAt: new Date(row.starts_at), durationMinutes: Number(row.duration_minutes) || 30, roomName: row.room_name, joinUrl: row.join_url,
  notes: row.notes, invitedEmail: row.invited_email, invitedAt: row.invited_at ? new Date(row.invited_at) : null,
  cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
});

/** The table is not in the database yet: the SQL has not been run. */
const notSetUp = (error: { code?: string; message?: string }): boolean =>
  error.code === '42P01' || error.code === 'PGRST205' || /schema cache|does not exist/i.test(error.message ?? '');

export const MEETINGS_NOT_SET_UP_MESSAGE = 'This needs a newer database. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.';

/**
 * The meetings planned with one lead, the soonest first. `ready` is false
 * when the table is not there yet: the page then says meetings are not
 * switched on, and offers nothing that would fail.
 */
export async function listLeadMeetings(workspaceId: string, contactId: string): Promise<{ meetings: CrmMeeting[]; ready: boolean }> {
  const { data, error } = await supabase.from('crm_meetings').select('*')
    .eq('workspace_id', workspaceId).eq('contact_id', contactId).is('cancelled_at', null).order('starts_at', { ascending: true });
  if (error) {
    if (notSetUp(error)) return { meetings: [], ready: false };
    throw error;
  }
  return { meetings: ((data ?? []) as Row[]).map(map), ready: true };
}

export interface NewMeeting {
  organizationId: string;
  workspaceId: string;
  contactId: string;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  roomName: string;
  joinUrl: string;
  notes?: string | null;
}

export async function createMeeting(input: NewMeeting): Promise<CrmMeeting> {
  const { data, error } = await supabase.from('crm_meetings').insert({
    organization_id: input.organizationId, workspace_id: input.workspaceId, contact_id: input.contactId, title: input.title,
    starts_at: input.startsAt.toISOString(), duration_minutes: input.durationMinutes, room_name: input.roomName, join_url: input.joinUrl,
    notes: input.notes ?? null,
  }).select('*').single();
  if (error) {
    if (notSetUp(error)) throw new Error(MEETINGS_NOT_SET_UP_MESSAGE);
    throw error;
  }
  return map(data as Row);
}

/** Takes a meeting off the list. Its link stops being offered; the row is kept. */
export async function cancelMeeting(id: string): Promise<void> {
  const { error } = await supabase.from('crm_meetings').update({ cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/**
 * Emails the link to the lead. The server reads the meeting and the lead's
 * address itself; only the organiser's time zone and a short note go along.
 */
export async function emailMeetingInvite(workspaceId: string, meetingId: string, input: { timeZone: string; message?: string }): Promise<{ sentTo: string }> {
  return automationClient(workspaceId).call<{ sentTo: string }>(`meetings/${encodeURIComponent(meetingId)}/invite`, {
    timeZone: input.timeZone, message: input.message ?? '',
  });
}
