// CRM follow-ups: which list a follow-up belongs in (overdue, today, …).
import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_BUCKETS,
  followUpBucket,
  followUpCounts,
  groupFollowUps,
} from '@/lib/crmFollowUps';
import type { CrmTask, TaskPriority, TaskStatus } from '@/types/crmHub';

const TODAY = '2026-11-18';

/** Local-time date, so the tests do not depend on the machine's time zone. */
const at = (ymd: string, hour = 12, minute = 0): Date => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute);
};

const task = (
  id: string,
  dueDate: Date | null,
  over: { status?: TaskStatus; priority?: TaskPriority; completedAt?: Date | null } = {},
): CrmTask => ({
  id,
  organizationId: 'org',
  workspaceId: 'ws',
  ownerId: null,
  assignedTo: null,
  contactId: null,
  companyId: null,
  dealId: null,
  projectId: null,
  sharedTaskId: null,
  title: id,
  description: null,
  dueDate,
  priority: over.priority ?? 'medium',
  status: over.status ?? 'pending',
  completedAt: over.completedAt ?? null,
  createdAt: at('2026-11-01'),
  updatedAt: at('2026-11-01'),
});

const ids = (list: CrmTask[]) => list.map((t) => t.id);

describe('followUpBucket', () => {
  it('is overdue when it was due before today and is still open', () => {
    expect(followUpBucket(task('a', at('2026-11-17', 23, 59)), TODAY)).toBe('overdue');
    expect(followUpBucket(task('b', at('2026-10-02'), { status: 'in_progress' }), TODAY)).toBe('overdue');
  });

  it('is due today at any time of the day, even an hour that has passed', () => {
    expect(followUpBucket(task('a', at(TODAY, 0, 0)), TODAY)).toBe('today');
    expect(followUpBucket(task('b', at(TODAY, 23, 59)), TODAY)).toBe('today');
  });

  it('is upcoming from tomorrow onwards', () => {
    expect(followUpBucket(task('a', at('2026-11-19', 0, 0)), TODAY)).toBe('upcoming');
    expect(followUpBucket(task('b', at('2027-01-05')), TODAY)).toBe('upcoming');
  });

  it('has no date when none was set', () => {
    expect(followUpBucket(task('a', null), TODAY)).toBe('no_date');
  });

  it('is done once completed, whatever the due date', () => {
    expect(followUpBucket(task('a', at('2026-11-01'), { status: 'completed' }), TODAY)).toBe('done');
    expect(followUpBucket(task('b', null, { status: 'completed' }), TODAY)).toBe('done');
    expect(followUpBucket(task('c', at('2026-12-01'), { status: 'completed' }), TODAY)).toBe('done');
  });
});

describe('groupFollowUps', () => {
  it('always returns every bucket, in display order', () => {
    const groups = groupFollowUps([], TODAY);
    expect(Object.keys(groups)).toEqual(['overdue', 'today', 'upcoming', 'no_date', 'done']);
    expect(FOLLOW_UP_BUCKETS).toEqual(['overdue', 'today', 'upcoming', 'no_date', 'done']);
    for (const bucket of FOLLOW_UP_BUCKETS) expect(groups[bucket]).toEqual([]);
  });

  it('puts each follow-up in exactly one bucket', () => {
    const all = [
      task('late', at('2026-11-10')),
      task('now', at(TODAY, 9)),
      task('soon', at('2026-11-25')),
      task('someday', null),
      task('finished', at('2026-11-10'), { status: 'completed' }),
    ];
    const groups = groupFollowUps(all, TODAY);
    expect(ids(groups.overdue)).toEqual(['late']);
    expect(ids(groups.today)).toEqual(['now']);
    expect(ids(groups.upcoming)).toEqual(['soon']);
    expect(ids(groups.no_date)).toEqual(['someday']);
    expect(ids(groups.done)).toEqual(['finished']);
  });

  it('lists the earliest due date first', () => {
    const groups = groupFollowUps(
      [
        task('o2', at('2026-11-16')),
        task('o1', at('2026-11-03')),
        task('t2', at(TODAY, 16)),
        task('t1', at(TODAY, 9)),
        task('u2', at('2026-12-20')),
        task('u1', at('2026-11-19')),
      ],
      TODAY,
    );
    expect(ids(groups.overdue)).toEqual(['o1', 'o2']);
    expect(ids(groups.today)).toEqual(['t1', 't2']);
    expect(ids(groups.upcoming)).toEqual(['u1', 'u2']);
  });

  it('lists urgent follow-ups first within a bucket', () => {
    const groups = groupFollowUps(
      [
        task('early', at('2026-11-03')),
        task('urgent', at('2026-11-16'), { priority: 'urgent' }),
        task('plain', null, { priority: 'high' }),
        task('urgent-undated', null, { priority: 'urgent' }),
      ],
      TODAY,
    );
    expect(ids(groups.overdue)).toEqual(['urgent', 'early']);
    expect(ids(groups.no_date)).toEqual(['urgent-undated', 'plain']);
  });

  it('keeps the given order when nothing else separates two follow-ups', () => {
    const groups = groupFollowUps([task('first', null), task('second', null), task('third', null)], TODAY);
    expect(ids(groups.no_date)).toEqual(['first', 'second', 'third']);
  });

  it('lists the most recently finished first, and does not push urgent ones up', () => {
    const groups = groupFollowUps(
      [
        task('old', null, { status: 'completed', completedAt: at('2026-11-02'), priority: 'urgent' }),
        task('new', null, { status: 'completed', completedAt: at('2026-11-17') }),
        task('unknown', null, { status: 'completed' }),
      ],
      TODAY,
    );
    expect(ids(groups.done)).toEqual(['new', 'old', 'unknown']);
  });

  it('does not change the list it was given', () => {
    const all = [task('b', at('2026-11-16')), task('a', at('2026-11-03'))];
    groupFollowUps(all, TODAY);
    expect(ids(all)).toEqual(['b', 'a']);
  });
});

describe('followUpCounts', () => {
  it('counts each bucket', () => {
    const counts = followUpCounts(
      [
        task('a', at('2026-11-10')),
        task('b', at('2026-11-11')),
        task('c', at(TODAY)),
        task('d', null),
        task('e', null, { status: 'completed' }),
      ],
      TODAY,
    );
    expect(counts).toEqual({ overdue: 2, today: 1, upcoming: 0, no_date: 1, done: 1 });
  });
});
