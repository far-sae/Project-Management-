import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/services/supabase/config', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import {
  PROJECTS_CHANGED_EVENT,
  moveProjectToWorkspace,
} from '@/services/supabase/projectMove';

describe('moveProjectToWorkspace', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('moves the project via the move_project_to_workspace database function', async () => {
    await moveProjectToWorkspace('p1', 'ws-b');
    expect(rpc).toHaveBeenCalledWith('move_project_to_workspace', {
      p_project: 'p1',
      p_workspace: 'ws-b',
    });
  });

  it('can move a project out to "No workspace"', async () => {
    await moveProjectToWorkspace('p1', null);
    expect(rpc).toHaveBeenCalledWith('move_project_to_workspace', {
      p_project: 'p1',
      p_workspace: null,
    });
  });

  it('tells every open project list to refresh', async () => {
    const heard = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, heard);
    await moveProjectToWorkspace('p1', 'ws-b');
    window.removeEventListener(PROJECTS_CHANGED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('shows the database reason when the move is refused', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'You need to be an owner or admin of the destination organization', code: '42501' },
    });
    await expect(moveProjectToWorkspace('p1', 'ws-x')).rejects.toThrow(
      'You need to be an owner or admin of the destination organization',
    );
  });

  it('does not announce a change when the move failed', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    const heard = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, heard);
    await expect(moveProjectToWorkspace('p1', 'ws-b')).rejects.toThrow();
    window.removeEventListener(PROJECTS_CHANGED_EVENT, heard);
    expect(heard).not.toHaveBeenCalled();
  });

  it('explains when the database function has not been installed yet', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Could not find the function public.move_project_to_workspace', code: 'PGRST202' },
    });
    await expect(moveProjectToWorkspace('p1', 'ws-b')).rejects.toThrow(/migration 170/);
  });
});
