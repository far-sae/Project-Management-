// Extra access for one person, without making them an admin: the words and
// shapes the screens share. See supabase/migrations/213_member_access.sql.

/** The areas a person can be given. Social media is the only one so far. */
export type AccessArea = 'social';
/** use: sees the area and works in it. manage: may also do what was for admins only. */
export type AccessLevel = 'use' | 'manage';
/** What a person has in an area: nothing, or one of the levels. */
export type AreaAccess = 'none' | AccessLevel;

export type MemberAccess = Partial<Record<AccessArea, AccessLevel>>;

export const ACCESS_AREAS: AccessArea[] = ['social'];
export const isAccessArea = (value: unknown): value is AccessArea => ACCESS_AREAS.includes(value as AccessArea);
export const isAccessLevel = (value: unknown): value is AccessLevel => value === 'use' || value === 'manage';

/** What the owner chooses for one person on the Team page. */
export const SOCIAL_ACCESS_NAME: Record<AreaAccess, string> = {
  none: 'Social: no access',
  use: 'Social: posts only',
  manage: 'Social: everything',
};

export const SOCIAL_ACCESS_HINT: Record<AreaAccess, string> = {
  none: 'Does not see Social media.',
  use: 'Makes, plans and approves posts. Cannot connect accounts or change the autopilot.',
  manage: 'Everything on Social media: posts, connecting accounts, and the autopilot with its monthly budget.',
};

export const ACCESS_NOT_SET_UP_MESSAGE = 'Access for one person is not set up yet. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.';
