// supabase/functions/cancel-meet/index.ts
//
// Cancel + remove a Google Meet that was previously attached via
// task-create-meet / crm-create-meet. Supports all four entity types
// the create functions write to:
//   - tasks          → project tasks (migration 057 columns)
//   - client_notes   → CRM meeting notes
//   - client_tasks   → CRM follow-up tasks
//   - deals          → standing meet on the deal
//
// What it does:
//   1. Verify the caller's JWT and that they're in the entity's org.
//   2. Read google_event_id from the row.
//   3. DELETE the Calendar event via Google API (which also tears
//      down the Meet room). Tolerates 404/410 — the event may already
//      be gone, in which case we still clear the row so the UI
//      doesn't keep showing a dead link.
//   4. Null out google_meet_link + google_event_id on the row.
//
// Returns 200 { ok: true, cleared: boolean } on success.
//
// Deploy: npx supabase functions deploy cancel-meet

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

type EntityType = "tasks" | "client_notes" | "client_tasks" | "deals";

const ENTITY_CONFIG: Record<EntityType, { table: EntityType; pk: string }> = {
  tasks:        { table: "tasks",        pk: "task_id" },
  client_notes: { table: "client_notes", pk: "note_id" },
  client_tasks: { table: "client_tasks", pk: "task_id" },
  deals:        { table: "deals",        pk: "deal_id" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let auth;
  try { auth = await verifyUser(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({})) as {
    entityType?: string;
    entityId?: string;
  };

  const entityType = body.entityType as EntityType | undefined;
  if (!entityType || !(entityType in ENTITY_CONFIG)) {
    return json({ error: "entityType must be one of: tasks, client_notes, client_tasks, deals" }, 400);
  }
  const cfg = ENTITY_CONFIG[entityType];
  const entityId = (body.entityId ?? "").trim();
  if (!entityId) return json({ error: "entityId required" }, 400);

  const admin = auth.supabase;
  const userId = auth.userId;

  // 1. Load entity (pk + org + the two meet columns). google_event_id
  //    is only on tables that received migration 057 / 113 — on a
  //    partially-migrated DB the SELECT 42703s and the whole cancel
  //    bails. Fall back to selecting only the always-present columns;
  //    in that case we can still null google_meet_link (which the row
  //    must have, since the user clicked Cancel on a visible link),
  //    we just can't call the Calendar API to delete the event.
  let row: Record<string, unknown> | null = null;
  let eventIdAvailable = true;
  {
    const { data, error } = await admin
      .from(cfg.table)
      .select(`${cfg.pk}, organization_id, google_meet_link, google_event_id`)
      .eq(cfg.pk, entityId)
      .maybeSingle();
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      const msg = (error as { message?: string }).message ?? "";
      if (code === "42703" || /does not exist/i.test(msg)) {
        eventIdAvailable = false;
        const fallback = await admin
          .from(cfg.table)
          .select(`${cfg.pk}, organization_id, google_meet_link`)
          .eq(cfg.pk, entityId)
          .maybeSingle();
        if (fallback.error) return json({ error: fallback.error.message }, 500);
        row = fallback.data as Record<string, unknown> | null;
      } else {
        return json({ error: msg || "row_lookup_failed" }, 500);
      }
    } else {
      row = data as Record<string, unknown> | null;
    }
  }
  if (!row) return json({ error: `${entityType}_not_found` }, 404);

  // 2. Org membership check — same pattern as crm-create-meet.
  const orgId = row.organization_id as string;
  const meetLink = row.google_meet_link as string | null;
  const eventId = eventIdAvailable ? (row.google_event_id as string | null) : null;

  const { data: isMember, error: memErr } = await admin.rpc("is_org_member_for", {
    p_user_id: userId, p_org_id: orgId,
  });
  if (memErr || isMember !== true) return json({ error: "forbidden" }, 403);

  // 3. Nothing attached → still success (idempotent — the user clicked
  //    Cancel on a row whose link was already cleared). Avoids confusing
  //    "nothing to cancel" errors when two tabs race.
  if (!meetLink && !eventId) {
    return json({ ok: true, cleared: false, note: "no_meet_attached" });
  }

  // 4. Delete the Calendar event (best-effort). If the user has no
  //    Google tokens we still null the columns — the link is dead to
  //    them regardless, and forcing a reconnect just to clear a stale
  //    link helps nobody.
  let calendarDeleted: boolean | "skipped" = "skipped";
  let calendarDetail: string | undefined;

  if (eventId) {
    try {
      const { accessToken } = await getProviderTokens(admin, userId, "google");
      const encoded = encodeURIComponent(eventId);
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encoded}`,
        { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
      );
      // 204 = deleted, 404/410 = already gone (treat as success).
      if (res.status === 204 || res.status === 404 || res.status === 410) {
        calendarDeleted = true;
      } else {
        const text = await res.text().catch(() => "");
        calendarDeleted = false;
        calendarDetail = `calendar_api ${res.status}: ${text.slice(0, 200)}`;
      }
    } catch (err) {
      // No google tokens (or token refresh failure). We still clear
      // the columns — see the comment above.
      calendarDeleted = "skipped";
      calendarDetail = (err as Error).message;
    }
  } else if (!eventIdAvailable) {
    calendarDetail = "google_event_id column not on this table — apply migration 057 (tasks) or 113 (CRM) to enable Calendar-side cancel";
  }

  // 5. Null the row columns. This is the load-bearing bit — even if the
  //    Calendar delete failed, clearing the link makes the UI consistent.
  //    Only include google_event_id in the UPDATE if the column exists,
  //    otherwise PostgREST 42703s on the unknown column.
  const updatePayload: Record<string, unknown> = {
    google_meet_link: null,
    updated_at: new Date().toISOString(),
  };
  if (eventIdAvailable) updatePayload.google_event_id = null;

  const { error: updateErr } = await admin
    .from(cfg.table)
    .update(updatePayload)
    .eq(cfg.pk, entityId);

  if (updateErr) return json({ error: updateErr.message }, 500);

  return json({
    ok: true,
    cleared: true,
    calendarDeleted,
    ...(calendarDetail ? { calendarDetail } : {}),
  });
});
