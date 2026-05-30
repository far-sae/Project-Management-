// src/services/integrations/googleMeet.ts
import { supabase } from '@/services/supabase/config';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}` };
}

/** True if the current user has an active Google integration (Calendar / Meet scope). */
export async function isGoogleConnected(): Promise<boolean> {
  const { data } = await supabase
    .from('integrations')
    .select('id, status')
    .eq('provider', 'google')
    .maybeSingle();
  return Boolean(data && data.status === 'active');
}

export interface CreateMeetResult {
  meetLink: string;
  eventId?: string;
  note?: string;
}

/**
 * Asks the task-create-meet edge function to create a Calendar event with a
 * Meet link for an existing task. Returns the meet link. The task row is
 * updated server-side; the caller should refetch the task to pick up the new
 * google_meet_link column.
 */
export interface CreateMeetOptions {
  durationMinutes?: number;
  /** Explicit meeting start time (overrides the task's saved due_date and
   *  is persisted back to the task). Useful for picking "tomorrow 3pm"
   *  without waiting for autosave to land first. */
  startTime?: Date;
}

export async function createMeetForTask(
  taskId: string,
  opts: CreateMeetOptions = {},
): Promise<CreateMeetResult> {
  const res = await fetch(`${FUNCTIONS_URL}/task-create-meet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      taskId,
      durationMinutes: opts.durationMinutes,
      startTime: opts.startTime?.toISOString(),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.message ?? body.error ?? `Meet creation failed: ${res.status}`);
  }
  return res.json();
}

export type CrmMeetEntity = 'client_notes' | 'client_tasks' | 'deals';

export interface CreateCrmMeetOptions extends CreateMeetOptions {
  /** Calendar event summary override. Defaults to the entity's title /
   *  subject column. */
  summary?: string;
  description?: string;
}

/**
 * Attach a Meet link to a CRM entity (meeting note, follow-up task, or
 * deal). Backed by the crm-create-meet edge function (migration 113 +
 * `supabase functions deploy crm-create-meet`). Same auth + Google
 * OAuth requirements as createMeetForTask — surfaces 412
 * "google_not_connected" so the UI can prompt the rep to connect.
 */
export async function createMeetForCrm(
  entityType: CrmMeetEntity,
  entityId: string,
  opts: CreateCrmMeetOptions = {},
): Promise<CreateMeetResult> {
  const res = await fetch(`${FUNCTIONS_URL}/crm-create-meet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      entityType,
      entityId,
      durationMinutes: opts.durationMinutes,
      startTime: opts.startTime?.toISOString(),
      summary: opts.summary,
      description: opts.description,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string; status?: number };
    // Surface the most common error (412 google_not_connected) with a
    // useful message so the UI can prompt the rep to connect.
    if (res.status === 412) {
      throw new Error('Google account not connected. Go to Settings → Integrations and click Connect on Google Meet.');
    }
    throw new Error(body.message ?? body.error ?? `Meet creation failed: ${res.status}`);
  }
  return res.json();
}
