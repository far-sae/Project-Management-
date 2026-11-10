/**
 * One place for every alert sound (call ring, chat chime, bell chime).
 *
 * Why this exists — browsers only let a page make sound after the person has
 * interacted with it, and Safari (MacBooks) is the strictest:
 *   • Safari may ignore the first press for unlocking audio, so we keep
 *     trying on every press/click/key until the audio is actually running;
 *   • Safari puts audio into an "interrupted" state when the tab goes to the
 *     background, so we wake it from any non-running state, not only
 *     "suspended", and re-arm the unlock when it drops;
 *   • if Web Audio still can't run, we fall back to a plain <audio> element
 *     playing the same sound (generated as a small WAV) — an element that was
 *     started once during a click may be replayed later, which Safari is far
 *     more lenient about than Web Audio.
 */

export type Note = [offset: number, freq: number, duration: number, peak: number];
export type AlertSound = 'chat' | 'notification' | 'ring';

/** Chat / direct message: short A5 (880Hz) → fuller D5 (~587Hz). */
export const CHAT_NOTES: Note[] = [
  [0, 880, 0.18, 0.18],
  [0.11, 587.33, 0.42, 0.22],
];
/** Bell notification: C6 → G5. */
export const NOTIFICATION_NOTES: Note[] = [
  [0, 1046.5, 0.16, 0.18],
  [0.09, 783.99, 0.32, 0.2],
];
/** One 3-second ring cycle: G5 → B5 → D6, twice. */
export const RING_NOTES: Note[] = [
  [0, 784, 0.25, 0.2],
  [0.28, 988, 0.25, 0.22],
  [0.56, 1175, 0.4, 0.25],
  [1.2, 784, 0.25, 0.18],
  [1.48, 988, 0.25, 0.2],
  [1.76, 1175, 0.4, 0.22],
];
export const RING_CYCLE_SECONDS = 3;

const VOLUME: Record<AlertSound, number> = { chat: 0.6, notification: 0.5, ring: 0.5 };
const NOTES: Record<AlertSound, Note[]> = { chat: CHAT_NOTES, notification: NOTIFICATION_NOTES, ring: RING_NOTES };

type AudioCtor = typeof AudioContext;
let sharedCtx: AudioContext | null = null;
const fallbackEls = new Map<AlertSound, HTMLAudioElement>();
const primed = new Set<AlertSound>();

function getAudioCtor(win: Window): AudioCtor | null {
  const w = win as Window & { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext || w.webkitAudioContext || null;
}

export function getSharedContext(win: Window = window): AudioContext | null {
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

function isRunning(ctx: AudioContext | null): boolean {
  // Read through a widened type: the state changes asynchronously after resume().
  return !!ctx && (ctx.state as AudioContextState) === 'running';
}

/** Shared context, nudged awake if it isn't running (suspended or Safari's "interrupted"). */
export function getAlertAudioContext(): AudioContext | null {
  const ctx = getSharedContext();
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
    void Promise.resolve(ctx.resume()).catch(() => undefined);
  }
  return ctx;
}

/** Resolve with a running context, or null if it can't run right now (no gesture yet). */
export async function audibleContext(waitMs = 250): Promise<AudioContext | null> {
  const ctx = getSharedContext();
  if (!ctx) return null;
  if (isRunning(ctx)) return ctx;
  try {
    await Promise.race([
      Promise.resolve(ctx.resume()),
      new Promise((r) => setTimeout(r, waitMs)),
    ]);
  } catch {
    /* not allowed yet */
  }
  return isRunning(ctx) ? ctx : null;
}

/** Schedule notes on the context starting at `at` (context time). Returns the master gain. */
export function scheduleNotes(ctx: AudioContext, notes: Note[], volume: number, at: number): GainNode {
  const master = ctx.createGain();
  master.gain.setValueAtTime(volume, ctx.currentTime);
  master.connect(ctx.destination);
  for (const [offset, freq, duration, peak] of notes) {
    const start = at + offset;
    const stop = start + duration;
    const osc = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const g = ctx.createGain();
    const og = ctx.createGain();
    osc.type = 'sine';
    overtone.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);
    overtone.frequency.setValueAtTime(freq * 2.005, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, stop);
    og.gain.setValueAtTime(0.0001, start);
    og.gain.exponentialRampToValueAtTime(peak * 0.3, start + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, stop);
    osc.connect(g);
    overtone.connect(og);
    g.connect(master);
    og.connect(master);
    osc.start(start);
    overtone.start(start);
    osc.stop(stop + 0.02);
    overtone.stop(stop + 0.02);
  }
  return master;
}

// ── WAV fallback ──────────────────────────────────────────────

