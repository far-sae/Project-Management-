# Stripe payment setup – simple steps

Follow these steps one by one. Do not skip any step.

---

## PART 1: Get your Stripe account ready

### Step 1: Open Stripe
- Go to: **https://stripe.com**
- Click **Sign in** (or **Start now** if you don’t have an account).
- Create an account or log in.

### Step 2: Turn on Test mode
- Look at the **top-right** of the Stripe page.
- You will see a switch that says **Test mode**.
- Turn it **ON** (so it’s blue/green).  
  → In Test mode you can try payments without using real money.

### Step 3: Get your two keys
- On the left side, click **Developers**.
- Then click **API keys**.
- You will see two keys:

  **Key 1 – Publishable key**
  - It starts with `pk_test_` or `pk_live_`.
  - Click **Reveal** and then **Copy**.
  - Paste it into a Notepad file and write next to it: **“Publishable key”**.  
  → You will use this in your website code (it’s safe to use in the frontend).

  **Key 2 – Secret key**
  - It starts with `sk_test_` or `sk_live_`.
  - Click **Reveal** and then **Copy**.
  - Paste it into the same Notepad and write: **“Secret key”**.  
  → You will use this only in Supabase (never put it on the website or in public).

---

## PART 2: Create your two paid plans in Stripe

You have **Basic** and **Advanced** plans. You will create one “product” for each in Stripe.

---

### Step 4: Create the Basic plan product

- On the left, click **Product catalog**.
- Click the button **+ Add product**.

**Fill in:**
- **Name:** type: `TaskCalander Basic`
- **Description (optional):** e.g. `For students and individuals`

**Add the first price (normal monthly):**
- Under **Pricing**, click **Add another price** (or **Add a price**).
- Choose **Standard pricing**.
- **Price:** type `7.99`
- **Currency:** select **GBP (£)** (British pounds).
- **Billing period:** select **Monthly**.
- Click **Save**.  
  → After saving, you will see a **Price ID** (something like `price_1ABC123...`). **Copy it** and in Notepad write: **“Basic – monthly £7.99”** and paste the ID under it.

**Add the second price (promo £5 for 3 months):**
- On the same product page, click **Add another price** again.
- **Price:** type `5.00`
- **Currency:** GBP (£).
- **Billing period:** Monthly.
- Click **Save**.  
  → Copy the new **Price ID** and in Notepad write: **“Basic – promo £5/month”** and paste the ID.

**Add the third price (yearly):**
- Click **Add another price** again.
- **Price:** type `63.90`
- **Currency:** GBP (£).
- **Billing period:** select **Yearly**.
- Click **Save**.  
  → Copy the **Price ID** and in Notepad write: **“Basic – yearly £63.9”** and paste the ID.

You should now have **3 Price IDs** written down for Basic.

---

### Step 5: Create the Advanced plan product

- Go back to **Product catalog** (left side).
- Click **+ Add product** again.

**Fill in the product:**
- **Name:** `TaskCalander Advanced`
- **Description (optional):** e.g. `For growing teams up to 10`

**Pricing model:** For each price you add, use **Standard** (simple flat price). If Stripe only shows **Tiered** and **Volume**, choose **Tiered** and set **one tier**: First unit **1**, Last unit **∞**, **Flat fee** = the price (e.g. 50), **Per unit** = 0.

**Add the first price (normal monthly £50):**
- **Recurring** → **Standard** (or Tiered with one tier, Flat fee **50**).
- **Amount:** `50.00` | **Currency:** GBP | **Billing period:** Monthly.
- Save. Copy **Price ID**, in Notepad write: **“Advanced – monthly £50”** and paste the ID.

**Add the second price (promo £45 first month):**
- Add another price: **£45.00**, **GBP**, **Monthly**. Save.  
  → Copy **Price ID**, in Notepad write: **“Advanced – promo £45/month”** and paste the ID.

**Add the third price (yearly £480):**
- Add another price: **£480.00**, **GBP**, **Yearly**. Save.  
  → Copy **Price ID**, in Notepad write: **“Advanced – yearly £480”** and paste the ID.

**Add the fourth price (extra member £2.99):**
- Add another price: **£2.99**, **GBP**, **Monthly**. Save.  
  → Copy **Price ID**, in Notepad write: **“Advanced – extra member £2.99”** and paste the ID.

You should now have **4 more Price IDs** written down for Advanced (7 Price IDs in total for Basic + Advanced).

---

## If you deploy on Vercel

Your **frontend** runs on Vercel. Stripe **checkout** and **webhooks** still run on **Supabase** (Edge Functions). Do this:

