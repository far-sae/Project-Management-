// Reading and changing the extra access of people (table org_member_access).
// The database lets a person read their own rows, and the owner and admins
// read and change all rows of their organisation.
import { supabase } from '@/services/supabase/config';
import { ACCESS_NOT_SET_UP_MESSAGE, isAccessArea, isAccessLevel, type AccessArea, type AccessLevel, type MemberAccess } from '@/lib/memberAccess';

type Row = Record<string, unknown>;

/** The table is not there: the SQL of the latest update has not been run yet. */
const missing = (error: { code?: string; message?: string } | null): boolean =>
  Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '')));

const accessOf = (rows: Row[]): MemberAccess => {
  const out: MemberAccess = {};
  for (const r of rows) if (isAccessArea(r.area) && isAccessLevel(r.level)) out[r.area] = r.level;
  return out;
};

/** What one person was given in this organisation. Nothing when the table is not there yet, or on any failure. */
export async function loadMyAccess(organizationId: string, userId: string): Promise<MemberAccess> {
  const { data, error } = await supabase.from('org_member_access').select('area, level').eq('organization_id', organizationId).eq('user_id', userId);
  return error ? {} : accessOf((data ?? []) as Row[]);
}

export type OrgAccess = {
  /** False when the database cannot keep access for one person yet. */
  ready: boolean;
  /** By the person's id. */
  byUser: Record<string, MemberAccess>;
};

/** What every person of the organisation was given. For the owner and admins. */
export async function loadOrgAccess(organizationId: string): Promise<OrgAccess> {
  const { data, error } = await supabase.from('org_member_access').select('user_id, area, level').eq('organization_id', organizationId);
  if (error) {
    if (missing(error)) return { ready: false, byUser: {} };
    throw new Error('The access of your people could not be read. Please try again.');
  }
  const byUser: Record<string, MemberAccess> = {};
  for (const r of (data ?? []) as Row[]) {
    const id = typeof r.user_id === 'string' ? r.user_id : '';
    if (id && isAccessArea(r.area) && isAccessLevel(r.level)) byUser[id] = { ...byUser[id], [r.area]: r.level };
  }
  return { ready: true, byUser };
}

/** Gives one person an area at a level, or takes it away (`level` null). Only the owner and admins are let through. */
export async function setMemberAccess(organizationId: string, userId: string, area: AccessArea, level: AccessLevel | null, grantedBy?: string): Promise<void> {
  const { error } = level === null
    ? await supabase.from('org_member_access').delete().eq('organization_id', organizationId).eq('user_id', userId).eq('area', area)
    : await supabase.from('org_member_access').upsert(
      { organization_id: organizationId, user_id: userId, area, level, granted_by: grantedBy ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id,user_id,area' },
    );
  if (error) {
    if (missing(error)) throw new Error(ACCESS_NOT_SET_UP_MESSAGE);
    throw new Error(error.code === '42501' ? 'Only the owner or an admin can change what a person may do.' : 'The access could not be changed. Please try again.');
  }
}
