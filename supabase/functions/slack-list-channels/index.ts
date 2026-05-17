// supabase/functions/slack-list-channels/index.ts
// JWT-gated. Returns the list of public channels the user's org's Slack
// bot has access to, for the recipe builder's channel-picker dropdown.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_KEY = Deno.env.get("INTEGRATION_TOKEN_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

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

  // Find a Slack integration in the same org as the caller. We look up
  // via the user's own integration row first; if they don't have one,
  // fall back to any active slack integration in any org they belong
  // to (matches the existing pattern for cross-user shared integrations).
  const { data: integ } = await admin.from("integrations")
    .select("access_token_encrypted, organization_id")
    .eq("user_id", userId)
    .eq("provider", "slack")
    .eq("status", "active")
    .maybeSingle();

  let row = integ;
  if (!row) {
    // Walk the user's orgs via the organizations.members jsonb
    const { data: orgs } = await admin.from("organizations")
      .select("organization_id, owner_id, members");
    const myOrgIds: string[] = [];
    for (const o of orgs ?? []) {
      const oid = o.organization_id as string;
      if (o.owner_id === userId) { myOrgIds.push(oid); continue; }
      const members = (o.members ?? []) as Array<{ userId?: string }>;
      if (members.some((m) => m?.userId === userId)) myOrgIds.push(oid);
    }
    if (myOrgIds.length === 0) return json({ channels: [] });

    const { data: shared } = await admin.from("integrations")
      .select("access_token_encrypted, organization_id")
      .in("organization_id", myOrgIds)
      .eq("provider", "slack")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!shared) return json({ channels: [], note: "no_slack_integration" });
    row = shared;
  }

  let botToken: string;
  try {
    botToken = await decrypt(row.access_token_encrypted as string, TOKEN_KEY);
  } catch (e) {
    return json({ error: "token_decrypt_failed", message: (e as Error).message }, 500);
  }

  // Slack pagination: keep cursoring until we run out or hit 1000.
  const all: Array<{ id: string; name: string }> = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const params = new URLSearchParams({
      types: "public_channel",
      exclude_archived: "true",
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`https://slack.com/api/conversations.list?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const j = await res.json() as {
      ok: boolean;
      channels?: Array<{ id: string; name: string; is_archived?: boolean }>;
      response_metadata?: { next_cursor?: string };
      error?: string;
    };
    if (!j.ok) {
      return json({ error: "slack_api_failed", message: j.error ?? "unknown" }, 502);
    }
    for (const c of j.channels ?? []) {
      if (!c.is_archived) all.push({ id: c.id, name: c.name });
    }
    cursor = j.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  all.sort((a, b) => a.name.localeCompare(b.name));
  return json({ channels: all });
});
