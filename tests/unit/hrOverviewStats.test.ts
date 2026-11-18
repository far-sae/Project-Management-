// HR overview figures: team breakdown, starters and anniversaries, documents
// about to expire, upcoming public holidays. All pure; "today" is passed in.
import { describe, expect, it } from 'vitest';
import {
  departmentBreakdown,
  expiringDocuments,
  milestoneLabel,
  onLeaveCount,
  pendingLeave,
  statusBreakdown,
  teamMilestones,
  upcomingHolidays,
} from '@/components/hr/overview/overviewStats';
import { daysBetweenYmd, formatYmd, formatYmdRange } from '@/components/hr/overview/dates';
import type { HrPerson } from '@/components/hr/types';
import type { EmployeeProfile } from '@/services/supabase/employees';
import type { EmployeeDocument } from '@/services/supabase/hrDocuments';
import type { LeaveRequest } from '@/services/supabase/leave';

const TODAY = '2026-11-18';

const person = (userId: string, profile?: Partial<EmployeeProfile> | null): HrPerson => ({
  userId,
  displayName: userId.charAt(0).toUpperCase() + userId.slice(1),
  email: `${userId}@x.io`,
  profile:
    profile === null || profile === undefined
      ? null
      : ({ userId, organizationId: 'o1', status: 'active', employmentType: 'employee', ...profile } as EmployeeProfile),
});

const hired = (ymd: string) => new Date(ymd);

const doc = (id: string, expiresOn: string | null): EmployeeDocument => ({
  id,
  organizationId: 'o1',
  userId: 'ana',
  title: `Doc ${id}`,
  category: 'contract',
  fileName: `${id}.pdf`,
  filePath: `o1/ana/${id}.pdf`,
  fileSize: 1024,
  fileType: 'application/pdf',
  expiresOn,
  uploadedBy: 'ana',
  createdAt: new Date('2026-01-05T10:00:00Z'),
});

