// supabase/functions/ai-agent-approve/index.ts
// User-facing endpoint to act on a pending agent_suggestion:
//   - "send"   → call sendViaGmail with the (optionally edited) draft
//   - "reject" → store reasons + tag
//   - "snooze" → set snooze_until = now + N days
//
// Auth: JWT verified against the caller's org membership;
// viewers are rejected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaGmail } from "../_shared/gmailSend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INBOUND_DOMAIN = Deno.env.get("SEQUENCE_INBOUND_DOMAIN") ?? "inbound.taskcalendar.co.uk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

interface ApproveRequest {
  suggestion_id: string;
  action: "send" | "reject" | "snooze";
  draft_override?: {
    subject?: string;
    body_text?: string;
    body_html?: string;
  };
  snooze_days?: number;
  reject_reasons?: string[];
  reject_note?: string;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  // Verify the JWT belongs to a real user (no service-role guards needed —
  // Supabase already rejects bad JWTs before we run, but double-check).
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userInfo, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userInfo.user) return json({ error: "unauthorized" }, 401);
  const userId = userInfo.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: ApproveRequest;
  try {
    body = await req.json() as ApproveRequest;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.suggestion_id || !body.action) {
    return json({ error: "missing_fields" }, 400);
  }

  const { data: sug, error: sugErr } = await admin
    .from("agent_suggestions")
    .select("*")
    .eq("id", body.suggestion_id)
    .maybeSingle();
  if (sugErr) return json({ error: "lookup_failed", message: sugErr.message }, 500);
  if (!sug) return json({ error: "not_found" }, 404);

  // Caller must be a non-viewer member of the suggestion's org. Membership is
  // stored as jsonb on organizations.members ({userId, role}[]), with the
  // owner_id column as an additional implicit "owner" membership.
  const { data: org } = await admin
    .from("organizations")
    .select("owner_id, members")
    .eq("organization_id", sug.organization_id)
    .maybeSingle();
  if (!org) return json({ error: "forbidden" }, 403);

  let role: string | null = null;
  if (org.owner_id === userId) {
    role = "owner";
  } else {
    const members = (org.members ?? []) as Array<{ userId?: string; role?: string }>;
    const me = members.find((m) => m?.userId === userId);
    role = me?.role ?? null;
  }
  if (!role || role === "viewer") return json({ error: "forbidden" }, 403);

  if (body.action === "snooze") {
    const days = Math.max(1, Math.min(30, Number(body.snooze_days ?? 1)));
    const until = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    const { error } = await admin.from("agent_suggestions").update({
      status: "snoozed",
      snooze_until: until,
      decided_by: userId,
      decided_at: new Date().toISOString(),
    }).eq("id", sug.id);
    if (error) return json({ error: "update_failed", message: error.message }, 500);
    return json({ ok: true, status: "snoozed", snooze_until: until });
  }

  if (body.action === "reject") {
    const { error } = await admin.from("agent_suggestions").update({
      status: "rejected",
      rejected_reasons: body.reject_reasons ?? null,
      rejected_note: body.reject_note ?? null,
      decided_by: userId,
      decided_at: new Date().toISOString(),
    }).eq("id", sug.id);
    if (error) return json({ error: "update_failed", message: error.message }, 500);
    return json({ ok: true, status: "rejected" });
  }

  // action === "send"
  const baseDraft = (sug.draft ?? {}) as Record<string, string>;
  const draft = {
    subject: body.draft_override?.subject ?? baseDraft.subject ?? "",
    body_text: body.draft_override?.body_text ?? baseDraft.body_text ?? "",
    body_html: body.draft_override?.body_html ?? baseDraft.body_html ?? "",
  };
  if (!draft.subject || !draft.body_html) {
    return json({ error: "draft_incomplete" }, 400);
  }

  // Resolve recipient: prefer the suggestion's client.email; if absent
  // (re-engagement with deal but no linked client.email), give up.
  let recipient: string | null = null;
  if (sug.client_id) {
    const { data: c } = await admin.from("clients")
      .select("email").eq("client_id", sug.client_id).maybeSingle();
    recipient = (c?.email as string) ?? null;
  }
  if (!recipient && sug.deal_id) {
    const { data: d } = await admin.from("deals")
      .select("client_id").eq("deal_id", sug.deal_id).maybeSingle();
    if (d?.client_id) {
      const { data: c } = await admin.from("clients")
        .select("email").eq("client_id", d.client_id).maybeSingle();
      recipient = (c?.email as string) ?? null;
    }
  }
  if (!recipient) return json({ error: "no_recipient" }, 400);

  let messageId: string | null = null;
  try {
    const r = await sendViaGmail({
      admin,
      senderUserId: userId,
      to: recipient,
      subject: draft.subject,
      bodyText: draft.body_text || undefined,
      bodyHtml: draft.body_html,
      replyToToken: sug.id as string,
      inboundDomain: INBOUND_DOMAIN,
    });
    messageId = r.messageId;
  } catch (e) {
    return json({ error: "send_failed", message: (e as Error).message }, 502);
  }

  await admin.from("agent_suggestions").update({
    status: "sent",
    draft,
    sent_message_id: messageId,
    decided_by: userId,
    decided_at: new Date().toISOString(),
  }).eq("id", sug.id);

  // Bump deals.last_activity_at so the stuck-deal scanner won't immediately
  // re-fire on the same deal. (The clients table has no last_outreach_at
  // column — the suggestion row itself records the outreach via decided_at.)
  if (sug.deal_id) {
    await admin.from("deals")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("deal_id", sug.deal_id);
  }

  return json({ ok: true, status: "sent", message_id: messageId });
});
