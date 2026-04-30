// Supabase Edge Function: create Stripe Checkout Session for subscription
// Deploy: supabase functions deploy create-checkout-session
// Set secret: STRIPE_SECRET_KEY (Stripe Dashboard -> Developers -> API keys)
// Optional: STRIPE_ALLOWED_PRICE_IDS (comma-separated) to restrict checkout to known prices.
// Optional: ALLOWED_ORIGINS (comma-separated) for CORS allowlist; defaults to none (browser blocks unknown).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.10.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const allowedOriginsRaw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
const allowedOrigins = allowedOriginsRaw
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allow =
    origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))
      ? origin
      : (allowedOrigins[0] ?? "null");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const ALLOWED_TIERS = new Set(["starter", "basic", "advanced", "premium"]);
const ALLOWED_BILLING_CYCLES = new Set(["monthly", "yearly"]);

const allowedPriceIdsRaw = Deno.env.get("STRIPE_ALLOWED_PRICE_IDS") ?? "";
const allowedPriceIds = allowedPriceIdsRaw
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

function isSafeRedirect(url: string): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("Origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.slice(7);

  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json() as {
      priceId?: unknown;
      tier?: unknown;
      billingCycle?: unknown;
      successUrl?: unknown;
      cancelUrl?: unknown;
    };

    const priceId = typeof body.priceId === "string" ? body.priceId.trim() : "";
    const tier = typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "basic";
    const billingCycle =
      typeof body.billingCycle === "string"
        ? body.billingCycle.trim().toLowerCase()
        : "monthly";
    const successUrl = typeof body.successUrl === "string" ? body.successUrl : "";
    const cancelUrl = typeof body.cancelUrl === "string" ? body.cancelUrl : "";

    if (!priceId || !successUrl || !cancelUrl) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!isSafeRedirect(successUrl) || !isSafeRedirect(cancelUrl)) {
      return new Response(
        JSON.stringify({ error: "Invalid redirect URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!/^price_[A-Za-z0-9_]+$/.test(priceId)) {
      return new Response(
        JSON.stringify({ error: "Invalid priceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (allowedPriceIds.length > 0 && !allowedPriceIds.includes(priceId)) {
      return new Response(
        JSON.stringify({ error: "Price not permitted" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!ALLOWED_TIERS.has(tier) || !ALLOWED_BILLING_CYCLES.has(billingCycle)) {
      return new Response(
        JSON.stringify({ error: "Invalid tier or billingCycle" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(secret, { apiVersion: "2023-10-16" });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Bind to the authenticated user — never trust a userId from the request body.
      customer_email: user.email || undefined,
      client_reference_id: user.id,
      subscription_data: {
        metadata: {
          userId: user.id,
          tier,
          billingCycle,
        },
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const stripeErr = err as { type?: string; code?: string; message?: string };
    console.error("create-checkout-session error:", err);
    // Avoid leaking raw provider error messages to the client.
    return new Response(
      JSON.stringify({
        error: "Checkout failed",
        code: stripeErr?.code ?? undefined,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
