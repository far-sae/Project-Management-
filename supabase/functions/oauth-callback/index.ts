// Edge Function: oauth-callback
// GET /oauth-callback?code=...&state=...&error=...
// Verifies state, exchanges code for tokens via the provider, encrypts and
// upserts the row in `integrations`, then 302-redirects the browser back to
// /settings?tab=integrations&connected=<provider>  (or &error=<msg> on failure).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getProvider, ProviderId } from '../_shared/providers.ts';
import { verifyState } from '../_shared/oauth-state.ts';
import { encrypt } from '../_shared/crypto.ts';

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173';
  const successBase = `${appUrl}/settings?tab=integrations`;
  const failureBase = `${appUrl}/settings?tab=integrations&error=`;

  if (providerError) return redirect(`${failureBase}${encodeURIComponent(providerError)}`);
  if (!code || !state) return redirect(`${failureBase}missing_params`);

  const stateSecret = Deno.env.get('OAUTH_STATE_SECRET');
  const tokenKey = Deno.env.get('INTEGRATION_TOKEN_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const redirectUri = Deno.env.get('INTEGRATION_REDIRECT_URI');
  if (!stateSecret || !tokenKey || !supabaseUrl || !serviceKey || !redirectUri) {
    return redirect(`${failureBase}server_misconfigured`);
  }

  let payload;
  try {
    payload = await verifyState(state, stateSecret);
  } catch {
    return redirect(`${failureBase}invalid_state`);
  }

  const config = getProvider(payload.provider as ProviderId);
  const clientId = Deno.env.get(config.clientIdEnv);
  const clientSecret = Deno.env.get(config.clientSecretEnv);
  if (!clientId || !clientSecret) {
    return redirect(`${failureBase}missing_client_credentials`);
  }

  // Exchange code for tokens
  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  if (!tokenRes.ok) {
    return redirect(`${failureBase}token_exchange_failed`);
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    // Slack-specific
    authed_user?: { access_token?: string };
    team?: { id?: string; name?: string };
  };

  // Slack returns its bot/user tokens differently. For now we take the top-level
  // access_token (bot token for Slack, user token for Google). The per-integration
  // plans refine metadata extraction.
  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    return redirect(`${failureBase}no_access_token`);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;
  const scopes = tokenJson.scope ? tokenJson.scope.split(/[ ,]+/) : [];

  const metadata: Record<string, unknown> = {};
  if (tokenJson.team?.id) metadata.team_id = tokenJson.team.id;
  if (tokenJson.team?.name) metadata.team_name = tokenJson.team.name;

  // Upsert by (user_id, provider)
  const { error: upsertError } = await supabase
    .from('integrations')
    .upsert(
      {
        user_id: payload.userId,
        org_id: payload.orgId,
        provider: payload.provider,
        scopes,
        access_token_encrypted: await encrypt(accessToken, tokenKey),
        refresh_token_encrypted: tokenJson.refresh_token
          ? await encrypt(tokenJson.refresh_token, tokenKey)
          : null,
        token_expires_at: expiresAt,
        status: 'active',
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );

  if (upsertError) {
    console.error('integrations upsert failed', upsertError);
    return redirect(`${failureBase}persist_failed`);
  }

  return redirect(`${successBase}&connected=${payload.provider}`);
});
