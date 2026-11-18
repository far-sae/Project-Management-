// HR overview tab: headline figures, leave waiting for a decision, who is off,
// team breakdown, starters and anniversaries, documents about to expire and
// public holidays. Leave and documents come in as props; "today" is pinned to
// Wednesday 18 November 2026.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  entries: [] as unknown[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({ organization: { organizationId: 'o1', members: [] } }),
}));
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

import { HrOverviewTab } from '@/components/hr/HrOverviewTab';
import type { HrPerson, HrTab } from '@/components/hr/types';
import type { UseLeave } from '@/hooks/useLeave';
import type { UseEmployeeDocuments } from '@/hooks/useEmployeeDocuments';
import type { EmployeeProfile } from '@/services/supabase/employees';
import type { EmployeeDocument } from '@/services/supabase/hrDocuments';
import type { LeaveRequest } from '@/services/supabase/leave';

const NOW = new Date(2026, 10, 18, 10, 0, 0);

const person = (userId: string, displayName: string, profile?: Partial<EmployeeProfile>): HrPerson => ({
  userId,
  displayName,
  email: `${userId}@x.io`,
  profile: profile
    ? ({ userId, organizationId: 'o1', status: 'active', employmentType: 'employee', ...profile } as EmployeeProfile)
    : null,
});

const PEOPLE: HrPerson[] = [
  person('ana', 'Ana', { department: 'Design', hireDate: new Date('2023-12-02') }),
  person('bob', 'Bob', { department: 'Engineering', status: 'onboarding', hireDate: new Date('2026-11-12') }),
  person('cy', 'Cy'),
  person('dee', 'Dee'),
];

const request = (id: string, over: Partial<LeaveRequest>): LeaveRequest => ({
  id,
  organizationId: 'o1',
  userId: 'ana',
  leaveType: 'annual',
  startDate: '2026-11-18',
  endDate: '2026-11-18',
  days: 1,
  halfDay: false,
  reason: null,
  status: 'pending',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  createdBy: 'ana',
  createdAt: new Date('2026-11-01T09:00:00Z'),
  ...over,
});

const REQUESTS: LeaveRequest[] = [
  request('p1', { userId: 'bob', leaveType: 'annual', startDate: '2026-11-24', endDate: '2026-11-26', days: 3 }),
  request('p2', { userId: 'cy', leaveType: 'sick', startDate: '2026-11-20', endDate: '2026-11-20', days: 1 }),
  request('a1', { userId: 'ana', status: 'approved', startDate: '2026-11-17', endDate: '2026-11-19', days: 3 }),
  request('a2', { userId: 'dee', status: 'approved', leaveType: 'unpaid', startDate: '2026-11-30', endDate: '2026-12-01', days: 2 }),
  request('a3', { userId: 'dee', status: 'approved', startDate: '2026-12-20', endDate: '2026-12-22', days: 3 }),
  request('r1', { userId: 'bob', status: 'rejected' }),
];

const doc = (id: string, over: Partial<EmployeeDocument>): EmployeeDocument => ({
  id,
  organizationId: 'o1',
  userId: 'ana',
  title: `Doc ${id}`,
  category: 'contract',
  fileName: `${id}.pdf`,
  filePath: `o1/ana/${id}.pdf`,
  fileSize: 1024,
  fileType: 'application/pdf',
  expiresOn: null,
  uploadedBy: 'ana',
  createdAt: new Date('2026-01-05T10:00:00Z'),
  ...over,
});

const DOCUMENTS: EmployeeDocument[] = [
  doc('d1', { title: 'Work visa', userId: 'bob', expiresOn: '2026-12-02' }),
  doc('d2', { title: 'First aid certificate', userId: 'gone', expiresOn: '2026-11-01' }),
  doc('d3', { title: 'Employment contract', expiresOn: null }),
  doc('d4', { title: 'Passport', expiresOn: '2031-06-30' }),
];

const HOLIDAYS = [
  { id: 'h1', date: '2026-01-01', name: "New Year's Day" },
  { id: 'h2', date: '2026-12-25', name: 'Christmas Day' },
  { id: 'h3', date: '2026-12-28', name: 'Boxing Day' },
  { id: 'h4', date: '2027-01-01', name: "New Year's Day 2027" },
  { id: 'h5', date: '2027-04-02', name: 'Good Friday' },
  { id: 'h6', date: '2027-04-05', name: 'Easter Monday' },
  { id: 'h7', date: '2027-05-03', name: 'Early May' },
];

const makeLeave = (over: Partial<UseLeave> = {}): UseLeave => ({
  requests: REQUESTS,
  allowances: [],
  holidays: HOLIDAYS,
  holidayDates: HOLIDAYS.map((x) => x.date),
  allowanceFor: (userId: string) => ({ userId, annualDays: 20, sickDays: 10 }),
  loading: false,
  setupMissing: false,
  error: null,
  refresh: vi.fn(),
  create: vi.fn(),
  decide: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn(),
  saveAllowance: vi.fn(),
  addHoliday: vi.fn(),
  removeHoliday: vi.fn(),
  ...over,
});

