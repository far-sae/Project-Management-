// src/lib/pageCatalog.ts
//
// Single source of truth for the app's "pages" — the unit the owner toggles
// when building a custom role (No access / View / Edit). Each entry maps a
// stable PageKey to the route path(s) it governs, the optional plan feature
// gate (applied separately, unchanged), and a display group for the editor.
//
// Pure data + a route→key resolver. No React, so it's trivially testable.

export type PageKey =
  | 'dashboard' | 'projects_analytics'
  | 'project_management' | 'my_tasks' | 'calendar' | 'workload' | 'inbox'
  | 'team' | 'files' | 'comments' | 'contracts'
  | 'timeline' | 'reports'
  | 'crm'
  | 'hr' | 'settings';

export type PageAccessLevel = 'none' | 'view' | 'edit';

export interface PageDef {
  key: PageKey;
  label: string;
  group: string;
  /** Route paths this page governs. A path matches a route when it equals the
   *  route or begins with `route + '/'` (so '/time' never matches '/timeline').
   *  The longest matching route wins (so '/dashboard/projects' resolves to
   *  projects_analytics, not dashboard). */
  routes: string[];
  /** Optional plan-feature gate name (an AppFeature). Applied separately at the
   *  route/sidebar layer, not by the permission resolver. */
  feature?: string;
  /** A personal/basic surface that a role can never drop below 'view' — nobody
   *  gets locked out of their own tasks / calendar / profile. */
  alwaysAvailable?: boolean;
}

export const PAGE_CATALOG: PageDef[] = [
  { key: 'dashboard',          label: 'Dashboard',          group: 'Overview',      routes: ['/dashboard'] },
  { key: 'projects_analytics', label: 'Projects analytics', group: 'Overview',      routes: ['/dashboard/projects'] },
  { key: 'project_management', label: 'Project management', group: 'Work',          routes: ['/project'] },
  { key: 'my_tasks',           label: 'My Tasks',           group: 'Work',          routes: ['/tasks'], alwaysAvailable: true },
  { key: 'calendar',           label: 'Calendar',           group: 'Work',          routes: ['/calendar'], alwaysAvailable: true },
  { key: 'workload',           label: 'Workload',           group: 'Work',          routes: ['/workload'] },
  { key: 'inbox',              label: 'Inbox',              group: 'Work',          routes: ['/inbox'] },
  { key: 'timeline',           label: 'Timeline',           group: 'Work',           routes: ['/timeline'], feature: 'timeline_overview' },
  { key: 'reports',            label: 'Reports',            group: 'Work',           routes: ['/reports'] },
  { key: 'crm',                label: 'CRM',                group: 'CRM',            routes: ['/crm'] },
  { key: 'team',               label: 'Team',               group: 'People & ops',  routes: ['/team'], feature: 'team_collaboration' },
  { key: 'hr',                 label: 'HR & people ops',    group: 'People & ops',  routes: ['/hr', '/time', '/payroll', '/expenses'] },
  { key: 'contracts',          label: 'Contracts',          group: 'People & ops',  routes: ['/contracts'], feature: 'contracts' },
  { key: 'comments',           label: 'Comments',           group: 'Workspace',     routes: ['/comments'] },
  { key: 'files',              label: 'Files',              group: 'Workspace',     routes: ['/files'] },
  { key: 'settings',           label: 'Settings',           group: 'Workspace',     routes: ['/settings'], alwaysAvailable: true },
];

export const ALL_PAGE_KEYS: PageKey[] = PAGE_CATALOG.map((p) => p.key);

const byKey = new Map<PageKey, PageDef>(PAGE_CATALOG.map((p) => [p.key, p]));
export const getPageDef = (key: PageKey): PageDef | undefined => byKey.get(key);

/** True when `pathname` falls under `route` on a path boundary. */
const routeMatches = (pathname: string, route: string): boolean =>
  pathname === route || pathname.startsWith(route + '/');

/**
 * Resolve a pathname to the PageKey that governs it, picking the most specific
 * (longest) matching route. Returns null for paths outside the catalog (e.g.
 * /login, /no-access) so callers can let those through ungated.
 */
export const pageKeyForPath = (pathname: string): PageKey | null => {
  let best: { key: PageKey; len: number } | null = null;
  for (const p of PAGE_CATALOG) {
    for (const route of p.routes) {
      if (routeMatches(pathname, route) && (!best || route.length > best.len)) {
        best = { key: p.key, len: route.length };
      }
    }
  }
  return best?.key ?? null;
};
