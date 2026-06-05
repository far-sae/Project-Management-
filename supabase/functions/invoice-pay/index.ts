// Supabase Edge Function: create a Stripe Checkout Session to pay ONE invoice.
// Public + token-scoped: the payer is the client (not logged in); the
// invoice's public_token authorizes the charge. Reuses STRIPE_SECRET_KEY.
// Deploy: supabase functions deploy invoice-pay
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.10.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Zero-decimal currencies have no minor unit (amount is already an integer).
const ZERO_DECIMAL = new Set(["BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF"]);
const toMinorUnits = (amount: number, currency: string): number => {
  const c = currency.toUpperCase();
  return ZERO_DECIMAL.has(c) ? Math.round(amount) : Math.round(amount * 100);
};

const isSafeHttpUrl = (url: string): boolean => {
  if (typeof url !== "string" || !url || url.length > 2048) return false;
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Server configuration error" });
  if (!secret) return json(400, { error: "not_configured", message: "Online payments are not set up." });

  let token = "", origin = "";
  try {
    const b = await req.json() as { token?: unknown; origin?: unknown };
    token = typeof b.token === "string" ? b.token.trim() : "";
    origin = typeof b.origin === "string" ? b.origin : "";
  } catch { return json(400, { error: "Invalid body" }); }
  if (!token) return json(400, { error: "Missing token" });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: inv, error } = await admin
    .from("invoices")
    .select("invoice_id, organization_id, status, currency, total, amount_paid, invoice_number")
    .eq("public_token", token)
    .maybeSingle();
  if (error || !inv) return json(404, { error: "Invoice not found" });

  if (inv.status === "paid") return json(409, { error: "already_paid", message: "This invoice is already paid." });
  if (inv.status === "void" || inv.status === "draft") return json(409, { error: "not_payable", message: "This invoice can't be paid online." });

  const balance = Math.max(0, Number(inv.total ?? 0) - Number(inv.amount_paid ?? 0));
  if (balance <= 0) return json(409, { error: "nothing_due", message: "Nothing is due on this invoice." });

  const currency = String(inv.currency ?? "USD").toLowerCase();
  const base = isSafeHttpUrl(origin) ? origin.replace(/\/$/, "") : "";
  const back = base ? `${base}/invoice/${token}` : undefined;

  try {
    const stripe = new Stripe(secret, { apiVersion: "2023-10-16" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          product_data: { name: `Invoice ${inv.invoice_number}` },
          unit_amount: toMinorUnits(balance, currency),
        },
      }],
      success_url: back ? `${back}?paid=1` : "https://taskcalendar.co.uk/",
      cancel_url: back ? `${back}?canceled=1` : "https://taskcalendar.co.uk/",
      metadata: { invoice_id: inv.invoice_id, organization_id: inv.organization_id },
    });
    return json(200, { url: session.url });
  } catch (err) {
    const e = err as { code?: string };
    console.error("invoice-pay error:", err);
    return json(500, { error: "checkout_failed", code: e?.code });
  }
});
