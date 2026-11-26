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
  saveMemberPages: vi.fn(),
  clearMemberPages: vi.fn(),
  features: new Set<string>(['crm', 'email_campaigns', 'team_collaboration']),
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
vi.mock('@/services/supabase/memberAccess', () => ({ loadOrgAccess: h.loadOrgAccess, saveMemberPages: h.saveMemberPages, clearMemberPages: h.clearMemberPages }));
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
    hasFeature: (f: string) => f === 'team_collaboration' || h.features.has(f),
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
  h.saveMemberPages.mockReset().mockResolvedValue(undefined);
  h.clearMemberPages.mockReset().mockResolvedValue(undefined);
  h.features = new Set(['crm', 'email_campaigns', 'team_collaboration']);
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.internals.visible = true;
});
afterEach(() => { cleanup(); setInternalsVisible(true); });

describe('the pages of one person, chosen by the owner', () => {
  // By its label, not by its role: while the window is open the page behind it is hidden from role queries.
  const pagesButton = (name: string) => screen.queryByLabelText(`Pages of ${name}`);
  const openPages = async (name = 'Alice') => {
    renderTeam();
    await screen.findByText(name);
    await waitFor(() => expect(pagesButton(name)).toBeTruthy());
    fireEvent.click(pagesButton(name) as HTMLElement);
    return screen.findByRole('dialog');
  };
  const toggle = (dialog: HTMLElement, label: string) => within(dialog).getByRole('switch', { name: label });
  const isOn = (dialog: HTMLElement, label: string) => toggle(dialog, label).getAttribute('aria-checked') === 'true';
  const ALL_OFF = { dashboard: 'off', projects_analytics: 'off', workload: 'off', inbox: 'off', reports: 'off', crm: 'off', calls: 'off', email: 'off', social: 'off' } as const;

  it('is a button on the row of a plain member, and not for the owner, an admin or a viewer', async () => {
    renderTeam();
    await screen.findByText('Alice');
    await waitFor(() => expect(pagesButton('Alice')).toBeTruthy());
    expect(h.loadOrgAccess).toHaveBeenCalledWith('org1');
    expect(pagesButton('Alice')?.textContent).toBe('Pages: standard');
    expect(pagesButton('Mia Owner')).toBeNull();
    expect(pagesButton('Tom')).toBeNull();
    expect(pagesButton('Dana')).toBeNull();
  });

  it('opens with what a member has in the menu today: only Workload on', async () => {
    const dialog = await openPages();
    expect(within(dialog).getByRole('heading', { name: 'What Alice can see' })).toBeTruthy();
    expect(dialog.textContent).toContain('My Tasks, Calendar, their own projects and their own settings are always on.');
    expect(within(dialog).getByRole('status').textContent).toContain('Nothing was chosen for Alice yet.');
    const names = within(dialog).getAllByRole('switch').map((sw) => sw.getAttribute('aria-label') ?? sw.id);
    expect(names).toHaveLength(9);
    // The Team page is empty for somebody who runs no project, so it is not offered.
    expect(within(dialog).queryByRole('switch', { name: 'Team' })).toBeNull();
    expect(isOn(dialog, 'Workload')).toBe(true);
    for (const page of ['Project Management', 'Projects analytics', 'Inbox', 'Reports', 'CRM', 'Calls', 'Email', 'Social media']) expect(isOn(dialog, page)).toBe(false);
  });

  it('saves a row for every page, on or off, so the choice is exactly what the person gets', async () => {
    const dialog = await openPages();
    fireEvent.click(toggle(dialog, 'Social media'));
    fireEvent.click(toggle(dialog, 'CRM'));
    fireEvent.click(toggle(dialog, 'Workload'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.saveMemberPages).toHaveBeenCalledTimes(1));
    expect(h.saveMemberPages.mock.calls[0]).toEqual(['org1', 'alice', { ...ALL_OFF, social: 'use', crm: 'use' }, 'me']);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Saved. Alice sees the new pages the next time they open the app.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pagesButton('Alice')?.textContent).toBe('Pages: 2 on');
  });

  it('asks how much of a page with admin things is given: Social media and Calls', async () => {
    const dialog = await openPages();
    expect(within(dialog).queryByLabelText('How much of Social media')).toBeNull();
    fireEvent.click(toggle(dialog, 'Social media'));
    const social = within(dialog).getByLabelText('How much of Social media') as HTMLSelectElement;
    expect([...social.options].map((o) => o.textContent)).toEqual(['Posts only', 'Everything, with accounts and the autopilot']);
    fireEvent.change(social, { target: { value: 'manage' } });
    fireEvent.click(toggle(dialog, 'Calls'));
    expect([...(within(dialog).getByLabelText('How much of Calls') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Own calls only', 'All calls and recordings']);
    expect(within(dialog).queryByLabelText('How much of CRM')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.saveMemberPages.mock.calls[0]?.[2]).toMatchObject({ social: 'manage', calls: 'use', workload: 'use', crm: 'off' }));
  });

  it('shows what was chosen before, and saves only once something changed', async () => {
    h.loadOrgAccess.mockResolvedValue({ ready: true, byUser: { alice: { ...ALL_OFF, social: 'manage', email: 'use' } } });
    const dialog = await openPages();
    expect(pagesButton('Alice')?.textContent).toBe('Pages: 2 on');
    expect(within(dialog).queryByRole('status')).toBeNull();
    expect(isOn(dialog, 'Social media')).toBe(true);
    expect(isOn(dialog, 'Email')).toBe(true);
    expect(isOn(dialog, 'Workload')).toBe(false);
    expect((within(dialog).getByLabelText('How much of Social media') as HTMLSelectElement).value).toBe('manage');
    const save = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(toggle(dialog, 'Email'));
    expect(save.disabled).toBe(false);
  });

  it('can put a person back to the standard pages of a member', async () => {
    h.loadOrgAccess.mockResolvedValue({ ready: true, byUser: { alice: { ...ALL_OFF, crm: 'use' } } });
    const dialog = await openPages();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to standard' }));
    await waitFor(() => expect(h.clearMemberPages).toHaveBeenCalledWith('org1', 'alice'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Alice has the standard pages of a member again.'));
    await waitFor(() => expect(pagesButton('Alice')?.textContent).toBe('Pages: standard'));
    expect(h.saveMemberPages).not.toHaveBeenCalled();
  });

  it('offers no "back to standard" for somebody nothing was chosen for', async () => {
    const dialog = await openPages();
    expect(within(dialog).queryByRole('button', { name: 'Back to standard' })).toBeNull();
  });

  it('leaves out a page the plan does not have', async () => {
    h.features = new Set(['team_collaboration']);
    const dialog = await openPages();
    for (const page of ['CRM', 'Calls', 'Email']) expect(within(dialog).queryByRole('switch', { name: page })).toBeNull();
    expect(within(dialog).getByRole('switch', { name: 'Social media' })).toBeTruthy();
  });

  it('keeps the window open and says so in plain words when it cannot be saved', async () => {
    h.saveMemberPages.mockRejectedValue(new Error('The pages could not be saved. Please try again.'));
    const dialog = await openPages();
    fireEvent.click(toggle(dialog, 'Reports'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The pages could not be saved. Please try again.'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(pagesButton('Alice')?.textContent).toBe('Pages: standard');
  });

  it('changes nothing when the window is closed without saving', async () => {
    const dialog = await openPages();
    fireEvent.click(toggle(dialog, 'CRM'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.saveMemberPages).not.toHaveBeenCalled();
    // Opened again, it shows what is saved, not what was clicked.
    fireEvent.click(pagesButton('Alice') as HTMLElement);
    expect(isOn(await screen.findByRole('dialog'), 'CRM')).toBe(false);
  });

  it('offers no button while the database cannot keep it, and tells the people who run the site which step is missing', async () => {
    h.loadOrgAccess.mockResolvedValue({ ready: false, byUser: {} });
    renderTeam();
    await screen.findByText('Alice');
    const note = await screen.findByText(/is not switched on yet/);
    expect(note.textContent).toContain('Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.');
    expect(pagesButton('Alice')).toBeNull();
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
