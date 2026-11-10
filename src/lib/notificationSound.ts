/**
 * Short chimes for new notifications and chat messages, synthesised with the
 * Web Audio API (no audio file).
 *
 *   • playNotificationChime — bell notifications (C6 → G5)
 *   • playChatChime         — chat / direct messages (A5 → D5)
 *
 * Both play through the ONE shared alert audio (see alertAudio.ts), with an
 * <audio> fallback for Safari. A fresh AudioContext per chime — what this
 * used to do — is often created "suspended" by the browser's autoplay rules,
 * so messages arrived in silence.
 */
import {
  CHAT_NOTES,
  NOTIFICATION_NOTES,
  audibleContext,
  getSharedContext,
  playFallback,
  scheduleNotes,
  type AlertSound,
  type Note,
} from '@/services/calling/alertAudio';

let lastPlayAt = 0;
const MIN_GAP_MS = 600;

/** Test hook. */
export function __resetChimeThrottleForTests(): void {
  lastPlayAt = 0;
}

function playOn(ctx: AudioContext, notes: Note[], volume: number): void {
  const master = scheduleNotes(ctx, notes, volume, ctx.currentTime + 0.02);
  const end = Math.max(...notes.map(([o, , d]) => o + d));
  // The shared context stays open for the next sound; just detach this one.
  window.setTimeout(() => {
    try {
      master.disconnect();
    } catch {
      /* already gone */
    }
  }, (end + 0.3) * 1000);
}

function playChime(kind: AlertSound, notes: Note[], volume: number): void {
  if (typeof window === 'undefined') return;

  // Throttle bursts (several rows in one refetch, bell + chat at once) to a single ping.
  const now = Date.now();
  if (lastPlayAt && now - lastPlayAt < MIN_GAP_MS) return;
  lastPlayAt = now;

  try {
    const ctx = getSharedContext();
    if (ctx && ctx.state === 'running') {
      playOn(ctx, notes, volume);
      return;
    }
    // Suspended / Safari "interrupted": try to wake it, else use the <audio> fallback.
    void audibleContext().then((running) => {
      if (running) playOn(running, notes, volume);
      else playFallback(kind);
    });
  } catch {
    playFallback(kind);
  }
}

export function playNotificationChime(): void {
  playChime('notification', NOTIFICATION_NOTES, 0.5);
}

export function playChatChime(): void {
  playChime('chat', CHAT_NOTES, 0.6);
}
