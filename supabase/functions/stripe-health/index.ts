// supabase/functions/stripe-health/index.ts
//
// Browser-friendly diagnostic for the Stripe wiring. Exists ONLY
// because stripe-webhook itself can't be probed from a browser:
// it has no CORS headers (intentional — Stripe calls it
// server-to-server, never a browser), so a fetch from the app's
// origin to stripe-webhook always fails CORS-preflight and the
// health card falsely reports "unreachable".
//
// This function:
//   - Has full CORS headers so the in-app card can call it.
//   - Reports whether STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
//     are visible to the function environment.
//   - Returns the project's own webhook URL so the UI can show the
//     exact value to paste into Stripe Dashboard.
//   - Makes NO Stripe API calls — cheap, fast, no risk of leaking
//     keys (it never echoes them; just presence + length).
//
// Deploy:
//   npx supabase functions deploy stripe-health
// No secrets needed beyond the existing Stripe ones.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

  // Mode hint — sk_test_* vs sk_live_* mixed with the wrong whsec_
  // is the single most common dead-end after secrets are set.
  const secretKeyMode = secretKey.startsWith("sk_test_") ? "test"
    : secretKey.startsWith("sk_live_") ? "live"
    : secretKey ? "unknown"
    : null;

  // Build the webhook URL the user pastes into Stripe Dashboard.
  // SUPABASE_URL is the canonical project URL on the function env.
  const webhookUrl = SUPABASE_URL
    ? `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/stripe-webhook`
    : null;

  return json({
    ok: true,
    // Boolean presence — NEVER echo the actual values.
    secretKeySet: !!secretKey,
    secretKeyMode,                     // 'test' | 'live' | 'unknown' | null
    secretKeyPrefix: secretKey ? secretKey.slice(0, 7) : null,  // e.g. 'sk_test'
    webhookSecretSet: !!webhookSecret,
    webhookSecretPrefix: webhookSecret ? webhookSecret.slice(0, 6) : null,  // 'whsec_'
    // Convenience for the UI.
    webhookUrl,
    // Sanity: env-var names we expect (so the UI can list them
    // alongside the booleans without hardcoding the strings client-side).
    expected: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  });
});
