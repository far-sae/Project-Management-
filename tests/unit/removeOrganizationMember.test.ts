import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => {
      throw new Error('must not edit organization rows directly');
    },
  },
}));

import { removeOrganizationMember } from '@/services/supabase/organizations';

describe('removeOrganizationMember', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: { projects: 3, ownedProjectsTransferred: 1, tasksUnassigned: 5, invitationsCancelled: 2 },
      error: null,
    });
  });

  it('removes them everywhere in one database call and unassigns their tasks', async () => {
    const summary = await removeOrganizationMember('org-1', 'u-sam');
    expect(rpc).toHaveBeenCalledWith('remove_org_member', {
      p_org: 'org-1',
      p_user: 'u-sam',
      p_unassign_tasks: true,
    });
    expect(summary).toEqual({
      projects: 3,
      ownedProjectsTransferred: 1,
      tasksUnassigned: 5,
      invitationsCancelled: 2,
    });
  });

  it('can keep their task assignments', async () => {
    await removeOrganizationMember('org-1', 'u-sam', { unassignTasks: false });
    expect(rpc).toHaveBeenCalledWith('remove_org_member', expect.objectContaining({ p_unassign_tasks: false }));
  });

  it('shows the database reason when the removal is refused', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Only the organization owner can remove an admin', code: '42501' } });
    await expect(removeOrganizationMember('org-1', 'u-admin')).rejects.toThrow(
      'Only the organization owner can remove an admin',
    );
  });

  it('explains when the database update has not been applied yet', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } });
    await expect(removeOrganizationMember('org-1', 'u-sam')).rejects.toThrow(/migration 172/);
  });
});
