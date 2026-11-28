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

  it('a member reaches Social media only when it was given to them', () => {
    expect(resolvePagePermissions({ isOwner: false, builtinRole: 'member', customRole: null }).social).toBe('none');
    expect(resolvePagePermissions({ isOwner: false, builtinRole: 'member', customRole: null, access: {} }).social).toBe('none');
    for (const level of ['use', 'manage'] as const) {
      const p = resolvePagePermissions({ isOwner: false, builtinRole: 'member', customRole: null, access: { social: level } });
      expect(p.social).toBe('edit');
      // Nothing else opens with it.
      expect(p.team).toBe('none');
      expect(p.dashboard).toBe('none');
      expect(p.reports).toBe('none');
    }
  });

  it('the owner\'s choice for one person opens a page a member does not have, and closes one a member has', () => {
    const p = resolvePagePermissions({ isOwner: false, builtinRole: 'member', customRole: null, access: { reports: 'use', dashboard: 'use', crm: 'off', email: 'off', workload: 'off', calls: 'use' } });
    expect(p.reports).toBe('edit');
    // The Team page is not one the owner switches on: it stays with people who run a project.
    expect(p.team).toBe('none');
    expect(p.dashboard).toBe('edit');
    expect(p.calls).toBe('edit');
    expect(p.crm).toBe('none');
    expect(p.email).toBe('none');
    expect(p.workload).toBe('none');
    // A page nobody chose keeps what a member has.
    expect(p.inbox).toBe('none');
    expect(p.projects_analytics).toBe('edit');
    expect(p.project_management).toBe('edit');
  });

  it('nobody is locked out of their own tasks, calendar and settings', () => {
    const p = resolvePagePermissions({ isOwner: false, builtinRole: 'member', customRole: null, access: { dashboard: 'off', workload: 'off', crm: 'off' } });
    expect(p.my_tasks).toBe('edit');
    expect(p.calendar).toBe('edit');
    expect(p.settings).toBe('edit');
    expect(p.hr).toBe('none');
  });

  it('Calls is a page of its own, and a member has it as before until the owner says otherwise', () => {
    expect(pageKeyForPath('/calls')).toBe('calls');
    expect(resolvePagePermissions({ isOwner: false, builtinRole: 'member', customRole: null }).calls).toBe('edit');
    expect(resolvePagePermissions({ isOwner: false, builtinRole: 'member', customRole: null, access: { calls: 'off' } }).calls).toBe('none');
  });

  it('what was given changes nothing for a viewer, an admin or the owner', () => {
    expect(resolvePagePermissions({ isOwner: false, builtinRole: 'viewer', customRole: null, access: { social: 'manage' } }).social).toBe('none');
    expect(resolvePagePermissions({ isOwner: false, builtinRole: 'admin', customRole: null, access: { crm: 'off' } }).crm).toBe('edit');
    expect(resolvePagePermissions({ isOwner: false, builtinRole: 'admin', customRole: null }).social).toBe('edit');
    expect(resolvePagePermissions({ isOwner: true, builtinRole: null, customRole: null, access: { crm: 'off' } }).crm).toBe('edit');
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

describe('Find leads has its own address', () => {
  it('is opened or closed with the CRM', async () => {
    const { pageKeyForPath } = await import('@/lib/pageCatalog');
    expect(pageKeyForPath('/find-leads')).toBe('crm');
  });
});
