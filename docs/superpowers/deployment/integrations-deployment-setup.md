# Integrations — Deployment & Secrets Setup

This guide walks through everything you need to do **outside the code** to make the integrations framework actually work in production. Until you finish these steps, the "Connect" buttons in Settings → Integrations will fail with a 401 or 500.

**Time estimate:** ~90 minutes total. Half of that is waiting for Google's brand verification email.

---

## Overview of what we're doing

The framework needs three categories of configuration:

| Category | What it is | Where it lives |
|---|---|---|
| **App secrets** | Random keys used to encrypt OAuth tokens and sign state | Supabase Edge Function secrets |
| **OAuth apps** | App registrations at Google and Slack so users can grant access | Google Cloud Console + Slack API dashboard |
| **Database migration** | The `integrations` and `integration_events` tables | Supabase Postgres (already in `057_integrations_tables.sql`) |

You'll do them in roughly that order.

---

## Step 1 — Generate the framework secrets (5 minutes)

Two random secrets need to exist before anything else works. **Don't reuse keys you've used elsewhere.**

### 1a. `INTEGRATION_TOKEN_KEY` (encrypts OAuth tokens in the database)

This must be exactly 32 random bytes, base64url-encoded.

On macOS / Linux:
```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

On Windows PowerShell:
```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes) -replace '\+','-' -replace '/','_' -replace '=',''
```

Copy the output. Save it somewhere safe (1Password, etc.). **If you lose this, every stored OAuth token becomes garbage and every user has to reconnect.**

### 1b. `OAUTH_STATE_SECRET` (signs the OAuth state parameter)

Any high-entropy string ≥ 32 characters works. Generate with:

```bash
openssl rand -hex 32
```

Or PowerShell:
```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
```

Save it.

---

## Step 2 — Register the Google OAuth app (20 minutes + 1–3 weeks verification wait)

A single Google OAuth app covers both Google Meet (calendar) and Gmail. You only need to register one.

### 2a. Create the Google Cloud project

1. Go to https://console.cloud.google.com
2. Top bar → project dropdown → **New Project**
3. Name it `TaskCalendar` (or similar). Leave organization blank if you don't have one.
4. Create. Wait ~30 seconds for the project to provision.
5. Top bar → make sure the new project is selected.

### 2b. Enable the APIs you need

1. Navigation menu (☰) → **APIs & Services** → **Library**
2. Search for and enable each:
   - **Google Calendar API** (for Meet link generation later)
   - **Gmail API** (for sending emails as the user later)

Each takes ~10 seconds to enable.

### 2c. Configure the OAuth consent screen

1. **APIs & Services** → **OAuth consent screen**
2. **User Type: External** → Create
3. Fill in:
   - **App name:** TaskCalendar
   - **User support email:** your email
   - **App logo:** optional, can add later
   - **App domain → Application home page:** your app URL (e.g., `https://taskcalendar.app`)
   - **Authorized domains:** the bare domain (e.g., `taskcalendar.app`)
   - **Developer contact information:** your email
4. **Save and Continue**

5. **Scopes** screen → **Add or Remove Scopes**. Add only what you'll actually request at first:
   - `https://www.googleapis.com/auth/calendar.events` (Google Meet — sensitive)
   - `https://www.googleapis.com/auth/gmail.send` (Gmail send — sensitive)
   - `openid`, `email`, `profile` (non-sensitive — adds the email to the connected-account label)

   **Do NOT add `gmail.readonly` or `gmail.modify`.** Those are restricted-scope and require a CASA audit (3+ months, $15k+). The Gmail plan in this framework's roadmap explicitly avoids them.

6. **Save and Continue** through Test Users (add your own email for testing) and Summary.

### 2d. Submit for verification (the slow part)

Back on the OAuth consent screen overview, click **Publish App** → confirm. This puts the app in "In production" mode and submits it to Google's review queue.

Because you requested **sensitive** scopes (`calendar.events`, `gmail.send`), Google will email you within 1–7 business days asking for:
- Demo video showing the OAuth flow
- Justification for each scope
- Privacy policy URL (must be public and match the home page domain)
- Domain verification (a TXT record on the home page domain, walked through in the email)

Reply promptly. Total elapsed time is typically **1–3 weeks**. You can continue with everything else in this guide in parallel; just don't expect real Google connections to work in production until the email confirming approval arrives.

**For development/testing, the app works immediately for emails listed under Test Users.**

### 2e. Create the OAuth client credentials

1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
2. **Application type: Web application**
3. **Name:** TaskCalendar OAuth Client
4. **Authorized redirect URIs**: add BOTH of these (so dev and prod both work):
   - `http://localhost:5173/integrations/callback` (Vite dev server)
   - `https://<your-supabase-project-ref>.supabase.co/functions/v1/oauth-callback` (production Edge Function)

   Replace `<your-supabase-project-ref>` with the slug from your Supabase project URL.
