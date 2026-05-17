// supabase/functions/crm-stuck-deal-scanner/index.ts
// Daily cron (09:00 UTC). For every org with ai_agent_enabled, finds
// open deals whose last_activity_at exceeds the pipeline's
// stale_after_days and dispatches them to ai-agent-suggest.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PER_ORG_LIMIT = 100;

interface StaleDealRow {
  deal_id: string;
  organization_id: string;
}

Deno.serve(async (_req) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: orgs } = await admin.from("organizations")
    .select("organization_id")
    .eq("ai_agent_enabled", true);

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
    headers: { "content-type": "application/json" },
  });
});
