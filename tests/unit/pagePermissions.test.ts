// tests/unit/pagePermissions.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePagePermissions } from '@/lib/pagePermissions';
import { pageKeyForPath, ALL_PAGE_KEYS } from '@/lib/pageCatalog';

describe('resolvePagePermissions', () => {
  it('owner gets edit on every page (role ignored)', () => {
    const p = resolvePagePermissions({ isOwner: true, builtinRole: 'owner', customRole: null });
    expect(ALL_PAGE_KEYS.every((k) => p[k] === 'edit')).toBe(true);
  });

  it('a custom role grants exactly its map; unlisted pages are none', () => {
    const p = resolvePagePermissions({
      isOwner: false,
      builtinRole: 'member',
      customRole: { permissions: { crm: 'edit', inbox: 'view' } },
    });
    expect(p.crm).toBe('edit');
    expect(p.inbox).toBe('view');
    expect(p.dashboard).toBe('none');
    expect(p.hr).toBe('none');
  });

  it('alwaysAvailable pages are floored at view even when a role omits them', () => {
    const p = resolvePagePermissions({
      isOwner: false,
      builtinRole: 'member',
      customRole: { permissions: { crm: 'edit' } },
    });
    // my_tasks, calendar, settings are alwaysAvailable
    expect(p.my_tasks).toBe('view');
    expect(p.calendar).toBe('view');
    expect(p.settings).toBe('view');
  });

  it('a custom role can still RAISE an alwaysAvailable page to edit', () => {
    const p = resolvePagePermissions({
      isOwner: false,
      builtinRole: 'member',
      customRole: { permissions: { settings: 'edit' } },
    });
    expect(p.settings).toBe('edit');
  });

  it('built-in member fallback blocks admin-only pages, allows the rest', () => {
    const p = resolvePagePermissions({ isOwner: false, builtinRole: 'member', customRole: null });
    expect(p.dashboard).toBe('none');
    expect(p.team).toBe('none');
    expect(p.hr).toBe('none');
    expect(p.reports).toBe('none');
    expect(p.crm).toBe('edit');
    expect(p.my_tasks).toBe('edit');
  });

  it('built-in admin fallback gets edit everywhere; viewer is read-only on its surface', () => {
    const admin = resolvePagePermissions({ isOwner: false, builtinRole: 'admin', customRole: null });
    expect(ALL_PAGE_KEYS.every((k) => admin[k] === 'edit')).toBe(true);

    const viewer = resolvePagePermissions({ isOwner: false, builtinRole: 'viewer', customRole: null });
    expect(viewer.calendar).toBe('view');
    expect(viewer.timeline).toBe('view');
    expect(viewer.project_management).toBe('view');
    expect(viewer.dashboard).toBe('none');
    expect(viewer.settings).toBe('view'); // alwaysAvailable floor
  });
});

describe('pageKeyForPath', () => {
  it('maps routes to the most specific page key', () => {
    expect(pageKeyForPath('/dashboard')).toBe('dashboard');
    expect(pageKeyForPath('/dashboard/projects')).toBe('projects_analytics');
    expect(pageKeyForPath('/project/abc-123')).toBe('project_management');
    expect(pageKeyForPath('/crm')).toBe('crm');
    expect(pageKeyForPath('/crm/activity')).toBe('crm');
    expect(pageKeyForPath('/email')).toBe('email');
  });

  it("does not confuse /time with /timeline", () => {
    expect(pageKeyForPath('/timeline')).toBe('timeline');
    expect(pageKeyForPath('/time')).toBe('hr');
    expect(pageKeyForPath('/payroll')).toBe('hr');
  });

  it('returns null for paths outside the catalog', () => {
    expect(pageKeyForPath('/login')).toBeNull();
    expect(pageKeyForPath('/no-access')).toBeNull();
  });
});
