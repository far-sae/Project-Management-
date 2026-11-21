/**
 * The browser's connection to the warm-up server (/api/email/warmup): is a
 * warm-up service connected, where each mailbox stands, start or pause one.
 * Every call carries the person's sign-in token; the server checks it and that
 * the person is an owner or admin of the organisation.
 */
import { publicMessage } from '@/lib/publicError';
import { supabase } from '@/services/supabase/config';
import type { WarmupMailbox, WarmupStatus } from '../../../api/_warmup/shared/types';

const BASE = '/api/email/warmup';

export const REQUEST_FAILED_MESSAGE = 'The request could not be completed. Please try again.';
export const SIGNED_OUT_MESSAGE = 'Please sign in again.';

export class WarmupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'WarmupError';
  }
}

export const errorSentence = (err: unknown): string =>
  publicMessage(err instanceof WarmupError ? err : null, REQUEST_FAILED_MESSAGE);

async function call<T>(action: string, method: 'GET' | 'POST' | 'DELETE', params: Record<string, string> = {}, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new WarmupError(SIGNED_OUT_MESSAGE, 401);
  const query = new URLSearchParams({ do: action, ...params }).toString();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${BASE}?${query}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new WarmupError(REQUEST_FAILED_MESSAGE, 0);
  }
  let reply: unknown = null;
  try {
    if (response.headers.get('content-type')?.includes('json')) reply = await response.json();
  } catch {
    reply = null;
  }
  if (!response.ok) {
    const sentence = (reply as { error?: unknown } | null)?.error;
    throw new WarmupError(typeof sentence === 'string' && sentence.trim() ? sentence : REQUEST_FAILED_MESSAGE, response.status);
  }
  return reply as T;
}

export const warmupStatus = (organizationId: string, workspaceId: string | null): Promise<WarmupStatus> =>
  call<WarmupStatus>('status', 'GET', workspaceId ? { organizationId, workspaceId } : { organizationId });

/** Checks the key with the warm-up service and keeps it; resolves to how many inboxes the key's project has. */
export const saveWarmupKey = (organizationId: string, apiKey: string): Promise<number> =>
  call<{ inboxes: number }>('key', 'POST', {}, { organizationId, apiKey }).then((r) => r.inboxes);

export const removeWarmupKey = (organizationId: string): Promise<void> =>
  call('key', 'DELETE', {}, { organizationId }).then(() => undefined);

/** Adds the mailbox to the warm-up service. It uses one seat of the organisation's plan there. */
export const startWarmup = (mailboxId: string): Promise<WarmupMailbox> =>
  call<{ mailbox: WarmupMailbox }>('connect', 'POST', {}, { mailboxId }).then((r) => r.mailbox);

export const pauseWarmup = (mailboxId: string, paused: boolean): Promise<WarmupMailbox> =>
  call<{ mailbox: WarmupMailbox }>('pause', 'POST', {}, { mailboxId, paused }).then((r) => r.mailbox);
