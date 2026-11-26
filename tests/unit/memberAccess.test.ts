// Extra access for one person (so far: Social media) without making them an
// admin: who the server lets through, and what the browser reads and writes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { managesSocial, mayManageSocial, roleIn } from '../../api/_social/access';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; values?: Record<string, unknown>; filters: Array<[string, unknown]>; options?: unknown }>,
  rows: [] as Array<Record<string, unknown>>,
  error: null as null | { code?: string; message?: string },
}));

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: (table: string) => {
      const start = (op: string, values?: Record<string, unknown>, options?: unknown) => {
        const call = { table, op, values, filters: [] as Array<[string, unknown]>, options };
        h.calls.push(call);
        const link = {
          eq: (c: string, v: unknown) => { call.filters.push([c, v]); return link; },
          then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: h.error ? null : h.rows, error: h.error }).then(ok),
        };
        return link;
      };
      return {
        select: () => start('select'),
        delete: () => start('delete'),
        upsert: (values: Record<string, unknown>, options: unknown) => start('upsert', values, options),
      };
    },
  },
}));

import { loadMyAccess, loadOrgAccess, setMemberAccess } from '@/services/supabase/memberAccess';
import { ACCESS_NOT_SET_UP_MESSAGE } from '@/lib/memberAccess';

const ORG = '22222222-2222-4222-8222-222222222222';
const OWNER = 'u-owner';
const org = {
  owner_id: OWNER,
  members: [
    { userId: 'u-admin', role: 'admin', status: 'active' },
    { userId: 'u-junaid', role: 'member', status: 'active' },
    { userId: 'u-other', role: 'member' },
    { userId: 'u-viewer', role: 'viewer', status: 'active' },
    { userId: 'u-gone', role: 'member', status: 'removed' },
  ],
};

beforeEach(() => { h.calls.length = 0; h.rows = []; h.error = null; });

describe('a person’s place in the organisation', () => {
  it('is read from the owner and the member list', () => {
    expect(roleIn(org, OWNER)).toBe('owner');
    expect(roleIn(org, 'u-admin')).toBe('admin');
    expect(roleIn(org, 'u-junaid')).toBe('member');
    // A member row written before "status" existed is an active member.
    expect(roleIn(org, 'u-other')).toBe('member');
    expect(roleIn(org, 'u-viewer')).toBe('viewer');
  });

  it('is nothing for a stranger, for somebody who was removed, and for an odd role', () => {
    expect(roleIn(org, 'u-stranger')).toBeNull();
    expect(roleIn(org, 'u-gone')).toBeNull();
    expect(roleIn(null, OWNER)).toBeNull();
    expect(roleIn(org, '')).toBeNull();
    expect(roleIn({ owner_id: 'x', members: [{ userId: 'u', role: 'superuser' }] }, 'u')).toBeNull();
    expect(roleIn({ owner_id: 'x', members: 'nobody' }, 'u')).toBeNull();
  });
});

describe('who may connect accounts and change the autopilot', () => {
  it('is the owner, the admins, and a member who was given all of Social media', () => {
    expect(managesSocial('owner', null)).toBe(true);
    expect(managesSocial('admin', null)).toBe(true);
    expect(managesSocial('member', 'manage')).toBe(true);
  });

  it('is not a member with posts only, a member with nothing, a viewer, or a stranger', () => {
    expect(managesSocial('member', 'use')).toBe(false);
    expect(managesSocial('member', null)).toBe(false);
    expect(managesSocial('viewer', 'manage')).toBe(false);
    expect(managesSocial(null, 'manage')).toBe(false);
  });

  /** A stand-in for the database on the service key. */
  const db = (given: { level?: string; missing?: boolean } = {}) => {
    const asked: string[] = [];
    const client = {
      from: (table: string) => {
        asked.push(table);
        const filters: Record<string, unknown> = {};
        const link = {
          select: () => link,
          eq: (c: string, v: unknown) => { filters[c] = v; return link; },
          maybeSingle: async () => {
            if (table === 'organizations') return { data: filters.organization_id === ORG ? org : null, error: null };
            if (given.missing) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.org_member_access' in the schema cache" } };
            const mine = filters.user_id === 'u-junaid' && filters.area === 'social' && given.level;
            return { data: mine ? { level: given.level } : null, error: null };
          },
        };
        return link;
      },
    } as unknown as SupabaseClient;
    return { client, asked };
  };

  it('asks the database only when the person is a plain member', async () => {
    const admin = db();
    expect(await mayManageSocial(admin.client, ORG, 'u-admin')).toBe(true);
    expect(admin.asked).toEqual(['organizations']);
    const owner = db();
    expect(await mayManageSocial(owner.client, ORG, OWNER)).toBe(true);
    const viewer = db({ level: 'manage' });
    expect(await mayManageSocial(viewer.client, ORG, 'u-viewer')).toBe(false);
    expect(viewer.asked).toEqual(['organizations']);
  });

  it('lets a member through with "everything", not with "posts only" or nothing', async () => {
    expect(await mayManageSocial(db({ level: 'manage' }).client, ORG, 'u-junaid')).toBe(true);
    expect(await mayManageSocial(db({ level: 'use' }).client, ORG, 'u-junaid')).toBe(false);
    expect(await mayManageSocial(db().client, ORG, 'u-junaid')).toBe(false);
    // What one member was given says nothing about another.
    expect(await mayManageSocial(db({ level: 'manage' }).client, ORG, 'u-other')).toBe(false);
  });

  it('says no to a removed member, a stranger, another organisation, and while the table is not there yet', async () => {
    expect(await mayManageSocial(db({ level: 'manage' }).client, ORG, 'u-gone')).toBe(false);
    expect(await mayManageSocial(db({ level: 'manage' }).client, ORG, 'u-stranger')).toBe(false);
    expect(await mayManageSocial(db({ level: 'manage' }).client, '33333333-3333-4333-8333-333333333333', 'u-junaid')).toBe(false);
    expect(await mayManageSocial(db({ missing: true }).client, ORG, 'u-junaid')).toBe(false);
    expect(await mayManageSocial(db().client, '', 'u-junaid')).toBe(false);
  });
});

