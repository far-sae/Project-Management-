// supabase/functions/notify-send-gmail/index.ts
//
// Server-side notification email sender. The frontend's
// sendNotificationEmail helper calls this first; only if it fails or
// the actor isn't Gmail-connected does the caller fall back to EmailJS.
//
// Why: the existing EmailJS path needs three VITE_* env vars baked into
// the browser bundle, which most deployments don't have. Routing
// through Supabase + the actor's connected Gmail integration means a
// rep who's already signed Gmail in for the agent / send-from-CRM
// workflow gets task notification emails for free, with no extra
// configuration.
//
// Auth: caller's user JWT. We only let an actor send "from" their own
// Gmail; cross-user impersonation is rejected.
//
// Deploy: npx supabase functions deploy notify-send-gmail
// Secret:  ANTHROPIC_API_KEY isn't needed here. Only INTEGRATION_TOKEN_KEY.

import { verifyUser } from "../_shared/auth.ts";
import { sendViaGmail } from "../_shared/gmailSend.ts";

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

interface NotifyRequest {
  toEmail: string;
  toName?: string;
  subject: string;
  /** Plain-text body, used both as the text/plain part and as fallback
   *  text wrapped into a minimal HTML template. */
  body: string;
  /** Optional pre-rendered HTML. When omitted we build a minimal
   *  responsive shell so reps don't get a raw plain-text email. */
  bodyHtml?: string;
  /** Optional URL the recipient should land on. Renders as a CTA in the
   *  HTML body when provided. */
  actionUrl?: string;
}

// Tiny inline HTML shell so notifications don't look like text/plain in
// modern mail clients. Inline styles only (Gmail strips <style>).
const buildHtml = (subject: string, body: string, actionUrl?: string) => {
  const safe = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");
  const cta = actionUrl
    ? `<p style="margin:24px 0 0">
         <a href="${actionUrl}"
            style="display:inline-block;padding:10px 16px;background:#f97316;color:#fff;
                   text-decoration:none;border-radius:6px;font-weight:600;">
           Open in TaskCalendar
         </a>
       </p>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
    <h2 style="margin:0 0 12px;font-size:18px;color:#111">${subject}</h2>
    <div style="font-size:14px;line-height:1.5;color:#374151">${safe}</div>
    ${cta}
    <p style="margin:24px 0 0;font-size:11px;color:#9ca3af">
      You're getting this because you turned on email notifications in TaskCalendar.
    </p>
  </div>
</body></html>`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let auth;
  try { auth = await verifyUser(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({})) as NotifyRequest;
  const toEmail = (body.toEmail ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const bodyText = (body.body ?? "").trim();

  if (!toEmail || !toEmail.includes("@")) {
    return json({ error: "toEmail required" }, 400);
  }
  if (!subject || !bodyText) {
    return json({ error: "subject + body required" }, 400);
  }

  const admin = auth.supabase;
  const userId = auth.userId;

  try {
    const result = await sendViaGmail(admin, {
      userId,
      to: toEmail,
      toName: body.toName,
      subject,
      bodyText,
      bodyHtml: body.bodyHtml ?? buildHtml(subject, bodyText, body.actionUrl),
    });
    return json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "send_failed";
    // 412 mirrors the other Google-aware functions: caller can fall back
    // to EmailJS (or just an in-app bell) when the rep hasn't connected.
    const code = /not connected|no.*integration|metadata.email/i.test(message)
      ? 412 : 502;
    return json({ error: "gmail_send_failed", message }, code);
  }
});
