import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@/services/supabase/config', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import {
  createGuestInvite,
  joinAsGuest,
  admitGuest,
  denyGuest,
} from '@/services/livekit/guestApi';

function httpError(body: unknown) {
  return { message: 'non-2xx', context: { json: async () => body } };
}

describe('guestApi', () => {
  beforeEach(() => invoke.mockReset());

  it('createGuestInvite sends create-invite and returns url/expiresAt', async () => {
    invoke.mockResolvedValue({ data: { url: 'https://x/join/t', expiresAt: 'e' }, error: null });
    const r = await createGuestInvite('project:1');
    expect(invoke).toHaveBeenCalledWith('call-guest', {
      body: { action: 'create-invite', roomName: 'project:1' },
    });
    expect(r).toEqual({ url: 'https://x/join/t', expiresAt: 'e' });
  });

  it('joinAsGuest sends guest-join and returns credentials', async () => {
    invoke.mockResolvedValue({
      data: { token: 't', url: 'wss://l', label: 'Guest', identity: 'guest:1', roomName: 'r' },
      error: null,
    });
    const r = await joinAsGuest('inv', 'Bob');
    expect(invoke).toHaveBeenCalledWith('call-guest', {
      body: { action: 'guest-join', invite: 'inv', name: 'Bob' },
    });
    expect(r).toEqual({ token: 't', url: 'wss://l', label: 'Guest', identity: 'guest:1' });
  });

  it('joinAsGuest surfaces INVITE_EXPIRED code', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'expired', code: 'INVITE_EXPIRED' }),
    });
    await expect(joinAsGuest('inv', 'Bob')).rejects.toMatchObject({ code: 'INVITE_EXPIRED' });
  });

  it('joinAsGuest surfaces BAD_NAME code', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'bad', code: 'BAD_NAME' }),
    });
    await expect(joinAsGuest('inv', '')).rejects.toMatchObject({ code: 'BAD_NAME' });
  });

  it('errors without a readable body still throw', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(joinAsGuest('inv', 'B')).rejects.toThrow('boom');
  });

  it('admitGuest / denyGuest send the right actions', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await admitGuest('project:1', 'guest:a');
    await denyGuest('project:1', 'guest:a');
    expect(invoke).toHaveBeenNthCalledWith(1, 'call-guest', {
      body: { action: 'admit', roomName: 'project:1', identity: 'guest:a' },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'call-guest', {
      body: { action: 'deny', roomName: 'project:1', identity: 'guest:a' },
    });
  });

  it('admitGuest throws with code on FORBIDDEN', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'no', code: 'FORBIDDEN' }),
    });
    await expect(admitGuest('r', 'guest:a')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
