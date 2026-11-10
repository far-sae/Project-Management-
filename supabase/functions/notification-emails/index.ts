// notification-emails — sends queued task notification emails.
//
// Called every minute by pg_cron (migration 174) while
// notification_email_outbox has work. It takes no input and only drains the
// queue, so it is deployed with verify_jwt = false: an extra call just sends
// already-queued emails a little sooner.
//
// Secrets: RESEND_API_KEY (required), RESEND_FROM (optional),
//          APP_URL (optional, default https://taskcalendar.co.uk).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { isValidEmail } from "../_shared/emailTemplates.ts";
import {
  type ClaimedNotificationEmail,
  renderTaskNotificationEmail,
  shouldEmailNotification,
} from "../_shared/taskNotificationEmail.ts";

const BATCH = 40;
// Resend's default limit is 2 requests/second.
const GAP_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  const from = (Deno.env.get("RESEND_FROM") ?? "").trim() || "TaskCalendar <noreply@taskcalendar.co.uk>";
  const appUrl = (Deno.env.get("APP_URL") ?? "").trim() || "https://taskcalendar.co.uk";
  if (!supabaseUrl || !serviceKey || !apiKey) {
    return json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const finish = (id: string, status: "sent" | "skipped" | "failed", error?: string) =>
    admin.rpc("finish_notification_email", {
      p_notification_id: id,
      p_status: status,
      p_error: error ?? null,
    });

  const { data, error } = await admin.rpc("claim_notification_emails", { p_limit: BATCH });
  if (error) {
    console.error("notification-emails: claim failed", error);
    return json({ error: error.message }, 500);
  }
  const rows = (data ?? []) as ClaimedNotificationEmail[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const to = (row.recipient_email ?? "").trim();
    if (!shouldEmailNotification(row.type, row.prefs) || !isValidEmail(to)) {
      await finish(row.notification_id, "skipped");
      skipped++;
      continue;
    }
    const email = renderTaskNotificationEmail(row, appUrl);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject: email.subject, html: email.html, text: email.text }),
      });
      if (res.ok) {
        await finish(row.notification_id, "sent");
        sent++;
      } else {
        const out = await res.json().catch(() => ({}));
        const msg = typeof out?.message === "string" ? out.message : `Resend error ${res.status}`;
        console.error("notification-emails: Resend rejected", res.status, msg);
        await finish(row.notification_id, "failed", msg);
        failed++;
      }
    } catch (err) {
      await finish(row.notification_id, "failed", err instanceof Error ? err.message : String(err));
      failed++;
    }
    await sleep(GAP_MS);
  }

  return json({ claimed: rows.length, sent, skipped, failed });
});
