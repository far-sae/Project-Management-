import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const joinAsGuest = vi.fn();
vi.mock('@/services/livekit/guestApi', () => ({
  joinAsGuest: (...a: unknown[]) => joinAsGuest(...a),
  GuestApiError: class extends Error {
    code?: string;
    constructor(m: string, code?: string) {
      super(m);
      this.code = code;
    }
  },
}));
// The test browser has no screen picker; the real check is the browser's own.
vi.mock('@/services/webrtc/mediaUtils', async (original) => ({
  ...(await original<typeof import('@/services/webrtc/mediaUtils')>()),
  isScreenShareSupported: () => true,
}));
vi.mock('@/services/webrtc/BackgroundProcessor', () => ({
  isBackgroundEffectSupported: () => true,
}));

interface Opts {
  onParticipantsChange: (p: unknown[]) => void;
  onDisconnected: (r: unknown) => void;
}
const svc = {
  opts: null as Opts | null,
  connect: vi.fn(async () => {}),
  publishLocalMedia: vi.fn(async () => {}),
  setMicMuted: vi.fn(async () => {}),
  setCameraOff: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  setBackgroundBlur: vi.fn(async () => {}),
  toggleScreenShare: vi.fn(async () => {}),
};
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
vi.mock('@/services/livekit/LiveKitCallService', () => ({
  LiveKitCallService: class {
    constructor(o: Opts) {
      svc.opts = o;
    }
    connect = svc.connect;
    publishLocalMedia = svc.publishLocalMedia;
    setMicMuted = svc.setMicMuted;
    setCameraOff = svc.setCameraOff;
    disconnect = svc.disconnect;
    setBackgroundBlur = svc.setBackgroundBlur;
    toggleScreenShare = svc.toggleScreenShare;
  },
}));

import { GuestJoin } from '@/pages/GuestJoin';
import { GuestApiError as FakeGuestApiError } from '@/services/livekit/guestApi';

