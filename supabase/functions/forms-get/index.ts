// supabase/functions/forms-get/index.ts
// Public read endpoint that returns only the fields needed to render a form.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURNSTILE_SITE_KEY = Deno.env.get("TURNSTILE_SITE_KEY") ?? "";

const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (!slug) return new Response(JSON.stringify({ error: "missing_slug" }), { status: 400, headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("lead_forms")
    .select("title, description, fields, thank_you_message, turnstile_enabled, status")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data || data.status !== "active") {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });
  }
  return new Response(JSON.stringify({
    title: data.title,
    description: data.description,
    fields: data.fields,
    thank_you_message: data.thank_you_message,
    turnstile_site_key: data.turnstile_enabled ? TURNSTILE_SITE_KEY : null,
  }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
