// HR leave rules: how many working days a request uses, what is left of a
// yearly allowance, who is off on a given day, and clashes between requests.
import { describe, expect, it } from 'vitest';
import {
  countLeaveDays,
  findOverlap,
  leaveBalance,
  leaveOnDate,
  upcomingLeave,
  type LeaveLike,
} from '@/lib/leave';

const req = (o: Partial<LeaveLike> & { startDate: string; endDate: string }): LeaveLike => ({
  id: Math.random().toString(36).slice(2),
  userId: 'ana',
  leaveType: 'annual',
  days: 1,
  status: 'approved',
  ...o,
});

describe('countLeaveDays', () => {
  it('counts Monday to Friday and skips the weekend', () => {
    // Mon 16 Nov 2026 → Mon 23 Nov 2026 = 6 working days
    expect(countLeaveDays('2026-11-16', '2026-11-23')).toBe(6);
  });

  it('skips public holidays that fall on a working day', () => {
    expect(countLeaveDays('2026-12-24', '2026-12-28', ['2026-12-25'])).toBe(2);
  });

  it('counts a single day as one, or as a half when asked', () => {
    expect(countLeaveDays('2026-11-18', '2026-11-18')).toBe(1);
    expect(countLeaveDays('2026-11-18', '2026-11-18', [], true)).toBe(0.5);
  });

  it('ignores the half-day flag on a request longer than one day', () => {
    expect(countLeaveDays('2026-11-18', '2026-11-19', [], true)).toBe(2);
  });

  it('is zero for a weekend-only request or dates the wrong way round', () => {
    expect(countLeaveDays('2026-11-21', '2026-11-22')).toBe(0);
    expect(countLeaveDays('2026-11-20', '2026-11-18')).toBe(0);
  });
});

describe('leaveBalance', () => {
  const requests = [
    req({ startDate: '2026-03-02', endDate: '2026-03-06', days: 5 }),
    req({ startDate: '2026-07-01', endDate: '2026-07-01', days: 0.5 }),
    req({ startDate: '2026-09-01', endDate: '2026-09-02', days: 2, status: 'pending' }),
    req({ startDate: '2026-10-01', endDate: '2026-10-01', days: 1, status: 'rejected' }),
    req({ startDate: '2026-04-01', endDate: '2026-04-02', days: 2, leaveType: 'sick' }),
    req({ startDate: '2025-12-01', endDate: '2025-12-02', days: 2 }),
    req({ startDate: '2026-05-01', endDate: '2026-05-01', days: 1, userId: 'bob' }),
  ];

  it('takes approved days off the allowance and shows pending separately', () => {
    expect(leaveBalance(requests, 'ana', 'annual', 2026, 20)).toEqual({
      entitled: 20,
      used: 5.5,
      pending: 2,
      remaining: 14.5,
    });
  });

  it('keeps each leave type and each person apart', () => {
    expect(leaveBalance(requests, 'ana', 'sick', 2026, 10).used).toBe(2);
    expect(leaveBalance(requests, 'bob', 'annual', 2026, 20).used).toBe(1);
  });

  it('can go negative when more was taken than allowed', () => {
    expect(leaveBalance(requests, 'ana', 'annual', 2026, 3).remaining).toBe(-2.5);
  });
});

describe('leaveOnDate', () => {
  const requests = [
    req({ id: 'a', startDate: '2026-11-17', endDate: '2026-11-19' }),
    req({ id: 'b', startDate: '2026-11-18', endDate: '2026-11-18', status: 'pending' }),
    req({ id: 'c', startDate: '2026-11-18', endDate: '2026-11-18', userId: 'bob' }),
  ];

  it('finds the approved leave covering a day, per person', () => {
    expect(leaveOnDate(requests, 'ana', '2026-11-18')?.id).toBe('a');
    expect(leaveOnDate(requests, 'bob', '2026-11-18')?.id).toBe('c');
    expect(leaveOnDate(requests, 'ana', '2026-11-20')).toBeUndefined();
  });
});

describe('findOverlap', () => {
  const requests = [
    req({ id: 'a', startDate: '2026-11-17', endDate: '2026-11-19' }),
    req({ id: 'r', startDate: '2026-11-24', endDate: '2026-11-25', status: 'rejected' }),
  ];

  it('spots a clash with a request that is approved or still pending', () => {
    expect(findOverlap(requests, 'ana', '2026-11-19', '2026-11-21')?.id).toBe('a');
    expect(findOverlap(requests, 'ana', '2026-11-20', '2026-11-21')).toBeUndefined();
  });

  it('ignores rejected requests, other people and the request being edited', () => {
    expect(findOverlap(requests, 'ana', '2026-11-24', '2026-11-24')).toBeUndefined();
    expect(findOverlap(requests, 'bob', '2026-11-18', '2026-11-18')).toBeUndefined();
    expect(findOverlap(requests, 'ana', '2026-11-18', '2026-11-18', 'a')).toBeUndefined();
  });
});

describe('upcomingLeave', () => {
  it('lists approved leave that is running or starts within the window, soonest first', () => {
    const requests = [
      req({ id: 'later', startDate: '2026-11-27', endDate: '2026-11-27' }),
      req({ id: 'now', startDate: '2026-11-16', endDate: '2026-11-19' }),
      req({ id: 'far', startDate: '2027-01-10', endDate: '2027-01-12' }),
      req({ id: 'past', startDate: '2026-11-02', endDate: '2026-11-03' }),
      req({ id: 'pending', startDate: '2026-11-20', endDate: '2026-11-20', status: 'pending' }),
    ];
    expect(upcomingLeave(requests, '2026-11-18', 14).map((r) => r.id)).toEqual(['now', 'later']);
  });
});
