// The project chat: a small Chat bar on the bottom edge of the project page
// (not a round floating button) that opens the chat window above it.
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

describe('project chat', () => {
  it('is a small Chat bar on the bottom edge while closed, with the unread count', () => {
    const onOpenChange = vi.fn();
    render(<ProjectRightRail project={project} open={false} onOpenChange={onOpenChange} />);
    const bar = screen.getByRole('button', { name: 'Open project chat, 2 unread' });
    expect(bar.textContent).toBe('Chat2');
    // Flush with the bottom of the page, and a bar rather than a circle.
    expect(bar.parentElement?.className).toContain('bottom-0');
    expect(bar.className).not.toContain('rounded-full');
    fireEvent.click(bar);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('shows no count on the bar when everything is read', () => {
    h.messages = [message('m2', 'me', 'Sam', 'Thanks, reading it now', 25)];
    render(<ProjectRightRail project={project} open={false} onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open project chat' }).textContent).toBe('Chat');
  });

  it('opens as the same compact window as before, not a full-height panel', () => {
    render(<ProjectRightRail project={project} open onOpenChange={() => {}} />);
    const panel = screen.getByRole('complementary', { name: 'Project chat' });
    const win = panel.querySelector('aside') as HTMLElement;
    expect(win.className).toContain('sm:w-[min(23.5rem,calc(100vw-2.5rem))]');
    expect(win.className).toContain('h-[min(36rem,calc(100svh-2rem))]');
    expect(screen.getByText('Homepage copy is in the doc')).toBeTruthy();
    expect(screen.getByText('Staging is updated')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open project chat/ })).toBeNull();
  });

  it('goes back down to the bar from its minimise button', () => {
    const onOpenChange = vi.fn();
    render(<ProjectRightRail project={project} open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize project chat' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps one-to-one chats clear of the window and of the bar', () => {
    const { rerender } = render(<ProjectRightRail project={project} open onOpenChange={() => {}} />);
    expect(h.insets[h.insets.length - 1]).toBe(25.5);
    rerender(<ProjectRightRail project={project} open={false} onOpenChange={() => {}} />);
    expect(h.insets[h.insets.length - 1]).toBe(8.5);
  });
});
