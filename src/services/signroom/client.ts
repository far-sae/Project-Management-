/**
 * The browser's connection to the documents server (/api/signroom): agreements
 * with e-signing, and invoices.
 *
 * A signed-in call carries the person's sign-in token and the workspace they
 * are working in; the server checks both on every request. Guest calls (someone
 * signing an agreement or opening an invoice from an emailed link) carry
 * neither: their session is an HttpOnly cookie the server sets after the
 * emailed code is accepted.
 */
import { supabase } from '@/services/supabase/config';

const BASE = '/api/signroom/';
const WORKSPACE_HEADER = 'X-Signroom-Workspace';

export const REQUEST_FAILED_MESSAGE = 'The request could not be completed. Please try again.';
export const SIGNED_OUT_MESSAGE = 'Please sign in again.';

/** A failed call. `status` is the HTTP status; `message` is the server's own sentence when it sent one. */
export class SignroomError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SignroomError';
  }
}

const isGuestPath = (path: string) => path.startsWith('guest/') || path.startsWith('billing-guest/');

/** The server's `error` sentence, when the reply is JSON with one. Never throws. */
async function errorOf(response: Response): Promise<string | null> {
  try {
    if (!response.headers.get('content-type')?.includes('json')) return null;
    const data = await response.json();
    return typeof data?.error === 'string' && data.error.trim() ? data.error : null;
  } catch {
    return null;
  }
}

async function send(path: string, init: RequestInit, workspaceId: string | null): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (!isGuestPath(path)) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new SignroomError(SIGNED_OUT_MESSAGE, 401);
    headers.Authorization = `Bearer ${token}`;
    if (workspaceId) headers[WORKSPACE_HEADER] = workspaceId;
  }
  const response = await fetch(BASE + path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new SignroomError((await errorOf(response)) || REQUEST_FAILED_MESSAGE, response.status);
  return response;
}

export interface SignroomClient {
  /** GET when there is no body, otherwise POST (or the method given). Resolves to the JSON reply. */
  call<T = unknown>(path: string, body?: unknown, method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'): Promise<T>;
  /** A PDF the server streams (invoice preview, invoice, receipt). */
  pdf(path: string): Promise<Blob>;
  /** Uploads a file as raw bytes; the name travels in X-File-Name. */
  upload<T = unknown>(path: string, file: File): Promise<T>;
}

/**
 * A client for one workspace. Pass `null` for guest pages, which have no
 * workspace and no sign-in.
 */
export function signroomClient(workspaceId: string | null): SignroomClient {
  return {
    async call<T>(path: string, body?: unknown, method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'): Promise<T> {
      const response = await send(path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, workspaceId);
      if (!response.headers.get('content-type')?.includes('json')) {
        throw new SignroomError(REQUEST_FAILED_MESSAGE, response.status);
      }
      return (await response.json()) as T;
    },
    async pdf(path: string): Promise<Blob> {
      return (await send(path, { method: 'GET' }, workspaceId)).blob();
    },
    async upload<T>(path: string, file: File): Promise<T> {
      const response = await send(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      }, workspaceId);
      return (await response.json()) as T;
    },
  };
}
