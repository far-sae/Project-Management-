/**
 * The browser's connection to the lead-finding server (/api/voice/prospects):
 * can leads be found here, search for people, and buy the details of the ones
 * chosen. The Apollo key never reaches the browser.
 *
 * Every request carries the person's sign-in token; the server checks it, and
 * that the person is an owner or admin, every time.
 */
import { publicMessage } from '@/lib/publicError';
import { supabase } from '@/services/supabase/config';
import type { ProspectFilters, ProspectPhones, ProspectReveal, ProspectSearch, ProspectSetup } from '../../../api/_prospect/shared/types';

const BASE = '/api/voice/prospects/';

export const REQUEST_FAILED_MESSAGE = 'The request could not be completed. Please try again.';
export const SIGNED_OUT_MESSAGE = 'Please sign in again.';

/** A failed request to the server. `message` is the server's own sentence when it sent one. */
export class ProspectError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ProspectError';
  }
}

export const errorSentence = (err: unknown): string =>
  publicMessage(err instanceof ProspectError ? err : null, REQUEST_FAILED_MESSAGE);

async function json<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ProspectError(SIGNED_OUT_MESSAGE, 401);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ProspectError(REQUEST_FAILED_MESSAGE, 0);
  }
  const isJson = response.headers.get('content-type')?.includes('json');
  if (!response.ok) {
    let sentence: string | null = null;
    try {
      const reply = isJson ? await response.json() : null;
      if (typeof reply?.error === 'string' && reply.error.trim()) sentence = reply.error;
    } catch {
      sentence = null;
    }
    throw new ProspectError(sentence || REQUEST_FAILED_MESSAGE, response.status);
  }
  if (!isJson) throw new ProspectError(REQUEST_FAILED_MESSAGE, response.status);
  return (await response.json()) as T;
}

/** What "finding leads is not set up" looks like. */
export const NO_PROSPECTING: ProspectSetup = { configured: false, ready: false, problem: null };

/** Whether leads can be found from this workspace. A failure is thrown, with the server's sentence. */
export const prospectSetup = (workspaceId: string): Promise<ProspectSetup> =>
  json<ProspectSetup>(`setup?workspaceId=${encodeURIComponent(workspaceId)}`);

/** People who match. Free: no Apollo credit is used. */
export const searchProspects = (workspaceId: string, filters: ProspectFilters, page: number): Promise<ProspectSearch> =>
  json<ProspectSearch>('search', { workspaceId, filters, page });

/**
 * The email and details of the chosen people. Uses 1 Apollo credit for each
 * person found. With `phones`, Apollo also starts looking for their phone
 * numbers (8 credits more for each one found); those are fetched afterwards
 * with prospectPhones().
 */
export const revealProspects = (workspaceId: string, ids: string[], verifiedOnly: boolean, phones = false): Promise<ProspectReveal> =>
  json<ProspectReveal>('reveal', { workspaceId, ids, verifiedOnly, phones });

/** The phone numbers of earlier reveals, as far as Apollo has found them. */
export const prospectPhones = (workspaceId: string, requestIds: string[]): Promise<ProspectPhones> =>
  json<ProspectPhones>('phones', { workspaceId, requestIds });