const request = (id: string, over: Partial<LeaveRequest>): LeaveRequest => ({
  id,
  organizationId: 'o1',
  userId: 'ana',
  leaveType: 'annual',
  startDate: TODAY,
  endDate: TODAY,
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

describe('dates', () => {
  it('counts whole days between two dates', () => {
    expect(daysBetweenYmd('2026-11-18', '2026-11-18')).toBe(0);
    expect(daysBetweenYmd('2026-11-18', '2026-12-02')).toBe(14);
    expect(daysBetweenYmd('2026-11-18', '2026-11-12')).toBe(-6);
    // Across the end of summer time, still whole days.
    expect(daysBetweenYmd('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('writes a date as day and short month, with the year when asked', () => {
    expect(formatYmd('2026-11-12')).toBe('12 Nov');
    expect(formatYmd('2026-12-02', { year: true })).toBe('2 Dec 2026');
    expect(formatYmd('2026-12-25', { weekday: true })).toBe('Fri 25 Dec');
  });

  it('writes a date range, and a single day only once', () => {
    expect(formatYmdRange('2026-11-18', '2026-11-18')).toBe('18 Nov');
    expect(formatYmdRange('2026-11-18', '2026-11-20')).toBe('18 Nov – 20 Nov');
    expect(formatYmdRange('2026-12-29', '2027-01-02')).toBe('29 Dec 2026 – 2 Jan 2027');
  });
});

describe('statusBreakdown', () => {
  it('counts people by HR status, with "No profile" for those without one', () => {
    const people = [
      person('ana', { status: 'active' }),
      person('bob', { status: 'active' }),
      person('cy', { status: 'onboarding' }),
      person('dee', { status: 'terminated' }),
      person('eve', null),
      person('fay', null),
    ];
    expect(statusBreakdown(people)).toEqual([
      { key: 'active', label: 'Active', count: 2 },
      { key: 'onboarding', label: 'Onboarding', count: 1 },
      { key: 'terminated', label: 'Terminated', count: 1 },
      { key: 'none', label: 'No profile', count: 2 },
    ]);
  });

  it('keeps all four rows when nobody is there', () => {
    expect(statusBreakdown([]).map((r) => r.count)).toEqual([0, 0, 0, 0]);
  });
});

describe('departmentBreakdown', () => {
  it('lists departments biggest first with "No department" last', () => {
    const people = [
      person('ana', { department: 'Design' }),
      person('bob', { department: 'Engineering' }),
      person('cy', { department: 'engineering ' }),
      person('dee', { department: '' }),
      person('eve', null),
    ];
    expect(departmentBreakdown(people)).toEqual([
      { key: 'engineering', label: 'Engineering', count: 2 },
      { key: 'design', label: 'Design', count: 1 },
      { key: 'none', label: 'No department', count: 2 },
    ]);
  });

  it('keeps the top five and folds the rest into one row', () => {
    const people = [
      ...['a1', 'a2', 'a3'].map((id) => person(id, { department: 'Alpha' })),
      ...['b1', 'b2'].map((id) => person(id, { department: 'Beta' })),
      person('c1', { department: 'Gamma' }),
      person('d1', { department: 'Delta' }),
      person('e1', { department: 'Epsilon' }),
      person('f1', { department: 'Zeta' }),
      person('g1', { department: 'Eta' }),
    ];
    const rows = departmentBreakdown(people);
    expect(rows.map((r) => r.label)).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon', 'Eta', 'Other departments']);
    expect(rows[rows.length - 1]).toEqual({ key: 'other', label: 'Other departments', count: 2 });
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(people.length);
  });

  it('is empty when nobody is there', () => {
    expect(departmentBreakdown([])).toEqual([]);
  });
});

describe('teamMilestones', () => {
  it('finds people who joined in the last 30 days', () => {
    const people = [
      person('ana', { hireDate: hired('2026-11-12') }),
      person('bob', { hireDate: hired('2026-10-19') }), // exactly 30 days ago
      person('cy', { hireDate: hired('2026-10-18') }), // 31 days ago
      person('dee', null),
    ];
    const found = teamMilestones(people, TODAY);
    expect(found.map((m) => [m.userId, m.kind, m.date])).toEqual([
      ['ana', 'joined', '2026-11-12'],
      ['bob', 'joined', '2026-10-19'],
    ]);
    expect(milestoneLabel(found[0])).toBe('Joined 12 Nov');
  });

  it('finds work anniversaries in the next 30 days', () => {
    const people = [
      person('ana', { hireDate: hired('2023-12-02') }),
      person('bob', { hireDate: hired('2025-11-18') }), // one year today
      person('cy', { hireDate: hired('2020-12-19') }), // 31 days away
      person('dee', { hireDate: hired('2024-11-10') }), // already passed this year
    ];
    const found = teamMilestones(people, TODAY);
    expect(found.map((m) => [m.userId, m.kind, m.date, m.years])).toEqual([
      ['bob', 'anniversary', '2026-11-18', 1],
      ['ana', 'anniversary', '2026-12-02', 3],
    ]);
    expect(milestoneLabel(found[0])).toBe('1 year today');
    expect(milestoneLabel(found[1])).toBe('3 years on 2 Dec');
  });

  it('sees an anniversary that falls just after New Year', () => {
    const found = teamMilestones([person('ana', { hireDate: hired('2022-01-05') })], '2026-12-20');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'anniversary', date: '2027-01-05', years: 5 });
    expect(milestoneLabel(found[0])).toBe('5 years on 5 Jan');
  });

  it('marks a 29 February starter on 28 February in ordinary years', () => {
    const found = teamMilestones([person('ana', { hireDate: hired('2024-02-29') })], '2027-02-10');
    expect(found[0]).toMatchObject({ kind: 'anniversary', date: '2027-02-28', years: 3 });
  });

  it('lists someone due to start in the next 30 days', () => {
    const found = teamMilestones([person('ana', { hireDate: hired('2026-12-01'), status: 'onboarding' })], TODAY);
    expect(found[0]).toMatchObject({ kind: 'starting', date: '2026-12-01' });
    expect(milestoneLabel(found[0])).toBe('Starts 1 Dec');
  });

  it('leaves out people who have left', () => {
    const people = [
      person('ana', { hireDate: hired('2026-11-12'), status: 'terminated' }),
      person('bob', { hireDate: hired('2023-12-02'), status: 'terminated' }),
    ];
    expect(teamMilestones(people, TODAY)).toEqual([]);
  });

  it('puts the nearest date first', () => {
    const people = [
      person('ana', { hireDate: hired('2023-12-10') }), // 22 days ahead
      person('bob', { hireDate: hired('2026-11-15') }), // 3 days ago
      person('cy', { hireDate: hired('2021-11-20') }), // 2 days ahead
    ];
    expect(teamMilestones(people, TODAY).map((m) => m.userId)).toEqual(['cy', 'bob', 'ana']);
  });
});

describe('expiringDocuments', () => {
  it('keeps documents that have expired or expire within 30 days, soonest first', () => {
    const documents = [
      doc('later', '2027-03-01'),
      doc('soon', '2026-12-02'),
      doc('none', null),
      doc('gone', '2026-11-01'),
      doc('edge', '2026-12-18'), // exactly 30 days
      doc('past-edge', '2026-12-19'),
      doc('today', TODAY),
    ];
    const found = expiringDocuments(documents, TODAY);
    expect(found.map((e) => e.doc.id)).toEqual(['gone', 'today', 'soon', 'edge']);
    expect(found.map((e) => [e.tone, e.label])).toEqual([
      ['danger', 'Expired'],
      ['warning', 'Expires today'],
      ['warning', 'In 14 days'],
      ['warning', 'In 30 days'],
    ]);
  });
});

describe('leave figures', () => {
  it('counts the people on approved leave on a day', () => {
    const people = [person('ana'), person('bob'), person('cy')];
    const requests = [
      request('1', { userId: 'ana', status: 'approved', startDate: '2026-11-17', endDate: '2026-11-19' }),
      request('2', { userId: 'bob', status: 'pending', startDate: TODAY, endDate: TODAY }),
      request('3', { userId: 'cy', status: 'approved', startDate: '2026-11-19', endDate: '2026-11-20' }),
      request('4', { userId: 'gone', status: 'approved', startDate: TODAY, endDate: TODAY }),
    ];
    expect(onLeaveCount(people, requests, TODAY)).toBe(1);
  });

  it('lists requests still waiting, earliest start first', () => {
    const requests = [
      request('late', { startDate: '2026-12-20', endDate: '2026-12-22' }),
      request('done', { status: 'approved' }),
      request('early', { startDate: '2026-11-25', endDate: '2026-11-25' }),
    ];
    expect(pendingLeave(requests).map((r) => r.id)).toEqual(['early', 'late']);
  });
});

describe('upcomingHolidays', () => {
  it('gives the next five from today on', () => {
    const holidays = [
      { id: 'h7', date: '2027-05-03', name: 'Early May' },
      { id: 'h1', date: '2026-01-01', name: "New Year's Day" },
      { id: 'h3', date: '2026-12-28', name: 'Boxing Day (substitute)' },
      { id: 'h2', date: '2026-12-25', name: 'Christmas Day' },
      { id: 'h0', date: TODAY, name: 'Founders day' },
      { id: 'h4', date: '2027-01-01', name: "New Year's Day" },
      { id: 'h5', date: '2027-04-02', name: 'Good Friday' },
      { id: 'h6', date: '2027-04-05', name: 'Easter Monday' },
    ];
    expect(upcomingHolidays(holidays, TODAY).map((h) => h.id)).toEqual(['h0', 'h2', 'h3', 'h4', 'h5']);
  });
});
