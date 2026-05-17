# Sequences — SendGrid Inbound Parse setup

External one-time setup required before `gmail-inbound` Edge Function can
receive reply webhooks.

## Prereqs
- DNS access to `taskcalendar.co.uk` (or your real domain).
- A SendGrid account (https://signup.sendgrid.com — free tier covers 100
  inbound emails/day; $20/mo Essentials plan covers real use).
- The Supabase project deployed with the `gmail-inbound` function live at
  `https://<project>.supabase.co/functions/v1/gmail-inbound`.

## Steps

### 1. Add MX record on `inbound.taskcalendar.co.uk`

In your DNS provider (Cloudflare, GoDaddy, Vercel DNS, etc.) add:

| Host | Type | Value | Priority |
|---|---|---|---|
| `inbound` | MX | `mx.sendgrid.net.` | 10 |

Wait 5–60 minutes for propagation. Verify with:
```
nslookup -type=MX inbound.taskcalendar.co.uk
```
You should see `mx.sendgrid.net` in the response.

### 2. Authenticate your domain in SendGrid

Before SendGrid will let you add an Inbound Parse host, you must
authenticate the domain:

1. SendGrid → **Settings → Sender Authentication → Authenticate Your Domain**.
2. Pick your DNS host, enter `taskcalendar.co.uk`.
3. SendGrid gives you 3 CNAME records — add them to your DNS.
4. Wait 5–30 min, then click **Verify**.

The Inbound Parse "Domain" dropdown only lists authenticated domains.

### 3. Generate a shared secret

The newer SendGrid Inbound Parse UI does not expose a signed-webhook
toggle, so we authenticate via a secret in the destination URL.
Generate a random 32-byte secret:

```powershell
[Convert]::ToBase64String([byte[]](1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Copy the output — you will paste it in **two** places (the URL and the
Supabase secret).

### 4. Add the host in SendGrid

1. SendGrid → **Settings → Inbound Parse → Add Host & URL**.
2. **Subdomain:** `inbound`
3. **Domain:** `taskcalendar.co.uk` (pick from dropdown — only appears
   after step 2).
4. **Destination URL:**
   `https://<your-project-ref>.supabase.co/functions/v1/gmail-inbound?secret=<paste-secret-from-step-3>`
5. **Check incoming emails for spam:** optional (leave UNCHECKED is fine).
6. **POST the raw, full MIME message:** UNCHECKED (we want parsed fields).
7. Click **Add**.

### 5. Set Supabase secrets

```bash
npx supabase secrets set \
  SENDGRID_INBOUND_WEBHOOK_SECRET=<same-secret-from-step-3> \
  SEQUENCE_INBOUND_DOMAIN=inbound.taskcalendar.co.uk
```

The value of `SENDGRID_INBOUND_WEBHOOK_SECRET` must match exactly what's
after `?secret=` in the destination URL — the function compares them in
constant time and rejects requests that don't match.

### 6. Deploy the function

```bash
npx supabase functions deploy gmail-inbound --no-verify-jwt
npx supabase functions deploy crm-run-automations
```

The `--no-verify-jwt` flag is required — SendGrid doesn't send a JWT.
The worker is redeployed so it picks up `SEQUENCE_INBOUND_DOMAIN`.

## Verify end-to-end

1. Create a sequence recipe in Settings → Automations that sends an email
   via Gmail.
2. Trigger it on a test client whose email you control.
3. From the recipient inbox, hit Reply on the message.
4. Within ~1 minute:
   - A row appears in `public.sequence_replies` with your reply body.
   - Any `pending_actions` rows for that recipe run flip from
     `status='pending'` to `status='reply_received'`.
   - In Settings → Sequences, the recipe's "Replies (last 30d)" count
     increments.

If nothing happens, check:
- `npx supabase functions logs gmail-inbound` — look for `unauthorized`
  (secret mismatch) or signature errors.
- DNS MX propagation (`nslookup -type=MX inbound.taskcalendar.co.uk`).
- That the Reply-To header on the original email looks like
  `reply+<uuid>@inbound.taskcalendar.co.uk` — if it's a different
  domain, `SEQUENCE_INBOUND_DOMAIN` was wrong when the email was sent.

## Notes on auth modes

`gmail-inbound` accepts two auth modes (in this order):

1. **`?secret=<value>` query param** — for the standard SendGrid Inbound
   Parse UI (no signed-webhook toggle). The secret is compared in
   constant time against `SENDGRID_INBOUND_WEBHOOK_SECRET`.
2. **ECDSA signature headers** (`x-twilio-email-event-webhook-signature`
   and `…-timestamp`) — for accounts that DO expose signed inbound
   webhooks. In that case the env var holds the base64 public key
   instead of a random secret.

You only need one of them configured. The URL-secret path is the simpler
choice and works on every SendGrid plan.
