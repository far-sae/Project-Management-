import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  const inFn = vi.fn();
  const eq = vi.fn();
  const select = vi.fn(() => ({ in: inFn }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select, update }));
  return { rpc, inFn, eq, select, update, from };
});

vi.mock('@/services/supabase/config', () => ({
  supabase: { rpc: h.rpc, from: h.from, channel: vi.fn(), removeChannel: vi.fn() },
}));

import { fetchLastSeenForUsers, pingLastSeen } from '@/services/supabase/lastSeen';

const missingFn = { code: 'PGRST202', message: 'Could not find the function public.get_last_seen' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchLastSeenForUsers', () => {
  it("reads teammates' last seen through get_last_seen (profiles are private)", async () => {
    h.rpc.mockResolvedValue({
      data: [{ user_id: 'tam', last_seen_at: '2026-11-13T14:55:00Z' }, { user_id: 'zg', last_seen_at: null }],
      error: null,
    });
    const map = await fetchLastSeenForUsers(['tam', 'zg', 'tam']);
    expect(h.rpc).toHaveBeenCalledWith('get_last_seen', { p_user_ids: ['tam', 'zg'] });
    expect(map.get('tam')?.toISOString()).toBe('2026-11-13T14:55:00.000Z');
    expect(map.get('zg')).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });

  it('falls back to the old direct read until the migration is applied', async () => {
    h.rpc.mockResolvedValue({ data: null, error: missingFn });
    h.inFn.mockResolvedValue({ data: [{ id: 'me', last_seen_at: '2026-11-13T15:00:00Z' }], error: null });
    const map = await fetchLastSeenForUsers(['me']);
    expect(h.from).toHaveBeenCalledWith('user_profiles');
    expect(map.get('me')).toBeInstanceOf(Date);
  });

  it('returns an empty map for no ids without calling the server', async () => {
    expect((await fetchLastSeenForUsers([])).size).toBe(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe('pingLastSeen', () => {
  it('stamps your own last seen through touch_last_seen', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await pingLastSeen('me');
    expect(h.rpc).toHaveBeenCalledWith('touch_last_seen');
    expect(h.update).not.toHaveBeenCalled();
  });

  it('falls back to a direct update until the migration is applied', async () => {
    h.rpc.mockResolvedValue({ data: null, error: missingFn });
    h.eq.mockResolvedValue({ error: null });
    await pingLastSeen('me');
    expect(h.update).toHaveBeenCalled();
    expect(h.eq).toHaveBeenCalledWith('id', 'me');
  });
});
