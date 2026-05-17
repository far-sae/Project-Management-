// supabase/functions/crm-stuck-deal-scanner/index.ts
// Daily cron (09:00 UTC). For every org with ai_agent_enabled, finds
// open deals whose last_activity_at exceeds the pipeline's
// stale_after_days and dispatches them to ai-agent-suggest.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PER_ORG_LIMIT = 100;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

interface StaleDealRow {
  deal_id: string;
  organization_id: string;
}

const isOrgMember = (members: unknown, userId: string): boolean => {
  const rows = Array.isArray(members) ? members : [];
  return rows.some((m) => {
    const row = (m ?? {}) as Record<string, unknown>;
    return row.userId === userId || row.user_id === userId || row.id === userId;
  });
};

const getAuthorizedOrgFilter = async (
  req: Request,
  admin: ReturnType<typeof createClient>,
): Promise<string[] | null> => {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  if (token === SERVICE_KEY) return [];

  const { data: userInfo, error: userErr } = await admin.auth.getUser(token);
  const user = userInfo.user;
  if (userErr || !user) return null;

  const body = await req.clone().json().catch(() => ({})) as { organization_id?: string };
  if (!body.organization_id) return null;

  const { data: org } = await admin
    .from("organizations")
    .select("organization_id, owner_id, members")
    .eq("organization_id", body.organization_id)
    .maybeSingle();
  if (!org) return null;
  if (org.owner_id === user.id || isOrgMember(org.members, user.id)) {
    return [org.organization_id as string];
  }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authorizedOrgIds = await getAuthorizedOrgFilter(req, admin);
  if (authorizedOrgIds === null) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let orgQuery = admin.from("organizations")
    .select("organization_id")
    .eq("ai_agent_enabled", true);
  if (authorizedOrgIds.length > 0) orgQuery = orgQuery.in("organization_id", authorizedOrgIds);
  const { data: orgs } = await orgQuery;

  const summary: Record<string, number> = {};

  for (const org of orgs ?? []) {
    const orgId = org.organization_id as string;
    const { data: stale, error } = await admin.rpc("find_stale_deals", {
      p_organization_id: orgId,
      p_limit: PER_ORG_LIMIT,
    });
    if (error) {
      console.error(`find_stale_deals failed for ${orgId}:`, error);
      summary[orgId] = -1;
      continue;
    }

    summary[orgId] = (stale ?? []).length;

    for (const row of (stale ?? []) as StaleDealRow[]) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/ai-agent-suggest`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            trigger_type: "re_engagement",
            organization_id: row.organization_id,
            deal_id: row.deal_id,
          }),
        });
      } catch (e) {
        console.error(`dispatch failed for deal ${row.deal_id}:`, e);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, dispatched: summary }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
