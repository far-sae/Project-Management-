// The words the automation screens use: when a step starts, how long ago, money, statuses, actions.
import { describe, expect, it } from 'vitest';
import type { ProposedAction, Run, RunStatus, RunSummary } from '../../../../api/_automation/shared/types';
import {
  LEAD_STATUS_WORD, RUN_STATUS, RUN_STATUSES, STEP_STATUS, ago, approvalsForSteps, approveBody, budgetPercent, dateTime, dayTime, describeAction,
  dollars, filterRuns, howLong, isOpen, lastDone, plural, startsInWords, statusCounts,
} from '@/lib/automation/format';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const before = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 'r1', automationId: 'a1', automationName: 'New lead to project', contactId: 'c1', dealId: null, projectId: null,
  subject: 'Northwind Studio', status: 'running', result: 'Researching the lead', stepsDone: 1, stepCount: 6,
  started: '2026-11-09T09:02:00Z', finished: null, updated: '2026-11-09T09:03:00Z', ...over,
});

describe('startsInWords', () => {
  it('says when each kind of step starts', () => {
    expect(startsInWords({ type: 'after_previous' })).toBe('Straight away');
    expect(startsInWords({ type: 'no_reply_days', days: 3 })).toBe('After 3 days with no reply');
    expect(startsInWords({ type: 'no_reply_days', days: 1 })).toBe('After 1 day with no reply');
    expect(startsInWords({ type: 'on_reply' })).toBe('When the lead replies');
    expect(startsInWords({ type: 'on_deal_won' })).toBe('When the deal is won');
  });
});

describe('how long ago', () => {
  it('counts minutes, hours and days, and names yesterday', () => {
    expect(ago(before(20_000), NOW)).toBe('Just now');
    expect(ago(before(MIN), NOW)).toBe('1 minute ago');
    expect(ago(before(12 * MIN), NOW)).toBe('12 minutes ago');
    expect(ago(before(HOUR), NOW)).toBe('1 hour ago');
    expect(ago(before(2 * HOUR), NOW)).toBe('2 hours ago');
    expect(ago(before(30 * HOUR), NOW)).toBe('Yesterday');
    expect(ago(before(3 * DAY), NOW)).toBe('3 days ago');
  });

  it('gives the date once it is more than a month ago, and nothing for a date it cannot read', () => {
    expect(ago('2026-08-03T10:00:00Z', NOW, 'UTC')).toBe('3 Aug 2026');
    expect(ago('not a date', NOW)).toBe('');
    // A clock that is a little behind the server never says "in the future".
    expect(ago(new Date(NOW + 5000).toISOString(), NOW)).toBe('Just now');
  });

  it('says how long something has waited, without "ago"', () => {
    expect(howLong(before(30_000), NOW)).toBe('less than a minute');
    expect(howLong(before(12 * MIN), NOW)).toBe('12 minutes');
    expect(howLong(before(2 * HOUR), NOW)).toBe('2 hours');
    expect(howLong(before(DAY), NOW)).toBe('1 day');
    expect(howLong(before(9 * DAY), NOW)).toBe('9 days');
  });
});

describe('dates', () => {
  it('writes the weekday and time, and the full date and time', () => {
    expect(dayTime('2026-11-09T09:02:00Z', 'UTC')).toBe('Mon 09:02');
    expect(dateTime('2026-11-09T09:02:00Z', 'UTC')).toBe('Mon 9 Nov, 09:02');
    expect(dateTime('2025-11-17T16:10:00Z', 'UTC', NOW)).toBe('Mon 17 Nov 2025, 16:10');
    expect(dayTime('nonsense', 'UTC')).toBe('');
    expect(dateTime(null, 'UTC')).toBe('');
  });
});

describe('money', () => {
  it('writes AI spend in US dollars', () => {
    expect(dollars(0)).toBe('$0.00');
    expect(dollars(42)).toBe('$0.42');
    expect(dollars(310)).toBe('$3.10');
    expect(dollars(123456)).toBe('$1,234.56');
  });

  it('works out the share of the monthly limit, and has none when no limit is set', () => {
    expect(budgetPercent(310, 1000)).toBe(31);
    expect(budgetPercent(0, 1000)).toBe(0);
    expect(budgetPercent(1, 100000)).toBe(1);
    expect(budgetPercent(1500, 1000)).toBe(150);
    expect(budgetPercent(50, 0)).toBeNull();
  });
});

