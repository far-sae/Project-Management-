/**
 * The ringing sound the caller hears while the other phone rings.
 *
 * Usually the other side's phone company sends that sound itself. Many do not,
 * above all in the United States: the call shows "Ringing" and the caller
 * hears nothing until somebody answers. The phone library says when that is
 * the case, and this plays the country's own ringing tone in its place.
 */

export type RingCountry = 'US' | 'GB';

/**
 * A country's ringing tone: the two notes that sound together, and the rhythm
 * as [seconds on, seconds off] pairs that repeat.
 *   United States   440 + 480 Hz, two seconds on, four off
 *   United Kingdom  400 + 450 Hz, "ring ring": 0.4 on, 0.2 off, 0.4 on, 2 off
 */
export const RING_PATTERN: Record<RingCountry, { tones: [number, number]; rhythm: Array<[number, number]> }> = {
  US: { tones: [440, 480], rhythm: [[2, 4]] },
  GB: { tones: [400, 450], rhythm: [[0.4, 0.2], [0.4, 2]] },
};

/** How loud the tone is (0 to 1): clearly there, never startling. */
export const RING_VOLUME = 0.12;
/** How far ahead the rhythm is laid out. A call stops ringing well before this. */
export const RING_SECONDS_AHEAD = 90;

/** When the tone is on, as [start, end] seconds from the beginning, for `seconds` of ringing. */
export function ringTimes(country: RingCountry, seconds: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const rhythm = RING_PATTERN[country].rhythm;
  let at = 0;
  for (let i = 0; at < seconds; i += 1) {
    const [on, off] = rhythm[i % rhythm.length];
    out.push([at, Math.min(at + on, seconds)]);
    at += on + off;
  }
  return out;
}

type AudioContextLike = Pick<AudioContext, 'currentTime' | 'destination' | 'createOscillator' | 'createGain' | 'close'>;

const browserContext = (): AudioContextLike | null => {
  if (typeof window === 'undefined') return null;
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
};

/**
 * Starts the ringing tone and answers with the way to stop it. Stopping twice
 * does no harm. In a browser that cannot make sound this does nothing.
 */
export function startRingback(country: RingCountry, make: () => AudioContextLike | null = browserContext): () => void {
  const context = make();
  if (!context) return () => undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      for (const tone of tones) tone.stop();
    } catch {
      /* already stopped */
    }
    void Promise.resolve(context.close()).catch(() => undefined);
  };
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(context.destination);
  const tones = RING_PATTERN[country].tones.map((frequency) => {
    const tone = context.createOscillator();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    tone.connect(gain);
    return tone;
  });
  try {
    const start = context.currentTime + 0.05;
    for (const [from, to] of ringTimes(country, RING_SECONDS_AHEAD)) {
      gain.gain.setValueAtTime(RING_VOLUME, start + from);
      gain.gain.setValueAtTime(0, start + to);
    }
    for (const tone of tones) tone.start();
  } catch {
    stop();
  }
  return stop;
}
