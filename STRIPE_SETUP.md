# Stripe setup for TaskCalendar (step-by-step)

This guide walks you through enabling Stripe subscriptions in your TaskCalendar project.

---

## 1. Create a Stripe account

1. Go to [https://stripe.com](https://stripe.com) and sign up (or log in).
2. Complete account verification if prompted.
3. For testing, use **Test mode** (toggle in the Stripe Dashboard top-right). Use **Live mode** only when you’re ready to charge real cards.

---

## 2. Get your API keys

1. In the [Stripe Dashboard](https://dashboard.stripe.com), go to **Developers → API keys**.
2. Copy:
   - **Publishable key** (starts with `pk_test_` or `pk_live_`) → used in the frontend.
   - **Secret key** (starts with `sk_test_` or `sk_live_`) → used only in backend/Edge Functions; never expose it in the browser.

---

## 3. Create Products and Prices in Stripe

Your app has three paid tiers: **Basic**, **Advanced**, and **Premium**. Create one Product per tier and at least one Price per product (monthly and/or yearly).

### For each tier (Basic, Advanced, Premium)

1. Go to **Product catalog → Add product**.
2. **Name**: e.g. `TaskCalendar Basic`, `TaskCalendar Advanced`, `TaskCalendar Premium`.
3. **Description**: optional.
4. **Pricing**:
   - Add a **recurring** price (monthly): e.g. $9.99/month for Basic.
   - Add another **recurring** price (yearly) if you offer yearly billing: e.g. $95.88/year for Basic.
   - Optionally add a **promo** monthly price (e.g. first 3 months at $5.99) and create a separate Price for it.
5. After saving, copy each **Price ID** (e.g. `price_1ABC...`). You will paste these into your app config.

### Suggested products (match your app’s pricing)

| Tier     | Monthly   | Yearly   | Promo monthly (optional) |
|----------|-----------|----------|---------------------------|
| Basic    | $9.99/mo  | $95.88/yr| $5.99 for 3 months        |
| Advanced | $59.99/mo | $575.88/yr | $49.99 for 1 month     |
| Premium  | (contact) | (contact)| —                         |

Create only the products/prices you actually use. You can start with Basic (monthly + yearly) and add the rest later.

---

## 4. Add environment variables

### Frontend (Vite)

In your project root, create or edit `.env`:

```env
# Stripe (public key only — safe in frontend)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
```

Restart the dev server after changing `.env`.

### Backend (Supabase Edge Functions)

Your Edge Functions need the **secret** key and (optional) webhook secret:

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Project Settings → Edge Functions**.
2. Under **Secrets**, add:
   - `STRIPE_SECRET_KEY` = your Stripe **secret** key (e.g. `sk_test_...`).
   - `STRIPE_WEBHOOK_SECRET` = webhook signing secret (you get this in step 6).

Never put `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` in `.env` in the repo or in the frontend.

---

## 5. Deploy Supabase Edge Functions

The app expects two Edge Functions:

1. **`create-checkout-session`** – creates a Stripe Checkout Session and returns the checkout URL.
2. **`stripe-webhook`** – receives Stripe webhooks and updates the `subscriptions` table.

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed and logged in.
- Project linked: `supabase link --project-ref YOUR_REF`.

### Deploy

From the **project root** (the folder that contains `supabase/functions`):

```bash
# If you haven’t linked the project yet:
supabase link --project-ref YOUR_PROJECT_REF

# Deploy both functions
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

Set the secrets in the Supabase Dashboard (step 4) before or right after deploying.

---

## 6. Configure the Stripe webhook

So Stripe can notify your app when a payment or subscription changes:

1. In Stripe Dashboard go to **Developers → Webhooks**.
2. Click **Add endpoint**.
3. **Endpoint URL**:  
   `https://YOUR_SUPABASE_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`  
   (replace `YOUR_SUPABASE_PROJECT_REF` with your Supabase project ref from Project Settings → General).
4. **Events to send**: add at least:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Create the endpoint. Open it and under **Signing secret** click **Reveal** and copy it.
6. In Supabase (Project Settings → Edge Functions → Secrets), set:
   - `STRIPE_WEBHOOK_SECRET` = that signing secret.

Redeploy the `stripe-webhook` function after changing secrets if your provider caches env.

---

## 7. Add your Price IDs to the app

The app reads Price IDs from `src/types/subscription.ts` (per country). Replace the placeholders with the IDs you copied in step 3.

1. Open `src/types/subscription.ts`.
2. Find the pricing object you use (e.g. `USA_PRICING` or `INDIA_PRICING`).
3. For each tier (basic, advanced, premium) set:
   - `stripePriceIdMonthly` = Stripe monthly Price ID.
   - `stripePriceIdYearly` = Stripe yearly Price ID (or `null` if you don’t offer yearly).
   - `stripePriceIdMonthlyPromo` = promo Price ID or `null`.

Example for Basic in USA:

```ts
basic: {
  monthly: 9.99,
  monthlyPromo: 5.99,
  promoMonths: 3,
  yearly: 95.88,
  stripePriceIdMonthly: "price_1ABC123...",      // from Stripe
  stripePriceIdMonthlyPromo: "price_1ABC456...",
  stripePriceIdYearly: "price_1ABC789...",
  // ... rest unchanged
},
```

Save the file. The Pricing page will use these IDs when starting checkout.

---

## 8. Ensure the `subscriptions` table exists (Supabase)

Your Edge Function and app expect a `subscriptions` table. If you haven’t created it yet, run SQL in Supabase (**SQL Editor**):

```sql
-- Example schema (adjust to match your app if you already have a table)
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'starter',
  status text not null default 'trial',
  billing_cycle text,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: users can read/update only their own row (and service role can do everything for webhooks)
alter table public.subscriptions enable row level security;

create policy "Users can read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can update own subscription"
  on public.subscriptions for update
  using (auth.uid() = user_id);

-- Webhook runs with service role and can insert/update any row
```

If your table or columns differ (e.g. different names or extra columns), adjust the webhook code in `supabase/functions/stripe-webhook/index.ts` to match.

---

## 9. Test the flow

1. Run the app: `npm run dev`.
2. Sign in and go to **Pricing** (or the page that uses `CheckoutForm`).
3. Pick a paid plan and click the subscribe/checkout button.
4. You should be redirected to Stripe Checkout. In Test mode use card `4242 4242 4242 4242`, any future expiry, any CVC, any postal code.
5. After payment, Stripe redirects back to your `success_url` (e.g. `/pricing?subscription=success&session_id=...`). The app will poll the `subscriptions` table and should show the plan as active.
6. In Stripe Dashboard → **Payments** and **Customers** you should see the test payment and customer. Under **Developers → Webhooks** you can open your endpoint and see recent event deliveries and any errors.

---

## 10. Optional: cancel and portal

- **Cancel at period end**: The app already has `setUserCancelAtPeriodEnd` and reads `cancel_at_period_end` from the DB. Your webhook should set this when Stripe sends `customer.subscription.updated` with `cancel_at_period_end: true`.
- **Customer portal** (manage subscription, payment method): You can add a second Edge Function that creates a Stripe Billing Portal session and redirects the user there. Then add a “Manage subscription” link in Settings that calls that function.

---

## Checklist

- [ ] Stripe account created (Test mode for development).
- [ ] API keys copied; publishable key in `.env` as `VITE_STRIPE_PUBLISHABLE_KEY`.
- [ ] Products and Prices created in Stripe; Price IDs copied.
- [ ] Supabase secrets set: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- [ ] Edge Functions deployed: `create-checkout-session`, `stripe-webhook`.
- [ ] Webhook endpoint added in Stripe with correct URL and events; signing secret in Supabase.
- [ ] Price IDs in `src/types/subscription.ts` updated for your country/tiers.
- [ ] `subscriptions` table and RLS in place.
- [ ] Test checkout with card 4242 4242 4242 4242 and confirm subscription becomes active in the app.

If something fails, check the browser console (frontend), Supabase Edge Function logs (Functions → your function → Logs), and Stripe Webhooks → your endpoint → event list and response body.