const makeDocs = (over: Partial<UseEmployeeDocuments> = {}): UseEmployeeDocuments => ({
  documents: DOCUMENTS,
  loading: false,
  setupMissing: false,
  error: null,
  refresh: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  open: vi.fn(),
  ...over,
});

const renderTab = (
  props: { people?: HrPerson[]; leave?: UseLeave; docs?: UseEmployeeDocuments; onOpenTab?: (tab: HrTab) => void } = {},
) => {
  const leave = props.leave ?? makeLeave();
  const docs = props.docs ?? makeDocs();
  const onOpenTab = props.onOpenTab ?? vi.fn();
  render(<HrOverviewTab people={props.people ?? PEOPLE} leave={leave} docs={docs} onOpenTab={onOpenTab} />);
  return { leave, docs, onOpenTab };
};

/** The figure under a label in the strip at the top. */
const figure = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;
const box = (name: string) => screen.getByRole('region', { name });
const rowWith = (region: HTMLElement, text: string) =>
  within(region)
    .getAllByRole('listitem')
    .find((li) => within(li).queryByText(text))!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  h.entries = [];
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HR overview tab', () => {
  it('shows the headline figures', () => {
    const start = new Date(NOW.getTime() - 2 * 3600_000);
    h.entries = [
      {
        entryId: 'e1', organizationId: 'o1', userId: 'bob',
        clockedInAt: start, clockedOutAt: null, durationSeconds: null,
        createdAt: start, updatedAt: start,
      },
    ];
    renderTab();
    expect(screen.getByRole('heading', { level: 1, name: 'HR overview' })).toBeTruthy();
    expect(figure('Headcount').textContent).toBe('4');
    expect(figure('Headcount').nextElementSibling?.textContent).toBe('2 with an HR profile');
    expect(figure('On the clock now').textContent).toBe('1');
    expect(figure('On leave today').textContent).toBe('1');
    expect(figure('Pending leave requests').textContent).toBe('2');
    expect(figure('Documents expiring soon').textContent).toBe('2');
    expect(figure('Documents expiring soon').getAttribute('data-tone')).toBe('danger');
  });

  it('keeps the documents figure calm when nothing is expiring', () => {
    renderTab({ docs: makeDocs({ documents: [] }) });
    expect(figure('Documents expiring soon').textContent).toBe('0');
    expect(figure('Documents expiring soon').getAttribute('data-tone')).toBe('default');
  });

  it('lists leave waiting for a decision, soonest first', () => {
    renderTab();
    const rows = within(box('Pending leave requests')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Cy');
    expect(rows[0].textContent).toContain('Sick leave');
    expect(rows[0].textContent).toContain('20 Nov');
    expect(rows[0].textContent).toContain('1 day');
    expect(rows[1].textContent).toContain('Bob');
    expect(rows[1].textContent).toContain('Annual leave');
    expect(rows[1].textContent).toContain('24 Nov – 26 Nov');
    expect(rows[1].textContent).toContain('3 days');
  });

  it('approves and rejects from the overview', async () => {
    const { leave } = renderTab();
    const pending = box('Pending leave requests');
    fireEvent.click(within(rowWith(pending, 'Bob')).getByRole('button', { name: /^Approve/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
    expect(leave.decide).toHaveBeenCalledWith('p1', 'approved');

    fireEvent.click(within(rowWith(pending, 'Cy')).getByRole('button', { name: /^Reject/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(2));
    expect(leave.decide).toHaveBeenLastCalledWith('p2', 'rejected');
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it('says so when a decision could not be saved', async () => {
    const decide = vi.fn().mockRejectedValue(new Error('No connection'));
    renderTab({ leave: makeLeave({ decide }) });
    const row = rowWith(box('Pending leave requests'), 'Bob');
    fireEvent.click(within(row).getByRole('button', { name: /^Approve/ }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('No connection'));
    expect(h.toast.success).not.toHaveBeenCalled();
    expect((within(row).getByRole('button', { name: /^Approve/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows who's off today and in the next two weeks", () => {
    renderTab();
    const off = box("Who's off");
    const rows = within(off).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Ana');
    expect(rows[0].textContent).toContain('Annual leave');
    expect(rows[0].textContent).toContain('17 Nov – 19 Nov');
    expect(within(rows[0]).getByText('Today').getAttribute('data-tone')).toBeTruthy();
    expect(rows[1].textContent).toContain('Dee');
    expect(rows[1].textContent).toContain('Unpaid leave');
    expect(rows[1].textContent).toContain('30 Nov – 1 Dec');
    expect(within(rows[1]).queryByText('Today')).toBeNull();
  });

  it('breaks the team down by status and department', () => {
    renderTab();
    const team = box('Team');
    const count = (label: string) => rowWith(team, label).textContent;
    expect(count('Active')).toBe('Active1');
    expect(count('Onboarding')).toBe('Onboarding1');
    expect(count('Terminated')).toBe('Terminated0');
    expect(count('No profile')).toBe('No profile2');
    expect(count('Design')).toBe('Design1');
    expect(count('Engineering')).toBe('Engineering1');
    expect(count('No department')).toBe('No department2');
  });

  it('lists starters and anniversaries', () => {
    renderTab();
    const rows = within(box('Starters and anniversaries')).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Bob.*Joined 12 Nov/),
      expect.stringMatching(/Ana.*3 years on 2 Dec/),
    ]);
  });

  it('lists documents that expire soon, with a pill for each', () => {
    renderTab();
    const expiring = box('Documents expiring soon');
    const rows = within(expiring).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('First aid certificate');
    expect(rows[0].textContent).toContain('Former member');
    expect(rows[0].textContent).toContain('1 Nov 2026');
    expect(within(rows[0]).getByText('Expired').getAttribute('data-tone')).toBe('danger');
    expect(rows[1].textContent).toContain('Work visa');
    expect(rows[1].textContent).toContain('Bob');
    expect(rows[1].textContent).toContain('2 Dec 2026');
    expect(within(rows[1]).getByText('In 14 days').getAttribute('data-tone')).toBe('warning');
  });

  it('shows the next five public holidays', () => {
    renderTab();
    const rows = within(box('Upcoming public holidays')).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Christmas Day'),
      expect.stringContaining('Boxing Day'),
      expect.stringContaining("New Year's Day 2027"),
      expect.stringContaining('Good Friday'),
      expect.stringContaining('Easter Monday'),
    ]);
    expect(rows[0].textContent).toContain('Fri 25 Dec');
  });

  it('links each box to its tab', () => {
    const { onOpenTab } = renderTab();
    fireEvent.click(within(box('Pending leave requests')).getByRole('button', { name: 'Open Leave' }));
    expect(onOpenTab).toHaveBeenLastCalledWith('leave');
    fireEvent.click(within(box('Team')).getByRole('button', { name: 'Open People' }));
    expect(onOpenTab).toHaveBeenLastCalledWith('people');
    fireEvent.click(within(box('Documents expiring soon')).getByRole('button', { name: 'Open Documents' }));
    expect(onOpenTab).toHaveBeenLastCalledWith('documents');
  });

  it('says when there is nothing to show', () => {
    renderTab({
      people: [person('cy', 'Cy')],
      leave: makeLeave({ requests: [], holidays: [] }),
      docs: makeDocs({ documents: [] }),
    });
    expect(within(box('Pending leave requests')).getByText('Nothing waiting for a decision.')).toBeTruthy();
    expect(within(box("Who's off")).getByText('Nobody is off in the next two weeks.')).toBeTruthy();
    expect(within(box('Starters and anniversaries')).getByText('No new starters or anniversaries this month.')).toBeTruthy();
    expect(within(box('Documents expiring soon')).getByText('No documents expire in the next 30 days.')).toBeTruthy();
    expect(within(box('Upcoming public holidays')).getByText('No public holidays coming up.')).toBeTruthy();
  });

  it('still shows headcount and team before the database update, with one notice', () => {
    const { onOpenTab } = renderTab({
      leave: makeLeave({ setupMissing: true, requests: [], holidays: [] }),
      docs: makeDocs({ setupMissing: true, documents: [] }),
    });
    expect(screen.getAllByText('Leave and Documents need a one-time database update.')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'See how' }));
    expect(onOpenTab).toHaveBeenCalledWith('leave');

    expect(figure('Headcount').textContent).toBe('4');
    expect(figure('On the clock now').textContent).toBe('0');
    expect(within(box('Team')).getByText('Onboarding')).toBeTruthy();
    expect(within(box('Starters and anniversaries')).getByText('Joined 12 Nov')).toBeTruthy();

    expect(screen.queryByText('On leave today')).toBeNull();
    expect(screen.queryByText('Pending leave requests')).toBeNull();
    expect(screen.queryByText('Documents expiring soon')).toBeNull();
    expect(screen.queryByRole('region', { name: "Who's off" })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Upcoming public holidays' })).toBeNull();
  });

  it('shows a spinner in the leave boxes while leave is loading', () => {
    renderTab({ leave: makeLeave({ loading: true, requests: [], holidays: [] }) });
    expect(within(box('Pending leave requests')).getByLabelText('Loading')).toBeTruthy();
    expect(figure('Pending leave requests').textContent).toBe('—');
    expect(figure('Headcount').textContent).toBe('4');
  });

  it('offers to try again when leave could not be loaded', () => {
    const leave = makeLeave({ error: 'Could not load leave.', requests: [], holidays: [] });
    renderTab({ leave });
    const pending = box('Pending leave requests');
    expect(within(pending).getByRole('alert').textContent).toContain('Could not load leave.');
    fireEvent.click(within(pending).getByRole('button', { name: 'Retry' }));
    expect(leave.refresh).toHaveBeenCalled();
  });
});
