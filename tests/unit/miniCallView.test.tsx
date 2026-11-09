import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MiniCallView } from '@/components/calling/MiniCallView';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';

afterEach(cleanup);

beforeAll(() => {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
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

function renderView(overrides: Partial<React.ComponentProps<typeof MiniCallView>> = {}) {
  const props: React.ComponentProps<typeof MiniCallView> = {
    participants: [
      peer({ userId: 'me', displayName: 'Me', isLocal: true }),
      peer({ userId: 'a', displayName: 'Alice', isSpeaking: true }),
      peer({ userId: 'b', displayName: 'Bob' }),
    ],
    isMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    mediaType: 'video',
    onToggleMute: vi.fn(),
    onToggleCamera: vi.fn(),
    onStopSharing: vi.fn(),
    onHangUp: vi.fn(),
    onBackToCall: vi.fn(),
    ...overrides,
  };
  const utils = render(<MiniCallView {...props} />);
  return { ...utils, props };
}

describe('MiniCallView', () => {
  it('renders the main speaker and a strip of the others', () => {
    renderView();
    expect(screen.getByTestId('mini-main-tile').textContent).toContain('Alice');
    const strip = screen.getByTestId('mini-strip');
    expect(strip.textContent).toContain('Bob');
    expect(strip.textContent).toContain('Me');
    expect(strip.textContent).not.toContain('Alice');
  });

  it('shows Stop sharing only while sharing', () => {
    const { rerender, props } = renderView();
    expect(screen.queryByRole('button', { name: /stop sharing/i })).toBeNull();
    rerender(<MiniCallView {...props} isScreenSharing />);
    fireEvent.click(screen.getByRole('button', { name: /stop sharing/i }));
    expect(props.onStopSharing).toHaveBeenCalled();
  });

  it('calls onBackToCall and onHangUp', () => {
    const { props } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /back to call/i }));
    fireEvent.click(screen.getByRole('button', { name: /hang up/i }));
    expect(props.onBackToCall).toHaveBeenCalled();
    expect(props.onHangUp).toHaveBeenCalled();
  });

  it('hides the camera button on audio calls', () => {
    renderView({ mediaType: 'audio' });
    expect(screen.queryByRole('button', { name: /camera/i })).toBeNull();
  });

  it('shows the admit prompt for waiting guests and reports the decision', () => {
    const gina = peer({ userId: 'guest:1', displayName: 'Gina', role: 'guest', isWaiting: true });
    const onGuestDecision = vi.fn();
    renderView({ waitingGuests: [gina], guestBusy: {}, onGuestDecision });
    expect(screen.getByText('Gina (guest) wants to join')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Admit' }));
    expect(onGuestDecision).toHaveBeenCalledWith('guest:1', 'admit');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onGuestDecision).toHaveBeenCalledWith('guest:1', 'deny');
  });

  it('disables Admit and Deny while that guest is busy', () => {
    const gina = peer({ userId: 'guest:1', displayName: 'Gina', role: 'guest', isWaiting: true });
    renderView({ waitingGuests: [gina], guestBusy: { 'guest:1': true }, onGuestDecision: vi.fn() });
    expect((screen.getByRole('button', { name: 'Admit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows no admit prompt without waiting guests', () => {
    renderView();
    expect(screen.queryByRole('button', { name: 'Admit' })).toBeNull();
  });

  it('renders no audio elements', () => {
    const { container } = renderView();
    expect(container.querySelectorAll('audio').length).toBe(0);
  });
});
