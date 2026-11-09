import { supabase } from '@/services/supabase/config';

export type GuestApiErrorCode =
  | 'INVITE_EXPIRED'
  | 'BAD_NAME'
  | 'FORBIDDEN'
  | 'LIVEKIT_ERROR';

export class GuestApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'GuestApiError';
    this.code = code;
  }
}

/** Read the JSON body of a non-2xx FunctionsHttpError, tolerating any shape. */
async function readErrorBody(
  error: unknown,
): Promise<{ error?: string; code?: string } | null> {
  try {
    const ctx = (error as { context?: Response } | null)?.context;
    if (!ctx || typeof ctx.json !== 'function') return null;
    const body = await ctx.json();
    return body && typeof body === 'object'
      ? (body as { error?: string; code?: string })
      : null;
  } catch {
    return null;
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('call-guest', { body });
  if (error) {
    const parsed = await readErrorBody(error);
    throw new GuestApiError(
      parsed?.error || (error as { message?: string }).message || 'Request failed',
      parsed?.code,
    );
  }
  const payload = data as (T & { error?: string; code?: string }) | null;
  if (payload?.error) throw new GuestApiError(payload.error, payload.code);
  return payload as T;
}

export async function createGuestInvite(
  roomName: string,
): Promise<{ url: string; expiresAt: string }> {
  const r = await call<{ url?: string; expiresAt?: string }>({
    action: 'create-invite',
    roomName,
  });
  if (!r?.url) throw new GuestApiError('Malformed call-guest response');
  return { url: r.url, expiresAt: r.expiresAt ?? '' };
}

export async function joinAsGuest(
  invite: string,
  name: string,
): Promise<{ token: string; url: string; label: string; identity: string }> {
  const r = await call<{
    token?: string;
    url?: string;
    label?: string;
    identity?: string;
  }>({ action: 'guest-join', invite, name });
  if (!r?.token || !r?.url) throw new GuestApiError('Malformed call-guest response');
  return {
    token: r.token,
    url: r.url,
    label: r.label ?? 'Guest',
    identity: r.identity ?? '',
  };
}

export async function admitGuest(roomName: string, identity: string): Promise<void> {
  await call({ action: 'admit', roomName, identity });
}

export async function denyGuest(roomName: string, identity: string): Promise<void> {
  await call({ action: 'deny', roomName, identity });
}