describe('statuses', () => {
  it('has a word and a tone for every run and step status', () => {
    expect(RUN_STATUS.needs_approval).toEqual({ label: 'Needs approval', tone: 'warning' });
    expect(RUN_STATUS.finished).toEqual({ label: 'Finished', tone: 'success' });
    expect(RUN_STATUS.failed.tone).toBe('danger');
    expect(RUN_STATUSES.map((s) => RUN_STATUS[s].label)).toEqual(['Running', 'Waiting', 'Needs approval', 'Finished', 'Stopped', 'Failed']);
    expect(STEP_STATUS.waiting_approval.label).toBe('Needs approval');
    expect(STEP_STATUS.rejected.label).toBe('Not approved');
    expect(LEAD_STATUS_WORD.attempted_to_contact).toBe('Attempted to contact');
  });

  it('knows which runs can still be stopped or answered', () => {
    const open: RunStatus[] = ['running', 'waiting', 'needs_approval'];
    expect(RUN_STATUSES.filter(isOpen)).toEqual(open);
  });

  it('counts runs per status', () => {
    const counts = statusCounts([summary(), summary({ id: 'r2' }), summary({ id: 'r3', status: 'finished' })]);
    expect(counts.all).toBe(3);
    expect(counts.running).toBe(2);
    expect(counts.finished).toBe(1);
    expect(counts.failed).toBe(0);
  });
});

