// supabase/functions/task-create-meet/index.ts
// Authenticated POST { taskId } → creates a Google Calendar event with a Meet
// link for that task and stores the link on the tasks row.
//
// Used by the task-create modal when the "Add Google Meet" checkbox is ticked.
// Mirrors the Calendar API call in crm-run-automations/actions/createGoogleMeet.ts
// but runs interactively under the user's JWT instead of from the automation
// worker.
//
// Deploy: npx supabase functions deploy task-create-meet

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let auth;
  try { auth = await verifyUser(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({})) as {
    taskId?: string;
    durationMinutes?: number;
    /** Optional explicit meeting start time (ISO 8601). If provided, this
     *  overrides the task's saved due_date and the new value is persisted
     *  back to the row so the UI shows the meeting time consistently. */
    startTime?: string;
  };
  const taskId = (body.taskId ?? "").trim();
  if (!taskId) return json({ error: "taskId required" }, 400);

  const admin = auth.supabase; // already service-role per _shared/auth.ts
  const userId = auth.userId;

  // 1. Load task. Verify it exists and belongs to an org the user is in.
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select("task_id, title, description, due_date, organization_id, google_meet_link")
    .eq("task_id", taskId)
    .maybeSingle();
  if (taskErr) return json({ error: taskErr.message }, 500);
  if (!task) return json({ error: "task_not_found" }, 404);

  const { data: isMember, error: memErr } = await admin.rpc("is_org_member_for", {
    p_user_id: userId, p_org_id: task.organization_id,
  });
  if (memErr || isMember !== true) return json({ error: "forbidden" }, 403);

  // 2. Sanity-check the task is Meet-able.
  if (task.google_meet_link) {
    return json({ meetLink: task.google_meet_link, note: "already_has_link" });
  }
  // The caller may pass an explicit startTime (e.g. "tomorrow 3pm") which we
  // prefer over the row's due_date. This lets the user pick a meeting time
  // in the modal and not depend on autosave landing first.
  const explicitStartIso = (body.startTime ?? "").trim();
  const startSource = explicitStartIso || task.due_date;
  if (!startSource) {
    return json({ error: "task_needs_due_date" }, 400);
  }
  const startDate = new Date(startSource);
  if (Number.isNaN(startDate.getTime())) {
    return json({ error: "invalid_start_time" }, 400);
  }

  // 3. Get the user's Google tokens. They must have connected Google in Settings.
  let accessToken: string;
  try {
    ({ accessToken } = await getProviderTokens(admin, userId, "google"));
  } catch (err) {
    return json({
      error: "google_not_connected",
      message: (err as Error).message,
    }, 412);
  }

  // 4. Create the Calendar event with a Meet link.
  const start = startDate;
  const end = new Date(start.getTime() + (body.durationMinutes ?? 30) * 60_000);
  const requestId = `task-${taskId}-${Date.now()}`;

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: task.title ?? "Task meeting",
        description: task.description ?? "",
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

  // 5. Persist on the task row. If the caller supplied an explicit start
  //    time, also update due_date so the UI is consistent with the Calendar
  //    event we just created.
  const updatePayload: Record<string, unknown> = {
    google_meet_link: event.hangoutLink,
    google_event_id: event.id ?? null,
    updated_at: new Date().toISOString(),
  };
  if (explicitStartIso) {
    updatePayload.due_date = start.toISOString();
  }
  const { error: updateErr } = await admin
    .from("tasks")
    .update(updatePayload)
    .eq("task_id", taskId);

  if (updateErr) {
    return json({ error: updateErr.message }, 500);
  }

  return json({
    meetLink: event.hangoutLink,
    eventId: event.id,
  });
});
