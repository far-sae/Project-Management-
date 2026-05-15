// Edge Function: integrations-action
// POST /integrations-action { provider, action, payload }
// Dispatcher for provider-specific actions. Phase 1 ships only `whoami`
// (returns the connected account's metadata) so the framework is end-to-end
// verifiable. Per-integration plans (Meet, Gmail, Slack) extend the action map.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { json, preflight } from '../_shared/cors.ts';
import { verifyUser } from '../_shared/auth.ts';
import { getProviderTokens } from '../_shared/tokens.ts';
import { ProviderId } from '../_shared/providers.ts';

type ActionHandler = (args: {
  userId: string;
  // deno-lint-ignore no-explicit-any
  supabase: any;
  // deno-lint-ignore no-explicit-any
  payload: any;
  tokens: Awaited<ReturnType<typeof getProviderTokens>>;
  // deno-lint-ignore no-explicit-any
}) => Promise<any>;

const actions: Record<string, ActionHandler> = {
  // 'whoami' is intentionally minimal: it proves auth + token decryption work.
  whoami: async ({ tokens }) => ({
    scopes: tokens.scopes,
    expiresAt: tokens.expiresAt,
    metadata: tokens.metadata,
  }),
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let auth;
  try {
    auth = await verifyUser(req);
  } catch (r) {
    return r as Response;
  }

  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    action?: string;
    payload?: unknown;
  };
  if (!body.provider || !body.action) {
    return json({ error: 'provider and action required' }, 400);
  }

  const handler = actions[body.action];
  if (!handler) return json({ error: `Unknown action: ${body.action}` }, 400);

  let tokens;
  try {
    tokens = await getProviderTokens(
      auth.supabase,
      auth.userId,
      body.provider as ProviderId,
    );
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }

  try {
    const result = await handler({
      userId: auth.userId,
      supabase: auth.supabase,
      payload: body.payload,
      tokens,
    });
    return json({ ok: true, result });
  } catch (err) {
    console.error('action failed', err);
    return json({ error: (err as Error).message }, 500);
  }
});
