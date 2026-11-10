import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  playChatChime: vi.fn(),
  appIsInFront: vi.fn(() => false),
  handler: null as null | ((p: { new: Record<string, unknown> }) => void),
  filter: '' as string,
  removeChannel: vi.fn(),
  profile: { display_name: 'Ana', email: 'ana@x.com' } as Record<string, unknown> | null,
}));

vi.mock('@/lib/notificationSound', () => ({ playChatChime: m.playChatChime }));
vi.mock('@/services/calling/incomingAlert', () => ({ appIsInFront: m.appIsInFront }));
vi.mock('@/services/supabase/config', () => {
  const channel = {
    on: (_t: string, f: { filter: string }, cb: typeof m.handler) => {
      m.filter = f.filter;
      m.handler = cb;
      return channel;
    },
    subscribe: () => channel,
  };
  return {
    supabase: {
      channel: () => channel,
      removeChannel: m.removeChannel,
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: m.profile, error: null }) }),
        }),
      }),
    },
  };
});

import { useIncomingMessageAlerts } from '@/hooks/useIncomingMessageAlerts';

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

beforeEach(() => {
  m.playChatChime.mockReset();
  m.appIsInFront.mockReturnValue(false);
  m.handler = null;
  FakeNotification.instances = [];
  FakeNotification.permission = 'granted';
  (window as unknown as { Notification: unknown }).Notification = FakeNotification;
});
afterEach(cleanup);

describe('useIncomingMessageAlerts', () => {
  it('listens for direct messages sent to me', () => {
    renderHook(() => useIncomingMessageAlerts('me'));
    expect(m.filter).toBe('recipient_id=eq.me');
  });

  it('chimes and shows who wrote when TaskCalendar is not in front', async () => {
    renderHook(() => useIncomingMessageAlerts('me'));
    m.handler?.({ new: { sender_id: 'u-ana', recipient_id: 'me', body: 'Can you check the invoice?' } });
    expect(m.playChatChime).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    expect(FakeNotification.instances[0].title).toBe('New message from Ana');
    expect(FakeNotification.instances[0].options.body).toBe('Can you check the invoice?');
  });

  it('only chimes when the app is already in front', async () => {
    m.appIsInFront.mockReturnValue(true);
    renderHook(() => useIncomingMessageAlerts('me'));
    m.handler?.({ new: { sender_id: 'u-ana', recipient_id: 'me', body: 'hi' } });
    expect(m.playChatChime).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('says "Sent an attachment" for a file with no text', async () => {
    renderHook(() => useIncomingMessageAlerts('me'));
    m.handler?.({ new: { sender_id: 'u-ana', recipient_id: 'me', body: '' } });
    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    expect(FakeNotification.instances[0].options.body).toBe('Sent an attachment');
  });

  it('does nothing when signed out', () => {
    m.filter = '';
    renderHook(() => useIncomingMessageAlerts(null));
    expect(m.filter).toBe('');
  });
});
