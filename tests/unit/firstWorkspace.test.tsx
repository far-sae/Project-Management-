// No "General" and no "Unassigned": every organisation works in a workspace
// its people made and named. A new organisation is asked for its first
// workspace before anything else; an old one is asked to name its "General".
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Workspace } from '@/types/workspace';

const h = vi.hoisted(() => ({
  scope: {
    workspaces: [] as unknown[],
    workspacesKnown: true,
    select: vi.fn(),
    refreshWorkspaces: vi.fn(async () => {}),
  },
  organization: { isAdmin: true, organization: { organizationId: 'org-1', name: 'Northwind Studio' } as { organizationId: string; name: string } | null },
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  signOut: vi.fn(async () => {}),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspaceScope: () => h.scope }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.organization }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ signOut: h.signOut }) }));
vi.mock('@/services/supabase/workspaces', () => ({ createWorkspace: h.createWorkspace, updateWorkspace: h.updateWorkspace }));

import { FirstWorkspaceGate } from '@/components/workspace/FirstWorkspaceGate';
import { isPlaceholderWorkspaceName, workspaceToName } from '@/lib/workspaceDisplay';

const workspace = (workspaceId: string, name: string, isDefault = false): Workspace =>
  ({ workspaceId, name, isDefault, organizationId: 'org-1', createdAt: new Date(), updatedAt: new Date() }) as Workspace;

const show = () => render(<FirstWorkspaceGate><p>the app</p></FirstWorkspaceGate>);
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

beforeEach(() => {
  h.scope = { workspaces: [], workspacesKnown: true, select: vi.fn(), refreshWorkspaces: vi.fn(async () => {}) };
  h.organization = { isAdmin: true, organization: { organizationId: 'org-1', name: 'Northwind Studio' } };
  h.createWorkspace.mockReset().mockResolvedValue(workspace('w-new', 'Client work', true));
  h.updateWorkspace.mockReset().mockResolvedValue(undefined);
  h.toast.error.mockReset();
});
afterEach(cleanup);

describe('which names are not real names', () => {
  it('are the ones the app used to give by itself', () => {
    for (const name of ['General', ' general ', 'Default', 'Default Workspace', 'Workspace', '']) expect(isPlaceholderWorkspaceName(name), name).toBe(true);
    for (const name of ['General Dental', 'Client work', 'Northwind']) expect(isPlaceholderWorkspaceName(name), name).toBe(false);
  });

  it('ask for a name only when that is the organisation’s one workspace', () => {
    expect(workspaceToName([workspace('w1', 'General', true)])?.workspaceId).toBe('w1');
    // With a workspace somebody made, nobody is stopped: the old one can be renamed from the workspaces window.
    expect(workspaceToName([workspace('w1', 'General', true), workspace('w2', 'Client work')])).toBeNull();
    expect(workspaceToName([workspace('w1', 'Client work', true)])).toBeNull();
    expect(workspaceToName([])).toBeNull();
  });
});

describe('a new organisation', () => {
  it('is asked for its first workspace before anything else', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Create your first workspace' })).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
    expect((screen.getByRole('button', { name: 'Create workspace' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('makes it the organisation’s main workspace, with the name typed, and opens it', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: '  Client work ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(h.createWorkspace).toHaveBeenCalledWith({ name: 'Client work', organizationId: 'org-1', isDefault: true }));
    await waitFor(() => expect(h.scope.select).toHaveBeenCalledWith('w-new'));
    expect(h.scope.refreshWorkspaces).toHaveBeenCalled();
  });

  it('does not take "General" for a name', () => {
    show();
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'General' } });
    expect((screen.getByRole('button', { name: 'Create workspace' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Give it a name of your own/)).toBeTruthy();
  });

  it('never locks out a member, who cannot make a workspace: only the owner and admins are asked', () => {
    h.organization = { ...h.organization, isAdmin: false };
    show();
    expect(screen.getByText('the app')).toBeTruthy();
    expect(screen.queryByLabelText('Workspace name')).toBeNull();
  });

  it('says so plainly when the workspace cannot be made', async () => {
    h.createWorkspace.mockRejectedValue({ message: 'new row violates row-level security policy for table "workspaces"' });
    show();
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Client work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(String(h.toast.error.mock.calls[0]![0])).not.toMatch(/row-level|workspaces"/);
  });
});

describe('an organisation that still has only "General"', () => {
  beforeEach(() => { h.scope = { ...h.scope, workspaces: [workspace('w1', 'General', true)] }; });

  it('asks the owner to name it: nothing in it is lost', async () => {
    show();
    expect(screen.getByRole('heading', { name: 'Name your workspace' })).toBeTruthy();
    expect(screen.getByText(/Everything in it stays where it is/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Client work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(h.updateWorkspace).toHaveBeenCalledWith('w1', { name: 'Client work' }));
    expect(h.createWorkspace).not.toHaveBeenCalled();
    await waitFor(() => expect(h.scope.select).toHaveBeenCalledWith('w1'));
  });

  it('does not stop a member, who could not rename it anyway', () => {
    h.organization = { ...h.organization, isAdmin: false };
    show();
    expect(screen.getByText('the app')).toBeTruthy();
  });
});

describe('a way out', () => {
  it('lets a person sign out from this screen', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(h.signOut).toHaveBeenCalled();
  });

  it('never stops an organisation that exists only in this browser', () => {
    h.organization = { isAdmin: true, organization: { organizationId: 'local-abc', name: 'Me' } };
    show();
    expect(screen.getByText('the app')).toBeTruthy();
  });
});

describe('everybody else', () => {
  it('goes straight to the app once there is a workspace with a real name', () => {
    h.scope = { ...h.scope, workspaces: [workspace('w1', 'Client work', true)] };
    show();
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('is not stopped while the list of workspaces is still unknown (signing in, a reload)', () => {
    h.scope = { ...h.scope, workspaces: [], workspacesKnown: false };
    show();
    expect(screen.getByText('the app')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Create your first workspace' })).toBeNull();
  });
});

describe('no "General", no "Unassigned" and no project without a workspace', () => {
  it('signing up no longer makes a "General" workspace', () => {
    const auth = read('src/context/AuthContext.tsx');
    expect(auth).not.toMatch(/name:\s*'General'/);
    expect(auth).not.toMatch(/from\('workspaces'\)\s*\.insert/);
  });

  it('the workspace switcher offers no "Unassigned projects"', () => {
    expect(read('src/components/sidebar/WorkspaceSwitcher.tsx')).not.toContain('Unassigned projects');
  });

  it('a new project cannot be made with "No workspace"', () => {
    for (const file of ['src/components/workspace/NewProjectDialog.tsx', 'src/pages/kanban/Dashboard.tsx']) {
      expect(read(file), file).not.toContain('>No workspace<');
    }
  });
});
