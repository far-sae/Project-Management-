// Made-up automation data for the overview, runs and lead card tests. Every name here is invented.
import type {
  Approval, ChainStep, Overview, Run, RunStep, RunSummary,
} from '../../../../api/_automation/shared/types';

/** The moment the tests pretend it is. */
export const NOW = '2026-11-20T12:00:00Z';
export const before = (minutes: number): string => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

export const chainStep = (n: number, agentName: string, over: Partial<ChainStep> = {}): ChainStep => ({
  n, agentId: `ag${n}`, agentName, does: `${agentName} does its one job.`, starts: { type: 'after_previous' }, asks: false, ...over,
});

export const chain: ChainStep[] = [
  chainStep(1, 'Researcher', { does: 'Reads the lead and their company and writes a short summary on the lead.' }),
  chainStep(2, 'Qualifier', { does: 'Marks the lead Qualified or Unqualified and says why.' }),
  chainStep(3, 'Writer', { does: 'Drafts the first email in your tone.', asks: true }),
  chainStep(4, 'Chaser', { does: 'Chases again when there is no reply.', starts: { type: 'no_reply_days', days: 3 }, asks: true }),
  chainStep(5, 'Deal keeper', { does: 'Opens the deal and moves its stage.', starts: { type: 'on_reply' }, asks: true }),
  chainStep(6, 'Project starter', { does: 'Creates the project with its tasks.', starts: { type: 'on_deal_won' } }),
];

export const approval = (over: Partial<Approval> = {}): Approval => ({
  id: 'ap1', runId: 'r2', agentName: 'Writer', what: 'Send the first email to Priya Nair', about: 'Harbour Dental',
  action: { type: 'send_email', subject: 'Your enquiry about a new website', body: 'Hi Priya,\n\nThank you for getting in touch.' },
  status: 'pending', created: before(120), canDecide: true, stepN: 3, to: 'priya@harbourdental.example', ...over,
});

export const wonApproval = (over: Partial<Approval> = {}): Approval => approval({
  id: 'ap2', runId: 'r1', agentName: 'Deal keeper', what: 'Mark “Northwind website” as won', about: 'Northwind Studio',
  action: { type: 'mark_deal', result: 'won', reason: 'Signed on the 18th' }, created: before(40), ...over,
});

export const runSummary = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 'r1', automationId: 'a1', automationName: 'New lead to project', contactId: 'c1', dealId: 'd1', projectId: 'p1',
  subject: 'Northwind Studio', status: 'finished', result: 'Project created with 5 tasks', stepsDone: 6, stepCount: 6,
  started: '2026-11-09T09:02:00Z', finished: '2026-11-17T16:10:00Z', updated: before(60), ...over,
});

export const runs: RunSummary[] = [
  runSummary(),
  runSummary({
    id: 'r2', contactId: 'c2', dealId: null, projectId: null, subject: 'Harbour Dental', status: 'needs_approval',
    result: 'Stopped at step 3: waiting for approval', stepsDone: 2, finished: null, started: before(125), updated: before(120),
  }),
  runSummary({
    id: 'r3', contactId: 'c3', dealId: null, projectId: null, subject: 'Fieldway Logistics', status: 'waiting',
    result: 'Follow-up created for Thursday', stepsDone: 3, finished: null, started: before(400), updated: before(180),
  }),
  runSummary({
    id: 'r4', contactId: 'c4', dealId: null, projectId: null, subject: 'Jon Petrov', automationName: 'Trade show leads',
    status: 'stopped', result: 'Marked unqualified: student enquiry', stepsDone: 2, stepCount: 4, finished: before(1500),
    started: before(1510), updated: before(1500),
  }),
];

export const overview = (over: Partial<Overview> = {}): Overview => ({
  setUp: true, enabled: true, role: 'Owner',
  stats: {
    automationsOn: 2, automationsPaused: 1, runsThisWeek: 48, finishedThisWeek: 46, stoppedThisWeek: 2,
    waitingApprovals: 2, oldestApproval: before(120), spentCents: 310, budgetCents: 1000,
  },
  automation: { id: 'a1', name: 'New lead to project', status: 'on' },
  chain,
  approvals: [approval(), wonApproval()],
  latestRuns: runs,
  ...over,
});

/** What the server answers before "Set up automation" was pressed. */
export const notSetUp = (role: Overview['role'] = 'Owner'): Overview => overview({
  setUp: false, enabled: false, role, automation: null, chain: [], approvals: [], latestRuns: [],
  stats: {
    automationsOn: 0, automationsPaused: 0, runsThisWeek: 0, finishedThisWeek: 0, stoppedThisWeek: 0,
    waitingApprovals: 0, oldestApproval: null, spentCents: 0, budgetCents: 0,
  },
});

export const runStep = (n: number, agentName: string, over: Partial<RunStep> = {}): RunStep => ({
  id: `s${n}`, n, agentId: `ag${n}`, agentName, status: 'done', received: `What step ${n} was handed`, decided: `What step ${n} decided`,
  did: [`Step ${n} did its job`], approvedBy: null, when: '2026-11-09T09:02:00Z', ...over,
});

/** The finished Northwind run: six steps, a project, a deal. */
export const finishedRun = (over: Partial<Run> = {}): Run => ({
  ...runSummary(),
  steps: [
    runStep(1, 'Researcher', {
      received: 'New lead: Elena Rossi, Marketing director, Northwind Studio',
      decided: 'Design studio, about 20 people, redesigning their website this year',
      did: ['Wrote the summary on the lead'],
    }),
    runStep(2, 'Qualifier', { did: ['Marked the lead Qualified'] }),
    runStep(3, 'Writer', { did: ['Sent the intro email from the Studio mailbox'], approvedBy: 'Sam' }),
    runStep(4, 'Chaser', { status: 'skipped', decided: 'The lead replied, so no chasing was needed', did: [] }),
    runStep(5, 'Deal keeper', { did: ['Opened the deal “Northwind website”', 'Marked the deal won'], approvedBy: 'Sam' }),
    runStep(6, 'Project starter', { did: ['Created the project with 5 tasks'], when: '2026-11-17T16:10:00Z' }),
  ],
  waitingFor: null,
  facts: { agentSteps: 6, approvals: 2, emailsSent: 1, costCents: 42 },
  canStop: false,
  canReply: false,
  ...over,
});

/** The Harbour Dental run, standing at the Writer's email. */
export const waitingRun = (over: Partial<Run> = {}): Run => ({
  ...runs[1]!,
  steps: [
    runStep(1, 'Researcher', { did: ['Wrote the summary on the lead'] }),
    runStep(2, 'Qualifier', { did: ['Marked the lead Qualified'] }),
    runStep(3, 'Writer', { status: 'waiting_approval', decided: 'Use the intro email and mention the new practice', did: [] }),
  ],
  waitingFor: 'Waiting for someone to approve the first email.',
  facts: { agentSteps: 3, approvals: 0, emailsSent: 0, costCents: 7 },
  canStop: true,
  canReply: true,
  ...over,
});

/** jsdom lacks a few things the dialogs and menus use. */
export function polyfillDom(): void {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  const g = globalThis as unknown as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
