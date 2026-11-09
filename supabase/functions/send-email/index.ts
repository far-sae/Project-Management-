// Supabase Edge Function: send TaskCalendar emails through Resend.
// Deploy: supabase functions deploy send-email
//
// Secrets:
//   RESEND_API_KEY   — required (re_… from resend.com → API Keys)
//   RESEND_FROM      — optional, default "TaskCalendar <noreply@taskcalendar.co.uk>"
//                      (the domain must be verified in Resend)
//   ALLOWED_ORIGINS  — already set; links in emails must point at one of these
//
// Replaces the old browser-side EmailJS calls: the Resend key must never ship
// to the browser. Signed-in users only, and only fixed templates
// (`invitation`, `notification`) — callers send data, never HTML — so this
// can't be used as an open mail relay.

import { json, preflight } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";
import {
  isAllowedLink,
  isValidEmail,
  renderInvitationEmail,
  renderNotificationEmail,
  type RenderedEmail,
} from "../_shared/emailTemplates.ts";

const DEFAULT_FROM = "TaskCalendar <noreply@taskcalendar.co.uk>";

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    await verifyUser(req);
  } catch (r) {
    return json({ error: "Unauthorized" }, r instanceof Response ? r.status : 401);
  }

  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!apiKey) {
    return json(
      { error: "Email is not set up: RESEND_API_KEY is missing on Supabase.", code: "MISSING_RESEND_KEY" },
      503,
    );
  }
  const from = (Deno.env.get("RESEND_FROM") ?? "").trim() || DEFAULT_FROM;
  const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://taskcalendar.co.uk")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const toEmail = str(body.toEmail, 254);
  if (!isValidEmail(toEmail)) {
    return json({ error: "Invalid recipient email address", code: "BAD_EMAIL" }, 400);
  }

  let email: RenderedEmail;
  if (body.kind === "invitation") {
    const inviteLink = str(body.inviteLink, 2000);
    if (!isAllowedLink(inviteLink, allowedOrigins)) {
      return json({ error: "Invite link must point to TaskCalendar", code: "BAD_LINK" }, 400);
    }
    email = renderInvitationEmail({
      toEmail,
      inviterName: str(body.inviterName, 200) || "A teammate",
      projectName: str(body.projectName, 200) || "TaskCalendar",
      inviteLink,
      role: str(body.role, 50) || "member",
    });
  } else if (body.kind === "notification") {
    const title = str(body.title, 200);
    const text = str(body.body, 5000);
    const actionUrl = str(body.actionUrl, 2000);
    if (!title) return json({ error: "Missing title", code: "BAD_INPUT" }, 400);
    if (actionUrl && !isAllowedLink(actionUrl, allowedOrigins)) {
      return json({ error: "Link must point to TaskCalendar", code: "BAD_LINK" }, 400);
    }
    email = renderNotificationEmail({ title, body: text, actionUrl: actionUrl || undefined });
  } else {
    return json({ error: "Unknown email kind", code: "BAD_INPUT" }, 400);
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [toEmail], subject: email.subject, html: email.html, text: email.text }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Resend messages are safe to show (e.g. "domain is not verified").
      const msg = typeof out?.message === "string" ? out.message : `Resend error ${res.status}`;
      console.error("send-email: Resend rejected", res.status, msg);
      return json({ error: msg, code: "RESEND_ERROR" }, 502);
    }
    return json({ ok: true, id: out?.id ?? null });
  } catch (err) {
    console.error("send-email: network error", err);
    return json({ error: "Could not reach the email service", code: "RESEND_ERROR" }, 502);
  }
});
