// The workspace a person chose stays chosen: through a reload, and from page
// to page. Two things used to throw it away:
//   1. the switcher in the side menu, which on a reload took "the list is not
//      read yet" for "this person may not see that workspace";
//   2. pages that need one workspace (Email, Social) and, with "All workspaces"
//      chosen, simply took the oldest one: the old "General".
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Workspace } from '@/types/workspace';

const STORAGE_KEY = 'selectedWorkspaceId';
const ALL = '__ALL_WORKSPACES__';

const state = vi.hoisted(() => ({
  auth: { user: { userId: 'u1' } as { userId: string } | null, loading: false },
  org: { loading: false, isAdmin: true, organization: { organizationId: 'o1' } as { organizationId: string } | null },
  ws: { workspaces: [] as unknown[], loading: false, DEFAULT_WORKSPACE_ID: '__default__', listOrgId: 'o1' as string | null, refresh: async () => {}, addWorkspace: async () => {} },
  projects: { projects: [] as unknown[], loading: false },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => state.org }));
vi.mock('@/hooks/useWorkspaces', () => ({ useWorkspaces: () => state.ws }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => state.projects }));
vi.mock('@/components/workspace/WorkspaceModal', () => ({ WorkspaceModal: () => null }));
vi.mock('@/components/workspace/NewProjectDialog', () => ({ NewProjectDialog: () => null }));

import { WorkspaceProvider, useWorkspaceScope } from '@/context/WorkspaceContext';
import { WorkspaceSwitcher } from '@/components/sidebar/WorkspaceSwitcher';

const workspace = (workspaceId: string, name: string, over: Partial<Workspace> = {}): Workspace =>
  ({ workspaceId, name, organizationId: 'o1', createdAt: new Date(), updatedAt: new Date(), ...over }) as Workspace;

const GENERAL = workspace('w-general', 'General', { isDefault: true });
const STUDIO = workspace('w-studio', 'Northwind Studio');
const DENTAL = workspace('w-dental', 'Harbour Dental');

const wrapper = ({ children }: { children: React.ReactNode }) => <WorkspaceProvider>{children}</WorkspaceProvider>;
const menu = () => render(<MemoryRouter><WorkspaceProvider><WorkspaceSwitcher /></WorkspaceProvider></MemoryRouter>);

beforeEach(() => {
  window.localStorage.clear();
  state.auth = { user: { userId: 'u1' }, loading: false };
  state.org = { loading: false, isAdmin: true, organization: { organizationId: 'o1' } };
  state.ws = { ...state.ws, workspaces: [GENERAL, STUDIO, DENTAL], loading: false, listOrgId: 'o1' };
  state.projects = { projects: [], loading: false };
});
afterEach(cleanup);

describe('a reload', () => {
  it('keeps the chosen workspace while the side menu does not know yet who the person is', () => {
    window.localStorage.setItem(STORAGE_KEY, 'w-studio');
    // Half-way through a reload: the organisation is still being read, so the
    // person is not known to be an owner yet, and the list has not arrived.
    state.org = { loading: true, isAdmin: false, organization: null };
    state.ws = { ...state.ws, workspaces: [], listOrgId: null };
    menu();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('w-studio');
  });

  it('keeps it while the list on hand is not this organisation\'s yet', () => {
    window.localStorage.setItem(STORAGE_KEY, 'w-studio');
    state.org = { loading: false, isAdmin: false, organization: { organizationId: 'o1' } };
    state.ws = { ...state.ws, workspaces: [], listOrgId: null };
    menu();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('w-studio');
  });

  it('keeps it for an owner once everything has arrived', () => {
    window.localStorage.setItem(STORAGE_KEY, 'w-studio');
    menu();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('w-studio');
  });

  it('still moves a member off a workspace they really may not see any more', () => {
    window.localStorage.setItem(STORAGE_KEY, 'w-studio');
    state.org = { loading: false, isAdmin: false, organization: { organizationId: 'o1' } };
    // Their only project is in another workspace.
    state.projects = { projects: [{ projectId: 'p1', workspaceId: 'w-dental' }], loading: false };
    menu();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(ALL);
  });
});

describe('a page that needs one workspace, while "All workspaces" is chosen', () => {
  const scope = () => renderHook(() => useWorkspaceScope(), { wrapper }).result;

  it('is offered the workspace the person used last, not the oldest one', () => {
    const result = scope();
    result.current.select('w-dental');
    result.current.select(ALL);
    cleanup();
    expect(scope().current.preferredWorkspaceId).toBe('w-dental');
  });

  it('is offered a workspace the person named, before a ready-made "General"', () => {
    expect(scope().current.preferredWorkspaceId).toBe('w-studio');
  });

  it('is offered the only workspace there is, whatever its name', () => {
    state.ws = { ...state.ws, workspaces: [GENERAL] };
    expect(scope().current.preferredWorkspaceId).toBe('w-general');
  });

  it('is offered the chosen workspace when one is chosen', () => {
    window.localStorage.setItem(STORAGE_KEY, 'w-studio');
    expect(scope().current.preferredWorkspaceId).toBe('w-studio');
  });

  it('is offered nothing while the list is not known, so no page picks from a half-read list', () => {
    state.ws = { ...state.ws, workspaces: [GENERAL], listOrgId: null };
    expect(scope().current.preferredWorkspaceId).toBeNull();
  });

  it('forgets a last-used workspace that is gone', () => {
    window.localStorage.setItem('selectedWorkspaceId.last', 'w-deleted');
    expect(scope().current.preferredWorkspaceId).toBe('w-studio');
  });
});
