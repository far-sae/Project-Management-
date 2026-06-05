# Billing Phase 3 — Stripe "Pay now" on invoices

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Let a client pay an invoice online from the public hosted page (`/invoice/:token`) via Stripe Checkout. Reuses the app's EXISTING Stripe integration (same `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, same webhook URL). No new migration.

**Architecture:** A new public, token-scoped edge function `invoice-pay` creates a one-time Stripe Checkout Session (`mode: "payment"`) for the invoice's outstanding balance, with `metadata: { invoice_id, organization_id }`. The EXISTING `stripe-webhook` gets one new branch in its `checkout.session.completed` case: when the session carries `invoice_id` metadata, it marks that invoice paid (service role). The public page gains a **Pay now** button that calls `invoice-pay` and redirects to Stripe.

**Tech Stack:** Deno edge functions (esm.sh `stripe@14.10.0`, `@supabase/supabase-js@2.39.0`), React/TS. **Branch:** `billing-hub` (continue on it).

**Known facts (verified):**
- `supabase/functions/stripe-webhook/index.ts` constructs `new Stripe(stripeSecret, { apiVersion: "2023-10-16" })`, verifies via `constructEventAsync`, and has a `switch (event.type)` with `case "checkout.session.completed"`. Service-role supabase client is `createClient(supabaseUrl, supabaseServiceKey)`. It reads `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `supabase/functions/create-checkout-session/index.ts` is the mirror for building a checkout session (CORS via `buildCorsHeaders`, `mode: "subscription"`). Phase 3's `invoice-pay` mirrors it but `mode: "payment"` with `price_data`, and is PUBLIC (token-authorized, no user JWT — the payer is the client, not logged in).
- `invoices` table: `invoice_id`, `organization_id`, `public_token` (uuid), `status` (draft/sent/paid/overdue/void), `currency`, `total`, `amount_paid`, `invoice_number`, `client_id`. RPC `get_public_invoice(p_token)` (migration 128) already returns `status`, `total`, `amount_paid`, `currency`, `invoice_number` to the public page.
- Frontend public page: `src/pages/public/PublicInvoice.tsx` (uses `getPublicInvoice` from `src/services/supabase/invoices.ts`, which returns `PublicInvoiceView` with `status`, `total`, `amountPaid`, `currency`, `invoiceNumber`).
- Deno binary (not on PATH): `C:\Users\faraz\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe` (call it `$DENO`).

---

## Task 1: `invoice-pay` edge function (public, token-scoped)

**Files:** Create `supabase/functions/invoice-pay/index.ts`

- [ ] **Step 1:** Create the file:

```typescript
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
```

- [ ] **Step 2: Type-check.**

Run: `& "$DENO" check supabase/functions/invoice-pay/index.ts`
Expected: no errors (esm.sh remote types resolve).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/invoice-pay/index.ts
git commit -m "feat(billing): invoice-pay edge fn (token-scoped Stripe Checkout)"
```

---

## Task 2: Extend `stripe-webhook` to mark an invoice paid

**Files:** Modify `supabase/functions/stripe-webhook/index.ts`

- [ ] **Step 1:** In the `case "checkout.session.completed": {` block, add an invoice-payment branch at the very TOP of the block (right after `const session = event.data.object as Stripe.Checkout.Session;`), BEFORE any subscription logic:

```typescript
        // Invoice payment (Billing Phase 3) — a one-time payment carrying an
        // invoice_id in metadata. Mark that invoice paid and stop; this is not
        // a subscription checkout.
        const paidInvoiceId = session.metadata?.invoice_id as string | undefined;
        if (paidInvoiceId && session.mode === "payment") {
          const paidOrgId = session.metadata?.organization_id as string | undefined;
          const { data: invRow } = await supabase
            .from("invoices")
            .select("total")
            .eq("invoice_id", paidInvoiceId)
            .maybeSingle();
          // We charged the full outstanding balance, so the invoice is now
          // fully paid. Idempotent: re-delivery just re-sets the same values.
          const upd = await supabase
            .from("invoices")
            .update({
              status: "paid",
              amount_paid: Number(invRow?.total ?? 0),
              paid_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("invoice_id", paidInvoiceId)
            .eq("organization_id", paidOrgId ?? "");
          if (upd.error) console.error("invoice payment update error:", upd.error);
          return new Response("OK", { status: 200 });
        }
```

(The existing subscription/extra-seat logic stays unchanged below this branch.)

- [ ] **Step 2: Type-check.**

