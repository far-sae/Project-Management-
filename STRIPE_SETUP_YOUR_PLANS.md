# Stripe setup for your TaskCalendar plans (step-by-step)

This guide matches **your** subscription plans (Starter, Basic, Advanced, Premium) in **GBP (£)** and walks you through setting them up in Stripe.

---

## Your plans (reference)

| Plan      | Monthly        | Promo              | Yearly   | Extra                    |
|----------|----------------|--------------------|----------|--------------------------|
| **Starter**  | Free           | —                  | —        | —                        |
| **Basic**    | £7.99          | £5 for first 3 months | £63.9  | —                        |
| **Advanced** | £50            | £45 for first month   | £480   | +£2.99/member beyond 10   |
| **Premium**  | Contact you    | —                  | —        | —                        |

Starter = no Stripe. Premium = “Talk to Us” (no checkout). You only create **Products & Prices** in Stripe for **Basic** and **Advanced**.

---

## Step 1: Create a Stripe account and get keys

1. Go to [https://stripe.com](https://stripe.com) and sign up or log in.
2. Turn **Test mode** ON (top-right) for development. Use **Live mode** when you’re ready for real payments.
3. Go to **Developers → API keys**.
4. Copy:
   - **Publishable key** (e.g. `pk_test_...`) → for your frontend.
   - **Secret key** (e.g. `sk_test_...`) → only for the backend; never put it in the app or in git.

---

## Step 2: Create Products and Prices in Stripe (GBP)

You will create **2 products**: Basic and Advanced. Each product will have **several prices** (monthly, monthly promo, yearly; Advanced also has “per member beyond 10”).

### 2.1 Product: TaskCalendar Basic

1. In Stripe Dashboard go to **Product catalog → Add product**.
2. **Name:** `TaskCalendar Basic`
3. **Description:** e.g. *For students & individuals*
4. **Pricing – add 3 prices** (use **Recurring** and **British pound (£)**):

   | Price type        | Amount  | Billing period | Note                    |
   |-------------------|---------|----------------|-------------------------|
   | Standard monthly  | £7.99   | Monthly        | Default monthly         |
   | Promo monthly     | £5.00   | Monthly        | “First 3 months offer”  |
   | Yearly            | £63.90  | Yearly         | Save 2 months           |

5. For each price, after you save, copy the **Price ID** (e.g. `price_1ABC...`). You’ll need all three later.

### 2.2 Product: TaskCalendar Advanced

1. **Product catalog → Add product**.
2. **Name:** `TaskCalendar Advanced`
3. **Description:** e.g. *For growing teams up to 10*
4. **Pricing – add 4 prices** (all **Recurring**, **GBP**):

   | Price type         | Amount | Billing period | Note                     |
   |--------------------|--------|----------------|--------------------------|
   | Standard monthly   | £50.00 | Monthly        | Default monthly          |
   | Promo monthly      | £45.00 | Monthly        | “First month offer”      |
   | Yearly             | £480.00| Yearly         | Save 2 months            |
   | Extra member       | £2.99  | Monthly        | Per member beyond 10     |

5. Copy each **Price ID** (you’ll use the extra-member one for “+£2.99/member beyond 10” in the app config).

**Promo behaviour:** The app shows “£5 for first 3 months” and “£45 for first month” by using the **promo** Price IDs when the user selects monthly. The actual “first 3 months” or “first 1 month” discount is applied by sending the customer to that price in Checkout. For a true 3‑month or 1‑month discount, you can later add a [Stripe Coupon](https://dashboard.stripe.com/coupons) and attach it in your Edge Function; for now, using the lower price (e.g. £5) as the first price is enough.

---

## Step 3: Add keys and webhook secret to your project

### Frontend (.env)

In your project root, create or edit `.env`:

```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
```

Restart the dev server after changing `.env`.

### Supabase (Edge Function secrets)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Project Settings → Edge Functions**.
2. Under **Secrets**, add:
   - **STRIPE_SECRET_KEY** = your Stripe **secret** key (`sk_test_...` or `sk_live_...`).
   - **STRIPE_WEBHOOK_SECRET** = leave empty for now; you’ll set it in Step 5 after creating the webhook.

---

## Step 4: Deploy the Edge Functions

Your repo has two Supabase Edge Functions that talk to Stripe:

- `create-checkout-session` – creates the Stripe Checkout link when the user clicks “Get Started”.
- `stripe-webhook` – receives Stripe events and updates the `subscriptions` table.

From the **project root** (folder that contains `supabase/functions`):

```bash
supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

You can find **YOUR_SUPABASE_PROJECT_REF** in Supabase under **Project Settings → General**.

---

## Step 5: Create the Stripe webhook

1. In Stripe Dashboard go to **Developers → Webhooks**.
2. Click **Add endpoint**.
3. **Endpoint URL:**  
   `https://YOUR_SUPABASE_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`  
   (replace with your real project ref).
4. **Events to send:** click **Select events** and add:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**.
6. Open the new endpoint and click **Reveal** under **Signing secret**. Copy the value (e.g. `whsec_...`).
7. In Supabase (**Project Settings → Edge Functions → Secrets**) add or update:
   - **STRIPE_WEBHOOK_SECRET** = that signing secret.

---

## Step 6: Put your Price IDs into the app

The app reads Price IDs from `src/types/subscription.ts`. For **GBP (UK / default)** you use **DEFAULT_PRICING**.

1. Open `src/types/subscription.ts`.
2. Find the block **DEFAULT_PRICING** (around the line that says `// ── GBP Pricing (UK / International)`).
3. Replace the placeholder `stripePriceId*` values with the **Price IDs** you copied from Stripe:

**Basic:**

- `stripePriceIdMonthly` → Price ID for **£7.99/month**.
- `stripePriceIdMonthlyPromo` → Price ID for **£5/month** (first 3 months offer).
- `stripePriceIdYearly` → Price ID for **£63.9/year**.

**Advanced:**

- `stripePriceIdMonthly` → Price ID for **£50/month**.
- `stripePriceIdMonthlyPromo` → Price ID for **£45/month** (first month offer).
- `stripePriceIdYearly` → Price ID for **£480/year**.
- `extraUserPriceId` → Price ID for **£2.99/month** (per member beyond 10).

Example (your IDs will be different):

```ts
basic: {
  monthly: 7.99,
  monthlyPromo: 5.0,
  promoMonths: 3,
  yearly: 63.9,
  stripePriceIdMonthly: "price_xxxxxxxxxxxx",      // £7.99/month
  stripePriceIdMonthlyPromo: "price_xxxxxxxxxxxx", // £5/month promo
  stripePriceIdYearly: "price_xxxxxxxxxxxx",       // £63.9/year
  // ... rest unchanged
},
advanced: {
  monthly: 50.0,
  monthlyPromo: 45.0,
  promoMonths: 1,
  yearly: 480.0,
  stripePriceIdMonthly: "price_xxxxxxxxxxxx",      // £50/month
  stripePriceIdMonthlyPromo: "price_xxxxxxxxxxxx", // £45/month promo
  stripePriceIdYearly: "price_xxxxxxxxxxxx",       // £480/year
  extraUserPriceId: "price_xxxxxxxxxxxx",          // £2.99/member beyond 10
  extraUserPrice: 2.99,
  // ... rest unchanged
},
```

4. Save the file. Do **not** change Starter or Premium – they stay free / “Talk to Us” and have no Stripe Price IDs.

---

## Step 7: Make sure the `subscriptions` table exists

In Supabase go to **SQL Editor** and run (only if you don’t already have this table):

```sql
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

alter table public.subscriptions enable row level security;

create policy "Users can read own subscription"
  on public.subscriptions for select using (auth.uid() = user_id);

create policy "Users can update own subscription"
  on public.subscriptions for update using (auth.uid() = user_id);
```

Your webhook runs with the service role and can insert/update any row.

---

## Step 8: Test the flow

1. Run the app: `npm run dev`.
2. Sign in and open the **Pricing** page (same as in your screenshots).
3. Choose **Basic** or **Advanced**, then **Monthly** or **Yearly**.
4. Click **Get Started**. You should be redirected to Stripe Checkout.
5. In **Test mode** use card: `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.
6. After payment, you should be redirected back and the app should show the plan as active (it polls the `subscriptions` table).

**Starter:** “Use Free Plan” does not call Stripe.  
**Premium:** “Talk to Us” can open an email to `smtkur31@gmail.com` and does not need Stripe checkout.

---

## Quick checklist

- [ ] Stripe account created; Test mode used for development.
- [ ] Product “TaskCalendar Basic” with 3 prices (£7.99, £5, £63.9) and IDs copied.
- [ ] Product “TaskCalendar Advanced” with 4 prices (£50, £45, £480, £2.99) and IDs copied.
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` in `.env`.
- [ ] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` set in Supabase Edge Function secrets.
- [ ] Edge Functions `create-checkout-session` and `stripe-webhook` deployed.
- [ ] Webhook endpoint added in Stripe with the 3 events; signing secret in Supabase.
- [ ] Price IDs in `src/types/subscription.ts` (DEFAULT_PRICING) updated for Basic and Advanced.
- [ ] `subscriptions` table and RLS in place.
- [ ] Test checkout with 4242 4242 4242 4242 and confirm plan activates.

If something fails, check: browser console, Supabase **Edge Function logs**, and Stripe **Developers → Webhooks → your endpoint** for failed events and errors.
