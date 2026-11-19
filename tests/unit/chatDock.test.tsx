// Teams-style chat dock: per-person chats dock at the bottom, minimise to a
// bar instead of vanishing, survive page changes, and calls ring only that person.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  startCall: vi.fn(),
  messages: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'me', displayName: 'Me', organizationId: 'org1' } }),
}));
vi.mock('@/hooks/useCall', () => ({
  useCall: () => ({ actions: { startCall: h.startCall }, state: { status: 'idle' } }),
}));
vi.mock('@/services/webrtc/mediaUtils', () => ({ isMediaSupported: () => true }));
vi.mock('@/hooks/useLastSeen', () => ({ useLastSeen: () => new Map() }));
vi.mock('@/hooks/useDmTyping', () => ({ useDmTyping: () => ({ otherTyping: false, notifyTyping: () => undefined }) }));
vi.mock('@/services/supabase/storage', () => ({
  ATTACHMENTS_BUCKET: 'attachments',
  deleteFile: vi.fn(),
  uploadChatAttachment: vi.fn(),
}));
vi.mock('@/services/supabase/database', () => ({
  insertDirectMessage: vi.fn(),
  markDirectMessagesRead: vi.fn(async () => undefined),
  deleteOldDirectMessages: vi.fn(async () => undefined),
  directMessageThreadKey: (a: string, b: string) => [a, b].sort().join(':'),
  subscribeToDirectMessages: (_me: string, _other: string, cb: (m: unknown[]) => void) => {
    cb(h.messages);
    return () => undefined;
  },
  subscribeToDirectMessageReactions: (_me: string, _other: string, cb: (r: unknown[]) => void) => {
    cb([]);
    return { stop: () => undefined, reload: () => undefined };
  },
  toggleDirectMessageReaction: vi.fn(),
}));

import { ChatDockProvider, useChatDock } from '@/components/messaging/ChatDock';
import { DM_RECEIVED_EVENT } from '@/hooks/useIncomingMessageAlerts';

const alice = { userId: 'alice', displayName: 'Alice', organizationId: 'org1' };

const Opener = () => {
  const { openChat } = useChatDock();
  return (
    <button type="button" onClick={() => openChat(alice)}>
      open alice
    </button>
  );
};

const renderDock = () =>
  render(
    <ChatDockProvider>
      <Opener />
    </ChatDockProvider>,
  );

beforeEach(() => {
  h.startCall.mockReset();
  h.messages = [];
  localStorage.clear();
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe('Chat dock', () => {
  it('opens a person’s chat docked at the bottom', () => {
    renderDock();
    fireEvent.click(screen.getByText('open alice'));
    expect(screen.getByRole('region', { name: /chat with alice/i })).toBeTruthy();
    expect(screen.getByPlaceholderText(/message alice/i)).toBeTruthy();
  });

  it('minimising keeps the chat as a bar at the bottom, and clicking it opens it again', () => {
    renderDock();
    fireEvent.click(screen.getByText('open alice'));
    fireEvent.click(screen.getByRole('button', { name: /minimi[sz]e chat with alice/i }));
    expect(screen.queryByPlaceholderText(/message alice/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /open chat with alice/i }));
    expect(screen.getByPlaceholderText(/message alice/i)).toBeTruthy();
  });

  it('closing removes the chat', () => {
    renderDock();
    fireEvent.click(screen.getByText('open alice'));
    fireEvent.click(screen.getByRole('button', { name: /close chat with alice/i }));
    expect(screen.queryByRole('region', { name: /chat with alice/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /open chat with alice/i })).toBeNull();
  });

  it('calling from the chat rings only that person', () => {
    renderDock();
    fireEvent.click(screen.getByText('open alice'));
    fireEvent.click(screen.getByRole('button', { name: /video call alice/i }));
    expect(h.startCall).toHaveBeenCalledTimes(1);
    const [context, media, target] = h.startCall.mock.calls[0];
    expect(context).toEqual({ type: 'dm', targetId: 'alice', label: 'Alice' });
    expect(media).toBe('video');
    expect(Array.isArray(target)).toBe(false);
    expect(target.userId).toBe('alice');
  });

  it('stays open after moving to another page (remount) — remembered per user', () => {
    const first = renderDock();
    fireEvent.click(screen.getByText('open alice'));
    fireEvent.click(screen.getByRole('button', { name: /minimi[sz]e chat with alice/i }));
    first.unmount();
    renderDock();
    expect(screen.getByRole('button', { name: /open chat with alice/i })).toBeTruthy();
  });

  it('a new message from someone shows up as a bar with an unread count', () => {
    h.messages = [
      { messageId: 'm1', senderId: 'alice', recipientId: 'me', body: 'hi', attachments: [], createdAt: new Date(), readAt: null },
      { messageId: 'm2', senderId: 'alice', recipientId: 'me', body: 'there?', attachments: [], createdAt: new Date(), readAt: null },
    ];
    renderDock();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DM_RECEIVED_EVENT, {
          detail: { senderId: 'alice', displayName: 'Alice', organizationId: 'org1' },
        }),
      );
    });
    const bar = screen.getByRole('button', { name: /open chat with alice/i });
    expect(bar.textContent).toContain('2');
  });
});
