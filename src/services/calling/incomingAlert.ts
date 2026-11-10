/**
 * Making an incoming call actually get noticed.
 *
 * Browsers keep audio created before the user has interacted with the page
 * "suspended" (silent). Teammates often open TaskCalendar and leave it in a
 * background tab, so the old ringtone — a fresh AudioContext per call —
 * frequently made no sound. This module:
 *   1. plays through the shared alert audio (alertAudio.ts), unlocked on
 *      user gestures — with an <audio> fallback for Safari;
 *   2. schedules the whole ring on the audio clock up front (background-tab
 *      timer throttling can't stretch it out);
 *   3. shows a desktop notification (with the OS notification sound) when
 *      the app isn't in front — this works even if the page was never clicked;
 *   4. flashes the tab title while ringing.
 */

import {
  RING_CYCLE_SECONDS,
  RING_NOTES,
  __resetAlertAudioForTests,
  audibleContext,
  getAlertAudioContext,
  getSharedContext,
  playFallback,
  scheduleNotes,
  unlockAlertAudio,
  type Note,
} from './alertAudio';

/** Matches the 30 s ring timeout in CallProvider. */
export const RING_TOTAL_SECONDS = 30;
export const CALL_ALERTS_DISMISSED_KEY = 'taskcalendar:call-alerts-dismissed';
const NOTIFICATION_TAG = 'taskcalendar-incoming-call';


export { getAlertAudioContext };

/** Test hook — forget the shared audio. */
export function __resetCallAudioForTests(): void {
  __resetAlertAudioForTests();
}

/**
 * Unlock alert audio on user gestures (keeps trying until it's really
 * running — needed for Safari). Call once at app start; returns cleanup.
 */
export function unlockCallAudio(win: Window = window): () => void {
  return unlockAlertAudio(win);
}

function ringNotes(): Note[] {
  const notes: Note[] = [];
  for (let s = 0; s < RING_TOTAL_SECONDS; s += RING_CYCLE_SECONDS) {
    for (const [o, f, d, p] of RING_NOTES) notes.push([o + s, f, d, p]);
  }
  return notes;
}

/**
 * Play the incoming-call ring (three rising bell notes, twice, every 3 s)
 * for the full ringing period — scheduled up front on the audio clock so
 * background-tab timer throttling can't stretch it. If Web Audio can't run
 * (Safari before an accepted click), a looping <audio> fallback plays.
 * Returns stop().
 */
export function startIncomingRing(): () => void {
  let stopped = false;
  let stopSound: () => void = () => {};

  const startOn = (ctx: AudioContext) => {
    try {
      const master = scheduleNotes(ctx, ringNotes(), 0.5, ctx.currentTime + 0.05);
      stopSound = () => {
        try {
          master.disconnect();
        } catch {
          /* already stopped */
        }
      };
    } catch {
      stopSound = playFallback('ring');
    }
  };

  const ctx = getSharedContext();
  if (!ctx) {
    stopSound = playFallback('ring');
  } else if (ctx.state === 'running') {
    startOn(ctx);
  } else {
    void audibleContext().then((running) => {
      if (stopped) return;
      if (running) startOn(running);
      else stopSound = playFallback('ring');
    });
  }

  return () => {
    stopped = true;
    stopSound();
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
