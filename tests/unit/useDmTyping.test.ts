// "Alice is typing…": each side tells the other while it types, and the notice fades by itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  names: [] as string[],
  sent: [] as Array<Record<string, unknown>>,
  onTyping: null as ((m: { payload: { userId: string } }) => void) | null,
  removed: 0,
}));

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    channel: (name: string) => {
      h.names.push(name);
      const channel = {
        on: (_kind: string, _filter: unknown, cb: (m: { payload: { userId: string } }) => void) => {
          h.onTyping = cb;
          return channel;
        },
        subscribe: () => channel,
        send: (message: Record<string, unknown>) => {
          h.sent.push(message);
          return Promise.resolve('ok');
        },
      };
      return channel;
    },
    removeChannel: () => {
      h.removed += 1;
      return Promise.resolve('ok');
    },
  },
}));

import { useDmTyping } from '@/hooks/useDmTyping';

beforeEach(() => {
  vi.useFakeTimers();
  h.names = [];
  h.sent = [];
  h.onTyping = null;
  h.removed = 0;
});
afterEach(() => vi.useRealTimers());

describe('useDmTyping', () => {
  it('both people join the same channel for their conversation', () => {
    renderHook(() => useDmTyping('alice', 'bob'));
    renderHook(() => useDmTyping('bob', 'alice'));
    expect(h.names[0]).toBe(h.names[1]);
  });

  it('tells the other person I am typing, at most once every two seconds', () => {
    const { result } = renderHook(() => useDmTyping('me', 'alice'));
    act(() => {
      result.current.notifyTyping();
      result.current.notifyTyping();
    });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ type: 'broadcast', event: 'typing', payload: { userId: 'me' } });
    act(() => {
      vi.advanceTimersByTime(2100);
      result.current.notifyTyping();
    });
    expect(h.sent).toHaveLength(2);
  });

  it('shows the other person typing, and stops a few seconds after they stop', () => {
    const { result } = renderHook(() => useDmTyping('me', 'alice'));
    expect(result.current.otherTyping).toBe(false);
    act(() => h.onTyping?.({ payload: { userId: 'alice' } }));
    expect(result.current.otherTyping).toBe(true);
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(result.current.otherTyping).toBe(false);
  });

  it('ignores my own typing', () => {
    const { result } = renderHook(() => useDmTyping('me', 'alice'));
    act(() => h.onTyping?.({ payload: { userId: 'me' } }));
    expect(result.current.otherTyping).toBe(false);
  });

  it('leaves the channel when the chat closes', () => {
    const { unmount } = renderHook(() => useDmTyping('me', 'alice'));
    unmount();
    expect(h.removed).toBe(1);
  });
});
