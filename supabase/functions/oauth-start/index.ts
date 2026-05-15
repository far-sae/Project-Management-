// Edge Function: oauth-start
// POST /oauth-start  { provider: "google" | "gmail" | "slack", scopes?: string[], orgId?: string }
// Returns { authUrl: string }
//
// The client redirects the browser to authUrl. After consent the provider
// redirects back to <INTEGRATION_REDIRECT_URI>?code=...&state=... which is
// served by the oauth-callback function.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, json, preflight } from '../_shared/cors.ts';
import { verifyUser } from '../_shared/auth.ts';
import { getProvider, ProviderId } from '../_shared/providers.ts';
import { signState } from '../_shared/oauth-state.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let auth;
  try {
    auth = await verifyUser(req);
  } catch (r) {
    return r as Response;
  }

  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    scopes?: string[];
    orgId?: string | null;
  };
  const providerId = body.provider as ProviderId;
  if (!providerId) return json({ error: 'provider required' }, 400);

  let config;
  try {
    config = getProvider(providerId);
  } catch {
    return json({ error: `Unknown provider: ${providerId}` }, 400);
  }

  const clientId = Deno.env.get(config.clientIdEnv);
  const redirectUri = Deno.env.get('INTEGRATION_REDIRECT_URI');
  const stateSecret = Deno.env.get('OAUTH_STATE_SECRET');
  if (!clientId || !redirectUri || !stateSecret) {
    return json({ error: 'Server configuration error' }, 500);
  }

  const scopes = body.scopes && body.scopes.length > 0 ? body.scopes : config.scopes;
  const nonce = crypto.randomUUID();
  const state = await signState(
    {
      userId: auth.userId,
      orgId: body.orgId ?? null,
      provider: providerId,
      nonce,
    },
    stateSecret,
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    ...(config.extraAuthParams ?? {}),
  });

  // Slack uses comma-separated scopes in user_scope / scope params, not space-separated.
  // It accepts space-separated for bot scopes ('scope') and is the spec; we keep space here.
  // Per-integration plans can override scope formatting if needed.

  return json({ authUrl: `${config.authUrl}?${params.toString()}` }, 200, corsHeaders);
});
