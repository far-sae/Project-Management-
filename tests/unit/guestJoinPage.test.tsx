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
vi.mock('@/services/webrtc/BackgroundProcessor', () => ({
  isBackgroundEffectSupported: () => false,
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
};
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
    expect(await screen.findByText('Waiting for someone to let you in…')).toBeTruthy();
    expect(trackStop).toHaveBeenCalled();
    expect(svc.connect).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { token: 't', url: 'u' }, publishOnConnect: false }),
    );
  });

  it('enters the call and publishes media when admitted', async () => {
    joinAsGuest.mockResolvedValue({ token: 't', url: 'u', label: 'L', identity: 'guest:1' });
    renderPage();
    await askToJoin();
    await screen.findByText('Waiting for someone to let you in…');
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
    await screen.findByText('Waiting for someone to let you in…');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(svc.disconnect).toHaveBeenCalled());
  });

  it('shows denied copy when removed while waiting', async () => {
    joinAsGuest.mockResolvedValue({ token: 't', url: 'u', label: 'L', identity: 'guest:1' });
    renderPage();
    await askToJoin();
    await screen.findByText('Waiting for someone to let you in…');
    const { DisconnectReason } = await import('livekit-client');
    act(() => svc.opts!.onDisconnected(DisconnectReason.PARTICIPANT_REMOVED));
    expect(await screen.findByText("You weren't let into the call.")).toBeTruthy();
  });
});
