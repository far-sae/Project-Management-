/**
 * Making an incoming call actually get noticed.
 *
 * Browsers keep audio created before the user has interacted with the page
 * "suspended" (silent). Teammates often open TaskCalendar and leave it in a
 * background tab, so the old ringtone — a fresh AudioContext per call —
 * frequently made no sound. This module:
 *   1. unlocks ONE shared AudioContext on the user's first click/keypress,
 *      so later rings can play out loud;
 *   2. schedules the whole ring on the audio clock up front (background-tab
 *      timer throttling can't stretch it out);
 *   3. shows a desktop notification (with the OS notification sound) when
 *      the app isn't in front — this works even if the page was never clicked;
 *   4. flashes the tab title while ringing.
 */

/** Matches the 30 s ring timeout in CallProvider. */
export const RING_TOTAL_SECONDS = 30;
const RING_EVERY_SECONDS = 3;
export const CALL_ALERTS_DISMISSED_KEY = 'taskcalendar:call-alerts-dismissed';
const NOTIFICATION_TAG = 'taskcalendar-incoming-call';

type AudioCtor = typeof AudioContext;

let sharedCtx: AudioContext | null = null;

function getAudioCtor(win: Window): AudioCtor | null {
  const w = win as Window & { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext || w.webkitAudioContext || null;
}

function getSharedContext(win: Window = window): AudioContext | null {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  const Ctor = getAudioCtor(win);
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    return null;
  }
}

/**
 * The shared, gesture-unlocked audio context — also used for chat chimes so
 * they aren't silent the way a freshly created AudioContext often is.
 */
export function getAlertAudioContext(): AudioContext | null {
  const ctx = getSharedContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Test hook — forget the shared context. */
export function __resetCallAudioForTests(): void {
  sharedCtx = null;
}

/**
 * Unlock call audio on the first user gesture. Call once at app start;
 * returns a cleanup function.
 */
export function unlockCallAudio(win: Window = window): () => void {
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  const unlock = () => {
    const ctx = getSharedContext(win);
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    remove();
  };
  const remove = () => {
    for (const e of events) win.removeEventListener(e, unlock, true);
  };
  for (const e of events) win.addEventListener(e, unlock, true);
  return remove;
}

/**
 * Play the incoming-call ring (three rising bell notes, twice, every 3 s)
 * for the full ringing period. Returns stop().
 */
export function startIncomingRing(): () => void {
  const ctx = getSharedContext();
  if (!ctx) return () => {};
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

  let master: GainNode;
  try {
    master = ctx.createGain();
    master.gain.setValueAtTime(0.5, ctx.currentTime);
    master.connect(ctx.destination);

    const note = (freq: number, at: number, dur: number, peak: number) => {
      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const g = ctx.createGain();
      const og = ctx.createGain();
      osc.type = 'sine';
      overtone.type = 'sine';
      osc.frequency.setValueAtTime(freq, at);
      overtone.frequency.setValueAtTime(freq * 2.01, at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      og.gain.setValueAtTime(0.0001, at);
      og.gain.exponentialRampToValueAtTime(peak * 0.3, at + 0.03);
      og.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      overtone.connect(og);
      g.connect(master);
      og.connect(master);
      osc.start(at);
      overtone.start(at);
      osc.stop(at + dur + 0.02);
      overtone.stop(at + dur + 0.02);
    };

    const t0 = ctx.currentTime + 0.05;
    for (let s = 0; s < RING_TOTAL_SECONDS; s += RING_EVERY_SECONDS) {
      const t = t0 + s;
      // G5 → B5 → D6, then again after a short pause.
      note(784, t, 0.25, 0.2);
      note(988, t + 0.28, 0.25, 0.22);
      note(1175, t + 0.56, 0.4, 0.25);
      note(784, t + 1.2, 0.25, 0.18);
      note(988, t + 1.48, 0.25, 0.2);
      note(1175, t + 1.76, 0.4, 0.22);
    }
  } catch {
    return () => {};
  }

  return () => {
    try {
      master.disconnect();
    } catch {
      /* already stopped */
    }
  };
}

export function appIsInFront(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * Desktop notification for an incoming call when the app isn't in front.
 * Requires notification permission (see shouldOfferCallAlerts). Returns close().
 */
export function showIncomingCallNotification(p: {
  callerName: string;
  mediaType: 'audio' | 'video';
  contextLabel?: string;
}): () => void {
  const N = (window as Window & { Notification?: typeof Notification }).Notification;
  if (!N || N.permission !== 'granted' || appIsInFront()) return () => {};
  try {
    const kind = p.mediaType === 'video' ? 'Video call' : 'Voice call';
    const n = new N(`${p.callerName} is calling`, {
      body: p.contextLabel ? `${kind} · ${p.contextLabel}` : kind,
      tag: NOTIFICATION_TAG,
      requireInteraction: true,
      icon: '/favicon.ico',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return () => n.close();
  } catch {
    return () => {};
  }
}

/** True while it makes sense to ask the user to allow call notifications. */
export function shouldOfferCallAlerts(): boolean {
  const N = (window as Window & { Notification?: typeof Notification }).Notification;
  if (!N || N.permission !== 'default') return false;
  try {
    return localStorage.getItem(CALL_ALERTS_DISMISSED_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Ask for notification permission (must run from a click). */
export async function requestCallAlerts(): Promise<NotificationPermission | 'unsupported'> {
  const N = (window as Window & { Notification?: typeof Notification }).Notification;
  if (!N) return 'unsupported';
  try {
    return await N.requestPermission();
  } catch {
    return N.permission;
  }
}

export function dismissCallAlertsOffer(): void {
  try {
    localStorage.setItem(CALL_ALERTS_DISMISSED_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

/** Alternate the tab title with `text` every second. Returns stop(). */
export function startTitleFlash(text: string): () => void {
  const original = document.title;
  let showing = false;
  const id = setInterval(() => {
    showing = !showing;
    document.title = showing ? text : original;
  }, 1000);
  return () => {
    clearInterval(id);
    document.title = original;
  };
}
