/**
 * Short chimes for new notifications and chat messages, synthesised with the
 * Web Audio API (no audio file).
 *
 *   • playNotificationChime — bell notifications (C6 → G5)
 *   • playChatChime         — chat / direct messages (A5 → D5)
 *
 * Both play through the ONE shared audio context that is unlocked on the
 * user's first click (see unlockCallAudio). A fresh AudioContext per chime —
 * what this used to do — is often created "suspended" by the browser's
 * autoplay rules, so messages arrived in silence.
 */
import { getAlertAudioContext } from '@/services/calling/incomingAlert';

let lastPlayAt = 0;
const MIN_GAP_MS = 600;

/** Test hook. */
export function __resetChimeThrottleForTests(): void {
  lastPlayAt = 0;
}

function playChime(notes: Array<[offset: number, freq: number, duration: number, peak: number]>, volume: number): void {
  if (typeof window === 'undefined') return;

  // Throttle bursts (several rows in one refetch, bell + chat at once) to a single ping.
  const now = Date.now();
  if (lastPlayAt && now - lastPlayAt < MIN_GAP_MS) return;
  lastPlayAt = now;

  try {
    const ctx = getAlertAudioContext();
    if (!ctx) return;

    const master = ctx.createGain();
    master.gain.setValueAtTime(volume, ctx.currentTime);
    master.connect(ctx.destination);

    let end = 0;
    for (const [offset, freq, duration, peak] of notes) {
      const start = ctx.currentTime + 0.02 + offset;
      const stop = start + duration;
      end = Math.max(end, offset + duration);

      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const noteGain = ctx.createGain();
      const overtoneGain = ctx.createGain();

      osc.type = 'sine';
      overtone.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      overtone.frequency.setValueAtTime(freq * 2.005, start);

      noteGain.gain.setValueAtTime(0.0001, start);
      noteGain.gain.exponentialRampToValueAtTime(peak, start + 0.018);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, stop);

      overtoneGain.gain.setValueAtTime(0.0001, start);
      overtoneGain.gain.exponentialRampToValueAtTime(peak * 0.3, start + 0.025);
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, stop);

      osc.connect(noteGain);
      overtone.connect(overtoneGain);
      noteGain.connect(master);
      overtoneGain.connect(master);

      osc.start(start);
      overtone.start(start);
      osc.stop(stop + 0.02);
      overtone.stop(stop + 0.02);
    }

    // The shared context stays open for the next chime / call ring; just
    // detach this chime's output once it has finished.
    window.setTimeout(() => {
      try {
        master.disconnect();
      } catch {
        /* already gone */
      }
    }, (end + 0.3) * 1000);
  } catch {
    /* Audio unavailable — nothing to do. */
  }
}

export function playNotificationChime(): void {
  // C6 (~1046Hz) bright opener, then G5 (~784Hz) softer landing.
  playChime(
    [
      [0, 1046.5, 0.16, 0.18],
      [0.09, 783.99, 0.32, 0.2],
    ],
    0.5,
  );
}

export function playChatChime(): void {
  // Two-note chat chime: short A5 (880Hz) → fuller D5 (~587Hz).
  playChime(
    [
      [0, 880, 0.18, 0.18],
      [0.11, 587.33, 0.42, 0.22],
    ],
    0.6,
  );
}
