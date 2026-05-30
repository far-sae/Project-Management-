// supabase/functions/crm-create-meet/index.ts
//
// Entity-typed Meet creator for the CRM side. Mirrors the project-task
// version (task-create-meet) but works against three CRM tables:
//   - client_notes(meeting)  → meeting logged on a deal / account
//   - client_tasks           → CRM follow-up task with a meet attached
//   - deals                  → standing meet link on the deal record
//
// Same Calendar API call (conferenceSolutionKey = hangoutsMeet), same
// auth model (user JWT + org membership check), same persistence shape
// (google_meet_link / google_event_id columns added in migration 113).
//
// Deploy: npx supabase functions deploy crm-create-meet

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
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

type EntityType = "client_notes" | "client_tasks" | "deals";

const ENTITY_CONFIG: Record<EntityType, {
  table: EntityType;
  pk: string;
  /** Column we read to derive the meeting time when caller didn't pass
   *  an explicit startTime. */
  timeCol: string;
  /** Column we read for a default Calendar summary. */
  titleCol: string;
}> = {
  client_notes:  { table: "client_notes",  pk: "note_id", timeCol: "occurred_at", titleCol: "subject" },
  client_tasks:  { table: "client_tasks",  pk: "task_id", timeCol: "due_at",      titleCol: "title" },
  deals:         { table: "deals",         pk: "deal_id", timeCol: "expected_close_date", titleCol: "title" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let auth;
  try { auth = await verifyUser(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({})) as {
    entityType?: string;
    entityId?: string;
    durationMinutes?: number;
    startTime?: string;
    summary?: string;
    description?: string;
  };

  const entityType = body.entityType as EntityType | undefined;
  if (!entityType || !(entityType in ENTITY_CONFIG)) {
    return json({ error: "entityType must be one of: client_notes, client_tasks, deals" }, 400);
  }
  const cfg = ENTITY_CONFIG[entityType];
  const entityId = (body.entityId ?? "").trim();
  if (!entityId) return json({ error: "entityId required" }, 400);

  const admin = auth.supabase;
  const userId = auth.userId;

  // 1. Load entity + verify org membership.
  const { data: row, error: rowErr } = await admin
    .from(cfg.table)
    .select(`${cfg.pk}, ${cfg.titleCol}, ${cfg.timeCol}, organization_id, google_meet_link`)
    .eq(cfg.pk, entityId)
    .maybeSingle();
  if (rowErr) return json({ error: rowErr.message }, 500);
  if (!row) return json({ error: `${entityType} not found` }, 404);

  const { data: isMember, error: memErr } = await admin.rpc("is_org_member_for", {
    p_user_id: userId, p_org_id: row.organization_id,
  });
  if (memErr || isMember !== true) return json({ error: "forbidden" }, 403);

  // Already has a link? Return it without burning a Calendar event.
  if (row.google_meet_link) {
    return json({ meetLink: row.google_meet_link, note: "already_has_link" });
  }

  // 2. Resolve start time. Caller can override; otherwise derive from the
  //    entity's natural time column. For deals (expected_close_date is a
  //    date with no time), default to 09:00 local on that day.
  const explicit = (body.startTime ?? "").trim();
  const baseRaw = (row as Record<string, unknown>)[cfg.timeCol];
  const startSource = explicit || (baseRaw as string | null);
  if (!startSource) {
    return json({ error: `${entityType}_needs_due_date` }, 400);
  }
  const startDate = new Date(startSource);
  if (Number.isNaN(startDate.getTime())) {
    return json({ error: "invalid_start_time" }, 400);
  }
  if (!explicit && entityType === "deals") {
    // expected_close_date is just YYYY-MM-DD — bump to 9am local.
    startDate.setHours(9, 0, 0, 0);
  }

  // 3. Google tokens.
  let accessToken: string;
  try {
    ({ accessToken } = await getProviderTokens(admin, userId, "google"));
  } catch (err) {
    return json({
      error: "google_not_connected",
      message: (err as Error).message,
    }, 412);
  }

  // 4. Create the Calendar event with Meet conference.
  const start = startDate;
  const end = new Date(start.getTime() + (body.durationMinutes ?? 30) * 60_000);
  const requestId = `crm-${entityType}-${entityId}-${Date.now()}`;
  const summary = body.summary?.trim()
    || (row as Record<string, unknown>)[cfg.titleCol] as string
    || `${entityType} meeting`;

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary,
        description: body.description ?? "",
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json({
      error: "calendar_api_failed",
      status: res.status,
      detail: text.slice(0, 300),
    }, 502);
  }

  const event = await res.json() as { id?: string; hangoutLink?: string };
  if (!event.hangoutLink) {
    return json({ error: "no_meet_link_returned" }, 502);
  }

  // 5. Persist on the entity row.
  const updatePayload: Record<string, unknown> = {
    google_meet_link: event.hangoutLink,
    google_event_id: event.id ?? null,
    updated_at: new Date().toISOString(),
  };
  // For client_notes + client_tasks the explicit start should also stamp
  // the time column so the UI reflects the meeting time.
  if (explicit && entityType !== "deals") {
    updatePayload[cfg.timeCol] = start.toISOString();
  }
  const { error: updateErr } = await admin
    .from(cfg.table)
    .update(updatePayload)
    .eq(cfg.pk, entityId);

  if (updateErr) return json({ error: updateErr.message }, 500);

  return json({
    meetLink: event.hangoutLink,
    eventId: event.id,
    start: start.toISOString(),
    end: end.toISOString(),
  });
});
