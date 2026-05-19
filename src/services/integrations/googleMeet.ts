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
export async function createMeetForTask(
  taskId: string,
  durationMinutes?: number,
): Promise<CreateMeetResult> {
  const res = await fetch(`${FUNCTIONS_URL}/task-create-meet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ taskId, durationMinutes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.message ?? body.error ?? `Meet creation failed: ${res.status}`);
  }
  return res.json();
}
