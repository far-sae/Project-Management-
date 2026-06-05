// Supabase Edge Function: handle Stripe webhooks and update subscriptions table
// Deploy: supabase functions deploy stripe-webhook
// Set secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// In Stripe Dashboard: Developers → Webhooks → Add endpoint → URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.10.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!stripeSecret || !webhookSecret) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return new Response("Server configuration error", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return new Response("Invalid body", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await new Stripe(stripeSecret, { apiVersion: "2023-10-16" }).webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Invoice payment (Billing Phase 3) — a one-time payment carrying an
        // invoice_id in metadata. Mark that invoice paid and stop; this is not
        // a subscription checkout.
        const paidInvoiceId = session.metadata?.invoice_id as string | undefined;
        if (paidInvoiceId && session.mode === "payment") {
          // Trust the invoice's OWN organization_id from the DB (not the
          // metadata) for scoping — invoice_id is a unique uuid, so this is the
          // authoritative row. Missing row => log and ack.
          const { data: invRow } = await supabase
            .from("invoices")
            .select("total, organization_id")
            .eq("invoice_id", paidInvoiceId)
            .maybeSingle();
          if (!invRow) {
            console.error("invoice payment: no invoice found for", paidInvoiceId);
            return new Response("OK", { status: 200 });
          }
          // We charged the full outstanding balance, so the invoice is now
          // fully paid. Idempotent: re-delivery just re-sets the same values.
          const upd = await supabase
            .from("invoices")
            .update({
              status: "paid",
              amount_paid: Number(invRow.total ?? 0),
              paid_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("invoice_id", paidInvoiceId)
            .eq("organization_id", invRow.organization_id)
            .select("invoice_id");
          if (upd.error) console.error("invoice payment update error:", upd.error);
          else if (!upd.data || upd.data.length === 0) console.error("invoice payment update matched 0 rows for", paidInvoiceId);
          return new Response("OK", { status: 200 });
        }

        const subId = session.subscription as string;
        const userId = session.client_reference_id || (session.metadata?.userId as string);
        const isExtraSeat = session.metadata?.extraSeat === "true";

        if (!userId) {
          console.error("checkout.session.completed missing userId");
          return new Response("OK", { status: 200 });
        }

        if (isExtraSeat) {
          const { data: row } = await supabase
            .from("subscriptions")
            .select("extra_seats")
            .eq("user_id", userId)
            .maybeSingle();
          const next = (row?.extra_seats ?? 0) + 1;
          await supabase
            .from("subscriptions")
            .update({ extra_seats: next, updated_at: new Date().toISOString() })
            .eq("user_id", userId);
          break;
        }

        if (!subId) {
          console.error("checkout.session.completed missing subscription id");
          return new Response("OK", { status: 200 });
        }

        const tier = (session.metadata?.tier as string) || "basic";
        const billingCycle = (session.metadata?.billingCycle as string) || "monthly";

        const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
        const subscription = await stripe.subscriptions.retrieve(subId);
        const periodStart = new Date(subscription.current_period_start * 1000);
        const periodEnd = new Date(subscription.current_period_end * 1000);

        const { error } = await supabase.from("subscriptions").upsert(
          {
            user_id: userId,
            plan: tier,
            status: "active",
            billing_cycle: billingCycle,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: subId,
            current_period_start: periodStart.toISOString(),
            current_period_end: periodEnd.toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end ?? false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        if (error) console.error("subscriptions upsert error:", error);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const subId = subscription.id;
        let userId = subscription.metadata?.userId as string | undefined;
        if (!userId) {
          const { data: row } = await supabase
            .from("subscriptions")
            .select("user_id")
            .eq("stripe_subscription_id", subId)
            .maybeSingle();
          userId = row?.user_id;
        }
        if (!userId) {
          console.error("subscription.updated: no user_id found for sub", subId);
          return new Response("OK", { status: 200 });
        }

        const periodStart = new Date(subscription.current_period_start * 1000);
        const periodEnd = new Date(subscription.current_period_end * 1000);
        const tier = (subscription.metadata?.tier as string) || undefined;
        const billingCycle = (subscription.metadata?.billingCycle as string) || undefined;

        const updatePayload: Record<string, unknown> = {
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end ?? false,
          updated_at: new Date().toISOString(),
        };
        if (tier) updatePayload.plan = tier;
        if (billingCycle) updatePayload.billing_cycle = billingCycle;
        if (subscription.status !== "active" && subscription.status !== "trialing") {
          updatePayload.status = subscription.status === "canceled" ? "cancelled" : "expired";
        }

        await supabase.from("subscriptions").update(updatePayload).eq("user_id", userId);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const subId = subscription.id;

        const { data: row } = await supabase
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();

        if (row) {
          await supabase
            .from("subscriptions")
            .update({
              status: "expired",
              plan: "starter",
              stripe_subscription_id: null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", row.user_id);
        }
        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});
