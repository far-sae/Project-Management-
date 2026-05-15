import { supabase } from '@/services/supabase/config';
import type { IntegrationRow, ProviderId } from './types';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}` };
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export async function startOAuth(provider: ProviderId, scopes?: string[], orgId?: string | null): Promise<string> {
  const res = await fetch(`${FUNCTIONS_URL}/oauth-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ provider, scopes, orgId }),
  });
  if (!res.ok) throw new Error(`oauth-start failed: ${res.status}`);
  const json = await res.json();
  return json.authUrl as string;
}

export async function disconnect(provider: ProviderId): Promise<void> {
  const res = await fetch(`${FUNCTIONS_URL}/integrations-disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ provider }),
  });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
}

export async function listIntegrations(): Promise<IntegrationRow[]> {
  // Reads come straight from the integrations table over the user's session,
  // gated by RLS.
  const { data, error } = await supabase
    .from('integrations')
    .select('id, provider, status, scopes, connected_at, metadata');
  if (error) throw error;
  return (data ?? []) as IntegrationRow[];
}

export async function callAction<T = unknown>(
  provider: ProviderId,
  action: string,
  payload?: unknown,
): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/integrations-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ provider, action, payload }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`action failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  return json.result as T;
}
