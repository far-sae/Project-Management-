// Team page: the member list keeps its management actions and adds per-person
// chat / call buttons on every row except your own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  openChat: vi.fn(),
  startCall: vi.fn(),
  invitations: [] as Array<Record<string, unknown>>,
}));

const orgMembers = [
  { userId: 'me', displayName: 'Mia Owner', email: 'mia@x.io', role: 'owner', status: 'active' },
  { userId: 'alice', displayName: 'Alice', email: 'alice@x.io', role: 'member', status: 'active' },
];
const project = {
  projectId: 'p1',
  name: 'Website',
  ownerId: 'me',
  organizationId: 'org1',
  members: [{ userId: 'alice', email: 'alice@x.io', displayName: 'Alice', role: 'member' }],
};

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'me', displayName: 'Mia Owner', email: 'mia@x.io', organizationId: 'org1' },
  }),
}));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({
    organization: {
      organizationId: 'org1',
      ownerId: 'me',
      ownerEmail: 'mia@x.io',
      ownerName: 'Mia Owner',
      members: orgMembers,
    },
    refreshOrganization: vi.fn(),
    isAdmin: true,
  }),
}));
vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({ projects: [project], refreshProjects: vi.fn() }),
}));
vi.mock('@/context/SubscriptionContext', () => ({
  useSubscription: () => ({
    hasFeature: () => true,
    currentTier: 'advanced',
    pricing: { currencySymbol: '$', tiers: { advanced: { extraUserPrice: 5, extraUserPriceId: '' } } },
  }),
}));
vi.mock('@/services/supabase', () => {
  const query = {
    eq: () => query,
    maybeSingle: async () => ({ data: { owner_id: 'me', members: project.members } }),
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      channel: () => channel,
      removeChannel: vi.fn(),
      from: () => ({ select: () => query }),
      auth: { getSession: async () => ({ data: { session: null } }) },
      functions: { invoke: vi.fn() },
    },
    checkTeamMemberLimit: vi.fn(),
  };
});
vi.mock('@/services/supabase/invitations', () => ({
  createInvitation: vi.fn(),
  getProjectInvitations: async () => h.invitations,
  cancelInvitation: vi.fn(),
}));
vi.mock('@/services/supabase/projectMemberProfiles', () => ({
  getProjectMemberProfiles: async () => [],
}));
vi.mock('@/services/supabase/organizations', () => ({
  removeOrganizationMember: vi.fn(),
  updateOrganization: vi.fn(),
}));
vi.mock('@/services/supabase/projectMembers', () => ({
  upsertProjectMember: vi.fn(),
  moveProjectMember: vi.fn(),
}));
vi.mock('@/services/supabase/auditLog', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/services/email/emailService', () => ({
  getInvitationEmailFailureHint: () => '',
  sendInvitationEmail: vi.fn(),
}));
vi.mock('@/components/messaging/ChatDock', () => ({
  useChatDock: () => ({ openChat: h.openChat, setRightInset: () => undefined }),
}));
vi.mock('@/hooks/useCall', () => ({
  useCall: () => ({ actions: { startCall: h.startCall }, state: { status: 'idle' } }),
}));
vi.mock('@/services/webrtc/mediaUtils', () => ({ isMediaSupported: () => true }));

import { Team } from '@/pages/Team';

const renderTeam = () =>
  render(
    <MemoryRouter>
      <Team />
    </MemoryRouter>,
  );

const rowOf = (name: string) =>
  screen.getAllByRole('row').find((r) => within(r).queryAllByText(name, { exact: false }).length > 0)!;

beforeEach(() => {
  h.openChat.mockReset();
  h.startCall.mockReset();
  h.invitations = [];
});
afterEach(cleanup);

describe('Team page', () => {
  it('lists the project’s people with the headline figures', async () => {
    renderTeam();
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy();
    await screen.findByText('Alice');
    expect(screen.getByText('Total Members').nextElementSibling?.textContent).toBe('2');
    expect(screen.getByText('Admins').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Pending Invites').nextElementSibling?.textContent).toBe('0');
    const owner = rowOf('Mia Owner');
    expect(within(owner).getByText('Owner')).toBeTruthy();
    expect(within(owner).getByText('(You)')).toBeTruthy();
    expect(within(owner).getByText('mia@x.io')).toBeTruthy();
  });

  it('gives every other person a chat and a call button, but not your own row', async () => {
    renderTeam();
    await screen.findByText('Alice');
    const alice = rowOf('Alice');
    expect(within(alice).getByRole('button', { name: 'Open chat with Alice' })).toBeTruthy();
    expect(within(alice).getByRole('button', { name: 'Voice call Alice' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open chat with Mia Owner' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Voice call Mia Owner' })).toBeNull();
  });

  it('the row buttons reach only that person', async () => {
    renderTeam();
    await screen.findByText('Alice');
    fireEvent.click(screen.getByRole('button', { name: 'Open chat with Alice' }));
    expect(h.openChat).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'alice', displayName: 'Alice', email: 'alice@x.io', organizationId: 'org1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Voice call Alice' }));
    const [context, media, target] = h.startCall.mock.calls[0];
    expect(context).toEqual({ type: 'dm', targetId: 'alice', label: 'Alice' });
    expect(media).toBe('audio');
    expect(target.userId).toBe('alice');
  });

  it('keeps the existing management actions on a member row', async () => {
    renderTeam();
    await screen.findByText('Alice');
    const alice = rowOf('Alice');
    expect(within(alice).getByRole('combobox', { name: 'Organization role' })).toBeTruthy();
    expect(within(alice).getByRole('combobox', { name: 'Role in this project' })).toBeTruthy();
    expect(within(alice).getByRole('button', { name: 'Move Alice to another project' })).toBeTruthy();
    expect(within(alice).getByRole('button', { name: 'Remove Alice from this project' })).toBeTruthy();
    const owner = rowOf('Mia Owner');
    expect(within(owner).queryByRole('button', { name: /remove/i })).toBeNull();
    expect(within(owner).queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Member' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite Member' })).toBeTruthy();
  });

  it('shows pending invitations with a Pending status and their actions', async () => {
    h.invitations = [
      {
        invitationId: 'i1',
        inviteeEmail: 'new@x.io',
        role: 'member',
        status: 'pending',
        token: 'tok',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    ];
    renderTeam();
    expect(await screen.findByText('new@x.io')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Pending Invitations' })).toBeTruthy();
    expect(screen.getByText('Pending').getAttribute('data-tone')).toBe('warning');
    expect(screen.getByRole('button', { name: 'Copy invitation link for new@x.io' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel invitation for new@x.io' })).toBeTruthy();
  });
});
