// In-call controls and participant tiles: every control keeps its name, the
// end-call button is labelled on the call screen, and toggled states and the
// active speaker are marked.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/services/webrtc/mediaUtils', () => ({ isScreenShareSupported: () => true }));
vi.mock('@/services/webrtc/BackgroundProcessor', () => ({
  isBackgroundEffectSupported: () => true,
}));

import { CallControls } from '@/components/calling/CallControls';
import { ParticipantTile } from '@/components/calling/CallTiles';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';

afterEach(cleanup);

beforeAll(() => {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});

function renderControls(overrides: Partial<React.ComponentProps<typeof CallControls>> = {}) {
  const props: React.ComponentProps<typeof CallControls> = {
    isMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    videoEffect: 'none',
    isApplyingEffect: false,
    mediaType: 'video',
    onToggleMute: vi.fn(),
    onToggleCamera: vi.fn(),
    onToggleScreenShare: vi.fn(),
    onToggleBackgroundEffect: vi.fn(),
    onHangUp: vi.fn(),
    isRecording: false,
    onToggleRecording: vi.fn(),
    ...overrides,
  };
  render(<CallControls {...props} />);
  return props;
}

describe('Call controls', () => {
  it('offers mute, camera, blur, share screen, record and a labelled End call', () => {
    const props = renderControls();
    expect(screen.getByRole('toolbar', { name: 'Call controls' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blur background' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record meeting' }));
    const end = screen.getByRole('button', { name: 'End call' });
    expect(end.textContent).toBe('End call');
    fireEvent.click(end);
    expect(props.onToggleMute).toHaveBeenCalledTimes(1);
    expect(props.onToggleCamera).toHaveBeenCalledTimes(1);
    expect(props.onToggleBackgroundEffect).toHaveBeenCalledTimes(1);
    expect(props.onToggleScreenShare).toHaveBeenCalledTimes(1);
    expect(props.onToggleRecording).toHaveBeenCalledTimes(1);
    expect(props.onHangUp).toHaveBeenCalledTimes(1);
  });

  it('names each control by what pressing it will do once it is toggled', () => {
    renderControls({
      isMuted: true,
      isCameraOff: true,
      isScreenSharing: true,
      videoEffect: 'blur',
      isRecording: true,
    });
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop screen sharing' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Turn off background blur' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Stop recording' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('looks different when muted than when not', () => {
    renderControls();
    const live = screen.getByRole('button', { name: 'Mute microphone' }).className;
    cleanup();
    renderControls({ isMuted: true });
    const muted = screen.getByRole('button', { name: 'Unmute microphone' }).className;
    expect(muted).not.toBe(live);
  });

  it('keeps only mute, camera and a round End call in the small floating call', () => {
    renderControls({ compact: true });
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn camera off' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share screen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Blur background' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record meeting' })).toBeNull();
    expect(screen.getByRole('button', { name: 'End call' }).textContent).toBe('');
  });

  it('has no camera or blur button on a voice call', () => {
    renderControls({ mediaType: 'audio' });
    expect(screen.queryByRole('button', { name: /camera/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /blur/i })).toBeNull();
  });

  it('hides Share screen when it is not allowed (guests)', () => {
    renderControls({ allowScreenShare: false });
    expect(screen.queryByRole('button', { name: 'Share screen' })).toBeNull();
  });
});

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

describe('Participant tile', () => {
  it('shows the name, and marks a muted microphone', () => {
    render(<ParticipantTile snap={peer({ userId: 'a', displayName: 'Alice', isMicMuted: true })} />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByLabelText('Alice is muted')).toBeTruthy();
    expect(screen.getByLabelText("Alice's camera is off")).toBeTruthy();
  });

  it('rings the person who is speaking', () => {
    render(<ParticipantTile snap={peer({ userId: 'a', displayName: 'Alice', isSpeaking: true })} />);
    expect(screen.getByTestId('speaking-ring')).toBeTruthy();
  });

  it('shows no ring when they are quiet, for yourself, or when rings are off', () => {
    const { rerender } = render(<ParticipantTile snap={peer({ userId: 'a', displayName: 'Alice' })} />);
    expect(screen.queryByTestId('speaking-ring')).toBeNull();
    rerender(
      <ParticipantTile snap={peer({ userId: 'me', displayName: 'Me', isSpeaking: true, isLocal: true })} />,
    );
    expect(screen.queryByTestId('speaking-ring')).toBeNull();
    rerender(
      <ParticipantTile
        snap={peer({ userId: 'a', displayName: 'Alice', isSpeaking: true })}
        showSpeakingRing={false}
      />,
    );
    expect(screen.queryByTestId('speaking-ring')).toBeNull();
  });

  it('labels guests and people who are sharing their screen', () => {
    render(
      <ParticipantTile
        snap={peer({ userId: 'g', displayName: 'Gina', role: 'guest', isScreenSharing: true })}
      />,
    );
    expect(screen.getByText('Guest')).toBeTruthy();
    expect(screen.getByText('Sharing')).toBeTruthy();
  });
});
