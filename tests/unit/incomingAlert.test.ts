import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RING_TOTAL_SECONDS,
  CALL_ALERTS_DISMISSED_KEY,
  __resetCallAudioForTests,
  shouldOfferCallAlerts,
  showIncomingCallNotification,
  startIncomingRing,
  startTitleFlash,
  unlockCallAudio,
} from '@/services/calling/incomingAlert';

// ── Fake Web Audio ────────────────────────────────────────────
const created: FakeCtx[] = [];
class FakeParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  connected = true;
  starts: number[] = [];
  connect() {}
  disconnect() {
    this.connected = false;
  }
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
  gains: FakeNode[] = [];
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
    const n = new FakeNode();
    this.gains.push(n);
    return n;
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
  created.length = 0;
  __resetCallAudioForTests();
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (globalThis as unknown as { Audio: unknown }).Audio = SilentAudio;
});

describe('unlockCallAudio', () => {
  it('creates and resumes the shared audio on the first click, once', () => {
    const remove = unlockCallAudio(window);
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('keydown'));
    expect(created).toHaveLength(1);
    expect(created[0].resume).toHaveBeenCalledTimes(1);
    remove();
  });
});

describe('startIncomingRing', () => {
  it('resumes audio and schedules the whole ring up front (not on timers)', async () => {
    const stop = startIncomingRing();
    const ctx = created[0];
    expect(ctx.resume).toHaveBeenCalled();
    await vi.waitFor(() => expect(ctx.oscillators.length).toBeGreaterThan(0));
    const startTimes = ctx.oscillators.flatMap((o) => o.starts);
    // Rings are spread across the full ringing period on the audio clock.
    expect(Math.max(...startTimes)).toBeGreaterThan(RING_TOTAL_SECONDS - 4);
    stop();
  });

  it('stop() silences everything immediately', async () => {
    const stop = startIncomingRing();
    await vi.waitFor(() => expect(created[0].gains.length).toBeGreaterThan(0));
    const master = created[0].gains[0];
    expect(master.connected).toBe(true);
    stop();
    expect(master.connected).toBe(false);
  });

  it('reuses the unlocked audio instead of creating a new (silent) one', () => {
    const remove = unlockCallAudio(window);
    window.dispatchEvent(new Event('pointerdown'));
    startIncomingRing()();
    expect(created).toHaveLength(1);
    remove();
  });
});

// ── Notifications ─────────────────────────────────────────────
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

describe('showIncomingCallNotification', () => {
  beforeEach(() => {
    FakeNotification.instances = [];
    FakeNotification.permission = 'granted';
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a desktop notification when the app is not in front', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const close = showIncomingCallNotification({
      callerName: 'Sam',
      mediaType: 'video',
      contextLabel: 'Website',
    });
    const n = FakeNotification.instances[0];
    expect(n.title).toBe('Sam is calling');
    expect(n.options.body).toBe('Video call · Website');
    expect(n.options.requireInteraction).toBe(true);
    close();
    expect(n.close).toHaveBeenCalled();
  });

  it('clicking the notification brings the app to the front', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    showIncomingCallNotification({ callerName: 'Sam', mediaType: 'audio' });
    FakeNotification.instances[0].onclick?.();
    expect(focus).toHaveBeenCalled();
  });

  it('does nothing when the app is already in front or permission is not granted', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    showIncomingCallNotification({ callerName: 'Sam', mediaType: 'audio' });
    expect(FakeNotification.instances).toHaveLength(0);

    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    FakeNotification.permission = 'denied';
    showIncomingCallNotification({ callerName: 'Sam', mediaType: 'audio' });
    expect(FakeNotification.instances).toHaveLength(0);
  });
});

describe('shouldOfferCallAlerts', () => {
  beforeEach(() => {
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
    localStorage.removeItem(CALL_ALERTS_DISMISSED_KEY);
  });
  it('offers only while permission is undecided and not dismissed', () => {
    FakeNotification.permission = 'default';
    expect(shouldOfferCallAlerts()).toBe(true);
    localStorage.setItem(CALL_ALERTS_DISMISSED_KEY, '1');
    expect(shouldOfferCallAlerts()).toBe(false);
    localStorage.removeItem(CALL_ALERTS_DISMISSED_KEY);
    FakeNotification.permission = 'granted';
    expect(shouldOfferCallAlerts()).toBe(false);
  });
});

describe('startTitleFlash', () => {
  it('alternates the tab title and restores it when stopped', () => {
    vi.useFakeTimers();
    document.title = 'TaskCalendar';
    const stop = startTitleFlash('📞 Sam is calling…');
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('📞 Sam is calling…');
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('TaskCalendar');
    vi.advanceTimersByTime(1000);
    stop();
    expect(document.title).toBe('TaskCalendar');
    vi.useRealTimers();
  });
});
