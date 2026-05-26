// supabase/functions/sms-send/index.ts
// Send an SMS via Twilio's REST API and persist the result to sms_messages.
//
// Deploy:
//   npx supabase functions deploy sms-send
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TWILIO_ACCOUNT_SID   — starts with AC…
//   TWILIO_AUTH_TOKEN    — Twilio dashboard secret
//   TWILIO_FROM_NUMBER   — E.164 sender; e.g. +15551234567
//
// Request body:
//   { organizationId, to, body, clientId?, dealId? }
//
// Response:
//   200 { ok: true, messageId, providerSid, status }
//   4xx { ok: false, error }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sendViaTwilio = async (
  to: string,
  body: string,
): Promise<{ sid: string; status: string }> => {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body });
  const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Twilio rejected the send: ${data?.message ?? res.statusText} (code ${
        data?.code ?? res.status
      })`,
    );
  }
  return { sid: String(data.sid), status: String(data.status ?? "queued") };
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return json(503, {
      ok: false,
      error:
        "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER as Edge Function secrets.",
    });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { ok: false, error: "Missing bearer token" });
  }

  let payload: {
    organizationId?: string;
    to?: string;
    body?: string;
    clientId?: string | null;
    dealId?: string | null;
  };
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "Body is not valid JSON" });
  }

  const { organizationId, to, body, clientId, dealId } = payload;
  if (!organizationId || !to || !body) {
    return json(400, { ok: false, error: "organizationId, to, and body are required" });
  }
  if (!/^\+\d{6,}$/.test(to)) {
    return json(400, { ok: false, error: "`to` must be an E.164 phone number, e.g. +15551234567" });
  }

  // Confirm the caller is a member of the org they claim to send from.
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { authorization: authHeader } },
  });
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id ?? null;
  if (!userId) return json(401, { ok: false, error: "Not signed in" });

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return json(403, { ok: false, error: "Not a member of this organization" });

  const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let sid = "";
  let providerStatus = "queued";
  let errorMessage: string | null = null;
  let dbStatus: "queued" | "sent" | "failed" = "queued";
  try {
    const r = await sendViaTwilio(to, body);
    sid = r.sid;
    providerStatus = r.status;
    dbStatus = "sent";
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "send failed";
    dbStatus = "failed";
  }

  const { data: inserted, error: insertErr } = await adminSupabase
    .from("sms_messages")
    .insert({
      organization_id: organizationId,
      client_id: clientId ?? null,
      deal_id: dealId ?? null,
      to_number: to,
      from_number: TWILIO_FROM,
      body,
      provider: "twilio",
      provider_sid: sid || null,
      status: providerStatus || dbStatus,
      error_message: errorMessage,
      sent_by: userId,
    })
    .select("message_id")
    .single();

  if (insertErr) {
    return json(500, { ok: false, error: insertErr.message });
  }

  if (dbStatus === "failed") {
    return json(502, {
      ok: false,
      error: errorMessage ?? "send failed",
      messageId: inserted?.message_id,
    });
  }
  return json(200, {
    ok: true,
    messageId: inserted?.message_id,
    providerSid: sid,
    status: providerStatus,
  });
});
