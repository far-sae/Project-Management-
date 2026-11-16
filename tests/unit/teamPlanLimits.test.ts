// Team members share the workspace owner's full access: an employee whose own
// trial has ended must not hit the Starter "20 tasks per project" limit.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  org: { owner_id: 'owner', members: [] as Array<{ userId: string; status?: string }> },
  subscription: { status: 'expired', plan: null, trial_ends_at: null, extra_seats: 0 } as Record<string, unknown> | null,
  taskCount: 20,
}));

vi.mock('@/services/supabase/config', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) chain[k] = () => chain;
    chain.maybeSingle = () => {
      if (table === 'projects') return Promise.resolve({ data: { organization_id: 'org1' } });
      if (table === 'organizations') return Promise.resolve({ data: db.org });
      if (table === 'subscriptions') return Promise.resolve({ data: db.subscription, error: null });
      return Promise.resolve({ data: null });
    };
    chain.then = (r: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, count: table === 'tasks' ? db.taskCount : table === 'projects' ? 3 : 0 }).then(r);
    return chain;
  };
  return { supabase: { from } };
});

import { checkProjectLimit, checkTaskLimit } from '@/services/supabase/database';

beforeEach(() => {
  db.org = { owner_id: 'owner', members: [] };
  db.subscription = { status: 'expired', plan: null, trial_ends_at: null, extra_seats: 0 };
  db.taskCount = 20;
});

describe('plan limits inside a workspace', () => {
  it('lets an employee add a 21st task even though their own trial ended', async () => {
    db.org.members = [{ userId: 'employee', status: 'active' }];
    const res = await checkTaskLimit('employee', 'p1');
    expect(res.allowed).toBe(true);
    expect(res.message).toBe('');
  });

  it('lets an employee create projects beyond the Starter limit', async () => {
    db.org.members = [{ userId: 'employee', status: 'active' }];
    const res = await checkProjectLimit('employee', 'org1');
    expect(res.allowed).toBe(true);
  });

  it('still lets the owner add tasks', async () => {
    expect((await checkTaskLimit('owner', 'p1')).allowed).toBe(true);
  });

  it('still limits someone who is not in the workspace', async () => {
    db.org.members = [{ userId: 'employee', status: 'active' }];
    const res = await checkTaskLimit('stranger', 'p1');
    expect(res.allowed).toBe(false);
  });

  it('does not give full access to a removed member', async () => {
    db.org.members = [{ userId: 'employee', status: 'removed' }];
    expect((await checkTaskLimit('employee', 'p1')).allowed).toBe(false);
  });
});
