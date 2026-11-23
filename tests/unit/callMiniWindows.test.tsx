// The two small call windows: the box inside TaskCalendar (while you work in
// the app during a call) and the floating window (while you are in another
// tab). Both show the other people, and the screen somebody else is sharing.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';
import { INITIAL_CALL_STATE, type CallState } from '@/services/webrtc/types';

const h = vi.hoisted(() => ({
  call: null as unknown as { state: CallState; actions: Record<string, ReturnType<typeof vi.fn>>; canInviteGuests: boolean },
  pipArgs: [] as Array<{ callActive: boolean; isLocalSharing: boolean; inAppMini?: boolean }>,
}));

vi.mock('@/hooks/useCall', () => ({ useCall: () => h.call }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'me', displayName: 'Me', organizationId: 'org' } }) }));
vi.mock('@/services/webrtc/BackgroundProcessor', () => ({ isBackgroundEffectSupported: () => false }));
vi.mock('@/hooks/useMeetingRecorder', () => ({
  useMeetingRecorder: () => ({ isRecording: false, liveTranscript: '', speechRecognitionAvailable: false, error: null, lastRecording: null, start: vi.fn(), stop: vi.fn(), reset: vi.fn() }),
}));
vi.mock('@/hooks/usePipWindow', () => ({
  usePipWindow: (args: { callActive: boolean; isLocalSharing: boolean; inAppMini?: boolean }) => {
    h.pipArgs.push(args);
    return { pipWindow: null, support: 'none', openPip: vi.fn(), closePip: vi.fn(), recheck: vi.fn() };
  },
}));
vi.mock('@/services/supabase/storage', () => ({ uploadFileWithProgress: vi.fn() }));
vi.mock('@/services/supabase/database', () => ({ insertProjectChatMessage: vi.fn() }));
vi.mock('@/services/ai/transcribeRecording', () => ({ transcribeRecording: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn() }) }));

import { CallOverlay } from '@/components/calling/CallOverlay';
import { MiniCallView } from '@/components/calling/MiniCallView';
import { shouldClosePip } from '@/services/calling/pip';

