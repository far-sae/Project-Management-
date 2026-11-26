// Team page: the member list keeps its management actions and adds per-person
// chat / call buttons on every row except your own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setInternalsVisible } from '@/lib/publicError';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  openChat: vi.fn(),
  startCall: vi.fn(),
  invitations: [] as Array<Record<string, unknown>>,
  loadOrgAccess: vi.fn(),
  setMemberAccess: vi.fn(),
  internals: { visible: true },
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

const orgMembers = [
  { userId: 'me', displayName: 'Mia Owner', email: 'mia@x.io', role: 'owner', status: 'active' },
  { userId: 'alice', displayName: 'Alice', email: 'alice@x.io', role: 'member', status: 'active' },
  { userId: 'tom', displayName: 'Tom', email: 'tom@x.io', role: 'admin', status: 'active' },
  { userId: 'dana', displayName: 'Dana', email: 'dana@x.io', role: 'viewer', status: 'active' },
];
const project = {
  projectId: 'p1',
  name: 'Website',
  ownerId: 'me',
  organizationId: 'org1',
  members: [
    { userId: 'alice', email: 'alice@x.io', displayName: 'Alice', role: 'member' },
    { userId: 'tom', email: 'tom@x.io', displayName: 'Tom', role: 'member' },
    { userId: 'dana', email: 'dana@x.io', displayName: 'Dana', role: 'viewer' },
  ],
};

vi.mock('@/hooks/useSelectedWorkspace', () => {
  const same = <T,>(list: T[]) => list;
  const scope = {
    selectedId: 'w', selected: { workspaceId: 'w', name: 'Studio' }, select: () => {},
    filterProjects: same, filterTasks: same, projectIds: null,
  };
  return { useSelectedWorkspace: () => scope };
});
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useInternalsVisible', () => ({ useInternalsVisible: () => h.internals.visible }));
vi.mock('@/services/supabase/memberAccess', () => ({ loadOrgAccess: h.loadOrgAccess, setMemberAccess: h.setMemberAccess }));
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
  h.loadOrgAccess.mockReset().mockResolvedValue({ ready: true, byUser: {} });
  h.setMemberAccess.mockReset().mockResolvedValue(undefined);
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.internals.visible = true;
});
afterEach(() => { cleanup(); setInternalsVisible(true); });

describe('Social media for one person, without making them an admin', () => {
  const socialOf = (name: string) => within(rowOf(name)).queryByLabelText(`Social media access of ${name}`) as HTMLSelectElement | null;

  it('is a choice on the row of a plain member: no access, posts only, or everything', async () => {
    renderTeam();
    await screen.findByText('Alice');
    await waitFor(() => expect(socialOf('Alice')).toBeTruthy());
    expect(h.loadOrgAccess).toHaveBeenCalledWith('org1');
    const choice = socialOf('Alice') as HTMLSelectElement;
    expect(choice.value).toBe('none');
    expect([...choice.options].map((o) => o.textContent)).toEqual(['Social: no access', 'Social: posts only', 'Social: everything']);
  });

  it('is not offered for the owner, an admin or a viewer', async () => {
    renderTeam();
    await screen.findByText('Alice');
    await waitFor(() => expect(socialOf('Alice')).toBeTruthy());
    expect(socialOf('Mia Owner')).toBeNull();
    expect(socialOf('Tom')).toBeNull();
    expect(socialOf('Dana')).toBeNull();
  });

  it('shows what the person has, gives more, and takes it away', async () => {
    h.loadOrgAccess.mockResolvedValue({ ready: true, byUser: { alice: { social: 'use' } } });
    renderTeam();
    await screen.findByText('Alice');
    await waitFor(() => expect(socialOf('Alice')?.value).toBe('use'));
    fireEvent.change(socialOf('Alice') as HTMLSelectElement, { target: { value: 'manage' } });
    await waitFor(() => expect(h.setMemberAccess).toHaveBeenCalledWith('org1', 'alice', 'social', 'manage', 'me'));
    await waitFor(() => expect(socialOf('Alice')?.value).toBe('manage'));
    expect(h.toast.success).toHaveBeenCalledWith('Alice now has Social media: everything.');
    fireEvent.change(socialOf('Alice') as HTMLSelectElement, { target: { value: 'none' } });
    await waitFor(() => expect(h.setMemberAccess).toHaveBeenLastCalledWith('org1', 'alice', 'social', null, 'me'));
    await waitFor(() => expect(socialOf('Alice')?.value).toBe('none'));
    expect(h.toast.success).toHaveBeenLastCalledWith('Alice no longer sees Social media.');
  });

  it('keeps what was there and says so in plain words when it cannot be changed', async () => {
    h.setMemberAccess.mockRejectedValue(new Error('The access could not be changed. Please try again.'));
    renderTeam();
    await screen.findByText('Alice');
    await waitFor(() => expect(socialOf('Alice')).toBeTruthy());
    fireEvent.change(socialOf('Alice') as HTMLSelectElement, { target: { value: 'use' } });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The access could not be changed. Please try again.'));
    expect(socialOf('Alice')?.value).toBe('none');
  });

  it('offers no choice while the database cannot keep it, and tells the people who run the site which step is missing', async () => {
    h.loadOrgAccess.mockResolvedValue({ ready: false, byUser: {} });
    renderTeam();
    await screen.findByText('Alice');
    const note = await screen.findByText(/is not switched on yet/);
    expect(note.textContent).toContain('Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.');
    expect(socialOf('Alice')).toBeNull();
    cleanup();
    h.internals.visible = false;
    renderTeam();
    const plain = await screen.findByText(/is not switched on yet/);
    expect(plain.textContent).not.toContain('supabase');
  });
});

describe('Team page', () => {
  it('lists the project’s people with the headline figures', async () => {
    renderTeam();
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy();
    await screen.findByText('Alice');
    expect(screen.getByText('Total Members').nextElementSibling?.textContent).toBe('4');
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
