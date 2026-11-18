// Team page: each person's row has "Open chat" and "Call" buttons that reach
// only that person. They are never shown on your own row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  openChat: vi.fn(),
  startCall: vi.fn(),
  callStatus: 'idle',
  mediaSupported: true,
}));

vi.mock('@/components/messaging/ChatDock', () => ({
  useChatDock: () => ({ openChat: h.openChat, setRightInset: () => undefined }),
}));
vi.mock('@/hooks/useCall', () => ({
  useCall: () => ({ actions: { startCall: h.startCall }, state: { status: h.callStatus } }),
}));
vi.mock('@/services/webrtc/mediaUtils', () => ({ isMediaSupported: () => h.mediaSupported }));

import { MemberContactActions } from '@/components/team/MemberContactActions';

const alice = {
  userId: 'alice',
  displayName: 'Alice Chen',
  email: 'alice@example.com',
  photoURL: 'https://example.com/a.png',
};

beforeEach(() => {
  h.openChat.mockReset();
  h.startCall.mockReset();
  h.callStatus = 'idle';
  h.mediaSupported = true;
});
afterEach(cleanup);

describe('Team member chat and call buttons', () => {
  it('shows a chat and a voice call button named after the person', () => {
    render(<MemberContactActions member={alice} currentUserId="me" organizationId="org1" />);
    expect(screen.getByRole('button', { name: 'Open chat with Alice Chen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voice call Alice Chen' })).toBeTruthy();
  });

  it('"Open chat" opens the one-to-one chat with that person', () => {
    render(<MemberContactActions member={alice} currentUserId="me" organizationId="org1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open chat with Alice Chen' }));
    expect(h.openChat).toHaveBeenCalledTimes(1);
    expect(h.openChat).toHaveBeenCalledWith({
      userId: 'alice',
      displayName: 'Alice Chen',
      email: 'alice@example.com',
      photoURL: 'https://example.com/a.png',
      organizationId: 'org1',
    });
    expect(h.startCall).not.toHaveBeenCalled();
  });

  it('"Call" rings only that person, as a voice call', () => {
    render(<MemberContactActions member={alice} currentUserId="me" organizationId="org1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Voice call Alice Chen' }));
    expect(h.startCall).toHaveBeenCalledTimes(1);
    const [context, media, target] = h.startCall.mock.calls[0];
    expect(context).toEqual({ type: 'dm', targetId: 'alice', label: 'Alice Chen' });
    expect(media).toBe('audio');
    expect(Array.isArray(target)).toBe(false);
    expect(target).toEqual({
      userId: 'alice',
      displayName: 'Alice Chen',
      photoURL: 'https://example.com/a.png',
    });
    expect(h.openChat).not.toHaveBeenCalled();
  });

  it('shows neither button on your own row', () => {
    const { container } = render(
      <MemberContactActions member={alice} currentUserId="alice" organizationId="org1" />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('hides the call button while a call is already in progress, but keeps chat', () => {
    h.callStatus = 'connected';
    render(<MemberContactActions member={alice} currentUserId="me" organizationId="org1" />);
    expect(screen.queryByRole('button', { name: 'Voice call Alice Chen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open chat with Alice Chen' })).toBeTruthy();
  });

  it('hides the call button when the browser cannot make calls', () => {
    h.mediaSupported = false;
    render(<MemberContactActions member={alice} currentUserId="me" organizationId="org1" />);
    expect(screen.queryByRole('button', { name: 'Voice call Alice Chen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open chat with Alice Chen' })).toBeTruthy();
  });
});