const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `${b64({ room: 'project:1', exp: 9999999999, label: 'Acme Kickoff', inviterName: 'Sam' })}.sig`;

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/join/${TOKEN}`]}>
      <Routes>
        <Route path="/join/:token" element={<GuestJoin />} />
      </Routes>
    </MemoryRouter>,
  );
}

const trackStop = vi.fn();

beforeEach(() => {
  joinAsGuest.mockReset();
  svc.connect.mockClear();
  svc.publishLocalMedia.mockClear();
  svc.disconnect.mockClear();
  svc.setBackgroundBlur.mockReset().mockResolvedValue(undefined);
  toastError.mockClear();
  trackStop.mockClear();
  const stream = {
    getTracks: () => [{ stop: trackStop, enabled: true, kind: 'video' }],
    getAudioTracks: () => [{ stop: trackStop, enabled: true }],
    getVideoTracks: () => [{ stop: trackStop, enabled: true }],
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});
afterEach(cleanup);

async function askToJoin() {
  fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Pat' } });
  fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
}

describe('GuestJoin', () => {
  it('shows recording notice, label, inviter, and disables Ask to join until a name is typed', () => {
    renderPage();
    expect(screen.getByText('This call may be recorded.')).toBeTruthy();
    expect(screen.getByText('Acme Kickoff')).toBeTruthy();
    expect(screen.getByText(/Invited by Sam/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /ask to join/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Pat' } });
    expect(btn.disabled).toBe(false);
  });

  it('shows expired copy on INVITE_EXPIRED', async () => {
    joinAsGuest.mockRejectedValue(new FakeGuestApiError('x', 'INVITE_EXPIRED'));
    renderPage();
    await askToJoin();
    expect(await screen.findByText('This link has expired — ask for a new one.')).toBeTruthy();
  });

  it('shows waiting copy after Ask to join, stopping preview tracks first', async () => {
    joinAsGuest.mockResolvedValue({ token: 't', url: 'u', label: 'L', identity: 'guest:1' });
    renderPage();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await askToJoin();
    expect(await screen.findByText('Waiting for the host to join…')).toBeTruthy();
    expect(trackStop).toHaveBeenCalled();
    expect(svc.connect).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { token: 't', url: 'u' }, publishOnConnect: false }),
    );
  });

  it('enters the call and publishes media when admitted', async () => {
    joinAsGuest.mockResolvedValue({ token: 't', url: 'u', label: 'L', identity: 'guest:1' });
    renderPage();
    await askToJoin();
    await screen.findByText(/^Waiting for/);
    act(() => {
      svc.opts!.onParticipantsChange([
        snap({ userId: 'guest:1', displayName: 'Pat', isLocal: true, role: 'guest', isWaiting: false }),
        snap({ userId: 'm1', displayName: 'Sam' }),
      ]);
    });
    await waitFor(() => expect(svc.publishLocalMedia).toHaveBeenCalledWith({ mic: true, camera: true }));
    expect(screen.queryByText('Waiting for someone to let you in…')).toBeNull();
    expect(screen.queryByRole('button', { name: /share screen/i })).toBeNull();
  });

  it('Cancel disconnects', async () => {
    joinAsGuest.mockResolvedValue({ token: 't', url: 'u', label: 'L', identity: 'guest:1' });
    renderPage();
    await askToJoin();
    await screen.findByText(/^Waiting for/);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(svc.disconnect).toHaveBeenCalled());
  });

  it('shows denied copy when removed while waiting', async () => {
    joinAsGuest.mockResolvedValue({ token: 't', url: 'u', label: 'L', identity: 'guest:1' });
    renderPage();
    await askToJoin();
    await screen.findByText(/^Waiting for/);
    const { DisconnectReason } = await import('livekit-client');
    act(() => svc.opts!.onDisconnected(DisconnectReason.PARTICIPANT_REMOVED));
    expect(await screen.findByText("You weren't let into the call.")).toBeTruthy();
  });

  const admit = async (extra: Record<string, unknown>[] = [snap({ userId: 'm1', displayName: 'Sam' })]) => {
    joinAsGuest.mockResolvedValue({ token: 't', url: 'u', label: 'L', identity: 'guest:1' });
    renderPage();
    await askToJoin();
    await screen.findByText(/Waiting for/);
    act(() => {
      svc.opts!.onParticipantsChange([
        snap({ userId: 'guest:1', displayName: 'Pat', isLocal: true, role: 'guest', isWaiting: false }),
        ...extra,
      ]);
    });
  };

  const admitMe = async (me: Record<string, unknown>, others: Record<string, unknown>[] = [snap({ userId: 'm1', displayName: 'Sam' })]) => {
    joinAsGuest.mockResolvedValue({ token: 't', url: 'u', label: 'L', identity: 'guest:1' });
    renderPage();
    await askToJoin();
    await screen.findByText(/Waiting for/);
    act(() => {
      svc.opts!.onParticipantsChange([snap({ userId: 'guest:1', displayName: 'Pat', isLocal: true, role: 'guest', isWaiting: false, ...me }), ...others]);
    });
  };

  it('lets a guest share their screen once the call allows it', async () => {
    svc.toggleScreenShare.mockClear();
    await admitMe({ canShareScreen: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Share screen' }));
    expect(svc.toggleScreenShare).toHaveBeenCalledTimes(1);
  });

  it('shows the guest the stop button while they share', async () => {
    await admitMe({ canShareScreen: true, isScreenSharing: true, screenStream: {} });
    expect(await screen.findByRole('button', { name: 'Stop screen sharing' })).toBeTruthy();
    expect(screen.getByText('Your screen')).toBeTruthy();
  });

  it('offers no share button on a call that does not allow guests to share', async () => {
    await admitMe({ canShareScreen: false });
    await screen.findByRole('button', { name: /mute/i });
    expect(screen.queryByRole('button', { name: 'Share screen' })).toBeNull();
  });

  it('shows a shared screen in the middle with everybody at the side', async () => {
    await admitMe({}, [snap({ userId: 'm1', displayName: 'Sam', isScreenSharing: true, screenStream: {} })]);
    expect(await screen.findByText('Sam’s screen')).toBeTruthy();
    const side = screen.getByRole('list', { name: 'People in the call' });
    expect(side.textContent).toContain('Sam');
    expect(side.textContent).toContain('Pat');
  });

  it('blur button toggles background blur on the service', async () => {
    await admit();
    fireEvent.click(await screen.findByRole('button', { name: 'Blur background' }));
    await waitFor(() => expect(svc.setBackgroundBlur).toHaveBeenCalledWith(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off background blur' }));
    await waitFor(() => expect(svc.setBackgroundBlur).toHaveBeenLastCalledWith(false));
  });

  it('blur failure shows an error toast and leaves blur off', async () => {
    svc.setBackgroundBlur.mockRejectedValue(new Error('model failed'));
    await admit();
    fireEvent.click(await screen.findByRole('button', { name: 'Blur background' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('model failed'));
    expect(screen.getByRole('button', { name: 'Blur background' })).toBeTruthy();
  });

  it('says it is waiting for the host until a member is present', async () => {
    joinAsGuest.mockResolvedValue({ token: 't', url: 'u', label: 'L', identity: 'guest:1' });
    renderPage();
    await askToJoin();
    expect(await screen.findByText('Waiting for the host to join…')).toBeTruthy();
    act(() => {
      svc.opts!.onParticipantsChange([
        snap({ userId: 'guest:1', isLocal: true, role: 'guest', isWaiting: true }),
        snap({ userId: 'm1', displayName: 'Sam' }),
      ]);
    });
    expect(await screen.findByText('Waiting for someone to let you in…')).toBeTruthy();
    expect(screen.queryByText('Waiting for the host to join…')).toBeNull();
  });

  it('the Recording badge is a polite live status', async () => {
    await admit([snap({ userId: 'm1', displayName: 'Sam', isRecording: true })]);
    const badge = await screen.findByText('Recording');
    expect(badge.getAttribute('role')).toBe('status');
    expect(badge.getAttribute('aria-live')).toBe('polite');
  });
});
