// Supabase Edge Function: create Stripe Checkout Session for subscription
// Deploy: supabase functions deploy create-checkout-session
// Set secret: STRIPE_SECRET_KEY (Stripe Dashboard -> Developers -> API keys)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.10.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json() as {
      priceId: string;
      tier?: string;
      billingCycle?: string;
      userId: string;
      userEmail?: string;
      successUrl: string;
      cancelUrl: string;
    };
    const { priceId, tier, billingCycle, userId, userEmail, successUrl, cancelUrl } = body;

    if (!priceId || !userId || !successUrl || !cancelUrl) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(secret, { apiVersion: "2023-10-16" });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: userEmail || undefined,
      client_reference_id: userId,
      subscription_data: {
        metadata: {
          userId,
          tier: tier || "basic",
          billingCycle: billingCycle || "monthly",
        },
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    const message = err instanceof Error ? err.message : "Checkout failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
