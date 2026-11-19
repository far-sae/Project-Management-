// A one-to-one chat works like the project chat: pictures, emoji, reactions,
// and it shows when the other person is typing and has seen your message.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  reactions: [] as Array<Record<string, unknown>>,
  reactionsMissing: false,
  toggle: vi.fn(async () => undefined),
  typing: false,
  notifyTyping: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'me', displayName: 'Me', organizationId: 'org1' } }),
}));
vi.mock('@/hooks/useCall', () => ({
  useCall: () => ({ actions: { startCall: vi.fn() }, state: { status: 'idle' } }),
}));
vi.mock('@/services/webrtc/mediaUtils', () => ({ isMediaSupported: () => true }));
vi.mock('@/hooks/useLastSeen', () => ({ useLastSeen: () => new Map() }));
vi.mock('@/hooks/useDmTyping', () => ({
  useDmTyping: () => ({ otherTyping: h.typing, notifyTyping: h.notifyTyping }),
}));
vi.mock('@/services/supabase/storage', () => ({
  ATTACHMENTS_BUCKET: 'attachments',
  deleteFile: vi.fn(),
  uploadChatAttachment: vi.fn(),
}));
vi.mock('@/services/supabase/database', () => ({
  insertDirectMessage: vi.fn(),
  markDirectMessagesRead: vi.fn(async () => undefined),
  deleteOldDirectMessages: vi.fn(async () => undefined),
  directMessageThreadKey: (a: string, b: string) => [a, b].sort().join('__'),
  subscribeToDirectMessages: (_me: string, _other: string, cb: (m: unknown[]) => void) => {
    cb(h.messages);
    return () => undefined;
  },
  subscribeToDirectMessageReactions: (
    _me: string, _other: string, cb: (r: unknown[]) => void, onUnavailable?: () => void,
  ) => {
    if (h.reactionsMissing) onUnavailable?.();
    cb(h.reactionsMissing ? [] : h.reactions);
    return { stop: () => undefined, reload: () => undefined };
  },
  toggleDirectMessageReaction: h.toggle,
}));

import { DirectMessageWindow } from '@/components/messaging/DirectMessageWindow';

const at = (minute: number) => new Date(2026, 10, 19, 10, minute);
const msg = (id: string, from: 'me' | 'alice', body: string, minute: number, readAt: Date | null = null) => ({
  messageId: id, threadKey: 'alice__me', senderId: from, recipientId: from === 'me' ? 'alice' : 'me',
  organizationId: 'org1', body, attachments: [], createdAt: at(minute), readAt,
});

const open = () =>
  render(
    <DirectMessageWindow
      recipient={{ userId: 'alice', displayName: 'Alice Moreno' }}
      organizationId="org1"
      minimized={false}
      onMinimize={() => {}}
      onRestore={() => {}}
      onClose={() => {}}
    />,
  );

beforeEach(() => {
  h.messages = [msg('m1', 'alice', 'Can you send the quote?', 1), msg('m2', 'alice', 'Today if possible', 2), msg('m3', 'me', 'Sending it now', 3)];
  h.reactions = [];
  h.reactionsMissing = false;
  h.typing = false;
  h.toggle.mockClear();
  h.notifyTyping.mockClear();
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe('One-to-one chat', () => {
  it('shows the other person’s picture once per run of their messages, like the project chat', () => {
    open();
    expect(screen.getAllByTestId('chat-avatar')).toHaveLength(1);
  });

  it('has an emoji button next to the message box', () => {
    open();
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeTruthy();
  });

  it('offers a reaction on every message and saves the one picked', () => {
    open();
    const buttons = screen.getAllByRole('button', { name: 'Add reaction' });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'React with ❤️' }));
    expect(h.toggle).toHaveBeenCalledWith({ messageId: 'm1', userId: 'me', emoji: '❤️' });
  });

  it('shows who reacted as a count, and takes my reaction back when I click it', () => {
    h.reactions = [
      { reactionId: 'r1', messageId: 'm1', userId: 'alice', emoji: '👍' },
      { reactionId: 'r2', messageId: 'm1', userId: 'me', emoji: '👍' },
    ];
    open();
    const chip = screen.getByRole('button', { name: /👍 2/ });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(h.toggle).toHaveBeenCalledWith({ messageId: 'm1', userId: 'me', emoji: '👍' });
  });

  it('leaves reactions out until the database supports them', () => {
    h.reactionsMissing = true;
    open();
    expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull();
  });

  it('says my last message was sent, then seen once they have read it', () => {
    open();
    expect(screen.getByText('Sent')).toBeTruthy();
    cleanup();
    h.messages = [msg('m1', 'alice', 'Can you send the quote?', 1), msg('m3', 'me', 'Sending it now', 3, at(4))];
    open();
    expect(screen.getByText('Seen')).toBeTruthy();
    expect(screen.queryByText('Sent')).toBeNull();
  });

  it('shows when the other person is typing', () => {
    h.typing = true;
    open();
    const log = screen.getByRole('region', { name: /chat with alice/i });
    expect(within(log).getByText(/alice is typing/i)).toBeTruthy();
  });

  it('tells the other person when I am typing', () => {
    open();
    fireEvent.change(screen.getByPlaceholderText(/message alice/i), { target: { value: 'On' } });
    expect(h.notifyTyping).toHaveBeenCalled();
  });
});