5. Click **Create**.
6. A dialog shows **Client ID** and **Client secret**. **Copy both immediately** — the secret is shown only once. Save in 1Password etc.

You now have `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

---

## Step 3 — Register the Slack app (15 minutes, no audit needed)

Slack is much faster — no review, no audit, instant install.

### 3a. Create the Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. **App Name:** TaskCalendar
3. **Pick a workspace** → your test workspace
4. Create App.

### 3b. Configure OAuth scopes

1. Left sidebar → **OAuth & Permissions**
2. Scroll to **Bot Token Scopes** → **Add an OAuth Scope**. Add these:
   - `chat:write` (post messages)
   - `chat:write.public` (post in channels the bot isn't a member of — optional but useful)
   - `commands` (slash commands)
   - `channels:read` (list public channels for the channel picker)
   - `groups:read` (list private channels)
   - `users:read` (resolve user IDs to names)

3. Scroll to **Redirect URLs** → **Add New Redirect URL**. Add the same Supabase callback URL:
   - `https://<your-supabase-project-ref>.supabase.co/functions/v1/oauth-callback`
4. **Save URLs**.

### 3c. Configure event subscriptions (for inbound Slack events used by the Slack plan later)

1. Left sidebar → **Event Subscriptions** → toggle ON
2. **Request URL:** `https://<your-supabase-project-ref>.supabase.co/functions/v1/integrations-webhook?provider=slack`
   - Slack will hit this URL with a `url_verification` challenge. The current `integrations-webhook` function will respond 200 with `{ok: true}`, but Slack expects the `challenge` value echoed back. **You can skip event subscriptions for now** — they're only needed when the Slack plan adds the message-action feature. Or update `integrations-webhook` later to handle the verification.
3. For now: leave Event Subscriptions OFF until the Slack plan implementation.

### 3d. Configure slash commands (for the Slack plan later)

Skip for now. The Slack plan will walk you through `/taskcalendar new` command setup.

### 3e. Get the Slack credentials

1. Left sidebar → **Basic Information** → scroll to **App Credentials**
2. Copy **Client ID** → save as `SLACK_CLIENT_ID`
3. Click **Show** next to **Client Secret** → save as `SLACK_CLIENT_SECRET`
4. Also note **Signing Secret** — save as `SLACK_SIGNING_SECRET`. You'll need it when the Slack plan adds webhook signature verification.

You now have `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_SIGNING_SECRET` (for later use).

---

## Step 4 — Decide your inbound email provider (Gmail plan only — skip for now)

The Gmail plan needs an inbound email service to receive replies. **You don't need this until you ship the Gmail integration.** When the time comes, the default recommendation is **SendGrid Inbound Parse**:

1. Create SendGrid account (free tier: 100 emails/day inbound; paid: $20/mo for 40k/mo).
2. Verify your domain (`taskcalendar.app` or similar) by adding the MX records SendGrid provides.
3. Set up an Inbound Parse webhook at `https://<your-supabase-project-ref>.supabase.co/functions/v1/integrations-webhook?provider=gmail-inbound`
4. Save the SendGrid API key as `SENDGRID_API_KEY` and the inbound webhook signing secret as `SENDGRID_INBOUND_SECRET`.

Postmark Inbound and Cloudflare Email Workers are interchangeable alternatives.

**Defer this entire step until you start the Gmail plan.**

---

## Step 5 — Set Supabase secrets (5 minutes)

You should now have these secrets ready:
- `INTEGRATION_TOKEN_KEY` (from Step 1a)
- `OAUTH_STATE_SECRET` (from Step 1b)
- `GOOGLE_CLIENT_ID` (from Step 2e)
- `GOOGLE_CLIENT_SECRET` (from Step 2e)
- `SLACK_CLIENT_ID` (from Step 3e)
- `SLACK_CLIENT_SECRET` (from Step 3e)

Plus two URLs you already know:
- `INTEGRATION_REDIRECT_URI` = `https://<your-supabase-project-ref>.supabase.co/functions/v1/oauth-callback`
- `APP_URL` = your production app URL (e.g., `https://taskcalendar.app`)

For **local development**, set the same secrets in `supabase/.env.local` with `APP_URL=http://localhost:5173` and `INTEGRATION_REDIRECT_URI=http://localhost:54321/functions/v1/oauth-callback`.

### Set production secrets

From the project root:

```bash
npx supabase secrets set \
  INTEGRATION_TOKEN_KEY="<your value>" \
  OAUTH_STATE_SECRET="<your value>" \
  GOOGLE_CLIENT_ID="<your value>" \
  GOOGLE_CLIENT_SECRET="<your value>" \
  SLACK_CLIENT_ID="<your value>" \
  SLACK_CLIENT_SECRET="<your value>" \
  INTEGRATION_REDIRECT_URI="https://<project-ref>.supabase.co/functions/v1/oauth-callback" \
  APP_URL="https://<your app URL>"
```

