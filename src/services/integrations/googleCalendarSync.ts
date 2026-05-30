import { supabase } from '@/services/supabase/config';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}` };
}

export interface ExternalCalendarEvent {
  id: string;
  userId: string;
  googleEventId: string;
  summary: string;
  description: string | null;
  location: string | null;
  meetLink: string | null;
  htmlLink: string | null;
  status: string | null;
  startAt: Date | null;
  endAt: Date | null;
  startDate: string | null;
  endDate: string | null;
  organizerEmail: string | null;
  organizerName: string | null;
  attendees: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  isOrganizer: boolean;
}

const mapRow = (r: Record<string, unknown>): ExternalCalendarEvent => ({
  id: r.id as string,
  userId: r.user_id as string,
  googleEventId: r.google_event_id as string,
  summary: (r.summary as string) ?? '(no title)',
  description: (r.description as string) ?? null,
  location: (r.location as string) ?? null,
  meetLink: (r.meet_link as string) ?? null,
  htmlLink: (r.html_link as string) ?? null,
  status: (r.status as string) ?? null,
  startAt: r.start_at ? new Date(r.start_at as string) : null,
  endAt: r.end_at ? new Date(r.end_at as string) : null,
  startDate: (r.start_date as string) ?? null,
  endDate: (r.end_date as string) ?? null,
  organizerEmail: (r.organizer_email as string) ?? null,
  organizerName: (r.organizer_name as string) ?? null,
  attendees: Array.isArray(r.attendees)
    ? (r.attendees as Array<{ email?: string; displayName?: string; responseStatus?: string }>)
    : [],
  isOrganizer: Boolean(r.is_organizer),
});

/**
 * List cached external calendar events for the current user inside a date
 * window. RLS already constrains to the current user; the (start_at,
 * start_date) range filter keeps the response small.
 */
export const listExternalCalendarEvents = async (
  windowStart: Date,
  windowEnd: Date,
): Promise<ExternalCalendarEvent[]> => {
  const { data, error } = await supabase
    .from('external_calendar_events')
    .select('*')
    .or(
      `and(start_at.gte.${windowStart.toISOString()},start_at.lte.${windowEnd.toISOString()}),`
      + `and(start_date.gte.${windowStart.toISOString().slice(0, 10)},start_date.lte.${windowEnd.toISOString().slice(0, 10)})`,
    )
    .order('start_at', { ascending: true });
  if (error) {
    // Most common reason on a fresh project: migration 114 hasn't been
    // applied. Return empty silently — the Calendar UI shows a "Connect
    // Google" / "Sync now" CTA so the rep can act.
    return [];
  }
  return (data ?? []).map(mapRow);
};

/**
 * Kick the sync-google-calendar edge function. Returns the count of
 * events upserted on success; throws with a friendly message on
 * google_not_connected (412) so the UI can prompt the rep to connect.
 */
export const syncGoogleCalendar = async (
  organizationId: string,
  opts: { pastDays?: number; futureDays?: number; calendarId?: string } = {},
): Promise<{ inserted: number }> => {
  const res = await fetch(`${FUNCTIONS_URL}/sync-google-calendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      organizationId,
      pastDays: opts.pastDays,
      futureDays: opts.futureDays,
      calendarId: opts.calendarId,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
    if (res.status === 412) {
      throw new Error(
        'Google account not connected. Go to Settings → Integrations and click Connect on Google Meet.',
      );
    }
    throw new Error(body.message ?? body.error ?? `Sync failed: ${res.status}`);
  }
  return res.json();
};
