// src/services/integrations/telegram.ts
import { supabase } from '@/services/supabase/config';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}` };
}

export interface LinkCode {
  code: string;
  expiresAt: string;
}

export async function requestTelegramLinkCode(orgId: string): Promise<LinkCode> {
  const res = await fetch(`${FUNCTIONS_URL}/telegram-link-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ orgId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to generate code: ${res.status} ${text}`);
  }
  return res.json();
}

export interface TelegramStatus {
  linked: boolean;
  username?: string;
  currentOrgId?: string;
}

export async function getTelegramStatus(): Promise<TelegramStatus> {
  const { data } = await supabase
    .from('integrations')
    .select('metadata')
    .eq('provider', 'telegram')
    .maybeSingle();
  if (!data) return { linked: false };
  const meta = (data.metadata ?? {}) as { telegram_username?: string; current_org_id?: string };
  return {
    linked: true,
    username: meta.telegram_username,
    currentOrgId: meta.current_org_id,
  };
}

export async function unlinkTelegram(): Promise<void> {
  const { error } = await supabase
    .from('integrations')
    .delete()
    .eq('provider', 'telegram');
  if (error) throw error;
}
