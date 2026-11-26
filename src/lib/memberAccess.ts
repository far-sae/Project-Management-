// Which pages one person sees and can use: the words and shapes the screens
// share. The owner (or an admin) chooses on the Team page; the choice is kept
// in the table org_member_access, one row for each person and page.
// See supabase/migrations/213_member_access.sql and 214_member_page_access.sql.
import type { PageKey } from './pageCatalog';

/** The pages the owner can open or close for one person. Each is also a page key. */
export type AccessArea =
  | 'dashboard' | 'projects_analytics' | 'inbox' | 'workload' | 'reports'
  | 'crm' | 'calls' | 'email' | 'social';

/**
 * What a row says. off: the person does not see the page and cannot open it.
 * use: sees it and works in it. manage: also does what was for admins only there.
 */
export type AccessLevel = 'off' | 'use' | 'manage';
/** What a person has been given in an area: nothing, or one of the two working levels. */
export type AreaAccess = 'none' | 'use' | 'manage';

/** One person's rows, by page. A page without a row: what a member had before the owner chose. */
export type MemberAccess = Partial<Record<AccessArea, AccessLevel>>;

export type AccessPage = {
  area: AccessArea;
  label: string;
  group: 'Work' | 'Sales and marketing';
  /** What the person can do there, in one line. */
  hint: string;
  /** A member sees this page in their menu without the owner choosing anything. */
  standard?: boolean;
  /** The page has things that were for admins only, which can be given too. */
  manage?: { use: string; manage: string };
  /** A plan feature the organisation needs for this page to exist at all. */
  feature?: 'crm' | 'email_campaigns';
};

/** Every page that can be opened or closed for one person, in the order it is shown. */
export const ACCESS_PAGES: AccessPage[] = [
  { area: 'dashboard', label: 'Project Management', group: 'Work', hint: 'The home page with the projects this person is on.' },
  { area: 'projects_analytics', label: 'Projects analytics', group: 'Work', hint: 'Figures of the projects this person is on.' },
  { area: 'workload', label: 'Workload', group: 'Work', hint: 'Who has how much to do.', standard: true },
  { area: 'inbox', label: 'Inbox', group: 'Work', hint: 'Messages and mentions.' },
  { area: 'reports', label: 'Reports', group: 'Work', hint: 'Reports on tasks and projects.' },
  { area: 'crm', label: 'CRM', group: 'Sales and marketing', hint: 'Leads, companies, deals, follow-ups, agreements and invoices.', feature: 'crm' },
  {
    area: 'calls', label: 'Calls', group: 'Sales and marketing', hint: 'Ring leads from the app. Calls are recorded.', feature: 'crm',
    manage: { use: 'Own calls only', manage: 'All calls and recordings' },
  },
  { area: 'email', label: 'Email', group: 'Sales and marketing', hint: 'Bulk email, sequences and templates.', feature: 'email_campaigns' },
  {
    area: 'social', label: 'Social media', group: 'Sales and marketing', hint: 'Posts for every platform.',
    manage: { use: 'Posts only', manage: 'Everything, with accounts and the autopilot' },
  },
];

export const ACCESS_AREAS: AccessArea[] = ACCESS_PAGES.map((p) => p.area);
export const isAccessArea = (value: unknown): value is AccessArea => ACCESS_AREAS.includes(value as AccessArea);
export const isAccessLevel = (value: unknown): value is AccessLevel => value === 'off' || value === 'use' || value === 'manage';

/** Each area is the page of the same name. */
export const pageOfArea = (area: AccessArea): PageKey => area;

/** What a person was given in an area. A page that was closed, or never chosen, is "none". */
export const givenIn = (access: MemberAccess, area: AccessArea): AreaAccess => {
  const level = access[area];
  return level === 'use' || level === 'manage' ? level : 'none';
};

/** True once the owner has chosen this person's pages (a row for any page). */
export const hasOwnPages = (access: MemberAccess | undefined): boolean => Boolean(access && Object.keys(access).length > 0);

/**
 * What the window on the Team page opens with for one person: their own rows,
 * and for a page without a row what a member has in their menu today (on for
 * the standard pages, off for the rest).
 */
export function pagesFor(access: MemberAccess | undefined): Record<AccessArea, AccessLevel> {
  const out = {} as Record<AccessArea, AccessLevel>;
  for (const page of ACCESS_PAGES) out[page.area] = access?.[page.area] ?? (page.standard ? 'use' : 'off');
  return out;
}

/** How many of the pages are on. */
export const pagesOn = (pages: Record<AccessArea, AccessLevel>): number => ACCESS_AREAS.filter((a) => pages[a] !== 'off').length;

export const ACCESS_NOT_SET_UP_MESSAGE = 'Choosing the pages of one person is not set up yet. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.';
