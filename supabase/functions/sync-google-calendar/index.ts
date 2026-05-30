// supabase/functions/sync-google-calendar/index.ts
//
// Pulls the caller's Google Calendar events for a configurable window
// (default ±30 days around today) and upserts them into
// public.external_calendar_events. The in-app Calendar reads from that
// table so every Gmail-delivered invite + every meeting on the rep's
// Google Calendar shows up alongside their TaskCalendar tasks.
//
// Why polling not push: Google's calendar push notifications require a
// public HTTPS webhook + watch-channel renewal; not worth the setup
// for a first cut. The Calendar page fires this function on mount and
// has a manual Sync button; we can layer cron on top later if needed.
//
// Auth: caller's JWT. We refuse if they aren't signed in OR haven't
// connected their Google integration. Pulls events from their primary
// calendar via Calendar API v3, with showDeleted+singleEvents so
// recurring expansions land as individual rows.
//
// Deploy: npx supabase functions deploy sync-google-calendar

import { verifyUser } from "../_shared/auth.ts";
import { getProviderTokens } from "../_shared/tokens.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

interface SyncRequest {
  organizationId?: string;
  /** Days into the past to fetch (default 30). */
  pastDays?: number;
  /** Days into the future to fetch (default 60). */
  futureDays?: number;
  /** Specific calendar id; defaults to "primary". */
  calendarId?: string;
}

interface GcalEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let auth;
  try { auth = await verifyUser(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({})) as SyncRequest;
  const orgId = (body.organizationId ?? "").trim();
  if (!orgId) return json({ error: "organizationId required" }, 400);

  const admin = auth.supabase;
  const userId = auth.userId;
  const pastDays   = Math.max(0, Math.min(365, body.pastDays   ?? 30));
  const futureDays = Math.max(0, Math.min(365, body.futureDays ?? 60));
  const calendarId = (body.calendarId ?? "primary").trim() || "primary";

  // 1) Pull the rep's Google access token (decrypts the stored OAuth row).
  let accessToken: string;
  try {
    ({ accessToken } = await getProviderTokens(admin, userId, "google"));
  } catch (err) {
    return json({
      error: "google_not_connected",
      message: (err as Error).message,
    }, 412);
  }

  // 2) Build the time window.
  const now = Date.now();
  const timeMin = new Date(now - pastDays   * 86_400_000).toISOString();
  const timeMax = new Date(now + futureDays * 86_400_000).toISOString();

  // 3) Fetch with pagination. Google caps at 2500 per page; defaults are
  // far below that for a ±90 day window, so a single page is usually
  // enough — handle nextPageToken anyway.
  const collected: GcalEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 6; page++) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showDeleted", "false");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json({
        error: "calendar_api_failed",
        status: res.status,
        detail: text.slice(0, 300),
      }, 502);
    }
    const body = await res.json() as { items?: GcalEvent[]; nextPageToken?: string };
    for (const e of body.items ?? []) collected.push(e);
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  // 4) Upsert each into external_calendar_events. Skip events without
  // an id (extremely rare; Calendar always emits one) and cancelled
  // ones that were already cleared from the cache.
  const rows = collected
    .filter((e) => e.id && (e.status ?? "confirmed") !== "cancelled")
    .map((e) => {
      const meetLink = e.hangoutLink
        ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri
        ?? null;
      const startAt = e.start?.dateTime ?? null;
      const endAt   = e.end?.dateTime   ?? null;
      const startDate = e.start?.date ?? null;
      const endDate   = e.end?.date   ?? null;
      return {
        user_id: userId,
        organization_id: orgId,
        provider: "google",
        google_event_id: e.id!,
        calendar_id: calendarId,
        summary: (e.summary ?? "(no title)").slice(0, 500),
        description: e.description ?? null,
        location: e.location ?? null,
        meet_link: meetLink,
        html_link: e.htmlLink ?? null,
        status: e.status ?? "confirmed",
        start_at: startAt,
        end_at: endAt,
        start_date: startDate,
        end_date: endDate,
        organizer_email: e.organizer?.email ?? null,
        organizer_name: e.organizer?.displayName ?? null,
        attendees: e.attendees ?? [],
        is_organizer: Boolean(e.organizer?.self),
        raw: e,
        last_synced_at: new Date().toISOString(),
      };
    });

  // Drop rows that fall outside the requested window for this user so a
  // re-sync after the rep deleted an event removes it locally too.
  // Cheap: we delete and reinsert; for thousands of rows this would
  // need to be incremental, but per-user calendars are small.
  const { error: delErr } = await admin
    .from("external_calendar_events")
    .delete()
    .eq("user_id", userId)
    .gte("last_synced_at", new Date(now - 366 * 86_400_000).toISOString());
  if (delErr) return json({ error: delErr.message }, 500);

  let inserted = 0;
  if (rows.length > 0) {
    const { error: insErr, count } = await admin
      .from("external_calendar_events")
      .insert(rows, { count: "exact" });
    if (insErr) return json({ error: insErr.message }, 500);
    inserted = count ?? rows.length;
  }

  return json({
    ok: true,
    inserted,
    windowDays: { past: pastDays, future: futureDays },
    calendarId,
  });
});
