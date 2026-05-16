// supabase/functions/crm-recompute-scores/index.ts
// Polls lead_scoring_recompute_queue and drains it via bulk_recompute_org_scores.
// Invoke via Supabase Scheduled Functions every 60 seconds, OR with a manual
// curl against /functions/v1/crm-recompute-scores for testing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: queued, error: qErr } = await admin
    .from("lead_scoring_recompute_queue")
    .select("organization_id")
    .order("enqueued_at", { ascending: true })
    .limit(5);
  if (qErr) {
    return new Response(JSON.stringify({ ok: false, error: qErr.message }), { status: 500 });
  }

  const results: Array<{ org: string; processed: number }> = [];
  for (const row of queued || []) {
    let processed = 0;
    while (true) {
      const { data, error } = await admin.rpc("bulk_recompute_org_scores", {
        p_org: row.organization_id,
        p_batch: 500,
      });
      if (error) break;
      const n = Number(data ?? 0);
      processed += n;
      if (n < 500) break;
    }
    results.push({ org: row.organization_id, processed });
  }

  return new Response(JSON.stringify({ ok: true, processed: results }), {
    headers: { "content-type": "application/json" },
  });
});
