// supabase/functions/whatsapp-link-code/index.ts
// Authenticated POST. Body: { orgId: string }.
// Returns { code: "123456", expiresAt: "..." }.
//
// Mirrors telegram-link-code one-to-one. Different table:
// whatsapp_link_codes (see migration 088).
//
// Deploy: npx supabase functions deploy whatsapp-link-code

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const recentCount = async (admin: ReturnType<typeof createClient>, userId: string): Promise<number> => {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin
    .from("whatsapp_link_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gt("created_at", since);
  return count ?? 0;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const authClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user }, error: authErr } = await authClient.auth.getUser(auth.slice(7));
  if (authErr || !user) return json({ error: "unauthorized" }, 401);

  let payload: { orgId?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const orgId = (payload.orgId ?? "").trim();
  if (!orgId) return json({ error: "orgId required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isMember, error: memErr } = await admin.rpc("is_org_member_for", {
    p_user_id: user.id,
    p_org_id: orgId,
  });
  if (memErr || isMember !== true) return json({ error: "not_a_member" }, 403);

  if ((await recentCount(admin, user.id)) >= 5) {
    return json({ error: "rate_limited" }, 429);
  }

  const code = String(Math.floor(100_000 + Math.random() * 900_000));
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { error } = await admin.from("whatsapp_link_codes").insert({
    user_id: user.id,
    org_id: orgId,
    code_hash: codeHash,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("insert whatsapp code failed:", error);
    return json({ error: "internal" }, 500);
  }

  return json({ code, expiresAt });
});
