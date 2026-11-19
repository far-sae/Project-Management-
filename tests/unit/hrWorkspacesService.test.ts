// Which workspace each person belongs to (table hr_person_workspaces,
// migration 185). Until that migration has been run every call answers
// "not set up yet" instead of failing, so HR keeps showing the whole company.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data?: unknown; error: unknown };

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; args: unknown[]; filters: Array<[string, unknown]> }>,
  result: { data: [], error: null } as { data?: unknown; error: unknown },
  /** Results handed out in order before falling back to `result`. */
  queue: [] as Array<{ data?: unknown; error: unknown }>,
  channels: [] as Array<{
    name: string;
    config: Record<string, unknown> | null;
    handler: (() => void) | null;
    subscribed: boolean;
    unsubscribed: boolean;
  }>,
}));

vi.mock('@/services/supabase/config', () => {
  const from = (table: string) => {
    const call = { table, op: '', args: [] as unknown[], filters: [] as Array<[string, unknown]> };
    const builder = {
      select: (...args: unknown[]) => {
        call.op = 'select';
        call.args = args;
        return builder;
      },
      upsert: (...args: unknown[]) => {
        call.op = 'upsert';
        call.args = args;
        return builder;
      },
      delete: (...args: unknown[]) => {
        call.op = 'delete';
        call.args = args;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return builder;
      },
      then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
        h.calls.push(call);
        return Promise.resolve(h.queue.shift() ?? h.result).then(resolve, reject);
      },
    };
    return builder;
  };
  const channel = (name: string) => {
    const record = {
      name,
      config: null as Record<string, unknown> | null,
      handler: null as (() => void) | null,
      subscribed: false,
      unsubscribed: false,
    };
    h.channels.push(record);
    const api = {
      on: (_event: string, config: Record<string, unknown>, handler: () => void) => {
        record.config = config;
        record.handler = handler;
        return api;
      },
      subscribe: () => {
        record.subscribed = true;
        return api;
      },
      unsubscribe: () => {
        record.unsubscribed = true;
      },
    };
    return api;
  };
  return { supabase: { from, channel } };
});

import {
  assignPeopleToWorkspace,
  isHrWorkspaceSetupMissing,
  listPersonWorkspaces,
  setPersonWorkspace,
  subscribeToPersonWorkspaces,
} from '@/services/supabase/hrWorkspaces';

const TABLE_MISSING = {
  code: 'PGRST205',
  message: "Could not find the table 'public.hr_person_workspaces' in the schema cache",
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  h.calls.length = 0;
  h.queue.length = 0;
  h.channels.length = 0;
  h.result = { data: [], error: null };
});

