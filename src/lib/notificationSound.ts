/**
 * Soft alert chime for incoming bell notifications. Synthesised on the fly with the Web Audio
 * API so we don't ship an audio file. Two-note (C6 → G5) bell-like timbre — distinct from the
 * project chat chime (which is A5 → D5) so users can tell the two channels apart by ear.
 *
 * Browsers block audio until the user has interacted with the page at least once. We swallow
 * that error silently — the next notification will play once the user clicks anywhere.
 */

let lastPlayAt = 0;
const MIN_GAP_MS = 600;

export function playNotificationChime(): void {
  if (typeof window === 'undefined') return;

  // Throttle bursts (e.g. 5 assignments inserted in the same 100ms refetch) to a single ping.
  const now = Date.now();
  if (now - lastPlayAt < MIN_GAP_MS) return;
  lastPlayAt = now;

  try {
    const AudioCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    const ctx = new AudioCtor();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.5, ctx.currentTime);
    master.connect(ctx.destination);

    const playNote = (
      startOffset: number,
      freq: number,
      duration: number,
      peak: number,
    ) => {
      const start = ctx.currentTime + startOffset;
      const stop = start + duration;

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
    };

    // C6 (~1046Hz) bright opener, then G5 (~784Hz) softer landing — quick, clean alert.
    playNote(0, 1046.5, 0.16, 0.18);
    playNote(0.09, 783.99, 0.32, 0.2);

    window.setTimeout(() => void ctx.close().catch(() => {}), 700);
  } catch {
    /* Audio blocked until first user interaction — that's fine. */
  }
}
