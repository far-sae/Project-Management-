import { describe, expect, it } from 'vitest';
import { presenceStatus } from '@/lib/presenceStatus';
import type { PresencePeer } from '@/hooks/usePresence';

const now = new Date(2026, 10, 13, 15, 0, 0);
const ago = (ms: number) => new Date(now.getTime() - ms);
const peer = (availability?: PresencePeer['availability']) =>
  ({ userId: 'u', displayName: 'Tamanna', availability }) as PresencePeer;

describe('presenceStatus', () => {
  it('is Online when they are live in the app, whatever the saved time says', () => {
    expect(presenceStatus(peer('online'), null, now)).toMatchObject({ label: 'Online', online: true });
    expect(presenceStatus(peer(undefined), ago(3 * 86_400_000), now)).toMatchObject({ label: 'Online', online: true });
  });

  it('is Online from a recent heartbeat even without live presence (e.g. other page)', () => {
    expect(presenceStatus(undefined, ago(30_000), now)).toMatchObject({ label: 'Online', online: true });
  });

  it('shows when they were last seen once they are gone', () => {
    expect(presenceStatus(undefined, ago(5 * 60_000), now)).toMatchObject({
      label: 'Last seen 5 min ago',
      online: false,
    });
    expect(presenceStatus(undefined, ago(2 * 3_600_000), now).label).toBe('Last seen 2 hr ago');
  });

  it('respects people who set themselves to offline', () => {
    const s = presenceStatus(peer('offline'), ago(10 * 60_000), now);
    expect(s.online).toBe(false);
    expect(s.label).toBe('Last seen 10 min ago');
  });

  it('keeps Do not disturb and Holiday', () => {
    expect(presenceStatus(peer('dnd'), null, now).label).toBe('Do not disturb');
    expect(presenceStatus(peer('holiday'), null, now).label).toBe('Holiday');
  });

  it('says Offline only when nothing is known', () => {
    expect(presenceStatus(undefined, null, now)).toMatchObject({ label: 'Offline', online: false });
  });

  it('gives the exact last-seen time for a tooltip', () => {
    const s = presenceStatus(undefined, ago(5 * 60_000), now);
    expect(s.title).toMatch(/^Last seen .*14:55/);
  });
});