describe('isHrWorkspaceSetupMissing', () => {
  it('recognises a missing table however the database words it', () => {
    expect(isHrWorkspaceSetupMissing({ code: 'PGRST205', message: 'whatever' })).toBe(true);
    expect(isHrWorkspaceSetupMissing({ code: '42P01', message: 'whatever' })).toBe(true);
    expect(
      isHrWorkspaceSetupMissing({ message: 'relation "public.hr_person_workspaces" does not exist' }),
    ).toBe(true);
  });

  it('does not mistake other failures for a missing table', () => {
    expect(isHrWorkspaceSetupMissing({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isHrWorkspaceSetupMissing(new Error('Failed to fetch'))).toBe(false);
    expect(isHrWorkspaceSetupMissing(null)).toBe(false);
  });
});

describe('listPersonWorkspaces', () => {
  it("returns the organization's assignments", async () => {
    h.result = {
      data: [
        { user_id: 'sam', workspace_id: 'ws-studio' },
        { user_id: 'tom', workspace_id: 'ws-agency' },
      ],
      error: null,
    };
    const result = await listPersonWorkspaces('org1');
    expect(result).toEqual({
      available: true,
      assignments: [
        { userId: 'sam', workspaceId: 'ws-studio' },
        { userId: 'tom', workspaceId: 'ws-agency' },
      ],
    });
    expect(h.calls[0].table).toBe('hr_person_workspaces');
    expect(h.calls[0].filters).toEqual([['organization_id', 'org1']]);
  });

  it('answers "not set up yet" when the table is missing, instead of throwing', async () => {
    h.result = { data: null, error: TABLE_MISSING };
    expect(await listPersonWorkspaces('org1')).toEqual({ available: false, assignments: [] });
    h.result = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    expect(await listPersonWorkspaces('org1')).toEqual({ available: false, assignments: [] });
  });

  it('still throws a real failure', async () => {
    h.result = { data: null, error: { code: '42501', message: 'permission denied' } };
    await expect(listPersonWorkspaces('org1')).rejects.toMatchObject({ code: '42501' });
  });

  it('has nothing to read for an account that only lives on this device', async () => {
    expect(await listPersonWorkspaces('local-u1')).toEqual({ available: false, assignments: [] });
    expect(await listPersonWorkspaces('')).toEqual({ available: false, assignments: [] });
    expect(h.calls).toHaveLength(0);
  });
});

describe('setPersonWorkspace', () => {
  it('saves the workspace for one person', async () => {
    expect(await setPersonWorkspace('org1', 'sam', 'ws-studio', 'owner1')).toEqual({ available: true });
    const call = h.calls[0];
    expect(call.op).toBe('upsert');
    const [rows, options] = call.args as [Array<Record<string, unknown>>, Record<string, unknown>];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      organization_id: 'org1',
      user_id: 'sam',
      workspace_id: 'ws-studio',
      assigned_by: 'owner1',
    });
    expect(typeof row.updated_at).toBe('string');
    expect(options).toEqual({ onConflict: 'organization_id,user_id' });
  });

  it('"No workspace" deletes the row', async () => {
    expect(await setPersonWorkspace('org1', 'sam', null, 'owner1')).toEqual({ available: true });
    const call = h.calls[0];
    expect(call.op).toBe('delete');
    expect(call.filters).toEqual([
      ['organization_id', 'org1'],
      ['user_id', 'sam'],
    ]);
  });

  it('answers "not set up yet" when the table is missing', async () => {
    h.result = { error: TABLE_MISSING };
    expect(await setPersonWorkspace('org1', 'sam', 'ws-studio', 'owner1')).toEqual({ available: false });
    expect(await setPersonWorkspace('org1', 'sam', null, 'owner1')).toEqual({ available: false });
  });

  it('throws when the save is refused', async () => {
    h.result = { error: { code: '42501', message: 'new row violates row-level security policy' } };
    await expect(setPersonWorkspace('org1', 'sam', 'ws-studio', 'member1')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('assignPeopleToWorkspace', () => {
  it('saves everyone in one request', async () => {
    expect(await assignPeopleToWorkspace('org1', ['sam', 'priya', 'tom'], 'ws-studio', 'owner1')).toEqual({
      available: true,
    });
    expect(h.calls).toHaveLength(1);
    const [rows, options] = h.calls[0].args as [Array<Record<string, unknown>>, Record<string, unknown>];
    expect(h.calls[0].op).toBe('upsert');
    expect(rows.map((r) => r.user_id)).toEqual(['sam', 'priya', 'tom']);
    expect(rows.every((r) => r.workspace_id === 'ws-studio' && r.organization_id === 'org1')).toBe(true);
    expect(rows.every((r) => r.assigned_by === 'owner1')).toBe(true);
    expect(options).toEqual({ onConflict: 'organization_id,user_id' });
  });

  it('sends each person once', async () => {
    await assignPeopleToWorkspace('org1', ['sam', 'sam', 'tom'], 'ws-studio', 'owner1');
    const [rows] = h.calls[0].args as [Array<Record<string, unknown>>];
    expect(rows.map((r) => r.user_id)).toEqual(['sam', 'tom']);
  });

  it('does nothing when there is nobody to add', async () => {
    expect(await assignPeopleToWorkspace('org1', [], 'ws-studio', 'owner1')).toEqual({ available: true });
    expect(h.calls).toHaveLength(0);
  });

  it('answers "not set up yet" when the table is missing', async () => {
    h.result = { error: TABLE_MISSING };
    expect(await assignPeopleToWorkspace('org1', ['sam'], 'ws-studio', 'owner1')).toEqual({
      available: false,
    });
  });
});

describe('subscribeToPersonWorkspaces', () => {
  it('loads once, then reloads whenever an assignment changes', async () => {
    h.result = { data: [{ user_id: 'sam', workspace_id: 'ws-studio' }], error: null };
    const seen: unknown[] = [];
    const stop = subscribeToPersonWorkspaces('org1', (r) => seen.push(r));
    await flush();
    expect(seen).toEqual([{ available: true, assignments: [{ userId: 'sam', workspaceId: 'ws-studio' }] }]);
    expect(h.channels).toHaveLength(1);
    expect(h.channels[0].subscribed).toBe(true);
    expect(h.channels[0].config).toMatchObject({
      schema: 'public',
      table: 'hr_person_workspaces',
      filter: 'organization_id=eq.org1',
    });

    h.result = { data: [], error: null };
    h.channels[0].handler?.();
    await flush();
    expect(seen[1]).toEqual({ available: true, assignments: [] });

    stop();
    expect(h.channels[0].unsubscribed).toBe(true);
  });

  it('checks once and does not listen when the table is missing', async () => {
    h.result = { data: null, error: TABLE_MISSING };
    const seen: unknown[] = [];
    subscribeToPersonWorkspaces('org1', (r) => seen.push(r));
    await flush();
    expect(seen).toEqual([{ available: false, assignments: [] }]);
    expect(h.calls).toHaveLength(1);
    expect(h.channels).toHaveLength(0);
  });

  it('reports a real failure to the caller', async () => {
    h.result = { data: null, error: { code: '42501', message: 'permission denied' } };
    const onError = vi.fn();
    const onChange = vi.fn();
    subscribeToPersonWorkspaces('org1', onChange, onError);
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: '42501' }));
    expect(h.channels).toHaveLength(0);
  });

  it('says nothing after it has been stopped', async () => {
    const onChange = vi.fn();
    const stop = subscribeToPersonWorkspaces('org1', onChange);
    stop();
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(h.channels).toHaveLength(0);
  });
});
