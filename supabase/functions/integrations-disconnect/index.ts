// Edge Function: integrations-disconnect
// POST /integrations-disconnect { provider: "google"|"gmail"|"slack" }
// Best-effort revokes the token at the provider, then marks the row revoked.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { json, preflight } from '../_shared/cors.ts';
import { verifyUser } from '../_shared/auth.ts';
import { getProvider, ProviderId } from '../_shared/providers.ts';
import { decrypt } from '../_shared/crypto.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let auth;
  try {
    auth = await verifyUser(req);
  } catch (r) {
    return r as Response;
  }

  const body = (await req.json().catch(() => ({}))) as { provider?: string };
  const providerId = body.provider as ProviderId;
  if (!providerId) return json({ error: 'provider required' }, 400);

  const tokenKey = Deno.env.get('INTEGRATION_TOKEN_KEY');
  if (!tokenKey) return json({ error: 'Server configuration error' }, 500);

  const { data: row, error } = await auth.supabase
    .from('integrations')
    .select('id, access_token_encrypted')
    .eq('user_id', auth.userId)
    .eq('provider', providerId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!row) return json({ ok: true, note: 'no integration to revoke' });

  const config = getProvider(providerId);
  if (config.revokeUrl) {
    try {
      const accessToken = await decrypt(row.access_token_encrypted, tokenKey);
      await fetch(`${config.revokeUrl}?token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
      });
    } catch (err) {
      console.warn('provider revoke failed (continuing):', err);
    }
  }

  const { error: updateError } = await auth.supabase
    .from('integrations')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (updateError) return json({ error: updateError.message }, 500);

  return json({ ok: true });
});
