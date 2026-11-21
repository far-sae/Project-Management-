// The Email page works as soon as there is a workspace. It used to stay locked
// until the workspace had a project, but leads are emailed long before a deal
// is won and a project exists.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  workspace: { selected: { workspaceId: 'w', name: 'Studio' } as null | { workspaceId: string; name: string }, loading: false },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1', organizationId: '11111111-1111-4111-8111-111111111111' } }) }));
vi.mock('@/context/OrganizationContext', () => {
  const value = { organization: { organizationId: '11111111-1111-4111-8111-111111111111' }, isAdmin: true, loading: false };
  return { useOrganization: () => value };
});
vi.mock('@/hooks/useSelectedWorkspace', () => ({
  useSelectedWorkspace: () => ({
    selected: h.workspace.selected, isAll: false, isUnassigned: false, select: () => undefined,
    workspaces: h.workspace.selected ? [h.workspace.selected] : [], loading: h.workspace.loading,
  }),
}));
// A workspace with no project at all, and a failing project list: neither may matter to this page.
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ projects: [], loading: true }) }));
vi.mock('@/services/supabase/email', () => ({ listAccounts: async () => [], listMailboxStatus: async () => [] }));
vi.mock('@/components/email/SetupChecklist', () => ({ SetupChecklist: () => null }));
vi.mock('@/components/email/WarmupServiceCard', () => ({ WarmupServiceCard: () => null }));
vi.mock('@/components/email', () => {
  const tab = (name: string) => () => <div>{name} tab</div>;
  return {
    ProspectsTab: tab('Prospects'), GroupsTab: tab('Groups'), TemplatesTab: tab('Templates'), AccountsTab: tab('Accounts'),
    ComposeTab: tab('Compose'), CampaignsTab: tab('Campaigns'), SequencesTab: tab('Sequences'), SuppressionTab: tab('Suppression'),
    SettingsTab: tab('Settings'),
  };
});

import { Email } from '@/pages/Email';

afterEach(() => { cleanup(); h.workspace = { selected: { workspaceId: 'w', name: 'Studio' }, loading: false }; });

describe('Email page', () => {
  it('opens for a workspace that has no project yet', async () => {
    render(<Email />);
    expect(await screen.findByText('Campaigns tab')).toBeTruthy();
    expect(screen.queryByText(/Create a project/)).toBeNull();
    expect(screen.queryByText('Loading your workspace…')).toBeNull();
  });

  it('still asks for a workspace when there is none', () => {
    h.workspace = { selected: null, loading: false };
    render(<Email />);
    expect(screen.getByText('Select or create a workspace to use email marketing.')).toBeTruthy();
    expect(screen.queryByText('Campaigns tab')).toBeNull();
  });
});
