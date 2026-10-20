# Social marketing deployment

Apply Supabase migrations `166` through `168` before deploying the frontend.

The publishing function needs these server-only environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INTEGRATION_TOKEN_KEY` (the same 32-byte base64url AES key used by email secrets)
- `CRON_SECRET` or `SOCIAL_WORKER_SECRET`

Optional version overrides are `LINKEDIN_API_VERSION` (YYYYMM) and
`META_GRAPH_VERSION` (for example `v24.0`). Vercel invokes
`/api/social/publish` every five minutes. Access tokens entered in the Social
Accounts screen are encrypted by `/api/social/account-secret`; the browser
cannot read the encrypted-token table.

Provider account identifiers:

- LinkedIn: a person or organization URN.
- Facebook: a Page ID.
- Instagram: an Instagram Business Account ID. Instagram posts also require a
  publicly reachable image URL in the content item.
- X: the account identifier is optional; the user access token determines the
  publishing identity.

Facebook/Instagram and LinkedIn/X apps must be approved by their providers for
the relevant publishing permissions. A token with insufficient scope leaves
the post in `failed` with the provider's error and can be retried after the
connection is repaired.