describe('filterRuns', () => {
  const runs = [
    summary(),
    summary({ id: 'r2', subject: 'Harbour Dental', status: 'needs_approval' }),
    summary({ id: 'r3', subject: 'Jon Petrov', automationName: 'Trade show leads', status: 'stopped' }),
  ];
  it('finds by who the run is about or by the automation, whatever the case', () => {
    expect(filterRuns(runs, 'all', 'harbour').map((r) => r.id)).toEqual(['r2']);
    expect(filterRuns(runs, 'all', '  TRADE ').map((r) => r.id)).toEqual(['r3']);
    expect(filterRuns(runs, 'all', '').map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });
  it('keeps one status when asked', () => {
    expect(filterRuns(runs, 'stopped', '').map((r) => r.id)).toEqual(['r3']);
    expect(filterRuns(runs, 'stopped', 'harbour')).toEqual([]);
  });
});

describe('describeAction', () => {
  const cases: Array<[ProposedAction, string]> = [
    [{ type: 'add_note', text: 'Design studio, about 20 people.' }, 'Add this note to the lead: “Design studio, about 20 people.”'],
    [{ type: 'set_lead_status', status: 'unqualified' }, 'Change the lead’s step to “Unqualified”.'],
    [{ type: 'create_follow_up', title: 'Call Elena', dueInDays: 2, note: '' }, 'Create the follow-up “Call Elena”, due in 2 days.'],
    [{ type: 'create_follow_up', title: 'Call Elena', dueInDays: 0, note: 'She asked for Thursday.' }, 'Create the follow-up “Call Elena”, due today. Note: She asked for Thursday.'],
    [{ type: 'send_email', subject: 'Hello', body: 'Hi' }, 'Send an email with the subject “Hello”.'],
    [{ type: 'create_deal', name: 'Northwind website', value: 12000 }, 'Open the deal “Northwind website” with a value of 12,000.'],
    [{ type: 'create_deal', name: 'Northwind website', value: null }, 'Open the deal “Northwind website”.'],
    [{ type: 'move_deal', stage: 'Proposal' }, 'Move the deal to the stage “Proposal”.'],
    [{ type: 'mark_deal', result: 'won', reason: 'Signed on the 18th' }, 'Mark the deal as won. Reason: Signed on the 18th'],
    [{ type: 'mark_deal', result: 'lost', reason: '' }, 'Mark the deal as lost.'],
    [{ type: 'create_project' }, 'Create the project from this workspace’s project template.'],
    [{ type: 'notify_owner', text: 'The lead asked for a call.' }, 'Tell the lead’s owner: “The lead asked for a call.”'],
  ];
  it.each(cases)('%o', (action, sentence) => {
    expect(describeAction(action)).toBe(sentence);
  });
});

describe('approveBody', () => {
  const email: ProposedAction = { type: 'send_email', subject: 'Hello', body: 'Hi Priya' };
  it('sends nothing extra when the email was not changed', () => {
    expect(approveBody(email, { subject: 'Hello', body: 'Hi Priya' })).toEqual({});
    expect(approveBody(email, null)).toEqual({});
    expect(approveBody({ type: 'create_project' }, { subject: 'x', body: 'y' })).toEqual({});
  });
  it('sends the email as edited when any of it changed', () => {
    expect(approveBody(email, { subject: 'Hello', body: 'Hi Priya, one more thing.' })).toEqual({ subject: 'Hello', body: 'Hi Priya, one more thing.' });
    expect(approveBody(email, { subject: 'Hello again', body: 'Hi Priya' })).toEqual({ subject: 'Hello again', body: 'Hi Priya' });
  });
});

describe('lastDone', () => {
  const step = (n: number, agentName: string, did: string[]): Run['steps'][number] => ({
    id: `s${n}`, n, agentId: `ag${n}`, agentName, status: 'done', received: '', decided: '', did, approvedBy: null, when: '2026-11-09T09:02:00Z',
  });
  it('is the newest thing any agent did', () => {
    expect(lastDone([step(1, 'Researcher', ['Wrote the summary on the lead']), step(2, 'Qualifier', ['Added a note', 'Marked the lead Qualified']), step(3, 'Writer', [])]))
      .toEqual({ agentName: 'Qualifier', text: 'Marked the lead Qualified', when: '2026-11-09T09:02:00Z' });
  });
  it('is nothing while no agent has done anything', () => {
    expect(lastDone([step(1, 'Researcher', [])])).toBeNull();
    expect(lastDone([])).toBeNull();
  });
});

describe('approvalsForSteps by step number', () => {
  it('puts an approval under the step it names, even when two waiting steps share an agent', () => {
    const steps = [
      { id: 's3', n: 3, agentName: 'Writer', status: 'waiting_approval' },
      { id: 's4', n: 4, agentName: 'Writer', status: 'waiting_approval' },
    ] as never;
    const byStep = approvalsForSteps('r1', steps, [{ runId: 'r1', agentName: 'Writer', stepN: 4 }]);
    expect([...byStep.keys()]).toEqual(['s4']);
  });
});

describe('approvalsForSteps', () => {
  const step = (n: number, agentName: string, status: Run['steps'][number]['status']): Run['steps'][number] => ({
    id: `s${n}`, n, agentId: `ag${n}`, agentName, status, received: '', decided: '', did: [], approvedBy: null, when: '2026-11-09T09:02:00Z',
  });
  const steps = [step(1, 'Researcher', 'done'), step(2, 'Writer', 'waiting_approval')];
  it('puts this run’s approvals under the step that waits, and leaves other runs out', () => {
    const mine = { id: 'ap1', runId: 'r1', agentName: 'Writer' };
    const other = { id: 'ap2', runId: 'r9', agentName: 'Writer' };
    const renamed = { id: 'ap3', runId: 'r1', agentName: 'Copywriter' };
    const byStep = approvalsForSteps('r1', steps, [mine, other, renamed]);
    expect([...byStep.keys()]).toEqual(['s2']);
    expect(byStep.get('s2')!.map((a) => a.id)).toEqual(['ap1', 'ap3']);
  });
  it('has nothing when no step is waiting', () => {
    expect(approvalsForSteps('r1', [step(1, 'Researcher', 'done')], [{ runId: 'r1', agentName: 'Researcher' }]).size).toBe(0);
  });
});

describe('plural', () => {
  it('picks the word for the count', () => {
    expect(plural(1, 'run', 'runs')).toBe('1 run');
    expect(plural(0, 'run', 'runs')).toBe('0 runs');
  });
});