Verify with:
```bash
npx supabase secrets list
```

All 8 names should appear (values hidden). The standard built-ins `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase — don't set them yourself.

### Set local-dev secrets (optional, for `supabase functions serve`)

Create `supabase/.env.local` (gitignored — DO NOT commit):

```
INTEGRATION_TOKEN_KEY=<your value>
OAUTH_STATE_SECRET=<your value>
GOOGLE_CLIENT_ID=<your value>
GOOGLE_CLIENT_SECRET=<your value>
SLACK_CLIENT_ID=<your value>
SLACK_CLIENT_SECRET=<your value>
INTEGRATION_REDIRECT_URI=http://localhost:54321/functions/v1/oauth-callback
APP_URL=http://localhost:5173
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<your local service-role key from supabase status>
```

Check `.gitignore` — the file `supabase/.env.local` should already be ignored.

---

## Step 6 — Deploy the Edge Functions (5 minutes)

The framework code is on `main` after the merge. Deploy the 5 new Edge Functions to your Supabase project:

```bash
npx supabase functions deploy oauth-start
npx supabase functions deploy oauth-callback
npx supabase functions deploy integrations-disconnect
npx supabase functions deploy integrations-action
npx supabase functions deploy integrations-webhook
```

Or all at once if your CLI supports it:
```bash
npx supabase functions deploy oauth-start oauth-callback integrations-disconnect integrations-action integrations-webhook
```

Each deploy takes ~10–30 seconds and prints the deployed URL.

---

## Step 7 — Apply the database migration (2 minutes)

```bash
npx supabase db push --linked
```

This applies `057_integrations_tables.sql` to your production database. Verify in the Supabase dashboard → **Table Editor** that `integrations` and `integration_events` now exist.

If you've already been running `npx supabase db reset --linked` for local dev, you've already got the tables locally.

---

## Step 8 — Smoke test (10 minutes)

1. `npm run dev` from the project root → opens `http://localhost:5173`
2. Log in to TaskCalendar as a test user
3. Navigate to **Settings → Integrations**
4. You should see three provider cards: Google Meet, Gmail, Slack — all showing "Not connected"
5. Click **Connect Google Meet** (or Slack, which is faster to test)
6. You should be redirected to the provider's OAuth consent screen showing your TaskCalendar app
7. Grant consent
8. You should land back on `/settings?tab=integrations&connected=google` (or slack)
9. The card status should now show "Connected" with the connected account name

If any of those steps fail, check the Supabase Edge Function logs:
```bash
npx supabase functions logs oauth-start
npx supabase functions logs oauth-callback
```

Common errors:
- `Server configuration error` (500) — a secret isn't set. Re-run `supabase secrets list` and confirm all 8 exist.
- `invalid_state` (302 to error) — `OAUTH_STATE_SECRET` differs between `oauth-start` and `oauth-callback`. Make sure the secret has been set and the functions have been redeployed AFTER setting it.
- `redirect_uri_mismatch` from Google → the `INTEGRATION_REDIRECT_URI` you set in Supabase secrets must exactly match the one you registered in the Google Cloud Console (Step 2e). Trailing slashes matter.
- Slack `bad_redirect_uri` → same thing, check it matches Step 3b.

---

## Step 9 — Production verification (when ready to ship)

Repeat Step 8 against your production URL. Verify:
- Tokens are encrypted in the `integrations` table (the `access_token_encrypted` column should be a long opaque base64 string, NOT readable plaintext)
- Disconnecting in Settings actually clears the status (status row stays but `status='revoked'`)
- A second connect from the same user **replaces** the prior row (no duplicates)

---

## Quick reference — checklist

```
[ ] Step 1a: Generate INTEGRATION_TOKEN_KEY
[ ] Step 1b: Generate OAUTH_STATE_SECRET
[ ] Step 2a–2c: Google Cloud project + APIs enabled + consent screen filled
[ ] Step 2d: Submit Google for verification (long lead time)
[ ] Step 2e: Create Google OAuth client → save GOOGLE_CLIENT_ID / SECRET
[ ] Step 3a–3b: Slack app + scopes + redirect URL configured
[ ] Step 3e: Save SLACK_CLIENT_ID / SECRET / SIGNING_SECRET
[ ] Step 5: All 8 secrets set in Supabase
[ ] Step 6: 5 Edge Functions deployed
[ ] Step 7: Migration 057 applied
[ ] Step 8: Local smoke test passes for at least Slack (Google may be pending verification)
[ ] Step 9: Production smoke test (after Google verification clears)
```

When this checklist is complete, the framework is live and ready to accept the per-provider feature implementations from the integrations plan.
