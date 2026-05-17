// supabase/functions/crm-agent-snooze-revival/index.ts
// Hourly cron. Flips snoozed → pending when snooze_until passes, and
// auto-expires pending suggestions older than 14 days.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("revive_agent_snoozes");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, touched: data }), {
    headers: { "content-type": "application/json" },
  });
});
