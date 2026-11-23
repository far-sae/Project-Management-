// "Ringing" is never silent: when the other side's phone company sends no
// ringing sound (common for United States numbers), the caller hears ours.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  handlers: {} as Record<string, (arg?: unknown) => void>,
  connect: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('@twilio/voice-sdk', () => ({
  Device: class {
    on() { /* device-level errors are not part of these tests */ }
    destroy() { sdk.destroy(); }
    async connect(options: unknown) {
      sdk.connect(options);
      return {
        on: (event: string, handler: (arg?: unknown) => void) => { sdk.handlers[event] = handler; },
        disconnect: vi.fn(), mute: vi.fn(), sendDigits: vi.fn(),
      };
    }
  },
}));

import { openLine } from '@/services/voice/device';
import { RING_PATTERN, RING_VOLUME, ringTimes, startRingback } from '@/services/voice/ringback';
import { dialTwiml } from '../../../api/_voice/twiml';

beforeEach(() => {
  sdk.handlers = {};
  sdk.connect.mockClear();
  sdk.destroy.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('each country’s ringing tone', () => {
  it('is the one people know from their own phones', () => {
    expect(RING_PATTERN.US).toEqual({ tones: [440, 480], rhythm: [[2, 4]] });
    expect(RING_PATTERN.GB).toEqual({ tones: [400, 450], rhythm: [[0.4, 0.2], [0.4, 2]] });
  });

  it('rings two seconds in every six in the United States', () => {
    expect(ringTimes('US', 14)).toEqual([[0, 2], [6, 8], [12, 14]]);
  });

  it('rings "ring ring", then waits, in the United Kingdom', () => {
    const times = ringTimes('GB', 4).map(([from, to]) => [Number(from.toFixed(2)), Number(to.toFixed(2))]);
    expect(times).toEqual([[0, 0.4], [0.6, 1], [3, 3.4], [3.6, 4]]);
  });
});

describe('playing it', () => {
  const fakeContext = () => {
    const gainTimes: Array<[number, number]> = [];
    const tones: Array<{ frequency: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; type: string }> = [];
    const context = {
      currentTime: 10,
      destination: {},
      close: vi.fn(async () => {}),
      createGain: () => ({ gain: { value: 1, setValueAtTime: (value: number, at: number) => { gainTimes.push([value, at]); } }, connect: vi.fn() }),
      createOscillator: () => {
        const tone = { frequency: { value: 0 }, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), type: '' };
        tones.push(tone);
        return tone;
      },
    };
    return { context, gainTimes, tones };
  };

  it('sounds the two notes together, quietly, in the country’s rhythm', () => {
    const { context, gainTimes, tones } = fakeContext();
    startRingback('US', () => context as never);
    expect(tones.map((t) => t.frequency.value)).toEqual([440, 480]);
    expect(tones.every((t) => t.start.mock.calls.length === 1)).toBe(true);
    // On at the start, off two seconds later, on again four seconds after that.
    expect(gainTimes.slice(0, 3).map(([value, at]) => [value, Number((at - 10.05).toFixed(2))])).toEqual([[RING_VOLUME, 0], [0, 2], [RING_VOLUME, 6]]);
  });

  it('stops for good when asked, and stopping twice does no harm', () => {
    const { context, tones } = fakeContext();
    const stop = startRingback('GB', () => context as never);
    stop();
    stop();
    expect(tones.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('does nothing in a browser that cannot make sound', () => {
    expect(() => startRingback('US', () => null)()).not.toThrow();
  });
});

describe('a call that is ringing', () => {
  const open = async (country: 'US' | 'GB' = 'US') => {
    const stop = vi.fn();
    const ring = vi.fn(() => stop);
    const events: string[] = [];
    await openLine('token', 'call-1', (event) => { events.push(event); }, country, ring);
    return { stop, ring, events };
  };

  it('plays our ringing tone when the other side sends none, in the country that is rung', async () => {
    const { ring, events } = await open('US');
    sdk.handlers.ringing(false);
    expect(ring).toHaveBeenCalledWith('US');
    expect(events).toEqual(['ringing']);
    const uk = await open('GB');
    sdk.handlers.ringing(false);
    expect(uk.ring).toHaveBeenCalledWith('GB');
  });

  it('leaves the other side’s own ringing alone when there is some: never two at once', async () => {
    const { ring } = await open();
    sdk.handlers.ringing(true);
    expect(ring).not.toHaveBeenCalled();
  });

  it('starts the tone once, however often the library says "ringing"', async () => {
    const { ring } = await open();
    sdk.handlers.ringing(false);
    sdk.handlers.ringing(false);
    expect(ring).toHaveBeenCalledTimes(1);
  });

  it('stops the tone the moment the call is answered', async () => {
    const { stop, events } = await open();
    sdk.handlers.ringing(false);
    sdk.handlers.accept();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['ringing', 'answered']);
  });

  it('stops the tone when the call ends without an answer, or fails', async () => {
    for (const how of ['disconnect', 'cancel', 'reject', 'error']) {
      const { stop } = await open();
      sdk.handlers.ringing(false);
      sdk.handlers[how]({ code: 31005 });
      expect(stop, how).toHaveBeenCalledTimes(1);
    }
  });
});

describe('what the phone provider is told', () => {
  it('is to play the rung country’s ringing to the caller straight away', () => {
    const us = dialTwiml({ base: 'https://app.example.com', callId: 'c1', to: '+14155550132', callerId: '+14155550100', country: 'US' });
    const uk = dialTwiml({ base: 'https://app.example.com', callId: 'c1', to: '+442079460958', callerId: '+442079460000', country: 'GB' });
    expect(us).toContain('ringTone="us"');
    expect(uk).toContain('ringTone="uk"');
    expect(us).toContain('answerOnBridge="true"');
  });
});
