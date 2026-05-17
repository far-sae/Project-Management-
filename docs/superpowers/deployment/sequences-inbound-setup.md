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

### 1. Add MX records on `inbound.taskcalendar.co.uk`

In your DNS provider (Cloudflare, Vercel DNS, GoDaddy, etc.) add:

| Host | Type | Value | Priority |
|---|---|---|---|
| `inbound` | MX | `mx.sendgrid.net.` | 10 |

Wait 5–60 minutes for propagation. Verify with:
```
nslookup -type=MX inbound.taskcalendar.co.uk
```
You should see `mx.sendgrid.net` in the response.

### 2. Add the hostname in SendGrid

1. SendGrid dashboard → Settings → **Inbound Parse** → **Add Host & URL**.
2. **Hostname:** `inbound.taskcalendar.co.uk`
3. **Destination URL:** `https://<your-project-ref>.supabase.co/functions/v1/gmail-inbound`
4. **POST the raw, full MIME message:** UNCHECK (we want parsed form fields).
5. **Send signed POSTs:** CHECK.
6. Save.

### 3. Copy the signing key

SendGrid → Inbound Parse → click the hostname row → copy the displayed
**Webhook Verification Key** (base64-encoded public key).

### 4. Set Supabase secrets

```bash
npx supabase secrets set \
  SENDGRID_INBOUND_WEBHOOK_SECRET=<paste-the-key> \
  SEQUENCE_INBOUND_DOMAIN=inbound.taskcalendar.co.uk
```

### 5. Deploy the function

```bash
npx supabase functions deploy gmail-inbound --no-verify-jwt
```

The `--no-verify-jwt` flag is required — SendGrid doesn't send a JWT.

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
- `npx supabase functions logs gmail-inbound` for signature-verification
  failures (means the secret doesn't match what SendGrid signed with).
- DNS MX propagation (`nslookup -type=MX inbound.taskcalendar.co.uk`).
- That the Reply-To header on the original email looks like
  `reply+<uuid>@inbound.taskcalendar.co.uk` — if it's a different
  domain, `SEQUENCE_INBOUND_DOMAIN` was wrong when the email was sent.
