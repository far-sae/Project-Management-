/**
 * The browser's connection to the calling server (/api/voice): can calls be
 * placed, start one, say how it went, and fetch a recording.
 *
 * Every call carries the person's sign-in token; the server checks it, and
 * that the person is an owner or admin, on every request.
 */
import { supabase } from '@/services/supabase/config';
import type { CallList, EndCallInput, StartCallInput, StartedCall, VoiceSetup } from '../../../api/_voice/shared/types';

const BASE = '/api/voice/';

export const REQUEST_FAILED_MESSAGE = 'The request could not be completed. Please try again.';
export const SIGNED_OUT_MESSAGE = 'Please sign in again.';

/** A failed call to the server. `message` is the server's own sentence when it sent one. */
export class VoiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'VoiceError';
  }
}

export const errorSentence = (err: unknown): string =>
  err instanceof VoiceError && err.message ? err.message : REQUEST_FAILED_MESSAGE;

async function send(path: string, body?: unknown, method?: 'DELETE'): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new VoiceError(SIGNED_OUT_MESSAGE, 401);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new VoiceError(REQUEST_FAILED_MESSAGE, 0);
  }
  if (!response.ok) {
    let sentence: string | null = null;
    try {
      if (response.headers.get('content-type')?.includes('json')) {
        const reply = await response.json();
        if (typeof reply?.error === 'string' && reply.error.trim()) sentence = reply.error;
      }
    } catch {
      sentence = null;
    }
    throw new VoiceError(sentence || REQUEST_FAILED_MESSAGE, response.status);
  }
  return response;
}

async function json<T>(path: string, body?: unknown): Promise<T> {
  const response = await send(path, body);
  if (!response.headers.get('content-type')?.includes('json')) throw new VoiceError(REQUEST_FAILED_MESSAGE, response.status);
  return (await response.json()) as T;
}

/** What "calling is not set up at all" looks like: the Call button then works as it always did. */
export const NO_CALLING: VoiceSetup = { configured: false, ready: false, problem: null, numbers: { US: false, GB: false } };

let setupOnce: Promise<VoiceSetup> | null = null;

/** Whether calls can be placed. Asked once per visit; a failure counts as "not set up" and is asked again next time. */
export function voiceSetup(): Promise<VoiceSetup> {
  if (!setupOnce) {
    setupOnce = json<VoiceSetup>('setup').catch(() => {
      setupOnce = null;
      return NO_CALLING;
    });
  }
  return setupOnce;
}

/** Test hook: forget the remembered answer. */
export function forgetVoiceSetup(): void {
  setupOnce = null;
}

export const startCall = (input: StartCallInput): Promise<StartedCall> => json<StartedCall>('calls', input);

export const endCall = (id: string, input: EndCallInput): Promise<void> => json<{ ok: true }>(`calls/${id}/end`, input).then(() => undefined);

/** The calls of a workspace, newest first; `before` (the time of the last one shown) asks for the older ones. */
export const listCalls = (workspaceId: string, before?: string): Promise<CallList> =>
  json<CallList>(`calls?workspaceId=${encodeURIComponent(workspaceId)}${before ? `&before=${encodeURIComponent(before)}` : ''}`);

/** Removes a call for good, with its recording and its timeline entry. The owner only. */
export const deleteCall = (id: string): Promise<void> => send(`calls/${id}`, undefined, 'DELETE').then(() => undefined);

/** The recording of a call, as audio the page can play. */
export async function fetchRecording(id: string): Promise<Blob> {
  const response = await send(`calls/${id}/recording`);
  return response.blob();
}
