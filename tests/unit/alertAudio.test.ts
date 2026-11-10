import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_NOTES,
  __resetAlertAudioForTests,
  audibleContext,
  playFallback,
  synthWav,
  unlockAlertAudio,
} from '@/services/calling/alertAudio';

// A context whose resume() only works when `allowResume` is true — like
// Safari ignoring some events, or a browser blocking audio without a click.
let allowResume = true;
const created: FakeCtx[] = [];
class FakeCtx {
  state: string = 'suspended';
  currentTime = 0;
  destination = {};
  listeners: Array<() => void> = [];
  resume = vi.fn(async () => {
    if (allowResume) this.setState('running');
  });
  constructor() {
    created.push(this);
  }
  setState(s: string) {
    this.state = s;
    this.listeners.forEach((l) => l());
  }
  addEventListener(_t: string, l: () => void) {
    this.listeners.push(l);
  }
  removeEventListener() {}
  createGain() {
    return { gain: { setValueAtTime() {} }, connect() {}, disconnect() {} };
  }
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  muted = false;
  loop = false;
  preload = '';
  currentTime = 0;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
}

beforeEach(() => {
  allowResume = true;
  created.length = 0;
  FakeAudio.instances = [];
  __resetAlertAudioForTests();
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
});
afterEach(() => vi.useRealTimers());

describe('unlockAlertAudio (Safari-proof)', () => {
  it('keeps trying on later clicks when the first one did not unlock audio', async () => {
    const stop = unlockAlertAudio(window);
    allowResume = false;
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    expect(created[0].state).toBe('suspended');

    allowResume = true;
    window.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(created[0].state).toBe('running');
    expect(created[0].resume).toHaveBeenCalledTimes(2);
    stop();
  });

  it('re-arms when the browser interrupts audio again (tab in background)', async () => {
    const stop = unlockAlertAudio(window);
    window.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(created[0].state).toBe('running');

    created[0].setState('interrupted');
    window.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    expect(created[0].state).toBe('running');
    stop();
  });

  it('starts the fallback sounds silently during a click so they can play later', async () => {
    const stop = unlockAlertAudio(window);
    window.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(FakeAudio.instances.length).toBeGreaterThan(0);
    for (const a of FakeAudio.instances) {
      expect(a.play).toHaveBeenCalled();
    }
    await Promise.resolve();
    for (const a of FakeAudio.instances) {
      expect(a.pause).toHaveBeenCalled();
      expect(a.muted).toBe(false);
    }
    stop();
  });
});

describe('audibleContext', () => {
  it('wakes an interrupted context', async () => {
    const stop = unlockAlertAudio(window);
    window.dispatchEvent(new Event('click'));
    await Promise.resolve();
    created[0].setState('interrupted');
    const ctx = await audibleContext();
    expect(ctx).toBe(created[0]);
    stop();
  });

  it('gives up quickly when audio is not allowed yet', async () => {
    allowResume = false;
    expect(await audibleContext(10)).toBeNull();
  });
});

describe('fallback sound', () => {
  it('is a real WAV file', () => {
    const wav = synthWav(CHAT_NOTES, 0.6);
    const head = String.fromCharCode(...wav.subarray(0, 4)) + String.fromCharCode(...wav.subarray(8, 12));
    expect(head).toBe('RIFFWAVE');
    expect(wav.length).toBeGreaterThan(1000);
  });

  it('the ring loops until stopped', () => {
    const stop = playFallback('ring');
    const el = FakeAudio.instances[0];
    expect(el.loop).toBe(true);
    expect(el.play).toHaveBeenCalled();
    stop();
    expect(el.pause).toHaveBeenCalled();
  });
});
