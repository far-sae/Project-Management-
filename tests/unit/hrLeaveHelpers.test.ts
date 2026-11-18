// HR Leave tab helpers: the rules of the "Add leave" form (dates stay in
// order, half days only for one day, clashes and empty ranges block saving)
// and the small view helpers (date ranges, ordering, headline figures).
import { describe, expect, it } from 'vitest';
import type { LeaveLike } from '@/lib/leave';
import {
  blankLeaveForm,
  checkLeaveForm,
  toCreateLeaveInput,
  updateLeaveForm,
  type LeaveFormValues,
} from '@/components/hr/leave/leaveForm';
import {
  formatDayCount,
  formatLeaveDates,
  leaveFigures,
  leaveYears,
  sortLeaveRequests,
} from '@/components/hr/leave/leaveView';

const req = (o: Partial<LeaveLike> & { id: string; startDate: string; endDate: string }): LeaveLike => ({
  userId: 'ana',
  leaveType: 'annual',
  days: 1,
  status: 'approved',
  ...o,
});

const form = (o: Partial<LeaveFormValues> = {}): LeaveFormValues => ({
  ...blankLeaveForm('2026-11-18', 'ana'),
  ...o,
});

const ctx = (requests: LeaveLike[] = [], holidayDates: string[] = []) => ({
  requests,
  holidayDates,
  allowance: { userId: 'ana', annualDays: 20, sickDays: 10 },
});

describe('blankLeaveForm', () => {
  it('starts as one day of annual leave today, approved straight away', () => {
    expect(blankLeaveForm('2026-11-18', 'ana')).toEqual({
      userId: 'ana',
      leaveType: 'annual',
      startDate: '2026-11-18',
      endDate: '2026-11-18',
      halfDay: false,
      reason: '',
      approveNow: true,
    });
    expect(blankLeaveForm('2026-11-18').userId).toBe('');
  });
});

describe('updateLeaveForm', () => {
  it('moves the end date along with the start date while they are the same day', () => {
    const next = updateLeaveForm(form(), { startDate: '2026-12-07' });
    expect(next.startDate).toBe('2026-12-07');
    expect(next.endDate).toBe('2026-12-07');
  });

  it('keeps a later end date when the start date changes', () => {
    const next = updateLeaveForm(form({ endDate: '2026-11-20' }), { startDate: '2026-11-19' });
    expect(next.endDate).toBe('2026-11-20');
  });

  it('never leaves the end date before the start date', () => {
    expect(updateLeaveForm(form({ endDate: '2026-11-20' }), { startDate: '2026-11-25' }).endDate).toBe('2026-11-25');
    expect(updateLeaveForm(form(), { endDate: '2026-11-10' }).endDate).toBe('2026-11-18');
  });

  it('drops the half day when the leave is longer than one day', () => {
    const half = updateLeaveForm(form(), { halfDay: true });
    expect(half.halfDay).toBe(true);
    expect(updateLeaveForm(half, { endDate: '2026-11-19' }).halfDay).toBe(false);
    expect(updateLeaveForm(form({ endDate: '2026-11-19' }), { halfDay: true }).halfDay).toBe(false);
  });
});

describe('checkLeaveForm', () => {
  it('counts working days and what is left of the annual allowance', () => {
    const requests = [req({ id: 'a', startDate: '2026-03-02', endDate: '2026-03-06', days: 5 })];
    const check = checkLeaveForm(form({ startDate: '2026-12-07', endDate: '2026-12-11' }), ctx(requests));
    expect(check).toEqual({ days: 5, clash: undefined, remainingAfter: 10, problem: null });
  });

  it('skips public holidays and counts a half day as 0.5', () => {
    const range = form({ startDate: '2026-12-24', endDate: '2026-12-28' });
    expect(checkLeaveForm(range, ctx([], ['2026-12-25'])).days).toBe(2);
    expect(checkLeaveForm(form({ halfDay: true }), ctx()).days).toBe(0.5);
  });

  it('uses the sick allowance for sick leave and none for unpaid or other leave', () => {
    const requests = [
      req({ id: 's', startDate: '2026-04-01', endDate: '2026-04-02', days: 2, leaveType: 'sick' }),
    ];
    expect(checkLeaveForm(form({ leaveType: 'sick' }), ctx(requests)).remainingAfter).toBe(7);
    expect(checkLeaveForm(form({ leaveType: 'unpaid' }), ctx(requests)).remainingAfter).toBeNull();
    expect(checkLeaveForm(form({ leaveType: 'other' }), ctx(requests)).remainingAfter).toBeNull();
  });

  it('lets the balance go negative without blocking', () => {
    const requests = [req({ id: 'a', startDate: '2026-03-02', endDate: '2026-03-27', days: 20 })];
    const check = checkLeaveForm(form(), ctx(requests));
    expect(check.remainingAfter).toBe(-1);
    expect(check.problem).toBeNull();
  });

  it('takes the balance from the year the leave starts in', () => {
    const requests = [req({ id: 'a', startDate: '2026-03-02', endDate: '2026-03-06', days: 5 })];
    const next = form({ startDate: '2027-01-04', endDate: '2027-01-05' });
    expect(checkLeaveForm(next, ctx(requests)).remainingAfter).toBe(18);
  });

  it('blocks dates that clash with approved or pending leave of the same person', () => {
    const clash = req({ id: 'c', startDate: '2026-11-17', endDate: '2026-11-19', status: 'pending' });
    const check = checkLeaveForm(form(), ctx([clash]));
    expect(check.problem).toBe('clash');
    expect(check.clash).toBe(clash);
    // Someone else's leave, or leave that was turned down, is not a clash.
    expect(checkLeaveForm(form(), ctx([{ ...clash, userId: 'bob' }])).problem).toBeNull();
    expect(checkLeaveForm(form(), ctx([{ ...clash, status: 'rejected' }])).problem).toBeNull();
  });

  it('blocks a range with no working days', () => {
    const weekend = form({ startDate: '2026-11-21', endDate: '2026-11-22' });
    expect(checkLeaveForm(weekend, ctx())).toMatchObject({ days: 0, problem: 'no-working-days' });
    const holiday = form({ startDate: '2026-12-25', endDate: '2026-12-25' });
    expect(checkLeaveForm(holiday, ctx([], ['2026-12-25'])).problem).toBe('no-working-days');
  });

  it('is incomplete until a person and both dates are chosen', () => {
    expect(checkLeaveForm(form({ userId: '' }), ctx()).problem).toBe('incomplete');
    expect(checkLeaveForm(form({ startDate: '' }), ctx()).problem).toBe('incomplete');
    expect(checkLeaveForm(form({ endDate: '' }), ctx()).problem).toBe('incomplete');
  });
});

