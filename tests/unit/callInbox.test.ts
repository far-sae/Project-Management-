import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeCallInbox } from '@/services/calling/callInbox';

type StatusCb = (status: string) => void;

class FakeChannel {
  state = 'joining';
  handler: ((m: { payload: unknown }) => void) | null = null;
  statusCb: StatusCb | null = null;
  constructor(public name: string) {}
  on(_type: string, _filter: unknown, cb: (m: { payload: unknown }) => void) {
    this.handler = cb;
    return this;
  }
  subscribe(cb: StatusCb) {
    this.statusCb = cb;
    return this;
  }
  emit(status: string) {
    if (status === 'SUBSCRIBED') this.state = 'joined';
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') this.state = 'errored';
    if (status === 'CLOSED') this.state = 'closed';
    this.statusCb?.(status);
  }
}

function fakeClient() {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  return {
    channels,
    removed,
    channel: vi.fn((name: string) => {
      const c = new FakeChannel(name);
      channels.push(c);
      return c;
    }),
    removeChannel: vi.fn(async (c: FakeChannel) => {
      removed.push(c);
      c.emit('CLOSED');
    }),
  };
}

describe('subscribeCallInbox', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("listens on the user's call inbox and passes rings on", () => {
    const client = fakeClient();
    const onSignal = vi.fn();
    const stop = subscribeCallInbox(client as never, 'u1', onSignal);
    expect(client.channels[0].name).toBe('call-inbox:u1');
    client.channels[0].handler?.({ payload: { type: 'ring' } });
    expect(onSignal).toHaveBeenCalledWith({ type: 'ring' });
    stop();
  });

  it('re-subscribes after the connection fails, so later rings still arrive', () => {
    const client = fakeClient();
    const onSignal = vi.fn();
    const stop = subscribeCallInbox(client as never, 'u1', onSignal);
    client.channels[0].emit('SUBSCRIBED');
    client.channels[0].emit('CHANNEL_ERROR');
    vi.advanceTimersByTime(1000);
    expect(client.channels).toHaveLength(2);
    expect(client.removed).toContain(client.channels[0]);
    client.channels[1].handler?.({ payload: { type: 'ring' } });
    expect(onSignal).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reconnects straight away when the tab comes back if the inbox dropped', () => {
    const client = fakeClient();
    const stop = subscribeCallInbox(client as never, 'u1', vi.fn());
    client.channels[0].state = 'closed';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(client.channels).toHaveLength(2);
    // Healthy inbox: coming back does nothing.
    client.channels[1].emit('SUBSCRIBED');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(client.channels).toHaveLength(2);
    stop();
  });

  it('stops cleanly without reconnecting', () => {
    const client = fakeClient();
    const stop = subscribeCallInbox(client as never, 'u1', vi.fn());
    stop();
    vi.advanceTimersByTime(60_000);
    expect(client.removed).toContain(client.channels[0]);
    expect(client.channels).toHaveLength(1);
  });
});