const stream = (id: string) => ({ id, getVideoTracks: () => [], getAudioTracks: () => [] }) as unknown as MediaStream;
function peer(p: Partial<CallPeerSnapshot> & { userId: string }): CallPeerSnapshot {
  return {
    displayName: p.userId,
    audioStream: null,
    videoStream: stream(`${p.userId}-camera`),
    screenStream: null,
    isMicMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    canShareScreen: true,
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
const priya = peer({ userId: 'priya', displayName: 'Priya' });
const sharing = (p: CallPeerSnapshot) => ({ ...p, isScreenSharing: true, screenStream: stream(`${p.userId}-screen`) });
const idOf = (el: Element | null) => ((el as HTMLVideoElement | null)?.srcObject as unknown as { id: string } | null)?.id ?? null;

function setCall(participants: CallPeerSnapshot[], over: Partial<CallState> = {}) {
  h.call = {
    state: {
      ...INITIAL_CALL_STATE, status: 'connected', direction: 'outgoing', roomName: 'project:p1', mediaType: 'video',
      context: { type: 'project', targetId: 'p1', label: 'Acme' }, participants, ...over,
    },
    actions: Object.fromEntries(['startCall', 'startMeeting', 'acceptCall', 'rejectCall', 'hangUp', 'toggleMute', 'toggleCamera', 'toggleScreenShare', 'setVideoEffect', 'inviteGuest', 'admitGuest', 'denyGuest', 'setRecordingFlag']
      .map((name) => [name, vi.fn(async () => {})])),
    canInviteGuests: true,
  };
}
const minimise = () => fireEvent.click(screen.getByRole('button', { name: 'Minimize call' }));
const box = () => screen.getByRole('dialog', { name: 'Active call (drag to move)' });

beforeEach(() => {
  h.pipArgs = [];
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});
afterEach(cleanup);

describe('the small box inside TaskCalendar', () => {
  it('shows the other person, not you, while you are the one sharing', () => {
    setCall([sharing(me), alice], { isScreenSharing: true });
    render(<CallOverlay />);
    minimise();
    const main = within(box()).getByTestId('in-app-main-tile');
    expect(main.textContent).toContain('Alice');
    expect(idOf(main.querySelector('video'))).toBe('alice-camera');
  });

  it('shows everybody else small underneath, yourself too', () => {
    setCall([me, alice, priya]);
    render(<CallOverlay />);
    minimise();
    expect(within(box()).getByTestId('in-app-main-tile').textContent).toContain('Alice');
    const strip = within(box()).getByRole('list', { name: 'Others in the call' });
    const names = within(strip).getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(names).toHaveLength(2);
    expect(names.join(' ')).toContain('Priya');
    expect(names.join(' ')).toContain('Me');
  });

  it('shows the screen somebody else is sharing, with their face beside it', () => {
    setCall([me, sharing(alice)]);
    render(<CallOverlay />);
    minimise();
    const main = within(box()).getByTestId('in-app-main-tile');
    expect(idOf(main.querySelector('video'))).toBe('alice-screen');
    expect(main.textContent).toContain('Alice’s screen');
    const strip = within(box()).getByRole('list', { name: 'Others in the call' });
    expect(within(strip).getAllByRole('listitem').map((item) => idOf(item.querySelector('video')))).toEqual(['alice-camera', 'me-camera']);
  });

  it('keeps the names readable on the small faces: no labels that push the name out', () => {
    setCall([me, sharing(alice)]);
    render(<CallOverlay />);
    minimise();
    const strip = within(box()).getByRole('list', { name: 'Others in the call' });
    expect(within(strip).getByText('Alice')).toBeTruthy();
    expect(within(strip).queryByText('Sharing')).toBeNull();
  });

  it('shows only you while nobody else has joined', () => {
    setCall([me], { isOpenMeeting: true });
    render(<CallOverlay />);
    minimise();
    expect(within(box()).getByTestId('in-app-main-tile').textContent).toContain('Me');
    expect(within(box()).queryByRole('list', { name: 'Others in the call' })).toBeNull();
  });
});

describe('which small window is shown', () => {
  it('tells the floating window when the call is minimised inside the app', () => {
    setCall([me, alice]);
    render(<CallOverlay />);
    expect(h.pipArgs.at(-1)).toMatchObject({ callActive: true, inAppMini: false });
    minimise();
    expect(h.pipArgs.at(-1)).toMatchObject({ inAppMini: true });
  });

  it('keeps only the box in the app while you work in TaskCalendar, even while you share', () => {
    // On the TaskCalendar tab with the call minimised in the app: one small window, not two.
    expect(shouldClosePip({ callActive: true, tabVisible: true, isLocalSharing: true, inAppMini: true })).toBe(true);
    // Sharing from the full call screen: the floating window stays, for when you go to another program.
    expect(shouldClosePip({ callActive: true, tabVisible: true, isLocalSharing: true, inAppMini: false })).toBe(false);
    // In another tab: the floating window is the only way to see the call.
    expect(shouldClosePip({ callActive: true, tabVisible: false, isLocalSharing: false, inAppMini: true })).toBe(false);
    expect(shouldClosePip({ callActive: true, tabVisible: false, isLocalSharing: true, inAppMini: true })).toBe(false);
  });
});

describe('the floating window (in another tab)', () => {
  const view = (participants: CallPeerSnapshot[]) => render(
    <MiniCallView
      participants={participants} isMuted={false} isCameraOff={false} isScreenSharing={false} mediaType="video"
      onToggleMute={() => {}} onToggleCamera={() => {}} onStopSharing={() => {}} onHangUp={() => {}} onBackToCall={() => {}}
    />,
  );

  it('shows the screen somebody else is sharing as the big picture', () => {
    view([me, sharing(alice), priya]);
    const main = screen.getByTestId('mini-main-tile');
    expect(idOf(main.querySelector('video'))).toBe('alice-screen');
    // The faces stay, small: the person sharing first.
    const small = Array.from(screen.getByTestId('mini-strip').querySelectorAll('video')).map(idOf);
    expect(small).toEqual(['alice-camera', 'me-camera', 'priya-camera']);
  });

  it('shows it also while you share your own screen at the same time', () => {
    view([sharing(me), sharing(alice)]);
    expect(idOf(screen.getByTestId('mini-main-tile').querySelector('video'))).toBe('alice-screen');
  });

  it('gives the shared screen most of the window', () => {
    view([me, sharing(alice)]);
    expect(screen.getByTestId('mini-strip').className).toContain('h-12');
  });
});
