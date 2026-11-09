import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';
import { INITIAL_CALL_STATE, type CallState } from '@/services/webrtc/types';

const h = vi.hoisted(() => ({
  call: null as unknown as {
    state: CallState;
    actions: Record<string, ReturnType<typeof vi.fn>>;
    canInviteGuests: boolean;
  },
  pipWindow: null as Window | null,
  recorder: {
    isRecording: false,
    liveTranscript: '',
    speechRecognitionAvailable: false,
    error: null,
    lastRecording: null,
    start: null as unknown as ReturnType<typeof vi.fn>,
    stop: null as unknown as ReturnType<typeof vi.fn>,
    reset: null as unknown as ReturnType<typeof vi.fn>,
  },
}));

vi.mock('@/hooks/useCall', () => ({ useCall: () => h.call }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'me', displayName: 'Me', organizationId: 'org' } }),
}));
vi.mock('@/services/webrtc/BackgroundProcessor', () => ({
  isBackgroundEffectSupported: () => false,
}));
vi.mock('@/hooks/useMeetingRecorder', () => ({ useMeetingRecorder: () => h.recorder }));
vi.mock('@/hooks/usePipWindow', () => ({
  usePipWindow: () => ({
    pipWindow: h.pipWindow,
    support: 'none',
    openPip: vi.fn(),
    closePip: vi.fn(),
    recheck: vi.fn(),
  }),
}));
vi.mock('@/services/supabase/storage', () => ({ uploadFileWithProgress: vi.fn() }));
vi.mock('@/services/supabase/database', () => ({ insertProjectChatMessage: vi.fn() }));
vi.mock('@/services/ai/transcribeRecording', () => ({ transcribeRecording: vi.fn() }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { CallOverlay } from '@/components/calling/CallOverlay';

function peer(p: Partial<CallPeerSnapshot> & { userId: string }): CallPeerSnapshot {
  return {
    displayName: p.userId,
    audioStream: null,
    videoStream: null,
    isMicMuted: false,
    isCameraOff: true,
    isScreenSharing: false,
    isSpeaking: false,
    isLocal: false,
    role: 'member',
    isWaiting: false,
    isRecording: false,
    ...p,
  };
}

const me = peer({ userId: 'me', displayName: 'Me', isLocal: true });
const alice = peer({ userId: 'alice', displayName: 'Alice' });
const waitingGina = peer({
  userId: 'guest:1',
  displayName: 'Gina',
  role: 'guest',
  isWaiting: true,
});

function setCall(state: Partial<CallState>, canInviteGuests = true) {
  h.call = {
    state: {
      ...INITIAL_CALL_STATE,
      status: 'connected',
      direction: 'outgoing',
      roomName: 'project:p1',
      context: { type: 'project', targetId: 'p1', label: 'Acme' },
      ...state,
    },
    actions: {
      startCall: vi.fn(),
      startMeeting: vi.fn(),
      acceptCall: vi.fn(),
      rejectCall: vi.fn(),
      hangUp: vi.fn(),
      toggleMute: vi.fn(),
      toggleCamera: vi.fn(),
      toggleScreenShare: vi.fn(async () => {}),
      setVideoEffect: vi.fn(async () => {}),
      inviteGuest: vi.fn(async () => {}),
      admitGuest: vi.fn(async () => {}),
      denyGuest: vi.fn(async () => {}),
      setRecordingFlag: vi.fn(async () => {}),
    },
    canInviteGuests,
  };
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  h.pipWindow = null;
  h.recorder.isRecording = false;
  h.recorder.start = vi.fn(async () => ({ outcome: 'started' }));
  h.recorder.stop = vi.fn(async () => null);
  h.recorder.reset = vi.fn();
});
afterEach(cleanup);

describe('CallOverlay — guests', () => {
  it('shows an admit banner for a waiting guest and admits on click', async () => {
    setCall({ participants: [me, alice, waitingGina] });
    render(<CallOverlay />);
    expect(screen.getByText('Gina (guest) wants to join')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Admit' }));
    });
    expect(h.call.actions.admitGuest).toHaveBeenCalledWith('guest:1');
  });

  it('denies a waiting guest on Deny', async () => {
    setCall({ participants: [me, alice, waitingGina] });
    render(<CallOverlay />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    });
    expect(h.call.actions.denyGuest).toHaveBeenCalledWith('guest:1');
  });

  it('disables Admit and Deny while the request runs', async () => {
    let finish: () => void = () => {};
    setCall({ participants: [me, alice, waitingGina] });
    h.call.actions.admitGuest = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<CallOverlay />);
    const admit = screen.getByRole('button', { name: 'Admit' }) as HTMLButtonElement;
    const deny = screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(admit);
    });
    expect(admit.disabled).toBe(true);
    expect(deny.disabled).toBe(true);
    await act(async () => {
      finish();
    });
  });

  it('does not render a waiting guest as a tile or count them', () => {
    setCall({ participants: [me, alice, waitingGina] });
    render(<CallOverlay />);
    expect(screen.queryByText('Gina')).toBeNull();
    expect(screen.getByText(/· 2 people/)).toBeTruthy();
  });

  it('labels an admitted guest tile with a "Guest" chip', () => {
    const gina = { ...waitingGina, isWaiting: false };
    setCall({ participants: [me, alice, gina] });
    render(<CallOverlay />);
    expect(screen.getByText('Gina')).toBeTruthy();
    expect(screen.getByText('Guest')).toBeTruthy();
    expect(screen.getByText(/· 3 people/)).toBeTruthy();
  });

  it('shows the Recording badge when a remote participant is recording', () => {
    setCall({ participants: [me, { ...alice, isRecording: true }] });
    render(<CallOverlay />);
    expect(screen.getByText('Recording')).toBeTruthy();
  });

  it('shows no Recording badge when nobody is recording', () => {
    setCall({ participants: [me, alice] });
    render(<CallOverlay />);
    expect(screen.queryByText('Recording')).toBeNull();
  });

  it('shows the Recording badge in the minimized box too', () => {
    setCall({ participants: [me, { ...alice, isRecording: true }] });
    render(<CallOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize call' }));
    expect(screen.getByText('Recording')).toBeTruthy();
  });

  it('Invite guest calls actions.inviteGuest', async () => {
    setCall({ participants: [me, alice] });
    render(<CallOverlay />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Invite guest' }));
    });
    expect(h.call.actions.inviteGuest).toHaveBeenCalled();
  });

  it('hides Invite guest for view-only users', () => {
    setCall({ participants: [me, alice] }, false);
    render(<CallOverlay />);
    expect(screen.queryByRole('button', { name: 'Invite guest' })).toBeNull();
  });

  it('outgoing ring screen offers Invite guest and the admit banner', () => {
    setCall({
      status: 'ringing',
      participants: [me, waitingGina],
      remoteParticipant: { userId: 'p1', displayName: 'Acme' },
      remoteParticipants: [
        { userId: 'a', displayName: 'A' },
        { userId: 'b', displayName: 'B' },
      ],
    });
    render(<CallOverlay />);
    expect(screen.getByRole('button', { name: 'Invite guest' })).toBeTruthy();
    expect(screen.getByText('Gina (guest) wants to join')).toBeTruthy();
  });

  it('shows the admit prompt in the floating mini window too', async () => {
    h.pipWindow = window; // portal renders into this document's body
    setCall({ participants: [me, alice, waitingGina] });
    render(<CallOverlay />);
    expect(screen.getAllByText('Gina (guest) wants to join')).toHaveLength(2);
    const admits = screen.getAllByRole('button', { name: 'Admit' });
    await act(async () => {
      fireEvent.click(admits[admits.length - 1]);
    });
    expect(h.call.actions.admitGuest).toHaveBeenCalledWith('guest:1');
  });

  it('keeps the mini window free of admit prompts for view-only users', () => {
    h.pipWindow = window;
    setCall({ participants: [me, alice, waitingGina] }, false);
    render(<CallOverlay />);
    expect(screen.queryByText('Gina (guest) wants to join')).toBeNull();
  });

  it('flags the recording to the room when the member starts recording', async () => {
    setCall({ participants: [me, alice] });
    render(<CallOverlay />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record meeting' }));
    });
    expect(h.call.actions.setRecordingFlag).toHaveBeenCalledWith(true);
  });
});