describe('what the browser reads', () => {
  it('gives a person their own areas, and nothing for a value it does not know', async () => {
    h.rows = [{ area: 'social', level: 'use' }, { area: 'payroll', level: 'manage' }, { area: 'social2', level: 'boss' }];
    expect(await loadMyAccess(ORG, 'u-junaid')).toEqual({ social: 'use' });
    expect(h.calls[0]).toMatchObject({ table: 'org_member_access', op: 'select', filters: [['organization_id', ORG], ['user_id', 'u-junaid']] });
  });

  it('gives a person nothing when it cannot be read: a failure never opens a page', async () => {
    h.error = { code: 'PGRST205', message: 'schema cache' };
    expect(await loadMyAccess(ORG, 'u-junaid')).toEqual({});
    h.error = { code: '500', message: 'down' };
    expect(await loadMyAccess(ORG, 'u-junaid')).toEqual({});
  });

  it('gives the owner every person’s areas, by person', async () => {
    h.rows = [{ user_id: 'u-junaid', area: 'social', level: 'manage' }, { user_id: 'u-other', area: 'social', level: 'use' }, { user_id: '', area: 'social', level: 'use' }];
    expect(await loadOrgAccess(ORG)).toEqual({ ready: true, byUser: { 'u-junaid': { social: 'manage' }, 'u-other': { social: 'use' } } });
  });

  it('says the database is not ready when the table is not there, and throws plain words for any other failure', async () => {
    h.error = { code: '42P01', message: 'relation "org_member_access" does not exist' };
    expect(await loadOrgAccess(ORG)).toEqual({ ready: false, byUser: {} });
    h.error = { code: '500', message: 'connection reset by peer' };
    await expect(loadOrgAccess(ORG)).rejects.toThrow('The access of your people could not be read. Please try again.');
  });
});

describe('what the browser writes', () => {
  it('gives an area at a level, once for each person and area', async () => {
    await setMemberAccess(ORG, 'u-junaid', 'social', 'manage', OWNER);
    expect(h.calls[0]).toMatchObject({ table: 'org_member_access', op: 'upsert', options: { onConflict: 'organization_id,user_id,area' } });
    expect(h.calls[0].values).toMatchObject({ organization_id: ORG, user_id: 'u-junaid', area: 'social', level: 'manage', granted_by: OWNER });
  });

  it('takes it away by deleting only that person’s row for that area', async () => {
    await setMemberAccess(ORG, 'u-junaid', 'social', null);
    expect(h.calls[0]).toMatchObject({ op: 'delete', filters: [['organization_id', ORG], ['user_id', 'u-junaid'], ['area', 'social']] });
  });

  it('says who may change it, and that the SQL is not run yet, in words for the reader', async () => {
    h.error = { code: '42501', message: 'new row violates row-level security policy for table "org_member_access"' };
    await expect(setMemberAccess(ORG, 'u-junaid', 'social', 'use')).rejects.toThrow('Only the owner or an admin can change what a person may do.');
    h.error = { code: 'PGRST205', message: "Could not find the table 'public.org_member_access' in the schema cache" };
    await expect(setMemberAccess(ORG, 'u-junaid', 'social', 'use')).rejects.toThrow(ACCESS_NOT_SET_UP_MESSAGE);
    h.error = { code: '500', message: 'connection reset by peer' };
    await expect(setMemberAccess(ORG, 'u-junaid', 'social', 'use')).rejects.toThrow('The access could not be changed. Please try again.');
  });
});
