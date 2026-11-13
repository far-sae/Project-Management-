import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ signInWithIdToken: vi.fn() }));
vi.mock('@/services/supabase/config', () => ({
  supabase: { auth: { signInWithIdToken: h.signInWithIdToken } },
}));

import {
  GOOGLE_CALLBACK_PATH,
  buildGoogleAuthUrl,
  completeGoogleSignIn,
  sha256Hex,
  startGoogleSignIn,
} from '@/services/supabase/googleSignIn';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('buildGoogleAuthUrl', () => {
  it('asks Google for an ID token that comes back to our own domain', () => {
    const url = new URL(
      buildGoogleAuthUrl({
        clientId: 'cid.apps.googleusercontent.com',
        redirectUri: 'https://taskcalendar.co.uk/auth/google',
        hashedNonce: 'abc',
        state: 'st',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://taskcalendar.co.uk/auth/google');
    expect(url.searchParams.get('response_type')).toBe('id_token');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('nonce')).toBe('abc');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });
});

describe('sha256Hex', () => {
  it('hashes the nonce the way Supabase checks it', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('startGoogleSignIn', () => {
  it('remembers where to go next and sends the browser to Google', async () => {
    const go = vi.fn();
    await startGoogleSignIn({
      clientId: 'cid',
      origin: 'https://taskcalendar.co.uk',
      next: '/accept-invite/tok',
      go,
    });
    const saved = JSON.parse(sessionStorage.getItem('googleSignIn') ?? '{}');
    expect(saved.next).toBe('/accept-invite/tok');
    expect(saved.nonce).toBeTruthy();
    const url = new URL(go.mock.calls[0][0]);
    expect(url.searchParams.get('redirect_uri')).toBe(`https://taskcalendar.co.uk${GOOGLE_CALLBACK_PATH}`);
    expect(url.searchParams.get('state')).toBe(saved.state);
    // Google gets the hash; the raw nonce stays with us for Supabase.
    expect(url.searchParams.get('nonce')).toBe(await sha256Hex(saved.nonce));
  });
});

describe('completeGoogleSignIn', () => {
  const remember = (over: Record<string, string> = {}) =>
    sessionStorage.setItem('googleSignIn', JSON.stringify({ state: 's1', nonce: 'raw', next: '/projects', ...over }));

  it('signs in to Supabase with the ID token and the raw nonce', async () => {
    remember();
    h.signInWithIdToken.mockResolvedValue({ data: {}, error: null });
    const next = await completeGoogleSignIn('#id_token=tok123&state=s1');
    expect(h.signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'tok123', nonce: 'raw' });
    expect(next).toBe('/projects');
    expect(sessionStorage.getItem('googleSignIn')).toBeNull();
  });

  it('rejects a reply that does not match the request (state)', async () => {
    remember();
    await expect(completeGoogleSignIn('#id_token=tok&state=evil')).rejects.toThrow(/start again/i);
    expect(h.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('explains when the person cancels on Google', async () => {
    remember();
    await expect(completeGoogleSignIn('#error=access_denied&state=s1')).rejects.toThrow(/cancelled/i);
  });

  it('surfaces Supabase errors', async () => {
    remember();
    h.signInWithIdToken.mockResolvedValue({ data: null, error: new Error('Unacceptable audience') });
    await expect(completeGoogleSignIn('#id_token=t&state=s1')).rejects.toThrow('Unacceptable audience');
  });

  it('only returns to a page on this site', async () => {
    remember({ next: 'https://evil.example/x' });
    h.signInWithIdToken.mockResolvedValue({ data: {}, error: null });
    expect(await completeGoogleSignIn('#id_token=t&state=s1')).toBe('/');
  });
});
