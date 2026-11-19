// The hook every HR screen uses to know whose data to show for the workspace
// picked in the sidebar, and to put people in a workspace.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

type ListResult = { available: boolean; assignments: Array<{ userId: string; workspaceId: string }> };

const h = vi.hoisted(() => {
  const members = [
    { userId: 'sam', displayName: 'Sam', email: 'sam@x.io', status: 'active', role: 'owner' },
    { userId: 'priya', displayName: 'Priya Nair', email: 'priya@x.io', status: 'active', role: 'member' },
    { userId: 'tom', displayName: 'Tom Okafor', email: 'tom@x.io', status: 'active', role: 'member' },
  ];
  const workspaces = [
    { workspaceId: 'ws-studio', name: 'Studio' },
    { workspaceId: 'ws-agency', name: 'Agency' },
  ];
  return {
    // Stable objects: a mock that hands back a new object on every call makes
    // effects re-run forever.
    org: { organization: { organizationId: 'org1', members }, isOwner: true, isAdmin: true },
    auth: { user: { userId: 'sam', displayName: 'Sam' } },
    scopes: {
      studio: {
        selectedId: 'ws-studio', selected: workspaces[0], isAll: false, isUnassigned: false, workspaces,
      },
      agency: {
        selectedId: 'ws-agency', selected: workspaces[1], isAll: false, isUnassigned: false, workspaces,
      },
      all: {
        selectedId: '__ALL_WORKSPACES__', selected: null, isAll: true, isUnassigned: false, workspaces,
      },
      unassigned: {
        selectedId: '__UNASSIGNED_PROJECTS__', selected: null, isAll: false, isUnassigned: true, workspaces,
      },
    },
    scope: 'studio' as 'studio' | 'agency' | 'all' | 'unassigned',
    /** What the database answers; `null` keeps the first load waiting. */
    first: null as ListResult | null,
    failWith: null as unknown,
    push: null as ((r: ListResult) => void) | null,
    subscribe: vi.fn(),
    stop: vi.fn(),
    setPersonWorkspace: vi.fn(),
    assignPeopleToWorkspace: vi.fn(),
  };
});

vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.org }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => h.scopes[h.scope] }));
vi.mock('@/services/supabase/hrWorkspaces', () => ({
  subscribeToPersonWorkspaces: (
    orgId: string,
    cb: (r: ListResult) => void,
    onError?: (e: unknown) => void,
  ) => {
    h.subscribe(orgId);
    h.push = cb;
    if (h.failWith) onError?.(h.failWith);
    else if (h.first) cb(h.first);
    return h.stop;
  },
  setPersonWorkspace: h.setPersonWorkspace,
  assignPeopleToWorkspace: h.assignPeopleToWorkspace,
}));

import { HrWorkspacePeopleContext, useHrWorkspacePeople } from '@/hooks/useHrWorkspacePeople';

const SAM_IN_STUDIO: ListResult = {
  available: true,
  assignments: [{ userId: 'sam', workspaceId: 'ws-studio' }],
};
const ids = (set: Set<string> | null) => (set ? [...set].sort() : null);

beforeEach(() => {
  h.scope = 'studio';
  h.first = SAM_IN_STUDIO;
  h.failWith = null;
  h.push = null;
  h.subscribe.mockClear();
  h.stop.mockClear();
  h.setPersonWorkspace.mockReset().mockResolvedValue({ available: true });
  h.assignPeopleToWorkspace.mockReset().mockResolvedValue({ available: true });
});
afterEach(cleanup);

