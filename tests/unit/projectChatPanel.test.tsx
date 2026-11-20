// The project chat is a panel docked beside the board, opened from a Chat
// button in the header. Nothing floats over the board.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '@/types';

const h = vi.hoisted(() => {
  const user = { userId: 'me', displayName: 'Sam', email: 'sam@example.com', organizationId: 'org1' };
  const organization = {
    organizationId: 'org1',
    members: [
      { userId: 'me', displayName: 'Sam', email: 'sam@example.com' },
      { userId: 'u2', displayName: 'Priya Nair', email: 'priya@example.com' },
      { userId: 'u3', displayName: 'Tom Okafor', email: 'tom@example.com' },
    ],
  };
  return {
    auth: { user },
    org: { organization, isViewer: false },
    call: { actions: { startCall: vi.fn(), startMeeting: vi.fn() }, state: { status: 'idle' } },
    activity: { events: [] as unknown[] },
    lastSeen: new Map<string, number>(),
    dock: { openChat: vi.fn(), setRightInset: vi.fn() },
    insets: [] as Array<number | null>,
    messages: [] as Array<Record<string, unknown>>,
  };
});

vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.org }));
vi.mock('@/hooks/useCall', () => ({ useCall: () => h.call }));
vi.mock('@/services/webrtc/mediaUtils', () => ({ isMediaSupported: () => true }));
vi.mock('@/hooks/useActivity', () => ({ useActivity: () => h.activity }));
vi.mock('@/hooks/useLastSeen', () => ({ useLastSeen: () => h.lastSeen }));
vi.mock('@/components/messaging/ChatDock', () => ({
  useChatDock: () => h.dock,
  useChatDockInset: (rem: number | null) => { h.insets.push(rem); },
}));
vi.mock('@/services/supabase/projectMemberProfiles', () => ({ getProjectMemberProfiles: async () => [] }));
vi.mock('@/lib/notificationSound', () => ({ playChatChime: vi.fn() }));
vi.mock('@/lib/notificationEvents', () => ({ dispatchNotificationsRefresh: vi.fn() }));
vi.mock('@/services/supabase/storage', () => ({
  ATTACHMENTS_BUCKET: 'attachments', deleteFile: vi.fn(), uploadChatAttachment: vi.fn(),
}));
vi.mock('@/services/supabase/database', () => ({
  subscribeToProjectChat: (_id: string, cb: (m: unknown[]) => void) => { cb(h.messages); return () => undefined; },
  subscribeToProjectChatReactions: (_id: string, cb: (r: unknown[]) => void) => { cb([]); return () => undefined; },
  insertProjectChatMessage: vi.fn(),
  notifyProjectChatMentions: vi.fn(async () => []),
  notifyProjectChatMessageToMembers: vi.fn(),
  toggleProjectChatReaction: vi.fn(),
  markNotificationsReadByProject: vi.fn(async () => undefined),
}));

import { ProjectRightRail } from '@/components/project/ProjectRightRail';
import { ProjectChatToggle } from '@/components/project/ProjectChatToggle';

const project = {
  projectId: 'p1',
  name: 'Northwind website',
  organizationId: 'org1',
  ownerId: 'me',
  coverColor: '#2563eb',
  members: [
    { userId: 'me', displayName: 'Sam', email: 'sam@example.com', role: 'owner' },
    { userId: 'u2', displayName: 'Priya Nair', email: 'priya@example.com', role: 'member' },
    { userId: 'u3', displayName: 'Tom Okafor', email: 'tom@example.com', role: 'member' },
  ],
} as unknown as Project;

const message = (id: string, userId: string, displayName: string, body: string, minutesAgo: number) => ({
  messageId: id, projectId: 'p1', userId, displayName, body, attachments: [],
  createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});

beforeEach(() => {
  window.localStorage.clear();
  h.insets.length = 0;
  h.messages = [
    message('m1', 'u2', 'Priya Nair', 'Homepage copy is in the doc', 30),
    message('m2', 'me', 'Sam', 'Thanks, reading it now', 25),
    message('m3', 'u3', 'Tom Okafor', 'Staging is updated', 5),
  ];
});
afterEach(cleanup);

describe('project chat panel', () => {
  it('puts nothing over the board while it is closed, and counts what is unread', () => {
    const onUnread = vi.fn();
    const { container } = render(
      <ProjectRightRail project={project} open={false} onOpenChange={() => {}} onUnreadChange={onUnread} />,
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('button', { name: /open project messages/i })).toBeNull();
    expect(onUnread).toHaveBeenLastCalledWith(2);
  });

  it('opens as a panel that sits in the page beside the board', () => {
    const onUnread = vi.fn();
    render(<ProjectRightRail project={project} open onOpenChange={() => {}} onUnreadChange={onUnread} />);
    const panel = screen.getByRole('complementary', { name: 'Project chat' });
    // From desktop width up the panel is part of the page layout, not laid over it.
    expect(panel.className).toContain('lg:static');
    expect(screen.getByText('Homepage copy is in the doc')).toBeTruthy();
    expect(screen.getByText('Staging is updated')).toBeTruthy();
    expect(onUnread).toHaveBeenLastCalledWith(0);
  });

  it('closes from its own close button', () => {
    const onOpenChange = vi.fn();
    render(<ProjectRightRail project={project} open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close project chat' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps one-to-one chats clear of the panel only while it is open', () => {
    const { rerender } = render(<ProjectRightRail project={project} open onOpenChange={() => {}} />);
    expect(h.insets[h.insets.length - 1]).toBe(23.5);
    rerender(<ProjectRightRail project={project} open={false} onOpenChange={() => {}} />);
    expect(h.insets[h.insets.length - 1]).toBeNull();
  });
});

describe('Chat button in the project header', () => {
  it('shows how many messages are unread and opens the chat', () => {
    const onToggle = vi.fn();
    render(<ProjectChatToggle open={false} unread={3} onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: 'Open project chat, 3 unread' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toContain('3');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows no count when everything is read', () => {
    render(<ProjectChatToggle open={false} unread={0} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open project chat' }).textContent).toBe('Chat');
  });

  it('says it closes the chat while the chat is open', () => {
    render(<ProjectChatToggle open unread={0} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Close project chat' }).getAttribute('aria-expanded')).toBe('true');
  });
});
