import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  calls: [] as string[],
}));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    rpc: (...a: unknown[]) => {
      m.calls.push('add');
      return m.rpc(...a);
    },
    functions: {
      invoke: (...a: unknown[]) => {
        m.calls.push('remove');
        return m.invoke(...a);
      },
    },
  },
}));

import { moveProjectMember } from '@/services/supabase/projectMembers';

const input = {
  fromProjectId: 'p-wrong',
  toProjectId: 'p-right',
  organizationId: 'org-1',
  userId: 'u-sam',
  email: 'sam@x.com',
  role: 'member' as const,
  unassignTasks: true,
};

describe('moveProjectMember', () => {
  beforeEach(() => {
    m.calls.length = 0;
    m.rpc.mockReset();
    m.invoke.mockReset();
    m.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    m.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it('adds them to the right project with the same role, then removes them from the wrong one', async () => {
    await moveProjectMember(input);
    expect(m.calls).toEqual(['add', 'remove']);
    expect(m.rpc).toHaveBeenCalledWith('upsert_project_member', {
      p_project_id: 'p-right',
      p_organization_id: 'org-1',
      p_user_id: 'u-sam',
      p_role: 'member',
    });
    expect(m.invoke).toHaveBeenCalledWith('remove-member', {
      body: {
        projectId: 'p-wrong',
        memberUserId: 'u-sam',
        memberEmail: 'sam@x.com',
        unassignTasks: true,
      },
    });
  });

  it('leaves them where they are if they cannot be added to the new project', async () => {
    m.rpc.mockResolvedValue({ data: { ok: false, error: 'Only the project owner can manage members' }, error: null });
    await expect(moveProjectMember(input)).rejects.toThrow('Only the project owner can manage members');
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it('says they were added but not removed when the removal is refused', async () => {
    m.invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(JSON.stringify({ error: 'Only the project owner or an admin can remove members' }), { status: 403 }),
      },
    });
    await expect(moveProjectMember(input)).rejects.toThrow(
      /added to the new project, but couldn't be removed from the old one: Only the project owner or an admin can remove members/,
    );
  });
});
