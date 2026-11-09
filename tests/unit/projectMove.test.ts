import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal chainable fake of the supabase query builder used by projectMove.
type Row = Record<string, unknown> | null;
const state: {
  workspace: Row;
  project: Row;
  updateResult: { data: unknown[] | null; error: unknown };
  updates: Array<{ values: Record<string, unknown>; projectId: unknown }>;
} = { workspace: null, project: null, updateResult: { data: [], error: null }, updates: [] };

vi.mock('@/services/supabase/config', () => {
  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null;
    let eqProjectId: unknown = null;
    const builder = {
      select: () => builder,
      update: (values: Record<string, unknown>) => {
        pendingUpdate = values;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        if (col === 'project_id') eqProjectId = val;
        if (pendingUpdate && col === 'project_id') {
          state.updates.push({ values: pendingUpdate, projectId: val });
          return { select: async () => state.updateResult };
        }
        return builder;
      },
      maybeSingle: async () => ({
        data: table === 'workspaces' ? state.workspace : state.project,
        error: null,
      }),
    };
    void eqProjectId;
    return builder;
  };
  return { supabase: { from } };
});

import {
  PROJECTS_CHANGED_EVENT,
  moveProjectToWorkspace,
} from '@/services/supabase/projectMove';

describe('moveProjectToWorkspace', () => {
  beforeEach(() => {
    state.workspace = { workspace_id: 'ws-b', organization_id: 'org-1' };
    state.project = { organization_id: 'org-1', workspace_id: 'ws-a' };
    state.updateResult = { data: [{ project_id: 'p1' }], error: null };
    state.updates = [];
  });

  it('moves the project (and so all its tasks/files/chat) by changing its workspace', async () => {
    await moveProjectToWorkspace('p1', 'ws-b', 'org-1');
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].projectId).toBe('p1');
    expect(state.updates[0].values.workspace_id).toBe('ws-b');
    expect(typeof state.updates[0].values.updated_at).toBe('string');
  });

  it('can move a project out to "No workspace"', async () => {
    await moveProjectToWorkspace('p1', null, 'org-1');
    expect(state.updates[0].values.workspace_id).toBeNull();
  });

  it('tells every open project list to refresh', async () => {
    const heard = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, heard);
    await moveProjectToWorkspace('p1', 'ws-b', 'org-1');
    window.removeEventListener(PROJECTS_CHANGED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('refuses a workspace from another organization', async () => {
    state.workspace = { workspace_id: 'ws-x', organization_id: 'org-2' };
    await expect(moveProjectToWorkspace('p1', 'ws-x', 'org-1')).rejects.toThrow(/organization/i);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses a workspace that no longer exists', async () => {
    state.workspace = null;
    await expect(moveProjectToWorkspace('p1', 'ws-gone', 'org-1')).rejects.toThrow(/no longer exists/i);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses a project from another organization', async () => {
    state.project = { organization_id: 'org-2', workspace_id: 'ws-a' };
    await expect(moveProjectToWorkspace('p1', 'ws-b', 'org-1')).rejects.toThrow(/not found|access/i);
    expect(state.updates).toHaveLength(0);
  });

  it('does nothing when the project is already in that workspace', async () => {
    state.project = { organization_id: 'org-1', workspace_id: 'ws-b' };
    await moveProjectToWorkspace('p1', 'ws-b', 'org-1');
    expect(state.updates).toHaveLength(0);
  });

  it('reports missing permission when the database silently updates nothing', async () => {
    state.updateResult = { data: [], error: null };
    await expect(moveProjectToWorkspace('p1', 'ws-b', 'org-1')).rejects.toThrow(/permission/i);
  });
});
