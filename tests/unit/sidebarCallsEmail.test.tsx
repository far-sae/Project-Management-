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
    organization: { isAdmin: true, isViewer: false, isOwner: true, areaLevel: (() => 'manage') as (area: string) => string, canAccessPage: (() => true) as (page: string) => boolean },
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
/** The pages of the quick menu, in the order they are shown (the logo and the footer links are left out). */
const MENU = ['Project Management', 'Projects analytics', 'My Tasks', 'Inbox', 'CRM', 'Calls', 'Email', 'Social', 'Calendar', 'Workload', 'Reports', 'Team', 'HR'];
const menu = () => labels().map((l) => l.text).filter((text) => MENU.includes(text));

const OWNER = { isAdmin: true, isViewer: false, isOwner: true, areaLevel: () => 'manage', canAccessPage: () => true };
/** A plain member, with the pages the owner chose for them on the Team page (nothing unless said). */
const member = (pages: Record<string, 'off' | 'use' | 'manage'> = {}) => ({
  isAdmin: false, isViewer: false, isOwner: false,
  areaLevel: (area: string) => (pages[area] === 'use' || pages[area] === 'manage' ? pages[area] : 'none'),
  canAccessPage: (page: string) => pages[page] !== 'off',
});

beforeEach(() => {
  state.features = new Set(['crm', 'email_campaigns', 'team_collaboration']);
  state.organization = OWNER;
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
    state.organization = member();
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
    state.organization = member();
    expect(hrefOf('Social')).toBeNull();
    cleanup();
    state.organization = OWNER;
    state.scope = { ...state.scope, menuPages: ['my_tasks', 'crm'] };
    expect(hrefOf('Social')).toBe('/social');
    cleanup();
    state.scope = { ...state.scope, menuPages: ['my_tasks', 'calendar'] };
    expect(hrefOf('Social')).toBeNull();
  });

  it('shows Social to a member who was given it, at either level, and nothing else of the admins', () => {
    for (const level of ['use', 'manage'] as const) {
      state.organization = member({ social: level });
      const all = labels();
      const names = all.map((l) => l.text);
      expect(all.find((l) => l.text === 'Social')?.href).toBe('/social');
      expect(names).toContain('My Tasks');
      for (const hidden of ['CRM', 'Calls', 'Email', 'Team', 'HR', 'Reports', 'Inbox']) expect(names).not.toContain(hidden);
      cleanup();
    }
  });

  it('never shows Social to a viewer, whatever was given', () => {
    state.organization = { isAdmin: false, isViewer: true, isOwner: false, areaLevel: () => 'none', canAccessPage: () => true };
    expect(hrefOf('Social')).toBeNull();
  });

  it('gives a member every page the owner switched on, in the order of the full menu, and never HR', () => {
    state.organization = member({ dashboard: 'use', projects_analytics: 'use', inbox: 'use', crm: 'use', calls: 'use', email: 'use', social: 'manage', reports: 'use' });
    expect(menu()).toEqual(['Project Management', 'Projects analytics', 'My Tasks', 'Inbox', 'CRM', 'Calls', 'Email', 'Social', 'Calendar', 'Workload', 'Reports']);
  });

  it('leaves a page out that the owner switched off, also a standard one, and keeps My Tasks and Calendar', () => {
    state.organization = member({ workload: 'off', crm: 'off', email: 'use' });
    expect(menu()).toEqual(['My Tasks', 'Email', 'Calendar']);
  });

  it('gives a member nothing new while the owner chose nothing', () => {
    state.organization = member();
    expect(menu()).toEqual(['My Tasks', 'Calendar', 'Workload']);
  });

  it('follows the plan for a member too: a page that was switched on needs its feature', () => {
    state.features = new Set(['team_collaboration']);
    state.organization = member({ crm: 'use', calls: 'use', email: 'use', social: 'use' });
    expect(menu()).toEqual(['My Tasks', 'Social', 'Calendar', 'Workload']);
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

// Finding new people (Apollo) is its own place in the menu, before the CRM:
// it is where leads come from, not a button inside the Leads page.
describe('sidebar: Find leads', () => {
  it('has its own entry for an owner or admin, right before the CRM', () => {
    const all = labels();
    const names = all.map((l) => l.text);
    expect(all.find((l) => l.text === 'Find leads')?.href).toBe('/find-leads');
    expect(names.indexOf('Find leads')).toBe(names.indexOf('CRM') - 1);
  });

  it('is never shown to a member, also one who was given the CRM: it spends credits', () => {
    state.organization = member({ crm: 'manage', calls: 'use', email: 'use' });
    expect(hrefOf('Find leads')).toBeNull();
    cleanup();
    expect(hrefOf('CRM')).toBe('/crm');
  });

  it('goes with the CRM: not on a plan without it, and not in a workspace menu without it', () => {
    state.features = new Set(['email_campaigns']);
    expect(hrefOf('Find leads')).toBeNull();
    cleanup();
    state.features = new Set(['crm']);
    state.scope = { ...state.scope, menuPages: ['my_tasks', 'calendar'] };
    expect(hrefOf('Find leads')).toBeNull();
    cleanup();
    state.scope = { ...state.scope, menuPages: ['my_tasks', 'crm'] };
    expect(hrefOf('Find leads')).toBe('/find-leads');
  });
});
