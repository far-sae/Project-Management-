import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { decrypt, encrypt } from './crypto.ts';
import { getProvider, ProviderId } from './providers.ts';

export interface IntegrationTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  metadata: Record<string, unknown>;
}

interface IntegrationRow {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  status: string;
}

/**
 * Returns decrypted tokens for a user's integration with a provider.
 * Refreshes the access token if it expires within the next 60 seconds.
 * Throws if the integration is not connected or is in error state.
 */
export async function getProviderTokens(
  supabase: SupabaseClient,
  userId: string,
  provider: ProviderId,
): Promise<IntegrationTokens> {
  const key = Deno.env.get('INTEGRATION_TOKEN_KEY');
  if (!key) throw new Error('INTEGRATION_TOKEN_KEY not set');

  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No ${provider} integration for user`);
  const row = data as IntegrationRow;
  if (row.status !== 'active') {
    throw new Error(`Integration status is ${row.status}`);
  }

  let accessToken = await decrypt(row.access_token_encrypted, key);
  const refreshToken = row.refresh_token_encrypted
    ? await decrypt(row.refresh_token_encrypted, key)
    : null;
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null;

  // Refresh if expiring within 60 seconds
  if (refreshToken && expiresAt && expiresAt.getTime() - Date.now() < 60_000) {
    const refreshed = await refreshAccessToken(provider, refreshToken);
    accessToken = refreshed.accessToken;
    await supabase
      .from('integrations')
      .update({
        access_token_encrypted: await encrypt(refreshed.accessToken, key),
        token_expires_at: refreshed.expiresAt?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scopes: row.scopes,
    metadata: row.metadata ?? {},
  };
}

async function refreshAccessToken(
  provider: ProviderId,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const config = getProvider(provider);
  const clientId = Deno.env.get(config.clientIdEnv);
  const clientSecret = Deno.env.get(config.clientSecretEnv);
  if (!clientId || !clientSecret) {
    throw new Error(`Missing client credentials for ${provider}`);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  const expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000)
    : null;
  return { accessToken: json.access_token, expiresAt };
}