describe('toCreateLeaveInput', () => {
  it('records approved leave by default', () => {
    const values = form({ startDate: '2026-12-07', endDate: '2026-12-11', reason: '  Family trip ' });
    expect(toCreateLeaveInput(values, 5)).toEqual({
      userId: 'ana',
      leaveType: 'annual',
      startDate: '2026-12-07',
      endDate: '2026-12-11',
      days: 5,
      halfDay: false,
      reason: 'Family trip',
      status: 'approved',
    });
  });

  it('records a pending half day with no reason', () => {
    const values = form({ halfDay: true, approveNow: false, leaveType: 'sick' });
    expect(toCreateLeaveInput(values, 0.5)).toMatchObject({
      leaveType: 'sick',
      days: 0.5,
      halfDay: true,
      reason: null,
      status: 'pending',
    });
  });
});

describe('formatLeaveDates', () => {
  it('shows one date for a single day', () => {
    expect(formatLeaveDates('2026-11-17', '2026-11-17')).toBe('17 Nov 2026');
  });

  it('shows the year once for a range inside one year', () => {
    expect(formatLeaveDates('2026-11-17', '2026-11-19')).toBe('17 Nov – 19 Nov 2026');
  });

  it('shows both years when the range crosses New Year', () => {
    expect(formatLeaveDates('2026-12-29', '2027-01-02')).toBe('29 Dec 2026 – 2 Jan 2027');
  });
});

describe('formatDayCount', () => {
  it('says day for one and days for anything else', () => {
    expect(formatDayCount(1)).toBe('1 day');
    expect(formatDayCount(0.5)).toBe('0.5 days');
    expect(formatDayCount(3)).toBe('3 days');
    expect(formatDayCount(-1.5)).toBe('-1.5 days');
    expect(formatDayCount(2, 'working day')).toBe('2 working days');
  });
});

describe('sortLeaveRequests', () => {
  const list = [
    req({ id: 'old', startDate: '2026-03-02', endDate: '2026-03-03' }),
    req({ id: 'pending-old', startDate: '2026-02-02', endDate: '2026-02-03', status: 'pending' }),
    req({ id: 'new', startDate: '2026-12-01', endDate: '2026-12-01' }),
    req({ id: 'pending-new', startDate: '2026-11-23', endDate: '2026-11-25', status: 'pending' }),
  ];

  it('puts the newest start date first', () => {
    expect(sortLeaveRequests(list, false).map((r) => r.id)).toEqual(['new', 'pending-new', 'old', 'pending-old']);
  });

  it('can put pending requests on top', () => {
    expect(sortLeaveRequests(list, true).map((r) => r.id)).toEqual(['pending-new', 'pending-old', 'new', 'old']);
  });

  it('does not reorder the list it was given', () => {
    sortLeaveRequests(list, true);
    expect(list[0].id).toBe('old');
  });
});

describe('leaveYears', () => {
  it('offers this year plus every year with leave or a holiday, newest first', () => {
    const requests = [
      req({ id: 'a', startDate: '2025-12-29', endDate: '2026-01-02' }),
      req({ id: 'b', startDate: '2026-03-02', endDate: '2026-03-03' }),
    ];
    expect(leaveYears(requests, [{ date: '2027-01-01' }], 2026)).toEqual([2027, 2026, 2025]);
    expect(leaveYears([], [], 2026)).toEqual([2026]);
  });
});

describe('leaveFigures', () => {
  it('counts pending requests, people off today and soon, and this year’s holidays', () => {
    const requests = [
      req({ id: 'p', userId: 'bob', startDate: '2026-11-23', endDate: '2026-11-25', status: 'pending' }),
      req({ id: 'today', startDate: '2026-11-17', endDate: '2026-11-19' }),
      req({ id: 'soon', startDate: '2026-12-01', endDate: '2026-12-01' }),
      req({ id: 'bob-soon', userId: 'bob', startDate: '2026-11-30', endDate: '2026-11-30' }),
      req({ id: 'far', userId: 'cy', startDate: '2026-12-21', endDate: '2026-12-22' }),
      req({ id: 'no', userId: 'cy', startDate: '2026-11-18', endDate: '2026-11-18', status: 'rejected' }),
    ];
    const holidays = [{ date: '2026-01-01' }, { date: '2026-12-25' }, { date: '2027-01-01' }];
    expect(leaveFigures(requests, holidays, '2026-11-18')).toEqual({
      pending: 1,
      onLeaveToday: 1,
      offNext14Days: 2,
      holidaysThisYear: 2,
    });
  });
});
