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

const snap = (over: Record<string, unknown>) => ({
  userId: 'u',
  displayName: 'X',
  audioStream: null,
  videoStream: null,
  isMicMuted: false,
  isCameraOff: false,
  isScreenSharing: false,
  isSpeaking: false,
  isLocal: false,
  role: 'member',
  isWaiting: false,
  isRecording: false,
  ...over,
});
const local = snap({ userId: 'me', displayName: 'Me', isLocal: true });
const PROJECT = { type: 'project' as const, targetId: 'p1', label: 'Acme' };

beforeEach(() => {
  h.isViewer = false;
  h.sent = [];
  h.svc.opts = null;
  h.svc.connect = vi.fn(async () => {});
  h.svc.disconnect = vi.fn(async () => {});
  h.svc.setRecordingFlag = vi.fn(async () => {});
  h.api.createGuestInvite = vi.fn(async () => ({
    url: 'https://taskcalendar.co.uk/join/abc',
    expiresAt: 'x',
  }));
  h.api.admitGuest = vi.fn(async () => {});
  h.api.denyGuest = vi.fn(async () => {});
  for (const k of ['success', 'error', 'message', 'warning']) h.toast[k].mockClear();
});
afterEach(cleanup);

describe('CallProvider — meetings and guests', () => {
  it('startMeeting joins the project room without ringing anyone', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startMeeting(PROJECT, 'video');
    });
    expect(h.svc.connect).toHaveBeenCalledWith(
      expect.objectContaining({ roomName: 'project:p1', mediaType: 'video' }),
    );
    expect(ctx.state.status).toBe('connected');
    expect(ctx.state.direction).toBe('outgoing');
    expect(ctx.state.isOpenMeeting).toBe(true);
    expect(ctx.state.roomName).toBe('project:p1');
    expect(h.sent.filter((s) => s.payload.type === 'ring')).toHaveLength(0);
  });

  it('hanging up during the dynamic import never connects (startMeeting)', async () => {
    renderProvider();
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = ctx.actions.startMeeting(PROJECT, 'video');
    });
    expect(ctx.state.status).toBe('connecting');
    act(() => ctx.actions.hangUp());
    await act(async () => {
      await pending;
    });
    expect(h.svc.connect).not.toHaveBeenCalled();
    expect(ctx.state.status).toBe('idle');
  });

  it('hanging up during the dynamic import never connects (startCall)', async () => {
    renderProvider();
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = ctx.actions.startCall(PROJECT, 'video', [{ userId: 'a', displayName: 'A' }]);
    });
    act(() => ctx.actions.hangUp());
    await act(async () => {
      await pending;
    });
    expect(h.svc.connect).not.toHaveBeenCalled();
  });

  it('startMeeting ignores DM contexts', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startMeeting({ type: 'dm', targetId: 'u2', label: 'U2' }, 'video');
    });
    expect(h.svc.connect).not.toHaveBeenCalled();
    expect(ctx.state.status).toBe('idle');
  });

  it('an open meeting does not end when the member is alone', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startMeeting(PROJECT, 'audio');
    });
    act(() => h.svc.opts!.onParticipantsChange([local]));
    expect(ctx.state.status).toBe('connected');
  });

  it('inviteGuest copies the link and confirms with a toast', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderProvider();
    await act(async () => {
      await ctx.actions.startMeeting(PROJECT, 'video');
    });
    await act(async () => {
      await ctx.actions.inviteGuest();
    });
    expect(h.api.createGuestInvite).toHaveBeenCalledWith('project:p1');
    expect(writeText).toHaveBeenCalledWith('https://taskcalendar.co.uk/join/abc');
    expect(h.toast.success).toHaveBeenCalledWith('Guest link copied — it works for 24 hours');
  });

  it('inviteGuest shows the link for manual copy when the clipboard fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null);
    renderProvider();
    await act(async () => {
      await ctx.actions.startMeeting(PROJECT, 'video');
    });
    await act(async () => {
      await ctx.actions.inviteGuest();
    });
    expect(prompt).toHaveBeenCalledWith(
      expect.stringContaining('24 hours'),
      'https://taskcalendar.co.uk/join/abc',
    );
    expect(h.toast.success).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it('inviteGuest toasts an error when the server refuses', async () => {
    h.api.createGuestInvite = vi.fn(async () => {
      throw Object.assign(new Error('nope'), { code: 'FORBIDDEN' });
    });
    renderProvider();
    await act(async () => {
      await ctx.actions.startMeeting(PROJECT, 'video');
    });
    await act(async () => {
      await ctx.actions.inviteGuest();
    });
    expect(h.toast.error).toHaveBeenCalled();
  });

  it('admitGuest / denyGuest call the API with the current room', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startMeeting(PROJECT, 'video');
    });
    await act(async () => {
      await ctx.actions.admitGuest('guest:1');
      await ctx.actions.denyGuest('guest:2');
    });
    expect(h.api.admitGuest).toHaveBeenCalledWith('project:p1', 'guest:1');
    expect(h.api.denyGuest).toHaveBeenCalledWith('project:p1', 'guest:2');
  });

  it('setRecordingFlag forwards to the LiveKit service', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startMeeting(PROJECT, 'video');
    });
    await act(async () => {
      await ctx.actions.setRecordingFlag(true);
    });
    expect(h.svc.setRecordingFlag).toHaveBeenCalledWith(true);
  });

  it('canInviteGuests follows the org viewer rule', () => {
    h.isViewer = true;
    renderProvider();
    expect(ctx.canInviteGuests).toBe(false);
    cleanup();
    h.isViewer = false;
    renderProvider();
    expect(ctx.canInviteGuests).toBe(true);
  });

  it('a waiting guest does not connect an outgoing ring; an admitted guest does not cancel rings', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startCall(PROJECT, 'video', [
        { userId: 'a', displayName: 'A' },
        { userId: 'b', displayName: 'B' },
      ]);
    });
    expect(ctx.state.status).toBe('ringing');
    const waiting = snap({ userId: 'guest:1', displayName: 'G', role: 'guest', isWaiting: true });
    act(() => h.svc.opts!.onParticipantsChange([local, waiting]));
    expect(ctx.state.status).toBe('ringing');
    expect(ctx.state.participants).toHaveLength(2); // overlay filters, state keeps all

    const admitted = { ...waiting, isWaiting: false };
    act(() => h.svc.opts!.onParticipantsChange([local, admitted]));
    expect(h.sent.filter((s) => s.payload.type === 'ring-cancel')).toHaveLength(0);

    act(() =>
      h.svc.opts!.onParticipantsChange([local, admitted, snap({ userId: 'a', displayName: 'A' })]),
    );
    const cancels = h.sent.filter((s) => s.payload.type === 'ring-cancel');
    expect(cancels.map((c) => c.channel)).toEqual(['call-inbox:b']);
  });

  it('hanging up after admitting a guest mid-ring cancels the teammates still ringing', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startCall(PROJECT, 'video', [
        { userId: 'a', displayName: 'A' },
        { userId: 'b', displayName: 'B' },
      ]);
    });
    const guest = snap({ userId: 'guest:1', displayName: 'G', role: 'guest' });
    act(() => h.svc.opts!.onParticipantsChange([local, guest]));
    expect(ctx.state.status).toBe('connected');
    h.sent = [];
    act(() => ctx.actions.hangUp());
    const cancels = h.sent.filter((s) => s.payload.type === 'ring-cancel');
    expect(cancels.map((c) => c.channel).sort()).toEqual(['call-inbox:a', 'call-inbox:b']);
  });

  it('auto-ending after an admitted guest leaves mid-ring cancels the teammates still ringing', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startCall(PROJECT, 'video', { userId: 'a', displayName: 'A' });
    });
    const guest = snap({ userId: 'guest:1', displayName: 'G', role: 'guest' });
    act(() => h.svc.opts!.onParticipantsChange([local, guest]));
    h.sent = [];
    act(() => h.svc.opts!.onParticipantsChange([local]));
    expect(ctx.state.status).toBe('idle');
    const cancels = h.sent.filter((s) => s.payload.type === 'ring-cancel');
    expect(cancels.map((c) => c.channel)).toEqual(['call-inbox:a']);
  });

  it('hanging up after a teammate answered sends no ring-cancel (unchanged)', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startCall(PROJECT, 'video', { userId: 'a', displayName: 'A' });
    });
    act(() => h.svc.opts!.onParticipantsChange([local, snap({ userId: 'a', displayName: 'A' })]));
    h.sent = [];
    act(() => ctx.actions.hangUp());
    expect(h.sent.filter((s) => s.payload.type === 'ring-cancel')).toHaveLength(0);
  });

  it('hanging up an open meeting sends no ring-cancel', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startMeeting(PROJECT, 'video');
    });
    act(() => ctx.actions.hangUp());
    expect(h.sent.filter((s) => s.payload.type === 'ring-cancel')).toHaveLength(0);
  });

  it('a normal call still ends when only a waiting guest remains', async () => {
    renderProvider();
    await act(async () => {
      await ctx.actions.startCall(PROJECT, 'video', { userId: 'a', displayName: 'A' });
    });
    act(() => h.svc.opts!.onParticipantsChange([local, snap({ userId: 'a', displayName: 'A' })]));
    expect(ctx.state.status).toBe('connected');
    const waiting = snap({ userId: 'guest:1', displayName: 'G', role: 'guest', isWaiting: true });
    act(() => h.svc.opts!.onParticipantsChange([local, waiting]));
    expect(ctx.state.status).toBe('idle');
  });

  it('a call stuck on "Connecting" gives up after 45 s so new calls can ring again', async () => {
    vi.useFakeTimers();
    try {
      h.svc.connect = vi.fn(() => new Promise<void>(() => {})); // never connects
      renderProvider();
      act(() => {
        void ctx.actions.startMeeting(PROJECT, 'video');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(ctx.state.status).toBe('connecting');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000);
      });
      expect(ctx.state.status).toBe('ended');
      expect(ctx.state.error).toMatch(/couldn't connect/i);
      expect(h.svc.disconnect).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

