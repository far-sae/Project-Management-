import { describe, expect, it } from 'vitest';
import {
  MediaStreamCache,
  shouldEndCallWhenAlone,
} from '@/services/livekit/callHelpers';

// jsdom has no MediaStream, and we only care about identity anyway.
class FakeStream {
  constructor(public tracks: MediaStreamTrack[]) {}
}
const factory = (tracks: MediaStreamTrack[]) =>
  new FakeStream(tracks) as unknown as MediaStream;
const track = (id: string) => ({ id }) as unknown as MediaStreamTrack;

describe('MediaStreamCache', () => {
  it('returns the SAME MediaStream while the tracks are unchanged', () => {
    // Regression: a fresh MediaStream per snapshot made <audio>/<video>
    // reset srcObject on every speaking-indicator change → choppy calls.
    const cache = new MediaStreamCache(factory);
    const mic = track('mic');
    const a = cache.get('user-1:audio', [mic]);
    const b = cache.get('user-1:audio', [mic]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it('returns a new stream when the tracks change', () => {
    const cache = new MediaStreamCache(factory);
    const a = cache.get('user-1:video', [track('cam')]);
    const b = cache.get('user-1:video', [track('screen')]);
    expect(b).not.toBe(a);
  });

  it('returns null and forgets the entry when there are no tracks', () => {
    const cache = new MediaStreamCache(factory);
    const mic = track('mic');
    const a = cache.get('k', [mic]);
    expect(cache.get('k', [])).toBeNull();
    expect(cache.get('k', [mic])).not.toBe(a);
  });

  it('prune() drops entries for keys no longer in use', () => {
    const cache = new MediaStreamCache(factory);
    const mic = track('mic');
    const a = cache.get('gone:audio', [mic]);
    cache.prune(new Set(['other:audio']));
    expect(cache.get('gone:audio', [mic])).not.toBe(a);
  });
});

describe('shouldEndCallWhenAlone', () => {
  it('ends a connected call once every remote has left', () => {
    expect(shouldEndCallWhenAlone('connected', 0)).toBe(true);
  });

  it('does not end while reconnecting (remotes can vanish briefly)', () => {
    expect(shouldEndCallWhenAlone('reconnecting', 0)).toBe(false);
  });

  it('keeps the call while someone is still there', () => {
    expect(shouldEndCallWhenAlone('connected', 1)).toBe(false);
  });

  it('does not end while still ringing / connecting (caller waits alone)', () => {
    expect(shouldEndCallWhenAlone('ringing', 0)).toBe(false);
    expect(shouldEndCallWhenAlone('connecting', 0)).toBe(false);
  });

  it('never ends an open meeting just because the member is alone', () => {
    expect(shouldEndCallWhenAlone('connected', 0, true)).toBe(false);
  });

  it('still ends a normal call when isOpenMeeting is false', () => {
    expect(shouldEndCallWhenAlone('connected', 0, false)).toBe(true);
  });
});
