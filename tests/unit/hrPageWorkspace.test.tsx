// HR follows the workspace picked in the sidebar: each person is in one
// workspace, and every tab shows only the selected workspace's people and
// their leave, documents and attendance. People with no workspace are pointed
// out so nobody silently disappears. Before migration 185 has been run HR
// shows the whole company, as it always did.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type ListResult = { available: boolean; assignments: Array<{ userId: string; workspaceId: string }> };

const h = vi.hoisted(() => {
  const members = [
    { userId: 'sam', displayName: 'Sam', email: 'sam@x.io', status: 'active', role: 'owner' },
    { userId: 'priya', displayName: 'Priya Nair', email: 'priya@x.io', status: 'active', role: 'member' },
    { userId: 'tom', displayName: 'Tom Okafor', email: 'tom@x.io', status: 'active', role: 'member' },
    { userId: 'jo', displayName: 'Jo Park', email: 'jo@x.io', status: 'active', role: 'member' },
  ];
  const workspaces = [
    { workspaceId: 'ws-studio', name: 'Studio' },
    { workspaceId: 'ws-agency', name: 'Agency' },
  ];
  const leaveRequest = (id: string, userId: string) => ({
    id,
    organizationId: 'org1',
    userId,
    leaveType: 'annual',
    startDate: '2031-03-03',
    endDate: '2031-03-04',
    days: 2,
    halfDay: false,
    reason: null,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdBy: userId,
    createdAt: new Date('2031-01-05T09:00:00Z'),
  });
  const document = (id: string, userId: string, title: string) => ({
    id,
    organizationId: 'org1',
    userId,
    title,
    category: 'contract',
    fileName: `${id}.pdf`,
    filePath: `org1/${userId}/${id}.pdf`,
    fileSize: 1024,
    fileType: 'application/pdf',
    expiresOn: null,
    uploadedBy: 'sam',
    createdAt: new Date('2031-01-05T10:00:00Z'),
  });
  const noop = () => {};
  return {
    // Every mocked hook hands back the same object on every call; a new one
    // each time would make effects re-run forever.
    org: { organization: { organizationId: 'org1', members }, isOwner: true, isAdmin: true },
    auth: { user: { userId: 'sam', displayName: 'Sam' } },
    scopes: {
      studio: {
        selectedId: 'ws-studio', selected: workspaces[0], isAll: false, isUnassigned: false, workspaces,
      },
      all: {
        selectedId: '__ALL_WORKSPACES__', selected: null, isAll: true, isUnassigned: false, workspaces,
      },
      unassigned: {
        selectedId: '__UNASSIGNED_PROJECTS__', selected: null, isAll: false, isUnassigned: true, workspaces,
      },
    },
    scope: 'studio' as 'studio' | 'all' | 'unassigned',
    first: null as ListResult | null,
    push: null as ((r: ListResult) => void) | null,
    setPersonWorkspace: vi.fn(),
    assignPeopleToWorkspace: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    employees: {
      profilesByUserId: new Map(),
      loading: false,
      upsert: vi.fn(),
      remove: vi.fn(),
      canManage: true,
      canView: true,
    },
    leave: {
      requests: [leaveRequest('l1', 'sam'), leaveRequest('l2', 'priya'), leaveRequest('l3', 'tom'), leaveRequest('l4', 'jo')],
      allowances: [],
      holidays: [],
      holidayDates: [],
      allowanceFor: (userId: string) => ({ userId, annualDays: 20, sickDays: 10 }),
      loading: false,
      setupMissing: false,
      error: null,
      refresh: noop,
      create: noop,
      decide: noop,
      remove: noop,
      saveAllowance: noop,
      addHoliday: noop,
      removeHoliday: noop,
    },
    docs: {
      documents: [
        document('d1', 'sam', 'Sam contract'),
        document('d2', 'tom', 'Tom contract'),
        document('d3', 'jo', 'Jo contract'),
      ],
      loading: false,
      setupMissing: false,
      error: null,
      refresh: noop,
      upload: noop,
      remove: noop,
      open: noop,
    },
    money: (n: number) => `$${n}`,
    /** Time entries the attendance figures are built from. */
    entries: [] as unknown[],
  };
});

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.org }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => h.scopes[h.scope] }));
vi.mock('@/services/supabase/hrWorkspaces', () => ({
  subscribeToPersonWorkspaces: (_orgId: string, cb: (r: ListResult) => void) => {
    h.push = cb;
    if (h.first) cb(h.first);
    return () => {};
  },
  setPersonWorkspace: h.setPersonWorkspace,
  assignPeopleToWorkspace: h.assignPeopleToWorkspace,
}));
vi.mock('@/hooks/useEmployees', () => ({ useEmployees: () => h.employees }));
vi.mock('@/hooks/useLeave', () => ({ useLeave: () => h.leave }));
vi.mock('@/hooks/useEmployeeDocuments', () => ({ useEmployeeDocuments: () => h.docs }));
vi.mock('@/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/hooks/useFormatMoney', () => ({ useFormatMoney: () => h.money }));
vi.mock('@/pages/TimeTracking', () => ({ TimeTracking: () => <p>time-tracking-screen</p> }));
vi.mock('@/pages/Expenses', () => ({ Expenses: () => <p>expenses-screen</p> }));
// The payroll screen is stood in for by one that reads the same hook, to show
// that screens inside HR use what the HR page already loaded.
vi.mock('@/pages/Payroll', async () => {
  const { useHrWorkspacePeople } = await import('@/hooks/useHrWorkspacePeople');
  const Payroll = () => {
    const scope = useHrWorkspacePeople();
    return <p>payroll-screen: {scope.figureNote ?? 'whole company'}</p>;
  };
  return { Payroll };
});
vi.mock('@/services/supabase/timeEntries', async (orig) => {
  const actual = await orig<typeof import('@/services/supabase/timeEntries')>();
  return {
    ...actual,
    subscribeToTimeEntries: (_org: string, cb: (e: unknown[]) => void) => {
      cb(h.entries);
      return () => {};
    },
  };
});

