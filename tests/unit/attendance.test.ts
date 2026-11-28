import { describe, expect, it } from 'vitest';
import { buildAttendance, summarizeAttendance } from '@/lib/attendance';
import type { TimeEntry } from '@/services/supabase/timeEntries';

const at = (iso: string) => new Date(iso);
let n = 0;
const entry = (userId: string, inIso: string, outIso: string | null, autoClosed = false): TimeEntry => ({
  entryId: `e${++n}`,
  organizationId: 'o1',
  userId,
  clockedInAt: at(inIso),
  clockedOutAt: outIso ? at(outIso) : null,
  durationSeconds: null,
  createdAt: at(inIso),
  updatedAt: at(inIso),
  autoClosed,
});

const people = [
  { userId: 'ana', name: 'Ana' },
  { userId: 'ben', name: 'Ben' },
  { userId: 'cara', name: 'Cara' },
  { userId: 'dev', name: 'Dev' },
];

// Wed 11 Nov 2026 (local time in the test runner)
const day = new Date(2026, 10, 11, 12, 0, 0);
const now = new Date(2026, 10, 11, 15, 0, 0);
const local = (h: number, m = 0, d = 11) => new Date(2026, 10, d, h, m, 0).toISOString();

const entries = [
  // Ana: two sessions today, both done
  entry('ana', local(9), local(12, 30)),
  entry('ana', local(13, 30), local(14, 0)),
  // Ben: on the clock since 10:00
  entry('ben', local(10), null),
  // Cara: forgot to clock out, auto-closed after 9 h
  entry('cara', local(5), local(14), true),
  // Dev: nothing today, 4 h on Monday this week
  entry('dev', local(9, 0, 9), local(13, 0, 9)),
  // Someone not in the people list still shows up
  entry('zed', local(8), local(9)),
];

describe('buildAttendance', () => {
  const rows = buildAttendance(entries, people, day, now);
  const row = (id: string) => rows.find((r) => r.userId === id)!;

  it('gives first clock-in, last clock-out and hours for the day', () => {
    expect(row('ana').status).toBe('out');
    expect(row('ana').firstIn?.toISOString()).toBe(local(9));
    expect(row('ana').lastOut?.toISOString()).toBe(local(14));
    expect(row('ana').daySeconds).toBe(4 * 3600);
    expect(row('ana').sessions).toBe(2);
  });

  it('counts people still on the clock live, up to now', () => {
    expect(row('ben').status).toBe('on_clock');
    expect(row('ben').lastOut).toBeNull();
    expect(row('ben').daySeconds).toBe(5 * 3600);
  });

  it('flags shifts that were clocked out automatically', () => {
    expect(row('cara').status).toBe('auto_out');
    expect(row('cara').daySeconds).toBe(9 * 3600);
  });

  it('lists teammates who did not clock in, with their hours this week', () => {
    expect(row('dev').status).toBe('absent');
    expect(row('dev').daySeconds).toBe(0);
    expect(row('dev').weekSeconds).toBe(4 * 3600);
    expect(row('ana').weekSeconds).toBe(4 * 3600);
  });

  it('includes people with entries even if they are not on the team list', () => {
    expect(row('zed').name).toBe('Unknown member');
  });

  it('sorts: on the clock first, then by clock-in time, absent last', () => {
    expect(rows.map((r) => r.userId)).toEqual(['ben', 'cara', 'zed', 'ana', 'dev']);
  });
});

describe('summarizeAttendance', () => {
  it('counts who is on the clock, who clocked in, and total team hours', () => {
    const s = summarizeAttendance(buildAttendance(entries, people, day, now));
    expect(s.onClock).toBe(1);
    expect(s.clockedIn).toBe(4);
    expect(s.teamSize).toBe(5);
    expect(s.totalSeconds).toBe((4 + 5 + 9 + 1) * 3600);
  });
});

// The clock runs round the clock: a shift may start in the evening and end
// the next morning, and it may be longer than a working day.
describe('a shift that goes over midnight', () => {
  const night = [{ userId: 'elena', name: 'Elena' }];
  const row = (rows: ReturnType<typeof buildAttendance>) => rows.find((r) => r.userId === 'elena')!;

  it('shows the person on the clock the next day, not as absent', () => {
    const open = [entry('elena', local(22, 0, 10), null)];
    const at2am = new Date(2026, 10, 11, 2, 0, 0);
    const r = row(buildAttendance(open, night, at2am, at2am));
    expect(r.status).toBe('on_clock');
    expect(r.firstIn?.toISOString()).toBe(local(22, 0, 10));
    expect(r.lastOut).toBeNull();
    // Only the two hours after midnight belong to this day.
    expect(r.daySeconds).toBe(2 * 3600);
    // Tuesday and Wednesday are in the same week: four hours so far.
    expect(r.weekSeconds).toBe(4 * 3600);
  });

  it('gives each day its own part of the hours', () => {
    const done = [entry('elena', local(22, 0, 10), local(6, 0, 11))];
    const later = new Date(2026, 10, 11, 15, 0, 0);
    const first = row(buildAttendance(done, night, new Date(2026, 10, 10, 12), later));
    const second = row(buildAttendance(done, night, new Date(2026, 10, 11, 12), later));
    expect(first.status).toBe('out');
    expect(first.daySeconds).toBe(2 * 3600);
    expect(first.lastOut?.toISOString()).toBe(local(6, 0, 11));
    expect(second.status).toBe('out');
    expect(second.daySeconds).toBe(6 * 3600);
    expect(second.firstIn?.toISOString()).toBe(local(22, 0, 10));
    expect(second.weekSeconds).toBe(8 * 3600);
  });

  it('does not count a shift that ended at midnight on the next day', () => {
    const done = [entry('elena', local(20, 0, 10), new Date(2026, 10, 11, 0, 0, 0).toISOString())];
    const r = row(buildAttendance(done, night, new Date(2026, 10, 11, 12), new Date(2026, 10, 11, 15)));
    expect(r.status).toBe('absent');
    expect(r.daySeconds).toBe(0);
    expect(r.weekSeconds).toBe(4 * 3600);
  });

  it('counts only the part of a shift that is inside the week', () => {
    // Sunday 8 Nov 22:00 to Monday 9 Nov 03:00: three hours belong to this week.
    const done = [entry('elena', local(22, 0, 8), local(3, 0, 9))];
    const r = row(buildAttendance(done, night, new Date(2026, 10, 11, 12), new Date(2026, 10, 11, 15)));
    expect(r.weekSeconds).toBe(3 * 3600);
  });

  it('marks the automatic clock-out on the day it happened', () => {
    // Forgotten at 10:00 on Tuesday, closed for them 24 hours later.
    const forgotten = [entry('elena', local(10, 0, 10), local(10, 0, 11), true)];
    const later = new Date(2026, 10, 11, 15, 0, 0);
    expect(row(buildAttendance(forgotten, night, new Date(2026, 10, 10, 12), later)).status).toBe('out');
    expect(row(buildAttendance(forgotten, night, new Date(2026, 10, 11, 12), later)).status).toBe('auto_out');
  });
});