Run: `& "$DENO" check supabase/functions/stripe-webhook/index.ts`
Expected: no NEW errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(billing): stripe-webhook marks invoice paid on one-time payment"
```

---

## Task 3: Frontend — `payInvoice` service + Pay-now button

**Files:** Modify `src/services/supabase/invoices.ts`, `src/pages/public/PublicInvoice.tsx`

- [ ] **Step 1:** Add to `src/services/supabase/invoices.ts` (near `getPublicInvoice`):

```typescript
/** Start an online payment for a public invoice. Returns the Stripe Checkout
 *  URL to redirect to, or null if payments aren't configured. Throws on other
 *  errors. */
export const payInvoice = async (token: string): Promise<string | null> => {
  const { data, error } = await supabase.functions.invoke('invoice-pay', {
    body: { token, origin: window.location.origin },
  });
  if (error) {
    // Supabase wraps non-2xx as an error; try to read the payload for the
    // "not configured" case so the UI can hide the button gracefully.
    const ctx = (error as { context?: { body?: unknown } }).context;
    const msg = String((ctx?.body as { error?: string })?.error ?? '');
    if (msg === 'not_configured') return null;
    throw new Error('Could not start the payment. Please try again or contact us.');
  }
  const d = data as { url?: string; error?: string };
  if (d?.error === 'not_configured') return null;
  if (!d?.url) throw new Error('Could not start the payment.');
  return d.url;
};
```

- [ ] **Step 2:** In `src/pages/public/PublicInvoice.tsx`:

2a. Add imports + read the `?paid=1` flag. At the top of the component, add:

```tsx
  const paidFlag = new URLSearchParams(window.location.search).get('paid') === '1';
  const [paying, setPaying] = useState(false);
```

(Add `payInvoice` to the existing `import { ... } from '@/services/supabase/invoices'` line, and ensure `useState` is imported — it already is.)

2b. Add a handler (inside the component, after `downloadPdf`):

```tsx
  const payNow = async () => {
    if (!inv) return;
    setPaying(true);
    try {
      const url = await payInvoice(token!);
      if (!url) { alert('Online payment is not available for this invoice.'); return; }
      window.location.href = url;
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Payment could not be started.');
    } finally {
      setPaying(false);
    }
  };
```

2c. In the actions row (where the Download PDF button is), add a success banner + the Pay-now button. The invoice is payable when not paid/void and a balance remains. Replace the actions `<div className="mt-8 flex justify-end gap-2">…</div>` block with:

```tsx
        {paidFlag && (
          <div className="mt-6 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-4 py-3 text-sm">
            Payment received — thank you! It may take a moment to reflect here.
          </div>
        )}
        <div className="mt-8 flex justify-end gap-2">
          <Button variant="outline" onClick={downloadPdf}><FileDown className="w-4 h-4 mr-1.5" /> Download PDF</Button>
          {inv.status !== 'paid' && inv.status !== 'void' && (inv.total - inv.amountPaid) > 0 && (
            <Button onClick={payNow} disabled={paying}>
              {paying ? 'Starting…' : `Pay ${money(inv.total - inv.amountPaid, inv.currency)}`}
            </Button>
          )}
        </div>
```

- [ ] **Step 3: Build.**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/services/supabase/invoices.ts src/pages/public/PublicInvoice.tsx
git commit -m "feat(billing): Pay now button on the public invoice page"
```

---

## Task 4: Verify

- [ ] `& "$DENO" check supabase/functions/invoice-pay/index.ts` and `… stripe-webhook/index.ts` → clean.
- [ ] `npm run build` → success; `npm run test` → still green (no test changes, but confirm nothing broke).
- [ ] **Manual (post-deploy — needs `invoice-pay` deployed, `stripe-webhook` redeployed, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` already set):** open a sent invoice's public page → "Pay {balance}" button shows → click → Stripe Checkout → pay with a test card → redirected back to `?paid=1` (thank-you banner) → within seconds the webhook flips the invoice to `paid` (verify on the Billing page). An already-paid or draft invoice shows no Pay button. With no `STRIPE_SECRET_KEY`, the button either hides (not_configured) or shows a graceful message.

## Self-Review
**Spec coverage (Phase 3):** token-scoped Checkout via `invoice-pay` (Task 1) ✓; webhook marks paid (Task 2) ✓; Pay-now on the hosted page (Task 3) ✓; gated behind `STRIPE_SECRET_KEY` with graceful fallback (Tasks 1+3) ✓; reuses existing Stripe keys + webhook endpoint (no new migration) ✓.
**Placeholder scan:** none — full code given. Fallback `success_url` uses the production domain when no safe origin is supplied (defensive, not a placeholder).
**Type consistency:** `payInvoice(token) → string | null` consumed by `PublicInvoice.payNow`; webhook branch reads `session.metadata.invoice_id`/`organization_id` exactly as `invoice-pay` sets them; balance computed identically (`total - amount_paid`) in the edge fn, the webhook (charges full balance → sets amount_paid=total), and the button.
