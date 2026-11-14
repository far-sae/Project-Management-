import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const h = vi.hoisted(() => ({
  isViewer: false,
  sent: [] as Array<{ channel: string; payload: { type: string; reason?: string } }>,
  svc: {
    opts: null as null | { onParticipantsChange: (p: unknown[]) => void },
    connect: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    disconnect: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    setRecordingFlag: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
  },
  api: {
    createGuestInvite: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    admitGuest: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    denyGuest: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
  },
  inbox: null as null | ((p: unknown) => void),
  missed: [] as unknown[],
  toast: null as unknown as Record<string, ReturnType<typeof import('vitest').vi.fn>>,
}));

vi.mock('@/services/supabase/config', () => {
  const channel = (name: string) => {
    const ch = {
      on: () => ch,
      subscribe: (cb?: (s: string) => void) => {
        cb?.('SUBSCRIBED');
        return ch;
      },
      send: (msg: { payload: { type: string; reason?: string } }) => {
        h.sent.push({ channel: name, payload: msg.payload });
      },
    };
    return ch;
  };
  return { supabase: { channel, removeChannel: () => Promise.resolve() } };
});
const USER = { userId: 'me', displayName: 'Me', email: 'me@x.io' };
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: USER }) }));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({ isViewer: h.isViewer }),
}));
vi.mock('@/services/webrtc/mediaUtils', () => ({ isMediaSupported: () => true }));
vi.mock('@/services/livekit/LiveKitCallService', () => ({
  LiveKitCallService: class {
    constructor(o: { onParticipantsChange: (p: unknown[]) => void }) {
      h.svc.opts = o;
    }
    connect = (...a: unknown[]) => h.svc.connect(...a);
    disconnect = (...a: unknown[]) => h.svc.disconnect(...a);
    setRecordingFlag = (...a: unknown[]) => h.svc.setRecordingFlag(...a);
  },
}));
vi.mock('@/services/livekit/guestApi', () => ({
  createGuestInvite: (...a: unknown[]) => h.api.createGuestInvite(...a),
  admitGuest: (...a: unknown[]) => h.api.admitGuest(...a),
  denyGuest: (...a: unknown[]) => h.api.denyGuest(...a),
  GuestApiError: class extends Error {
    code?: string;
    constructor(m: string, code?: string) {
      super(m);
      this.code = code;
    }
  },
}));
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    warning: vi.fn(),
  });
  h.toast = toast as unknown as Record<string, ReturnType<typeof vi.fn>>;
  return { toast };
});

vi.mock('@/services/calling/callInbox', () => ({
  subscribeCallInbox: (_c: unknown, _u: string, onSignal: (p: unknown) => void) => {
    h.inbox = onSignal;
    return () => {};
  },
}));
vi.mock('@/services/calling/missedCall', async (orig) => ({
  ...(await orig<typeof import('@/services/calling/missedCall')>()),
  showMissedCallNotification: (p: unknown) => h.missed.push(p),
}));

import { CallProvider, useCallContext } from '@/components/calling/CallProvider';

type Ctx = ReturnType<typeof useCallContext>;
let ctx: Ctx;
const Probe: React.FC = () => {
  ctx = useCallContext();
  return null;
};
const renderProvider = () =>
  render(
    <CallProvider>
      <Probe />
    </CallProvider>,
  );

const SAM = { userId: 'sam', displayName: 'Sam' };
const ring = (over: Record<string, unknown> = {}) => ({
  type: 'ring',
  callId: 'c1',
  roomName: 'dm:me__sam',
  mediaType: 'video',
  context: { type: 'dm', targetId: 'me', label: 'Me' },
  from: SAM,
  ...over,
});

beforeEach(() => {
  h.inbox = null;
  h.missed = [];
  h.sent = [];
  h.svc.connect = vi.fn(async () => {});
  h.svc.disconnect = vi.fn(async () => {});
  h.svc.setRecordingFlag = vi.fn(async () => {});
  h.toast.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CallProvider — answering like Teams', () => {
  it('answers a video call with audio only (camera stays off)', async () => {
    renderProvider();
    act(() => h.inbox!(ring()));
    expect(ctx.state.status).toBe('ringing');
    await act(async () => {
      await ctx.actions.acceptCall({ audioOnly: true });
    });
    expect(h.svc.connect).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: 'dm:me__sam', mediaType: 'audio' }),
    );
    // Still a video call, so the camera button is there to turn it on later.
    expect(ctx.state.mediaType).toBe('video');
    expect(ctx.state.isCameraOff).toBe(true);
  });

  it('answers with video by default', async () => {
    renderProvider();
    act(() => h.inbox!(ring()));
    await act(async () => {
      await ctx.actions.acceptCall();
    });
    expect(h.svc.connect).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'video' }));
  });

  it('shows "Missed call" with Call back when nobody answers in time', async () => {
    vi.useFakeTimers();
    renderProvider();
    act(() => h.inbox!(ring({ mediaType: 'audio' })));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(ctx.state.status).toBe('idle');
    expect(h.toast).toHaveBeenCalledWith(
      'Missed call from Sam',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Call back' }) }),
    );
    expect(h.missed).toEqual([{ callerName: 'Sam', mediaType: 'audio', contextLabel: undefined }]);
  });

  it('shows "Missed call" when the caller hangs up before you answer', () => {
    renderProvider();
    act(() => h.inbox!(ring()));
    act(() => h.inbox!({ type: 'ring-cancel', callId: 'c1', from: SAM, reason: 'cancelled' }));
    expect(ctx.state.status).toBe('idle');
    expect(h.toast).toHaveBeenCalledWith('Missed call from Sam', expect.anything());
  });

  it('does not call it missed when a teammate picked up a project call', () => {
    renderProvider();
    act(() =>
      h.inbox!(ring({ roomName: 'project:p1', context: { type: 'project', targetId: 'p1', label: 'Web' }, isMultiParty: true })),
    );
    act(() => h.inbox!({ type: 'ring-cancel', callId: 'c1', from: SAM, reason: 'taken' }));
    expect(ctx.state.status).toBe('idle');
    expect(h.toast).not.toHaveBeenCalledWith('Missed call from Sam', expect.anything());
  });

  it('declining is not a missed call', () => {
    renderProvider();
    act(() => h.inbox!(ring()));
    act(() => ctx.actions.rejectCall());
    expect(h.toast).not.toHaveBeenCalledWith('Missed call from Sam', expect.anything());
  });

  it('Call back rings the caller', async () => {
    vi.useFakeTimers();
    renderProvider();
    act(() => h.inbox!(ring({ mediaType: 'audio' })));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    const opts = h.toast.mock.calls.find((c) => c[0] === 'Missed call from Sam')![1];
    await act(async () => {
      opts.action.onClick();
    });
    expect(ctx.state.direction).toBe('outgoing');
    expect(ctx.state.remoteParticipant?.userId).toBe('sam');
    expect(ctx.state.mediaType).toBe('audio');
  });
});
