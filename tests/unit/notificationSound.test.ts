import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCallAudioForTests, unlockCallAudio } from '@/services/calling/incomingAlert';
import { __resetChimeThrottleForTests, playChatChime, playNotificationChime } from '@/lib/notificationSound';

const created: FakeCtx[] = [];
class FakeParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  starts: number[] = [];
  connect() {}
  disconnect() {}
  start(t: number) {
    this.starts.push(t);
  }
  stop() {}
}
class FakeCtx {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  oscillators: FakeNode[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {});
  constructor() {
    created.push(this);
  }
  createOscillator() {
    const n = new FakeNode();
    this.oscillators.push(n);
    return n;
  }
  createGain() {
    return new FakeNode();
  }
}

class SilentAudio {
  muted = false;
  loop = false;
  preload = '';
  currentTime = 0;
  play = vi.fn(async () => {});
  pause = vi.fn();
}

beforeEach(() => {
  (globalThis as unknown as { Audio: unknown }).Audio = SilentAudio;
  created.length = 0;
  __resetCallAudioForTests();
  __resetChimeThrottleForTests();
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
});

describe('chat and notification chimes', () => {
  it('play through the audio unlocked by the first click, not a new silent one', () => {
    const remove = unlockCallAudio(window);
    window.dispatchEvent(new Event('pointerdown'));
    playChatChime();
    expect(created).toHaveLength(1);
    expect(created[0].oscillators.length).toBeGreaterThan(0);
    expect(created[0].close).not.toHaveBeenCalled();
    remove();
  });

  it('try to wake suspended audio before playing', () => {
    playNotificationChime();
    expect(created[0].resume).toHaveBeenCalled();
  });

  it('play once for a burst of messages', async () => {
    playChatChime();
    playNotificationChime();
    playChatChime();
    // Two notes, each with an overtone → 4 oscillators for a single chime.
    await vi.waitFor(() => expect(created[0].oscillators).toHaveLength(4));
  });
});