import { HR } from '@/pages/HR';

// Sam and Priya are in Studio, Tom is in Agency, Jo has no workspace.
const ASSIGNED: ListResult = {
  available: true,
  assignments: [
    { userId: 'sam', workspaceId: 'ws-studio' },
    { userId: 'priya', workspaceId: 'ws-studio' },
    { userId: 'tom', workspaceId: 'ws-agency' },
  ],
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <HR />
    </MemoryRouter>,
  );

const peopleInTable = () =>
  within(screen.getByRole('table'))
    .getAllByRole('heading', { level: 3 })
    .map((el) => el.textContent);
const figure = (label: string) =>
  screen.getAllByText(label).find((el) => el.tagName === 'DT')?.nextElementSibling?.textContent;
/** Pick an option in a Select the way a keyboard user does. */
const choose = (trigger: HTMLElement, option: string) => {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: option }));
};

beforeAll(() => {
  // jsdom lacks these; the Select needs them to open.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  const g = globalThis as unknown as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  h.scope = 'studio';
  h.entries = [];
  h.first = ASSIGNED;
  h.push = null;
  h.org.isOwner = true;
  h.org.isAdmin = true;
  h.employees.canView = true;
  h.employees.canManage = true;
  h.auth.user = { userId: 'sam', displayName: 'Sam' };
  h.setPersonWorkspace.mockReset().mockResolvedValue({ available: true });
  h.assignPeopleToWorkspace.mockReset().mockResolvedValue({ available: true });
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(cleanup);

describe('HR follows the selected workspace', () => {
  it('says whose data is showing under the page title', () => {
    renderAt('/hr');
    expect(within(screen.getByRole('banner')).getByText('Showing Studio')).toBeTruthy();
    cleanup();
    h.scope = 'unassigned';
    renderAt('/hr');
    expect(within(screen.getByRole('banner')).getByText('Showing people with no workspace')).toBeTruthy();
    cleanup();
    h.scope = 'all';
    renderAt('/hr');
    expect(within(screen.getByRole('banner')).getByText('Showing the whole company')).toBeTruthy();
  });

  it('People lists only the people in the selected workspace', () => {
    renderAt('/hr?tab=people');
    expect(peopleInTable()).toEqual(['Sam', 'Priya Nair']);
  });

  it('"Unassigned" lists the people with no workspace', () => {
    h.scope = 'unassigned';
    renderAt('/hr?tab=people');
    expect(peopleInTable()).toEqual(['Jo Park']);
  });

  it('"All workspaces" lists everyone', () => {
    h.scope = 'all';
    renderAt('/hr?tab=people');
    expect(peopleInTable()).toEqual(['Sam', 'Priya Nair', 'Tom Okafor', 'Jo Park']);
  });

  it('counts the overview figures from the selected workspace only', () => {
    renderAt('/hr');
    expect(figure('Headcount')).toBe('2');
    expect(figure('Pending leave requests')).toBe('2');
    cleanup();
    h.scope = 'all';
    renderAt('/hr');
    expect(figure('Headcount')).toBe('4');
    expect(figure('Pending leave requests')).toBe('4');
  });

  it('Leave shows only the leave of people in the selected workspace', () => {
    renderAt('/hr?tab=leave');
    expect(figure('Pending requests')).toBe('2');
    expect(screen.getAllByText('Priya Nair').length).toBeGreaterThan(0);
    expect(screen.queryByText('Tom Okafor')).toBeNull();
    expect(screen.queryByText('Jo Park')).toBeNull();
  });

  it('Documents shows only the documents of people in the selected workspace', () => {
    renderAt('/hr?tab=documents');
    expect(screen.getByText('Sam contract')).toBeTruthy();
    expect(screen.queryByText('Tom contract')).toBeNull();
    expect(screen.queryByText('Jo contract')).toBeNull();
  });

  it('Attendance counts only the people in the selected workspace', () => {
    renderAt('/hr?tab=attendance');
    expect(screen.getByText('0 / 2')).toBeTruthy();
    expect(screen.getByText('Priya Nair')).toBeTruthy();
    expect(screen.queryByText('Tom Okafor')).toBeNull();
  });

  it('does not count people in other workspaces who are on the clock', () => {
    const start = new Date();
    const clockedIn = (entryId: string, userId: string, userName: string) => ({
      entryId, organizationId: 'org1', userId, userName,
      clockedInAt: start, clockedOutAt: null, durationSeconds: null,
      createdAt: start, updatedAt: start,
    });
    h.entries = [clockedIn('e1', 'sam', 'Sam'), clockedIn('e2', 'tom', 'Tom Okafor')];
    renderAt('/hr');
    expect(figure('On the clock now')).toBe('1');
    cleanup();
    renderAt('/hr?tab=attendance');
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.queryByText('Tom Okafor')).toBeNull();
    cleanup();
    h.scope = 'all';
    renderAt('/hr');
    expect(figure('On the clock now')).toBe('2');
  });

  it('someone who can only see their own HR record always sees it, whichever workspace is selected', () => {
    // Tom is in Agency, Studio is selected, and Tom is not an owner or admin.
    h.employees.canView = false;
    h.employees.canManage = false;
    h.org.isOwner = false;
    h.org.isAdmin = false;
    h.auth.user = { userId: 'tom', displayName: 'Tom Okafor' };
    renderAt('/hr?tab=people');
    expect(peopleInTable()).toEqual(['Tom Okafor']);
    expect(screen.queryByText('Showing Studio')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the screens inside HR use what the HR page already loaded', () => {
    renderAt('/hr?tab=payroll');
    expect(screen.getByText('payroll-screen: For Studio only')).toBeTruthy();
  });
});

describe('people who are not in a workspace yet', () => {
  it('are pointed out at the top of HR when a workspace is selected', () => {
    renderAt('/hr');
    const notice = screen.getByRole('status');
    expect(within(notice).getByText('1 person is not in a workspace yet.')).toBeTruthy();
    expect(within(notice).getByRole('button', { name: 'Add them to Studio' })).toBeTruthy();
    expect(within(notice).getByRole('button', { name: 'Review' })).toBeTruthy();
  });

  it('counts everyone when nobody has been assigned yet', () => {
    h.first = { available: true, assignments: [] };
    renderAt('/hr');
    expect(screen.getByText('4 people are not in a workspace yet.')).toBeTruthy();
  });

  it('are not announced under "Unassigned" or "All workspaces", where they already show', () => {
    h.scope = 'unassigned';
    renderAt('/hr');
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    h.scope = 'all';
    renderAt('/hr');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('"Add them to Studio" puts all of them in the selected workspace', async () => {
    renderAt('/hr?tab=people');
    expect(peopleInTable()).toEqual(['Sam', 'Priya Nair']);
    fireEvent.click(screen.getByRole('button', { name: 'Add them to Studio' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(h.assignPeopleToWorkspace).toHaveBeenCalledWith('org1', ['jo'], 'ws-studio', 'sam');
    expect(peopleInTable()).toEqual(['Sam', 'Priya Nair', 'Jo Park']);
    expect(h.toast.success).toHaveBeenCalledWith('1 person added to Studio');
  });

  it('says so when they could not be added', async () => {
    h.assignPeopleToWorkspace.mockRejectedValue(new Error('permission denied'));
    renderAt('/hr');
    fireEvent.click(screen.getByRole('button', { name: 'Add them to Studio' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('permission denied'));
    expect(screen.getByText('1 person is not in a workspace yet.')).toBeTruthy();
  });

  it('"Review" opens People showing just them, and goes back again', () => {
    renderAt('/hr');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('tab', { name: 'People' }).getAttribute('aria-selected')).toBe('true');
    expect(peopleInTable()).toEqual(['Jo Park']);
    expect(screen.getByText(/^These people are not in a workspace yet./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Studio' }));
    expect(peopleInTable()).toEqual(['Sam', 'Priya Nair']);
  });

  it('review ends by itself once everyone has a workspace', async () => {
    renderAt('/hr');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    choose(screen.getByRole('combobox', { name: 'Workspace for Jo Park' }), 'Studio');
    await waitFor(() => expect(h.setPersonWorkspace).toHaveBeenCalledWith('org1', 'jo', 'ws-studio', 'sam'));
    await waitFor(() => expect(peopleInTable()).toEqual(['Sam', 'Priya Nair', 'Jo Park']));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('only owners and admins are offered "Add them to Studio"', () => {
    h.org.isOwner = false;
    h.org.isAdmin = false;
    renderAt('/hr');
    const notice = screen.getByRole('status');
    expect(within(notice).queryByRole('button', { name: 'Add them to Studio' })).toBeNull();
    expect(within(notice).getByRole('button', { name: 'Review' })).toBeTruthy();
  });
});

describe('the Workspace control on People', () => {
  it('shows each person\'s workspace and lets an owner change it', async () => {
    renderAt('/hr?tab=people');
    expect(screen.getByRole('columnheader', { name: 'Workspace' })).toBeTruthy();
    const control = screen.getByRole('combobox', { name: 'Workspace for Sam' });
    expect(control.textContent).toContain('Studio');
    choose(control, 'Agency');
    await waitFor(() => expect(h.setPersonWorkspace).toHaveBeenCalledWith('org1', 'sam', 'ws-agency', 'sam'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Sam moved to Agency'));
    // Sam is in Agency now, so no longer listed under Studio.
    expect(peopleInTable()).toEqual(['Priya Nair']);
  });

  it('offers the organization\'s workspaces and "No workspace"', () => {
    renderAt('/hr?tab=people');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Workspace for Sam' }), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Studio', 'Agency', 'No workspace']);
  });

  it('"No workspace" takes the person out of their workspace', async () => {
    renderAt('/hr?tab=people');
    choose(screen.getByRole('combobox', { name: 'Workspace for Priya Nair' }), 'No workspace');
    await waitFor(() => expect(h.setPersonWorkspace).toHaveBeenCalledWith('org1', 'priya', null, 'sam'));
    await waitFor(() =>
      expect(h.toast.success).toHaveBeenCalledWith('Priya Nair is no longer in a workspace'),
    );
    expect(screen.getByText('2 people are not in a workspace yet.')).toBeTruthy();
  });

  it('says so and puts the person back when the change could not be saved', async () => {
    h.setPersonWorkspace.mockRejectedValue(new Error('permission denied'));
    renderAt('/hr?tab=people');
    choose(screen.getByRole('combobox', { name: 'Workspace for Sam' }), 'Agency');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('permission denied'));
    expect(peopleInTable()).toEqual(['Sam', 'Priya Nair']);
  });

  it('is plain text for people who are not an owner or admin', () => {
    h.org.isOwner = false;
    h.org.isAdmin = false;
    h.scope = 'all';
    renderAt('/hr?tab=people');
    expect(screen.queryByRole('combobox', { name: /^Workspace for/ })).toBeNull();
    const rows = screen.getAllByRole('row');
    expect(within(rows.find((r) => within(r).queryByText('Tom Okafor'))!).getByText('Agency')).toBeTruthy();
    expect(within(rows.find((r) => within(r).queryByText('Jo Park'))!).getByText('No workspace')).toBeTruthy();
  });

  it('says when a workspace has nobody in it yet', () => {
    h.first = { available: true, assignments: [{ userId: 'tom', workspaceId: 'ws-agency' }] };
    renderAt('/hr?tab=people');
    expect(screen.getByText('Nobody is in Studio yet.')).toBeTruthy();
  });
});

describe('before the database update has been run', () => {
  beforeEach(() => {
    h.first = { available: false, assignments: [] };
  });

  it('HR shows the whole company exactly as before', () => {
    renderAt('/hr?tab=people');
    expect(peopleInTable()).toEqual(['Sam', 'Priya Nair', 'Tom Okafor', 'Jo Park']);
    expect(screen.queryByRole('columnheader', { name: 'Workspace' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Workspace for/ })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });

  it('counts everyone in the figures', () => {
    renderAt('/hr');
    expect(figure('Headcount')).toBe('4');
    expect(figure('Pending leave requests')).toBe('4');
    cleanup();
    renderAt('/hr?tab=payroll');
    expect(screen.getByText('payroll-screen: whole company')).toBeTruthy();
  });
});

describe('while the assignments are still loading', () => {
  it('waits instead of showing the whole company under a workspace name', () => {
    h.first = null;
    renderAt('/hr');
    expect(screen.getByLabelText('Loading HR')).toBeTruthy();
    expect(screen.queryByText('Headcount')).toBeNull();
    act(() => h.push?.(ASSIGNED));
    expect(screen.queryByLabelText('Loading HR')).toBeNull();
    expect(figure('Headcount')).toBe('2');
  });

  it('"All workspaces" has nothing to wait for', () => {
    h.first = null;
    h.scope = 'all';
    renderAt('/hr');
    expect(figure('Headcount')).toBe('4');
  });
});