describe('useHrWorkspacePeople', () => {
  it('a workspace shows the people assigned to it and points out who has none', () => {
    const { result } = renderHook(() => useHrWorkspacePeople());
    expect(result.current.available).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(ids(result.current.scopedUserIds)).toEqual(['sam']);
    expect(result.current.inScope('sam')).toBe(true);
    expect(result.current.inScope('priya')).toBe(false);
    expect(result.current.unassigned.map((m) => m.displayName)).toEqual(['Priya Nair', 'Tom Okafor']);
    expect(result.current.workspaceOf('sam')).toBe('ws-studio');
    expect(result.current.workspaceOf('tom')).toBeNull();
    expect(result.current.label).toBe('Showing Studio');
    expect(result.current.figureNote).toBe('For Studio only');
    expect(h.subscribe).toHaveBeenCalledWith('org1');
  });

  it('"Unassigned" shows the people with no workspace', () => {
    h.scope = 'unassigned';
    const { result } = renderHook(() => useHrWorkspacePeople());
    expect(ids(result.current.scopedUserIds)).toEqual(['priya', 'tom']);
    expect(result.current.inScope('sam')).toBe(false);
    expect(result.current.label).toBe('Showing people with no workspace');
  });

  it('"All workspaces" shows everyone', () => {
    h.scope = 'all';
    const { result } = renderHook(() => useHrWorkspacePeople());
    expect(result.current.scopedUserIds).toBeNull();
    expect(result.current.inScope('tom')).toBe(true);
    expect(result.current.label).toBe('Showing the whole company');
    expect(result.current.figureNote).toBeNull();
  });

  it('before the database update HR shows the whole company and offers nothing new', async () => {
    h.first = { available: false, assignments: [] };
    const { result } = renderHook(() => useHrWorkspacePeople());
    expect(result.current.available).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.scopedUserIds).toBeNull();
    expect(result.current.inScope('tom')).toBe(true);
    expect(result.current.unassigned).toEqual([]);
    expect(result.current.label).toBeNull();
    expect(result.current.figureNote).toBeNull();

    // Nothing is written either.
    await act(async () => {
      await result.current.assign('tom', 'ws-studio');
      expect(await result.current.assignAllUnassignedToSelected()).toBe(0);
    });
    expect(h.setPersonWorkspace).not.toHaveBeenCalled();
    expect(h.assignPeopleToWorkspace).not.toHaveBeenCalled();
  });

  it('while the assignments are loading it waits rather than guessing', () => {
    h.first = null;
    const { result } = renderHook(() => useHrWorkspacePeople());
    expect(result.current.loading).toBe(true);
    expect(result.current.waiting).toBe(true);
    expect(result.current.available).toBe(false);
    act(() => h.push?.(SAM_IN_STUDIO));
    expect(result.current.loading).toBe(false);
    expect(result.current.waiting).toBe(false);
    expect(ids(result.current.scopedUserIds)).toEqual(['sam']);
  });

  it('"All workspaces" never has to wait: everyone shows either way', () => {
    h.first = null;
    h.scope = 'all';
    const { result } = renderHook(() => useHrWorkspacePeople());
    expect(result.current.loading).toBe(true);
    expect(result.current.waiting).toBe(false);
  });

  it('follows a change made somewhere else', () => {
    const { result } = renderHook(() => useHrWorkspacePeople());
    act(() =>
      h.push?.({
        available: true,
        assignments: [
          { userId: 'sam', workspaceId: 'ws-studio' },
          { userId: 'priya', workspaceId: 'ws-studio' },
        ],
      }),
    );
    expect(ids(result.current.scopedUserIds)).toEqual(['priya', 'sam']);
    expect(result.current.unassigned.map((m) => m.userId)).toEqual(['tom']);
  });

  it('follows the workspace picked in the sidebar', () => {
    const { result, rerender } = renderHook(() => useHrWorkspacePeople());
    expect(ids(result.current.scopedUserIds)).toEqual(['sam']);
    h.scope = 'agency';
    rerender();
    expect(ids(result.current.scopedUserIds)).toEqual([]);
    expect(result.current.label).toBe('Showing Agency');
    // Still one subscription: the selection is not a reason to reload.
    expect(h.subscribe).toHaveBeenCalledTimes(1);
  });

  it('assign puts one person in a workspace and shows it straight away', async () => {
    const { result } = renderHook(() => useHrWorkspacePeople());
    await act(async () => {
      await result.current.assign('tom', 'ws-studio');
    });
    expect(h.setPersonWorkspace).toHaveBeenCalledWith('org1', 'tom', 'ws-studio', 'sam');
    expect(result.current.inScope('tom')).toBe(true);
    expect(result.current.unassigned.map((m) => m.userId)).toEqual(['priya']);
  });

  it('assign with no workspace takes the person out', async () => {
    const { result } = renderHook(() => useHrWorkspacePeople());
    await act(async () => {
      await result.current.assign('sam', null);
    });
    expect(h.setPersonWorkspace).toHaveBeenCalledWith('org1', 'sam', null, 'sam');
    expect(result.current.inScope('sam')).toBe(false);
    expect(result.current.unassigned.map((m) => m.userId)).toEqual(['sam', 'priya', 'tom']);
  });

  it('puts the person back where they were when the save fails', async () => {
    h.setPersonWorkspace.mockRejectedValue(new Error('permission denied'));
    const { result } = renderHook(() => useHrWorkspacePeople());
    let failure: unknown = null;
    await act(async () => {
      await result.current.assign('sam', 'ws-agency').catch((e) => {
        failure = e;
      });
    });
    expect((failure as Error).message).toBe('permission denied');
    expect(result.current.workspaceOf('sam')).toBe('ws-studio');
  });

  it('assignAllUnassignedToSelected adds everyone without a workspace in one go', async () => {
    const { result } = renderHook(() => useHrWorkspacePeople());
    let added = 0;
    await act(async () => {
      added = await result.current.assignAllUnassignedToSelected();
    });
    expect(added).toBe(2);
    expect(h.assignPeopleToWorkspace).toHaveBeenCalledTimes(1);
    expect(h.assignPeopleToWorkspace).toHaveBeenCalledWith('org1', ['priya', 'tom'], 'ws-studio', 'sam');
    expect(result.current.unassigned).toEqual([]);
    expect(ids(result.current.scopedUserIds)).toEqual(['priya', 'sam', 'tom']);
  });

  it('assignAllUnassignedToSelected needs a real workspace to add people to', async () => {
    h.scope = 'all';
    const { result } = renderHook(() => useHrWorkspacePeople());
    await act(async () => {
      expect(await result.current.assignAllUnassignedToSelected()).toBe(0);
    });
    expect(h.assignPeopleToWorkspace).not.toHaveBeenCalled();
  });

  it('only owners and admins can move people', async () => {
    const before = { isOwner: h.org.isOwner, isAdmin: h.org.isAdmin };
    h.org.isOwner = false;
    h.org.isAdmin = false;
    try {
      const { result } = renderHook(() => useHrWorkspacePeople());
      expect(result.current.canAssign).toBe(false);
      await act(async () => {
        await expect(result.current.assign('tom', 'ws-studio')).rejects.toThrow(/owner or an admin/i);
      });
      expect(h.setPersonWorkspace).not.toHaveBeenCalled();
    } finally {
      Object.assign(h.org, before);
    }
  });

  it('when the assignments cannot be read it says so and shows the whole company', () => {
    h.failWith = new Error('Failed to fetch');
    const { result } = renderHook(() => useHrWorkspacePeople());
    expect(result.current.loading).toBe(false);
    expect(result.current.available).toBe(false);
    expect(result.current.scopedUserIds).toBeNull();
    expect(result.current.error).toBe('Failed to fetch');
    expect(result.current.label).toBeNull();
  });

  it('stops listening when the screen closes', () => {
    const { unmount } = renderHook(() => useHrWorkspacePeople());
    unmount();
    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('a screen inside the HR page reuses what the page already loaded', () => {
    const page = renderHook(() => useHrWorkspacePeople());
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <HrWorkspacePeopleContext.Provider value={page.result.current}>{children}</HrWorkspacePeopleContext.Provider>
    );
    const tab = renderHook(() => useHrWorkspacePeople(), { wrapper });
    expect(tab.result.current).toBe(page.result.current);
    expect(h.subscribe).toHaveBeenCalledTimes(1);
  });
});
