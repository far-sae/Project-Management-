import { supabase } from './config';

/**
 * "Sign in with Google" that returns to OUR domain.
 *
 * With supabase.auth.signInWithOAuth, Google redirects back to
 * <project>.supabase.co, so Google's account picker says "to continue to
 * cotrbc….supabase.co" — and it can never show the app name, because Google
 * only shows a verified brand for domains you own.
 *
 * Here we ask Google directly for an OpenID ID token (response_type=id_token)
 * with redirect_uri = https://taskcalendar.co.uk/auth/google, then hand the
 * token to Supabase (signInWithIdToken). Same Supabase account and session;
 * Google's screen now names TaskCalendar.
 *
 * Needs: VITE_GOOGLE_CLIENT_ID (the Web client id Supabase already uses),
 * `${origin}/auth/google` in that client's Authorized redirect URIs.
 */

export const GOOGLE_CALLBACK_PATH = '/auth/google';
const STORAGE_KEY = 'googleSignIn';

export const googleClientId = (): string =>
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';

function randomString(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hex SHA-256 — Google gets the hash, Supabase checks it against the raw nonce. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildGoogleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  hashedNonce: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: opts.hashedNonce,
    state: opts.state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Only same-site paths, so a tampered `next` can't send people elsewhere. */
function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export async function startGoogleSignIn(opts: {
  clientId: string;
  origin: string;
  /** Path to open after signing in (e.g. an invite page). */
  next: string;
  go?: (url: string) => void;
}): Promise<void> {
  const nonce = randomString();
  const state = randomString(16);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ state, nonce, next: safeNext(opts.next) }));
  const url = buildGoogleAuthUrl({
    clientId: opts.clientId,
    redirectUri: `${opts.origin}${GOOGLE_CALLBACK_PATH}`,
    hashedNonce: await sha256Hex(nonce),
    state,
  });
  (opts.go ?? ((u: string) => window.location.assign(u)))(url);
}

/**
 * Finish sign-in on /auth/google. `hash` is location.hash from Google.
 * Resolves to the path to open next; throws a readable error otherwise.
 */
export async function completeGoogleSignIn(hash: string): Promise<string> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const raw = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  const saved = raw ? (JSON.parse(raw) as { state?: string; nonce?: string; next?: string }) : null;

  if (!saved?.state || params.get('state') !== saved.state || !saved.nonce) {
    throw new Error('This sign-in link has expired. Please start again.');
  }
  const googleError = params.get('error');
  if (googleError) {
    throw new Error(
      googleError === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${googleError}).`,
    );
  }
  const token = params.get('id_token');
  if (!token) throw new Error('Google did not return a sign-in token. Please start again.');

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token, nonce: saved.nonce });
  if (error) throw error;
  return safeNext(saved.next);
}
