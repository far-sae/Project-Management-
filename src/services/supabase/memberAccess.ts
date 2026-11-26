// Reading and changing which pages people see (table org_member_access).
// The database lets a person read their own rows, and the owner and admins
// read and change all rows of their organisation.
import { supabase } from '@/services/supabase/config';
import { ACCESS_AREAS, ACCESS_NOT_SET_UP_MESSAGE, isAccessArea, isAccessLevel, type AccessArea, type AccessLevel, type MemberAccess } from '@/lib/memberAccess';

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string } | null;

/** The table is not there, or does not know "off" yet: the SQL of the latest update has not been run. */
const notSetUp = (error: DbError): boolean =>
  Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === '23514' || /does not exist|schema cache|level_check/i.test(error.message ?? '')));

const accessOf = (rows: Row[]): MemberAccess => {
  const out: MemberAccess = {};
  for (const r of rows) if (isAccessArea(r.area) && isAccessLevel(r.level)) out[r.area] = r.level;
  return out;
};

/** The pages chosen for one person in this organisation. Nothing when the table is not there yet, or on any failure. */
export async function loadMyAccess(organizationId: string, userId: string): Promise<MemberAccess> {
  const { data, error } = await supabase.from('org_member_access').select('area, level').eq('organization_id', organizationId).eq('user_id', userId);
  return error ? {} : accessOf((data ?? []) as Row[]);
}

export type OrgAccess = {
  /** False when the database cannot keep pages for one person yet. */
  ready: boolean;
  /** By the person's id. */
  byUser: Record<string, MemberAccess>;
};

/** The pages chosen for every person of the organisation. For the owner and admins. */
export async function loadOrgAccess(organizationId: string): Promise<OrgAccess> {
  const { data, error } = await supabase.from('org_member_access').select('user_id, area, level').eq('organization_id', organizationId);
  if (error) {
    if (notSetUp(error)) return { ready: false, byUser: {} };
    throw new Error('The pages of your people could not be read. Please try again.');
  }
  const byUser: Record<string, MemberAccess> = {};
  for (const r of (data ?? []) as Row[]) {
    const id = typeof r.user_id === 'string' ? r.user_id : '';
    if (id && isAccessArea(r.area) && isAccessLevel(r.level)) byUser[id] = { ...byUser[id], [r.area]: r.level };
  }
  return { ready: true, byUser };
}

const failure = (error: DbError): Error => {
  if (notSetUp(error)) return new Error(ACCESS_NOT_SET_UP_MESSAGE);
  return new Error(error?.code === '42501' ? 'Only the owner or an admin can change what a person sees.' : 'The pages could not be saved. Please try again.');
};

/**
 * Keeps the pages of one person: a row for every page, on or off, so what the
 * owner chose is exactly what the person gets. Only the owner and admins are
 * let through.
 */
export async function saveMemberPages(organizationId: string, userId: string, pages: Record<AccessArea, AccessLevel>, grantedBy?: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = ACCESS_AREAS.map((area) => ({
    organization_id: organizationId, user_id: userId, area, level: isAccessLevel(pages[area]) ? pages[area] : 'off', granted_by: grantedBy ?? null, updated_at: now,
  }));
  const { error } = await supabase.from('org_member_access').upsert(rows, { onConflict: 'organization_id,user_id,area' });
  if (error) throw failure(error);
}

/** Takes away everything that was chosen for one person: they are a standard member again. */
export async function clearMemberPages(organizationId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('org_member_access').delete().eq('organization_id', organizationId).eq('user_id', userId);
  if (error) throw failure(error);
}