/** Render notes to a 16-bit mono PCM WAV (same timbre as the Web Audio version). */
export function synthWav(notes: Note[], volume: number, totalSeconds?: number, sampleRate = 22050): Uint8Array {
  const end = totalSeconds ?? Math.max(...notes.map(([o, , d]) => o + d)) + 0.05;
  const n = Math.ceil(end * sampleRate);
  const samples = new Float32Array(n);
  for (const [offset, freq, duration, peak] of notes) {
    const s0 = Math.floor(offset * sampleRate);
    const len = Math.floor(duration * sampleRate);
    const attack = 0.02 * sampleRate;
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / sampleRate;
      const env =
        i < attack
          ? 0.0001 * Math.pow(peak / 0.0001, i / attack)
          : peak * Math.pow(0.0001 / peak, (i - attack) / Math.max(1, len - attack));
      samples[s0 + i] +=
        env * Math.sin(2 * Math.PI * freq * t) + env * 0.3 * Math.sin(2 * Math.PI * freq * 2.005 * t);
    }
  }
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i] * volume * 2));
    v.setInt16(44 + i * 2, Math.round(x * 32767), true);
  }
  return bytes;
}

function wavDataUri(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:audio/wav;base64,${btoa(bin)}`;
}

function fallbackElement(kind: AlertSound): HTMLAudioElement | null {
  const existing = fallbackEls.get(kind);
  if (existing) return existing;
  if (typeof Audio === 'undefined') return null;
  try {
    const wav = synthWav(NOTES[kind], VOLUME[kind], kind === 'ring' ? RING_CYCLE_SECONDS : undefined);
    const el = new Audio(wavDataUri(wav));
    el.preload = 'auto';
    if (kind === 'ring') el.loop = true;
    fallbackEls.set(kind, el);
    return el;
  } catch {
    return null;
  }
}

/** Play the <audio> fallback. Returns stop(). */
export function playFallback(kind: AlertSound): () => void {
  const el = fallbackElement(kind);
  if (!el) return () => {};
  try {
    el.currentTime = 0;
    el.muted = false;
    void Promise.resolve(el.play()).catch(() => undefined);
  } catch {
    /* blocked */
  }
  return () => {
    try {
      el.pause();
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
  };
}

/** During a user gesture: start each fallback silently once so it can be replayed later. */
function primeFallbacks(): void {
  for (const kind of ['chat', 'notification', 'ring'] as AlertSound[]) {
    if (primed.has(kind)) continue;
    const el = fallbackElement(kind);
    if (!el) continue;
    try {
      el.muted = true;
      void Promise.resolve(el.play())
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
          primed.add(kind);
        })
        .catch(() => {
          el.muted = false;
        });
    } catch {
      el.muted = false;
    }
  }
}

// ── Unlock ────────────────────────────────────────────────────

const UNLOCK_EVENTS = ['pointerdown', 'mousedown', 'touchend', 'keydown', 'click'] as const;

/**
 * Keep trying to unlock alert audio on every press/click/key until it is
 * actually running (Safari ignores some events), and re-arm whenever the
 * browser suspends or interrupts it again. Returns a cleanup function.
 */
export function unlockAlertAudio(win: Window = window): () => void {
  let armed = false;
  let stopped = false;
  let watched: AudioContext | null = null;

  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const e of UNLOCK_EVENTS) win.removeEventListener(e, onGesture, true);
  };
  const arm = () => {
    if (armed || stopped) return;
    armed = true;
    for (const e of UNLOCK_EVENTS) win.addEventListener(e, onGesture, true);
  };
  const onStateChange = () => {
    if (!watched || stopped) return;
    if (watched.state === 'running') disarm();
    else if (watched.state !== 'closed') arm();
  };
  const watch = (ctx: AudioContext | null) => {
    if (!ctx || ctx === watched) return;
    watched = ctx;
    try {
      ctx.addEventListener?.('statechange', onStateChange);
    } catch {
      /* old browsers */
    }
  };
  function onGesture() {
    const ctx = getSharedContext(win);
    watch(ctx);
    primeFallbacks();
    if (!ctx) {
      disarm();
      return;
    }
    if (ctx.state === 'running') {
      disarm();
      return;
    }
    void Promise.resolve(ctx.resume())
      .then(() => {
        if (isRunning(ctx)) disarm();
      })
      .catch(() => undefined);
    if (isRunning(ctx)) disarm();
  }
  // Coming back to the tab: wake audio the browser interrupted while hidden.
  const onVisible = () => {
    if (win.document?.visibilityState === 'hidden') return;
    const ctx = sharedCtx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
      void Promise.resolve(ctx.resume()).catch(() => undefined);
      arm();
    }
  };

  arm();
  win.document?.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    disarm();
    win.document?.removeEventListener('visibilitychange', onVisible);
    try {
      watched?.removeEventListener?.('statechange', onStateChange);
    } catch {
      /* ignore */
    }
  };
}

/** Test hook. */
export function __resetAlertAudioForTests(): void {
  sharedCtx = null;
  fallbackEls.clear();
  primed.clear();
}
