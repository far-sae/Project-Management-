// The project page: the chat lives at the bottom only. A small Chat bar on the
// bottom edge opens the chat window; the header has no chat button.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const h = vi.hoisted(() => {
  const user = { userId: 'me', displayName: 'Sam', email: 'sam@example.com', organizationId: 'org1' };
  const members = [
    { userId: 'me', displayName: 'Sam', email: 'sam@example.com', role: 'owner' },
    { userId: 'u2', displayName: 'Priya Nair', email: 'priya@example.com', role: 'member' },
    { userId: 'u3', displayName: 'Tom Okafor', email: 'tom@example.com', role: 'member' },
  ];
  const noop = () => undefined;
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    auth: { user },
    org: { organization: { organizationId: 'org1', members }, isViewer: false },
    workspace: { selectedId: 'w', isAll: true, isUnassigned: false },
    presencePref: { preference: 'auto', setPreference: noop },
    presence: { peers: [], broadcastTyping: noop, typingPeers: [] },
    tasks: {
      tasks: [], loading: false, addTask: noop, editTask: noop, removeTask: noop, refreshTasks: noop,
      limitModal: { open: false, message: '' }, closeLimitModal: noop,
    },
    call: { actions: { startCall: vi.fn(), startMeeting: vi.fn() }, state: { status: 'idle' } },
    activity: { events: [] as unknown[] },
    lastSeen: new Map<string, number>(),
    dock: { openChat: vi.fn(), setRightInset: vi.fn() },
    supabase: { channel: () => channel, removeChannel: noop },
    project: {
      projectId: 'p1', name: 'Northwind website', organizationId: 'org1', ownerId: 'me', workspaceId: null,
      coverColor: '#2563eb', members, columns: undefined,
    },
    messages: [] as Array<Record<string, unknown>>,
  };
});

vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.org }));
vi.mock('@/context/ProjectChromeContext', () => ({ usePublishProjectChrome: () => undefined }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({
  useSelectedWorkspace: () => h.workspace, ALL_WORKSPACES_ID: 'all', UNASSIGNED_WORKSPACE_ID: 'unassigned',
}));
vi.mock('@/hooks/usePresenceStatusPreference', () => ({ usePresenceStatusPreference: () => h.presencePref }));
vi.mock('@/hooks/usePresence', () => ({ usePresence: () => h.presence }));
vi.mock('@/hooks/useTasks', () => ({ useTasks: () => h.tasks }));
vi.mock('@/hooks/useCall', () => ({ useCall: () => h.call }));
vi.mock('@/hooks/useActivity', () => ({ useActivity: () => h.activity }));
vi.mock('@/hooks/useLastSeen', () => ({ useLastSeen: () => h.lastSeen }));
vi.mock('@/services/webrtc/mediaUtils', () => ({ isMediaSupported: () => true }));
vi.mock('@/services/supabase', () => ({ supabase: h.supabase }));
vi.mock('@/services/supabase/projectMemberProfiles', () => ({ getProjectMemberProfiles: async () => [] }));
vi.mock('@/services/supabase/storage', () => ({
  ATTACHMENTS_BUCKET: 'attachments', deleteFile: vi.fn(), uploadChatAttachment: vi.fn(),
}));
vi.mock('@/services/supabase/database', () => ({
  getProject: async () => h.project,
  updateProject: vi.fn(),
  verifyProjectLockPin: vi.fn(),
  subscribeToProjectChat: (_id: string, cb: (m: unknown[]) => void) => { cb(h.messages); return () => undefined; },
  subscribeToProjectChatReactions: (_id: string, cb: (r: unknown[]) => void) => { cb([]); return () => undefined; },
  insertProjectChatMessage: vi.fn(),
  notifyProjectChatMentions: vi.fn(async () => []),
  notifyProjectChatMessageToMembers: vi.fn(),
  toggleProjectChatReaction: vi.fn(),
  markNotificationsReadByProject: vi.fn(async () => undefined),
}));
vi.mock('@/lib/notificationSound', () => ({ playChatChime: vi.fn() }));
vi.mock('@/lib/notificationEvents', () => ({ dispatchNotificationsRefresh: vi.fn() }));
vi.mock('@/components/messaging/ChatDock', () => ({ useChatDock: () => h.dock, useChatDockInset: () => undefined }));
// The parts of the page this test is not about.
vi.mock('@/components/kanban/KanbanBoard', () => ({
  KanbanBoard: () => (
    <div data-testid="board" className="flex h-full gap-3">
      {['To do', 'In progress', 'Review', 'Blocked', 'Ready to ship'].map((title) => (
        <div key={title} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-2 p-2">
          <p className="px-1 py-1 text-sm font-medium">{title}</p>
          <div className="rounded-md border border-border bg-card p-3 text-sm">A task in {title.toLowerCase()}</div>
          <div className="rounded-md border border-border bg-card p-3 text-sm">Another task</div>
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@/components/kanban/DoneTasksView', () => ({ DoneTasksView: () => null }));
vi.mock('@/components/mindmap/ProjectMindMap', () => ({ ProjectMindMap: () => null }));
vi.mock('@/components/subscription/TrialBanner', () => ({ TrialBanner: () => null }));
vi.mock('@/components/ai/AIProjectHealth', () => ({ AIProjectHealth: () => null }));
vi.mock('@/components/time/ClockButton', () => ({ ClockButton: () => null }));
vi.mock('@/components/views/SavedViewsMenu', () => ({ SavedViewsMenu: () => null }));
vi.mock('@/components/crmHub/ProjectDealChip', () => ({ ProjectDealChip: () => null }));
vi.mock('@/components/presence/PresenceAvatars', () => ({ PresenceAvatars: () => null }));
vi.mock('@/components/presence/PresenceStatusMenu', () => ({ PresenceStatusAvatarMenu: () => null }));

import { ProjectView } from '@/pages/kanban/ProjectView';

const message = (id: string, userId: string, displayName: string, body: string, minutesAgo: number) => ({
  messageId: id, projectId: 'p1', userId, displayName, body, attachments: [],
  createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});

const renderPage = async () => {
  render(
    <MemoryRouter initialEntries={['/project/p1']}>
      <Routes>
        <Route path="/project/:projectId" element={<ProjectView />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Northwind website' });
};

beforeEach(() => {
  window.localStorage.clear();
  h.messages = [
    message('m1', 'u2', 'Priya Nair', 'Homepage copy is in the doc', 30),
    message('m2', 'me', 'Sam', 'Thanks, reading it now', 25),
    message('m3', 'u3', 'Tom Okafor', 'Staging is updated', 5),
  ];
});
afterEach(cleanup);

describe('project page chat', () => {
  it('has the Chat bar at the bottom and no chat button in the header', async () => {
    await renderPage();
    expect(screen.getByTestId('board')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Project chat' })).toBeNull();
    // The count arrives with the messages, a moment after the page itself.
    const bar = await screen.findByRole('button', { name: 'Open project chat, 2 unread' });
    expect(bar.parentElement?.className).toContain('bottom-0');
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: /chat/i })).toBeNull();
  });

  it('opens the chat window from the bar and minimises it again', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Open project chat/ }));
    const panel = screen.getByRole('complementary', { name: 'Project chat' });
    expect(within(panel).getByText('Staging is updated')).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Minimize project chat' }));
    expect(screen.queryByRole('complementary', { name: 'Project chat' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open project chat' })).toBeTruthy();
  });

  it('remembers that the chat was left open', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Open project chat/ }));
    cleanup();
    await renderPage();
    expect(screen.getByRole('complementary', { name: 'Project chat' })).toBeTruthy();
  });

  it('keeps the chat available in the other views of the project', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: /Open project chat/ }));
    expect(screen.getByRole('complementary', { name: 'Project chat' })).toBeTruthy();
  });
});
