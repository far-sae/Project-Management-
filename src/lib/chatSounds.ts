/**
 * Subtle, non-intrusive ping for new messages from other people in task / project chat.
 * Uses Web Audio (no network assets). Fails quietly if the browser blocks audio.
 */
let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!sharedCtx) {
      const Ctx =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) sharedCtx = new Ctx();
    }
  } catch {
    return null;
  }
  return sharedCtx;
}

/**
 * Resumes the AudioContext after a user gesture (some browsers start suspended).
 * Call on first play; it is a no-op if already running.
 */
export function resumeNotificationAudioContext(): void {
  const ctx = getCtx();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume();
  }
}

/**
 * One soft “glass ping” (two short tones) — works well for chat, not a harsh beep.
 */
export function playTaskChatMessageSound(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
  master.gain.exponentialRampToValueAtTime(0.01, t0 + 0.2);
  master.connect(ctx.destination);

  for (const [freq, start] of [
    [880, 0] as const,
    [1180, 0.06] as const,
  ]) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t0 + start);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0 + start);
    g.gain.linearRampToValueAtTime(0.35, t0 + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.01, t0 + start + 0.15);
    o.connect(g);
    g.connect(master);
    o.start(t0 + start);
    o.stop(t0 + start + 0.16);
  }
}
