// supabase/functions/crm-rotate-turnstile-salt/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const newSalt = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
};

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.from("crm_secrets").update({
    value: newSalt(), rotated_at: new Date().toISOString(),
  }).eq("key", "turnstile_daily_salt");

  // Clean rate-limit rows older than 25 hours so the table doesn't grow forever.
  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await admin.from("form_submission_rate_limits").delete().lt("bucket_started_at", cutoff);

  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
});
