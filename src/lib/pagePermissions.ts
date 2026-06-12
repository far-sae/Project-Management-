// src/lib/pagePermissions.ts
//
// Pure resolver that turns a member's built-in role + (optional) assigned
// custom role into a complete { pageKey -> 'none'|'view'|'edit' } map. No React,
// no Supabase — unit-tested in isolation. The plan-feature gate is applied
// separately at the route/sidebar layer (it already exists), so this resolver
// is only about role-driven access.

import { ALL_PAGE_KEYS, PAGE_CATALOG, type PageKey, type PageAccessLevel } from './pageCatalog';

export type BuiltinRole = 'owner' | 'admin' | 'member' | 'viewer';

/** A custom role's stored permission map (a subset of pages). */
export type RolePermissionMap = Partial<Record<PageKey, 'view' | 'edit'>>;

const ALWAYS_AVAILABLE: PageKey[] = PAGE_CATALOG.filter((p) => p.alwaysAvailable).map((p) => p.key);

// Built-in fallbacks, used only when a member has NO custom role assigned, so
// today's behavior is preserved for un-migrated members.
//
// Pages a built-in 'member' cannot reach — mirrors the routes currently gated
// by `requireOrgAdmin`.
const MEMBER_BLOCKED_PAGES: PageKey[] = [
  'dashboard', 'inbox', 'team', 'comments', 'contracts', 'hr', 'reports',
];
// Pages a built-in 'viewer' may view — mirrors today's viewer sidebar surface.
const VIEWER_VIEW_PAGES: PageKey[] = ['calendar', 'timeline', 'project_management'];

const fill = (level: PageAccessLevel): Record<PageKey, PageAccessLevel> =>
  Object.fromEntries(ALL_PAGE_KEYS.map((k) => [k, level])) as Record<PageKey, PageAccessLevel>;

/**
 * Resolve the effective per-page access for one member.
 *
 * Order: Owner → everything 'edit'. Else a custom role (if assigned) governs.
 * Else fall back to the built-in role's today-equivalent surface. Finally, any
 * `alwaysAvailable` page is floored at 'view' so nobody loses their own
 * tasks / calendar / profile.
 */
export const resolvePagePermissions = (input: {
  isOwner: boolean;
  builtinRole: BuiltinRole | null;
  customRole: { permissions: RolePermissionMap } | null;
}): Record<PageKey, PageAccessLevel> => {
  if (input.isOwner || input.builtinRole === 'owner') return fill('edit');

  const out = fill('none');

  if (input.customRole) {
    for (const k of ALL_PAGE_KEYS) {
      const lvl = input.customRole.permissions[k];
      if (lvl) out[k] = lvl;
    }
  } else if (input.builtinRole === 'admin') {
    for (const k of ALL_PAGE_KEYS) out[k] = 'edit';
  } else if (input.builtinRole === 'viewer') {
    for (const k of VIEWER_VIEW_PAGES) out[k] = 'view';
  } else {
    // member (default)
    for (const k of ALL_PAGE_KEYS) out[k] = MEMBER_BLOCKED_PAGES.includes(k) ? 'none' : 'edit';
  }

  // alwaysAvailable floor — never below 'view'.
  for (const k of ALWAYS_AVAILABLE) {
    if (out[k] === 'none') out[k] = 'view';
  }
  return out;
};
