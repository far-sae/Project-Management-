// Sample data for the assistant and agents screens: six agents, their chain, and what the server answers.
import type {
  Agent, AssistantReply, Automation, AutomationDraft, Overview, Right, StepStart, TestResult,
} from '../../../../api/_automation/shared/types';

const DAY = '2026-11-20T09:00:00.000Z';

export const agent = (over: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent => ({
  workspaceId: 'w',
  kind: 'custom',
  job: `${over.name} does its one job. Then it hands on.`,
  rights: [],
  askFirst: false,
  paused: false,
  archived: false,
  revision: 1,
  runsThisMonth: 0,
  created: DAY,
  updated: DAY,
  ...over,
});

export const researcher = agent({
  id: 'ag1', name: 'Researcher', kind: 'researcher',
  job: 'Look up the lead and their company. Write a five-line summary on the lead.',
  rights: ['add_notes_followups', 'look_up_web'], runsThisMonth: 40,
});
export const qualifier = agent({
  id: 'ag2', name: 'Qualifier', kind: 'qualifier',
  job: 'Decide whether this lead is a good fit for us. Give a score from 1 to 5 and one sentence explaining it.',
  rights: ['change_lead_step', 'add_notes_followups'], runsThisMonth: 31, revision: 4,
});
export const writer = agent({
  id: 'ag3', name: 'Writer', kind: 'writer',
  job: 'Write the intro email using the summary.',
  rights: ['send_email'], runsThisMonth: 1,
});
export const chaser = agent({
  id: 'ag4', name: 'Chaser', kind: 'chaser',
  job: 'Remind the lead owner when there is no reply.',
  rights: ['add_notes_followups'], askFirst: true,
});
export const greeter = agent({
  id: 'ag9', name: 'Greeter',
  job: 'Say thank you when a deal is won.',
  rights: ['add_notes_followups'],
});

export const allAgents = (): Agent[] => [researcher, qualifier, writer, chaser, greeter].map((a) => ({ ...a, rights: [...a.rights] }));

const step = (id: string, agentId: string, starts: StepStart = { type: 'after_previous' }) => ({ id, agentId, starts });

export const automation = (over: Partial<Automation> = {}): Automation => ({
  id: 'au1',
  workspaceId: 'w',
  name: 'New lead to project',
  status: 'draft',
  trigger: { type: 'lead_created', skipImports: false },
  steps: [
    step('s1', 'ag1'),
    step('s2', 'ag2'),
    step('s3', 'ag3'),
    step('s4', 'ag4', { type: 'no_reply_days', days: 3 }),
  ],
  revision: 7,
  created: DAY,
  updated: DAY,
  ...over,
});

export const overview = (over: Partial<Overview> = {}): Overview => ({
  setUp: true,
  enabled: true,
  role: 'Owner',
  stats: {
    automationsOn: 0, automationsPaused: 0, runsThisWeek: 0, finishedThisWeek: 0, stoppedThisWeek: 0,
    waitingApprovals: 0, oldestApproval: null, spentCents: 0, budgetCents: 2000,
  },
  automation: { id: 'au1', name: 'New lead to project', status: 'draft' },
  chain: [
    { n: 1, agentId: 'ag1', agentName: 'Researcher', does: 'Reads the lead and company; writes a summary', starts: { type: 'after_previous' }, asks: false },
    { n: 2, agentId: 'ag2', agentName: 'Qualifier', does: 'Decides good fit or not, with a reason', starts: { type: 'after_previous' }, asks: false },
    { n: 3, agentId: 'ag3', agentName: 'Writer', does: 'Drafts the first email', starts: { type: 'after_previous' }, asks: true },
    { n: 4, agentId: 'ag4', agentName: 'Chaser', does: 'Follows up until there is a reply', starts: { type: 'no_reply_days', days: 3 }, asks: true },
  ],
  approvals: [],
  latestRuns: [],
  ...over,
});

const draftStep = (
  name: string, rights: Right[], does: string, gives: string,
  starts: StepStart = { type: 'after_previous' }, askFirst = false, id: string | null = null,
) => ({ agent: { id, name, job: `${name}: ${does}`, rights, askFirst }, starts, does, gives });

export const draft = (over: Partial<AutomationDraft> = {}): AutomationDraft => ({
  name: 'New lead to project',
  trigger: { type: 'lead_created', skipImports: false },
  steps: [
    draftStep('Researcher', ['add_notes_followups', 'look_up_web'], 'Looks up the lead and their company.', 'the summary'),
    draftStep('Qualifier', ['change_lead_step'], 'Decides good fit or not, with the reason.', 'fit, score and reason'),
    draftStep('Writer', ['send_email'], 'Writes the intro email.', 'the email, once you approve it', { type: 'after_previous' }, true),
    draftStep('Chaser', ['add_notes_followups'], 'Reminds the lead owner.', 'reply or no reply', { type: 'no_reply_days', days: 3 }),
  ],
  ...over,
});

export const assistantReply = (over: Partial<AssistantReply> = {}): AssistantReply => ({
  reply: 'Done. I set this up as one automation with four agents. It is on the right.',
  assumptions: ['Emails wait for your approval before they are sent.', '“Good fit” means a company with a work email.'],
  draft: draft(),
  ...over,
});

export const testResult = (over: Partial<TestResult> = {}): TestResult => ({
  leadName: 'Priya Nair',
  steps: [
    {
      n: 1, agentName: 'Researcher', received: 'The new lead Priya Nair.', decided: 'Northwind is a design studio of 12 people.',
      wouldDo: ['Add a note with the summary'], needsApproval: false, stopsChain: false,
    },
    {
      n: 2, agentName: 'Writer', received: 'The summary.', decided: 'An intro email fits.',
      wouldDo: ['Send the intro email to priya@northwind.example'], needsApproval: true, stopsChain: false,
    },
  ],
  note: 'Step 4 waits 3 days for a reply.',
  ...over,
});

/** What the DOM lacks under jsdom and the app's menus and selects need. */
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

/** A reply the test settles when it chooses, as a slow server would. */
export const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
