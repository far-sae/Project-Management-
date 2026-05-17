// supabase/functions/slack-events/index.ts
// Public endpoint for Slack Events API. Receives signed POSTs for the
// `message.channels` event and enqueues an automation_events row that
// the existing crm-run-automations worker picks up.
//
// Deploy with: npx supabase functions deploy slack-events --no-verify-jwt

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET") ?? "";
const TOKEN_KEY = Deno.env.get("INTEGRATION_TOKEN_KEY") ?? "";

// ────────────────────────────────────────────────────────────────────────────
// Signature verification (Slack's v0 scheme).
// ────────────────────────────────────────────────────────────────────────────
const timingSafeEqualHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const verifySlackSignature = async (
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string,
  now: number = Date.now(),
): Promise<boolean> => {
  if (!signingSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject if timestamp is older than 5 minutes (replay protection).
  if (Math.abs(now / 1000 - ts) > 60 * 5) return false;
  if (!signature.startsWith("v0=")) return false;

  const base = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  const expected = "v0=" + Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqualHex(expected, signature);
};

// ────────────────────────────────────────────────────────────────────────────
// Slack API helpers (bot token, scoped to a single org).
// ────────────────────────────────────────────────────────────────────────────
const slackFetch = async (
  botToken: string, method: string, params: Record<string, string>,
): Promise<Record<string, unknown>> => {
  const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  return await res.json();
};

const lookupUserEmail = async (
  botToken: string, slackUserId: string,
): Promise<{ email: string | null; name: string | null }> => {
  try {
    const j = await slackFetch(botToken, "users.info", { user: slackUserId });
    const user = (j.user ?? {}) as { profile?: { email?: string; real_name?: string } };
    return {
      email: user.profile?.email ?? null,
      name: user.profile?.real_name ?? null,
    };
  } catch {
    return { email: null, name: null };
  }
};

const lookupChannelName = async (
  botToken: string, channelId: string,
): Promise<string | null> => {
  try {
    const j = await slackFetch(botToken, "conversations.info", { channel: channelId });
    const ch = (j.channel ?? {}) as { name?: string };
    return ch.name ?? null;
  } catch {
    return null;
  }
};

const buildPermalink = async (
  botToken: string, channelId: string, messageTs: string,
): Promise<string | null> => {
  try {
    const j = await slackFetch(botToken, "chat.getPermalink", {
      channel: channelId, message_ts: messageTs,
    });
    return (j.permalink as string) ?? null;
  } catch {
    return null;
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Org lookup by Slack team_id (uses the partial expression index from
// migration 070).
// ────────────────────────────────────────────────────────────────────────────
const resolveOrg = async (
  admin: SupabaseClient, teamId: string,
): Promise<{ organizationId: string; botToken: string } | null> => {
  const { data } = await admin.from("integrations")
    .select("organization_id, access_token_encrypted, metadata")
    .eq("provider", "slack")
    .eq("status", "active")
    .filter("metadata->>team_id", "eq", teamId)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  try {
    const botToken = await decrypt(data.access_token_encrypted as string, TOKEN_KEY);
    return { organizationId: data.organization_id as string, botToken };
  } catch {
    return null;
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Dedupe (best-effort; if it fails, we still process — Slack retries
// are bounded and downstream condition checks tolerate dupes).
// ────────────────────────────────────────────────────────────────────────────
const seenBefore = async (admin: SupabaseClient, eventId: string): Promise<boolean> => {
  const { error } = await admin.from("slack_event_dedupe")
    .insert({ event_id: eventId });
  // 23505 = unique_violation = already seen
  if (error && (error as { code?: string }).code === "23505") return true;
  // Opportunistic GC every ~100 events; cheap, ignore errors.
  if (Math.random() < 0.01) {
    void admin.rpc("gc_slack_event_dedupe");
  }
  return false;
};

// ────────────────────────────────────────────────────────────────────────────
// Main handler.
// ────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const sig = req.headers.get("x-slack-signature") ?? "";
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";

  if (!await verifySlackSignature(rawBody, ts, sig, SIGNING_SECRET)) {
    return new Response(JSON.stringify({ error: "invalid_signature" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); } catch {
    return new Response("bad_json", { status: 400 });
  }

  // URL verification handshake — Slack sends this once when an admin sets
  // the Request URL in the Event Subscriptions UI.
  if (body.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (body.type !== "event_callback") {
    return new Response(JSON.stringify({ ok: true, note: "ignored_type" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const eventId = (body.event_id as string) ?? "";
  const teamId = (body.team_id as string) ?? "";
  const ev = (body.event ?? {}) as {
    type?: string;
    bot_id?: string;
    subtype?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };

  // Only `message` events for now.
  if (ev.type !== "message") {
    return new Response(JSON.stringify({ ok: true, note: "non_message" }), {
      headers: { "content-type": "application/json" },
    });
  }
  // Drop bot-authored messages to prevent loops.
  if (ev.bot_id || ev.subtype === "bot_message") {
    return new Response(JSON.stringify({ ok: true, note: "bot_message" }), {
      headers: { "content-type": "application/json" },
    });
  }
  // Drop edits / deletes / channel-join chatter etc.
  if (ev.subtype && ev.subtype !== "thread_broadcast") {
    return new Response(JSON.stringify({ ok: true, note: `subtype_${ev.subtype}` }), {
      headers: { "content-type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotency check — return 200 quickly on retries.
  if (eventId) {
    if (await seenBefore(admin, eventId)) {
      return new Response(JSON.stringify({ ok: true, note: "duplicate" }), {
        headers: { "content-type": "application/json" },
      });
    }
  }

  const org = await resolveOrg(admin, teamId);
  if (!org) {
    return new Response(JSON.stringify({ ok: true, note: "no_org_for_team" }), {
      headers: { "content-type": "application/json" },
    });
  }

  // Enrich via Slack API (best-effort, all tolerant of failure).
  const [{ email, name }, channelName, permalink] = await Promise.all([
    ev.user ? lookupUserEmail(org.botToken, ev.user) : Promise.resolve({ email: null, name: null }),
    ev.channel ? lookupChannelName(org.botToken, ev.channel) : Promise.resolve(null),
    ev.channel && ev.ts ? buildPermalink(org.botToken, ev.channel, ev.ts) : Promise.resolve(null),
  ]);

  const payload = {
    team_id: teamId,
    channel_id: ev.channel ?? null,
    channel_name: channelName,
    user_id: ev.user ?? null,
    user_email: email,
    user_name: name,
    text: ev.text ?? "",
    message_ts: ev.ts ?? null,
    permalink,
    thread_ts: ev.thread_ts ?? null,
  };

  const { error: insertErr } = await admin.from("automation_events").insert({
    organization_id: org.organizationId,
    event_type: "slack_message_received",
    payload,
    source_table: "slack",
    source_id: ev.ts ?? null,
  });
  if (insertErr) {
    console.error("enqueue failed:", insertErr);
    // Still return 200 so Slack doesn't retry forever; the dedupe row
    // is already in place, so a retry would dedupe out anyway.
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
