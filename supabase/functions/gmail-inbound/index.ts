import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INBOUND_SECRET = Deno.env.get("SENDGRID_INBOUND_WEBHOOK_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, x-twilio-email-event-webhook-signature, x-twilio-email-event-webhook-timestamp",
};

// Constant-time string compare to avoid timing side channels.
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const verifyEcdsaSignature = async (
  body: string, timestamp: string, signatureB64: string,
): Promise<boolean> => {
  if (!INBOUND_SECRET || !timestamp || !signatureB64) return false;
  try {
    const publicKeyDer = Uint8Array.from(atob(INBOUND_SECRET), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "spki", publicKeyDer,
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    const signature = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    const data = new TextEncoder().encode(timestamp + body);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, data);
  } catch {
    return false;
  }
};

export const isAuthorized = async (
  req: Request, rawBody: string,
): Promise<boolean> => {
  if (!INBOUND_SECRET) return false;
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("secret") ?? "";
  if (querySecret && timingSafeEqual(querySecret, INBOUND_SECRET)) return true;

  const sig = req.headers.get("x-twilio-email-event-webhook-signature") ?? "";
  const ts = req.headers.get("x-twilio-email-event-webhook-timestamp") ?? "";
  return verifyEcdsaSignature(rawBody, ts, sig);
};

export const extractRunIdFromTo = (toHeader: string): string | null => {
  const m = toHeader.match(/reply\+([0-9a-f-]{36})@/i);
  return m ? m[1] : null;
};

const extractBoundary = (req: Request): string => {
  const ct = req.headers.get("content-type") ?? "";
  const m = ct.match(/boundary="?([^";]+)"?/);
  return m ? m[1] : "----";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const rawBody = await req.text();
  if (!await isAuthorized(req, rawBody)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const form = await new Request(
    "data:multipart/form-data;boundary=" + extractBoundary(req),
    { method: "POST", body: rawBody, headers: { "content-type": req.headers.get("content-type") ?? "" } },
  ).formData();

  const toField = String(form.get("to") ?? "");
  const fromField = String(form.get("from") ?? "");
  const subject = String(form.get("subject") ?? "");
  const text = String(form.get("text") ?? "");

  const runId = extractRunIdFromTo(toField);
  if (!runId) {
    return new Response(JSON.stringify({ ok: true, note: "no run id" }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: run } = await admin
    .from("automation_runs")
    .select("recipe_id, organization_id, event_id, automation_events(payload, source_table, source_id)")
    .eq("run_id", runId)
    .maybeSingle();
  if (!run) {
    return new Response(JSON.stringify({ ok: true, note: "run not found" }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  await admin.from("sequence_replies").insert({
    organization_id: run.organization_id,
    recipe_run_id: runId,
    recipe_id: run.recipe_id,
    from_address: fromField.slice(0, 320),
    subject: subject.slice(0, 1000),
    body_preview: text.slice(0, 500),
    raw_payload: Object.fromEntries(form),
  });

  const originalPayload = (run.automation_events as { payload?: Record<string, unknown> } | null)?.payload ?? {};
  await admin.from("automation_events").insert({
    organization_id: run.organization_id,
    event_type: "email_reply_received",
    payload: {
      ...originalPayload,
      reply_run_id: runId,
      from_address: fromField.slice(0, 320),
      subject: subject.slice(0, 1000),
      body_preview: text.slice(0, 500),
    },
    source_table: "sequence_replies",
    source_id: null,
  });

  await admin.from("pending_actions")
    .update({ status: "reply_received" })
    .eq("status", "pending")
    .eq("recipe_id", run.recipe_id)
    .eq("source_event_id", run.event_id);

  return new Response(JSON.stringify({ ok: true, cancelled_run: runId }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
