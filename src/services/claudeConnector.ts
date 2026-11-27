/**
 * The browser's side of the Claude connector (/api/mcp): what the "Allow
 * Claude" page shows and does, and what the Claude card in Email settings
 * lists. Every call carries the person's sign-in token. Claude itself never
 * goes through here: it talks to the server from its own servers.
 */
import { publicMessage } from '@/lib/publicError';
import { supabase } from '@/services/supabase/config';

const BASE = '/api/mcp';

export const REQUEST_FAILED_MESSAGE = 'The request could not be completed. Please try again.';
export const SIGNED_OUT_MESSAGE = 'Please sign in again.';

export class ConnectorError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export const errorSentence = (err: unknown): string =>
  publicMessage(err instanceof ConnectorError ? err : null, REQUEST_FAILED_MESSAGE);

async function call<T>(path: string, method: 'GET' | 'POST' | 'DELETE', params: Record<string, string> = {}, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ConnectorError(SIGNED_OUT_MESSAGE, 401);
  const query = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${BASE}/${path}${query ? `?${query}` : ''}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ConnectorError(REQUEST_FAILED_MESSAGE, 0);
  }
  let reply: unknown = null;
  try {
    if (response.headers.get('content-type')?.includes('json')) reply = await response.json();
  } catch {
    reply = null;
  }
  if (!response.ok) {
    const sentence = (reply as { error?: unknown } | null)?.error;
    throw new ConnectorError(typeof sentence === 'string' && sentence.trim() ? sentence : REQUEST_FAILED_MESSAGE, response.status);
  }
  return reply as T;
}

/** What Claude sent the person to our page with (the query of the address). */
export type ConnectParams = Record<string, string>;

export type ConsentCheck =
  | {
      ok: true;
      /** False when this person may not use Email, so there is nothing to allow. */
      allowed: boolean;
      /** Who is asking, judged by where the answer goes. */
      from: 'claude' | 'this_computer';
      /** What the program calls itself. Its own words. */
      clientName: string;
      /** Where the person goes when they say no. */
      deny: string;
      workspaces?: string[];
      problem?: string;
    }
  | { ok: false; problem: string; redirect: string | null; notSetUp?: boolean };

export type ConsentAllowed = { ok: true; redirect: string } | { ok: false; problem: string; redirect: string | null };

export const checkConsent = (params: ConnectParams, organizationId: string): Promise<ConsentCheck> =>
  call<ConsentCheck>('consent', 'POST', {}, { action: 'check', params, organizationId });

export const allowConsent = (params: ConnectParams, organizationId: string): Promise<ConsentAllowed> =>
  call<ConsentAllowed>('consent', 'POST', {}, { action: 'allow', params, organizationId });

export type ClaudeConnection = { id: string; userId: string; clientName: string; createdAt: string; lastUsedAt: string | null };
export type ClaudeAction = { at: string; userId: string; summary: string };
export type ClaudeStatus = {
  /** False until the connector's tables exist. */
  ready: boolean;
  /** The address to give Claude. */
  address: string;
  mayConnect?: boolean;
  connections: ClaudeConnection[];
  actions: ClaudeAction[];
};

export const loadClaudeStatus = (organizationId: string): Promise<ClaudeStatus> =>
  call<ClaudeStatus>('connections', 'GET', { organizationId });

export const disconnectClaude = (id: string): Promise<void> =>
  call('connections', 'DELETE', { id }).then(() => undefined);

/**
 * True for an address the page may send the person on to: Claude's own, or a
 * program on this computer. The server only ever gives one of these; this is
 * a second lock on the door, so a changed reply cannot send anybody elsewhere.
 */
export function isClaudeAddress(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return (u.hostname === 'claude.ai' || u.hostname === 'claude.com') && u.pathname === '/api/mcp/auth_callback';
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.pathname === '/callback';
  } catch {
    return false;
  }
}

/** Sends the person on to Claude, and only to Claude. True when they are on their way. */
export function goToClaude(url: string): boolean {
  if (!isClaudeAddress(url)) return false;
  window.location.assign(url);
  return true;
}

/**
 * True when this page is shown inside another page. The Allow page then shows
 * no button at all: a button inside somebody else's page can be pressed by a
 * person who cannot see what it is. (The server also tells browsers never to
 * frame the page; this is for a browser that did not listen.)
 */
export function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

/**
 * How long Allow stays off after the page appeared. A click that was meant
 * for something else (a page that opened this one under the person's mouse)
 * then lands on a button that does nothing.
 */
export const ALLOW_AFTER_MS = 1200;