**1. Add environment variables in Vercel**
- Go to [vercel.com](https://vercel.com) → your project → **Settings** → **Environment Variables**.
- Add the same variables your app needs (at least these for Stripe and Supabase):
  - **Name:** `VITE_STRIPE_PUBLISHABLE_KEY`  
    **Value:** your Stripe **Publishable** key (e.g. `pk_test_...`).  
    Enable for **Production**, **Preview**, and **Development**.
  - Also add your other `VITE_*` and Supabase vars if you use them (e.g. `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Save. Then do a **new deployment** (Redeploy) so the new env vars are used.

**2. You still must deploy the payment functions to Supabase (Part 5, Steps 11–13)**
- Vercel only hosts your **frontend**. The “Get Started” button calls **Supabase** to create the Stripe checkout; Stripe then sends webhooks to **Supabase**, not Vercel.
- So you **must** do Part 5: install Supabase CLI, link your project, and run:
  - `supabase functions deploy create-checkout-session`
  - `supabase functions deploy stripe-webhook`
- The **Secret key** stays in **Supabase** (Project Settings → Edge Functions → Secrets), not in Vercel.
- **Stripe webhook** URL is: `https://YOUR_SUPABASE_REF.supabase.co/functions/v1/stripe-webhook` (Supabase).

So: **Vercel** = frontend + `VITE_STRIPE_PUBLISHABLE_KEY`. **Supabase** = Stripe secret, checkout function, webhook function, and subscription updates. Steps 11–13 are required even when you deploy on Vercel.

---

## PART 3: Put the keys and Price IDs into your project

### Step 6: Put the Publishable key in your website

- Open your project folder on your computer.
- Find the file named **`.env`** (in the main project folder, same place as `package.json`).
- If there is no `.env`, create a new text file and name it exactly: **`.env`**
- Open `.env` in a text editor.
- Add this line (replace the key with your real Publishable key from Notepad):

```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx
```

- Save the file.
- If your app is already running, **stop it** (Ctrl+C in the terminal) and start it again: `npm run dev`.

---

### Step 7: Put the Secret key and Price IDs in Supabase

**7a – Secret key in Supabase**
- Go to **https://supabase.com** and log in.
- Open **your project** (the one you use for TaskCalander).
- Click **Project Settings** (gear icon, bottom left).
- Click **Edge Functions** in the left menu.
- Find **Secrets** (or **Function secrets**).
- Click **Add new secret** (or similar).
  - **Name:** `STRIPE_SECRET_KEY`
  - **Value:** paste your **Secret key** from Notepad (the one that starts with `sk_test_`).
- Save.

**7b – Price IDs in your code**
- In your project, open the file: **`src/types/subscription.ts`**
- Press Ctrl+F (or Cmd+F) and search for: **`DEFAULT_PRICING`**
- You will see a block with **basic** and **advanced** and lines like `stripePriceIdMonthly: "price_..."`.
- Replace **only** those `"price_..."` values with the Price IDs from your Notepad, like this:

**For Basic**, replace:
- `stripePriceIdMonthly` → use the ID you wrote as “Basic – monthly £7.99”
- `stripePriceIdMonthlyPromo` → use “Basic – promo £5/month”
- `stripePriceIdYearly` → use “Basic – yearly £63.9”

**For Advanced**, replace:
- `stripePriceIdMonthly` → use “Advanced – monthly £50”
- `stripePriceIdMonthlyPromo` → use “Advanced – promo £45/month”
- `stripePriceIdYearly` → use “Advanced – yearly £480”
- `extraUserPriceId` → use “Advanced – extra member £2.99”

- Save the file.

---

## PART 4: Turn on the webhook (so Stripe can tell your app when someone paid)

### Step 8: Get your Supabase project URL

- In Supabase, stay in **Project Settings**.
- Click **General** (left menu).
- Find **Reference ID** or **Project URL**.
- Your project URL looks like: `https://abcdefghijk.supabase.co`
- The part **abcdefghijk** is your “project ref”. Copy it. You will need it in the next step.

### Step 9: Add the webhook in Stripe

- Go back to **Stripe** (https://dashboard.stripe.com).
- On the left, click **Developers**.
- Click **Webhooks**.
- Click **Add endpoint**.

**Endpoint URL:** type exactly (replace `YOUR_PROJECT_REF` with the ref you copied):

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

Example: if your ref is `xyzabc123`, then the URL is:
`https://xyzabc123.supabase.co/functions/v1/stripe-webhook`

**Events to send:** click **Select events**. Then select these 3 (tick the box next to each):
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Click **Add endpoint**.

### Step 10: Copy the webhook secret into Supabase

- After you added the endpoint, Stripe will show the new webhook. Click on it.
- Find **Signing secret**. Click **Reveal** and then **Copy**.
- Go back to **Supabase** → **Project Settings** → **Edge Functions** → **Secrets**.
- Click **Add new secret**:
  - **Name:** `STRIPE_WEBHOOK_SECRET`
  - **Value:** paste the signing secret you just copied (it starts with `whsec_`).
- Save.

---

## PART 5: Deploy the payment functions to Supabase (one-time)

**Yes, you need this even if you deploy your app on Vercel.** Vercel hosts only the frontend. Creating the Stripe checkout and receiving webhooks happens on **Supabase** (Edge Functions), so these two functions must be deployed to Supabase.

Your project already has the code for “create checkout” and “receive webhook”. You only need to deploy them to Supabase once.

### Step 11: Install Supabase CLI (if you don’t have it)

**Important:** `npm install -g supabase` does **not** work (Supabase no longer supports it). Use one of the options below.

**Windows (PowerShell):**

**Option A – Using Scoop (recommended)**  
1. Install Scoop first (run in PowerShell):
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   iwr -useb get.scoop.sh | iex
   ```
2. Then install Supabase CLI:
   ```powershell
   scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
   scoop install supabase
   ```

**Option B – Direct download**  
- Go to: https://github.com/supabase/cli/releases  
- Download the latest **Windows** `.zip` (e.g. `supabase_windows_amd64.zip`), unzip it, and put `supabase.exe` in a folder that’s in your PATH, or run it from that folder.

**Mac:**
```bash
brew install supabase/tap/supabase
```

After installing, close and reopen the terminal, then run `supabase --version` to confirm.

### Step 12: Log in and link your project

- In the terminal, go to your project folder, for example:
  ```bash
  cd c:\Users\faraz\Downloads\freelance1-main\freelance1-main
  ```
- Run:
  ```bash
  supabase login
  ```
  → A browser will open; log in with your Supabase account.
- Then run (replace `YOUR_PROJECT_REF` with the ref from Step 8):
  ```bash
  supabase link --project-ref YOUR_PROJECT_REF
  ```

### Step 13: Deploy the two functions

- In the same project folder, run these two commands one after the other:

```bash
supabase functions deploy create-checkout-session
```

Wait until it says “Deployed”. Then:

```bash
supabase functions deploy stripe-webhook
```

Wait until it says “Deployed”.

You only need to do Step 11–13 once (unless you change the function code later).

---

## PART 6: Test that it works

### Step 14: Run your app and try a payment

- In your project folder run: **`npm run dev`**
- Open the app in the browser (e.g. http://localhost:5173).
- Log in.
- Go to the **Pricing** page (same as in your plan screenshots).
- Click **Get Started** on **Basic** or **Advanced** (Monthly or Yearly).
- You should be sent to a Stripe payment page.
- Use this **test card**: **4242 4242 4242 4242**
  - Expiry: any future date (e.g. 12/30)
  - CVC: any 3 digits (e.g. 123)
  - Name and address: anything
- Click **Pay**.
- You should be sent back to your app and the plan should show as active.

If that works, Stripe is set up correctly.

---

## Summary checklist

- [ ] Step 1–3: Stripe account, Test mode ON, both keys copied to Notepad  
- [ ] Step 4: Basic product with 3 prices, 3 Price IDs in Notepad  
- [ ] Step 5: Advanced product with 4 prices, 4 Price IDs in Notepad  
- [ ] Step 6: Publishable key in `.env`, app restarted  
- [ ] Step 7: Secret key in Supabase secrets; all Price IDs in `src/types/subscription.ts`  
- [ ] Step 8–10: Webhook added in Stripe, webhook secret in Supabase  
- [ ] Step 11–13: Supabase CLI, link project, deploy both functions  
- [ ] Step 14: Test payment with card 4242 4242 4242 4242  

If you get stuck, say which step number you are on and what you see on the screen (or the error message), and we can fix it step by step.

---

## Troubleshooting

**"create-checkout-session" returns 401**
- The project now has `supabase/config.toml` with `verify_jwt = false` for the checkout and webhook functions. **Redeploy both functions** so the change takes effect:
  ```powershell
  cd path\to\freelance1-main\freelance1-main
  supabase functions deploy create-checkout-session
  supabase functions deploy stripe-webhook
  ```
- Make sure you are **logged in** when you click Get Started. If you still get 401 after redeploying, use the flag:
  ```powershell
  supabase functions deploy create-checkout-session --no-verify-jwt
  ```

**Activity request returns 400**
- The `activity` table may not exist in your Supabase project yet. The app will show "No activity" instead of failing. To enable activity logging, create an `activity` table in Supabase with columns matching the app (e.g. `activity_id`, `task_id`, `project_id`, `organization_id`, `type`, `user_id`, `created_at`, etc.) and enable RLS as needed.
