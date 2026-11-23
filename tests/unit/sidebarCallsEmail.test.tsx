// The sidebar: Calls and Email have their own entries beside the CRM, for the
// people who see the CRM there.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => {
  const noop = () => undefined;
  const auth = { user: { userId: 'u1', displayName: 'Sam', email: 'sam@example.com' }, signOut: noop };
  const chrome = { project: null };
  const projects = { projects: [] as unknown[] };
  const pinned = { pinnedIds: [] as string[], isPinned: () => false, toggle: noop };
  return {
    auth, chrome, projects, pinned,
    features: new Set<string>(['crm', 'email_campaigns', 'team_collaboration']),
    organization: { isAdmin: true, isViewer: false, isOwner: true },
    scope: { selectedId: 'ws-1', isAll: false, isUnassigned: false, menuPages: null as string[] | null },
  };
});

vi.mock('@/context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => state.organization }));
vi.mock('@/context/SubscriptionContext', () => ({
  useSubscription: () => ({ trialInfo: null, hasFeature: (f: string) => state.features.has(f) }),
}));
vi.mock('@/context/ProjectChromeContext', () => ({ useProjectChrome: () => state.chrome }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => state.projects }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => state.scope, ALL_WORKSPACES_ID: 'all' }));
vi.mock('@/hooks/usePinnedProjects', () => ({ usePinnedProjects: () => state.pinned }));
vi.mock('@/components/sidebar/WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('@/components/sidebar/ThemeQuickToggle', () => ({ ThemeQuickToggle: () => null }));
vi.mock('@/components/time/ClockButton', () => ({ ClockButton: () => null }));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/brand/TaskCalendarLogo', () => ({ TaskCalendarLogo: () => null }));

import { Sidebar } from '@/components/sidebar/Sidebar';

const labels = () => {
  render(<MemoryRouter initialEntries={['/tasks']}><Sidebar /></MemoryRouter>);
  return screen.getAllByRole('link').map((a) => ({ text: a.textContent?.trim() ?? '', href: a.getAttribute('href') }));
};
const hrefOf = (name: string) => labels().find((l) => l.text === name)?.href ?? null;

beforeEach(() => {
  state.features = new Set(['crm', 'email_campaigns', 'team_collaboration']);
  state.organization = { isAdmin: true, isViewer: false, isOwner: true };
  state.scope = { selectedId: 'ws-1', isAll: false, isUnassigned: false, menuPages: null };
});
afterEach(cleanup);

describe('sidebar: Calls and Email', () => {
  it('shows Calls and Email right after the CRM for an owner or admin', () => {
    const all = labels();
    const names = all.map((l) => l.text);
    expect(all.find((l) => l.text === 'Calls')?.href).toBe('/calls');
    expect(all.find((l) => l.text === 'Email')?.href).toBe('/email');
    expect(names.indexOf('Calls')).toBe(names.indexOf('CRM') + 1);
    expect(names.indexOf('Email')).toBe(names.indexOf('Calls') + 1);
  });

  it('keeps both away from a member', () => {
    state.organization = { isAdmin: false, isViewer: false, isOwner: false };
    const names = labels().map((l) => l.text);
    expect(names).toContain('My Tasks');
    expect(names).not.toContain('Calls');
    expect(names).not.toContain('Email');
  });

  it('follows the plan: no Email without that feature, no Calls without the CRM', () => {
    state.features = new Set(['crm']);
    expect(hrefOf('Email')).toBeNull();
    cleanup();
    expect(hrefOf('Calls')).toBe('/calls');
    cleanup();
    state.features = new Set(['email_campaigns']);
    expect(hrefOf('Calls')).toBeNull();
  });

  // The Social page ("New post" to every platform) had no entry in the menu at
  // all: it could only be reached by typing its address.
  it('shows Social right after Email for an owner or admin', () => {
    const all = labels();
    const names = all.map((l) => l.text);
    expect(all.find((l) => l.text === 'Social')?.href).toBe('/social');
    expect(names.indexOf('Social')).toBe(names.indexOf('Email') + 1);
  });

  it('shows Social on a plan without bulk email, and in a workspace with no project yet', () => {
    state.features = new Set(['crm']);
    state.projects.projects = [];
    expect(hrefOf('Social')).toBe('/social');
  });

  it('keeps Social away from a member, and out of a workspace menu without the CRM', () => {
    state.organization = { isAdmin: false, isViewer: false, isOwner: false };
    expect(hrefOf('Social')).toBeNull();
    cleanup();
    state.organization = { isAdmin: true, isViewer: false, isOwner: true };
    state.scope = { ...state.scope, menuPages: ['my_tasks', 'crm'] };
    expect(hrefOf('Social')).toBe('/social');
    cleanup();
    state.scope = { ...state.scope, menuPages: ['my_tasks', 'calendar'] };
    expect(hrefOf('Social')).toBeNull();
  });

  it('goes with the CRM in a workspace that chose its own menu', () => {
    state.scope = { ...state.scope, menuPages: ['my_tasks', 'crm'] };
    const names = labels().map((l) => l.text);
    expect(names).toContain('Calls');
    expect(names).toContain('Email');
    cleanup();
    state.scope = { ...state.scope, menuPages: ['my_tasks', 'calendar'] };
    const without = labels().map((l) => l.text);
    expect(without).not.toContain('CRM');
    expect(without).not.toContain('Calls');
    expect(without).not.toContain('Email');
  });
});
