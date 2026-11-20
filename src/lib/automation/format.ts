// The words the automation screens use: when a step starts, how long ago, money, statuses, actions.
import type {
  LeadStatus, ProposedAction, RunStatus, RunStep, RunStepStatus, RunSummary, StepStart,
} from '../../../api/_automation/shared/types';
import type { StatusTone } from '@/components/common/StatusPill';

export const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

// ── When a step starts ──────────────────────────────────────────────────

/** When a step of the chain starts, in words. */
export function startsInWords(starts: StepStart): string {
  switch (starts.type) {
    case 'after_previous': return 'Straight away';
    case 'no_reply_days': return `After ${plural(starts.days, 'day', 'days')} with no reply`;
    case 'on_reply': return 'When the lead replies';
    case 'on_deal_won': return 'When the deal is won';
  }
}

// ── Time ────────────────────────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const timeOf = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string =>
  parts.find((p) => p.type === type)?.value ?? '';

function partsOf(time: number, timeZone?: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(time);
}

/** "Mon 09:02": the day and time a step ran. `timeZone` is the person's own unless one is given. */
export function dayTime(iso: string | null | undefined, timeZone?: string): string {
  const time = timeOf(iso);
  if (Number.isNaN(time)) return '';
  const parts = partsOf(time, timeZone);
  return `${part(parts, 'weekday')} ${part(parts, 'hour')}:${part(parts, 'minute')}`;
}

/** "Mon 9 Nov, 09:02", with the year when it is not this year. */
export function dateTime(iso: string | null | undefined, timeZone?: string, now: number = Date.now()): string {
  const time = timeOf(iso);
  if (Number.isNaN(time)) return '';
  const parts = partsOf(time, timeZone);
  const year = part(parts, 'year');
  const sameYear = year === part(partsOf(now, timeZone), 'year');
  return `${part(parts, 'weekday')} ${part(parts, 'day')} ${part(parts, 'month')}${sameYear ? '' : ` ${year}`}, ${part(parts, 'hour')}:${part(parts, 'minute')}`;
}

/** "12 minutes ago", "Yesterday", and the date once it is more than a month ago. */
export function ago(iso: string | null | undefined, now: number = Date.now(), timeZone?: string): string {
  const time = timeOf(iso);
  if (Number.isNaN(time)) return '';
  const passed = Math.max(0, now - time);
  if (passed < MINUTE) return 'Just now';
  if (passed < HOUR) return `${plural(Math.floor(passed / MINUTE), 'minute', 'minutes')} ago`;
  if (passed < DAY) return `${plural(Math.floor(passed / HOUR), 'hour', 'hours')} ago`;
  if (passed < 2 * DAY) return 'Yesterday';
  if (passed < 31 * DAY) return `${Math.floor(passed / DAY)} days ago`;
  const parts = partsOf(time, timeZone);
  return `${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}`;
}

/** How long something has waited: "2 hours", "9 days". */
export function howLong(iso: string | null | undefined, now: number = Date.now()): string {
  const time = timeOf(iso);
  if (Number.isNaN(time)) return '';
  const passed = Math.max(0, now - time);
  if (passed < MINUTE) return 'less than a minute';
  if (passed < HOUR) return plural(Math.floor(passed / MINUTE), 'minute', 'minutes');
  if (passed < DAY) return plural(Math.floor(passed / HOUR), 'hour', 'hours');
  return plural(Math.floor(passed / DAY), 'day', 'days');
}

// ── Money ───────────────────────────────────────────────────────────────

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** AI spend is kept in US cents and shown in US dollars. */
export const dollars = (cents: number): string => USD.format((Number.isFinite(cents) ? cents : 0) / 100);

/** The share of the monthly limit that is spent, as a whole percent. Null when no limit is set. */
export function budgetPercent(spentCents: number, budgetCents: number): number | null {
  if (!(budgetCents > 0)) return null;
  const share = (Math.max(0, spentCents) / budgetCents) * 100;
  // Anything spent shows as at least 1%, so "0%" always means nothing was spent.
  return share > 0 && share < 1 ? 1 : Math.round(share);
}

// ── Statuses ────────────────────────────────────────────────────────────

export const RUN_STATUSES: readonly RunStatus[] = ['running', 'waiting', 'needs_approval', 'finished', 'stopped', 'failed'];

export const RUN_STATUS: Record<RunStatus, { label: string; tone: StatusTone }> = {
  running: { label: 'Running', tone: 'info' },
  waiting: { label: 'Waiting', tone: 'neutral' },
  needs_approval: { label: 'Needs approval', tone: 'warning' },
  finished: { label: 'Finished', tone: 'success' },
  stopped: { label: 'Stopped', tone: 'muted' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const STEP_STATUS: Record<RunStepStatus, { label: string; tone: StatusTone }> = {
  done: { label: 'Done', tone: 'success' },
  waiting_approval: { label: 'Needs approval', tone: 'warning' },
  rejected: { label: 'Not approved', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'muted' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** A run that has not ended: it can still be stopped, and a reply still matters to it. */
export const isOpen = (status: RunStatus): boolean => status === 'running' || status === 'waiting' || status === 'needs_approval';

export const LEAD_STATUS_WORD: Record<LeadStatus, string> = {
  new: 'New',
  open: 'Open',
  in_progress: 'In progress',
  open_deal: 'Open deal',
  unqualified: 'Unqualified',
  attempted_to_contact: 'Attempted to contact',
  connected: 'Connected',
  bad_timing: 'Bad timing',
};

// ── Runs ────────────────────────────────────────────────────────────────

export type RunFilter = RunStatus | 'all';

/** How many runs there are in each status, and in all. */
export function statusCounts(runs: readonly RunSummary[]): Record<RunFilter, number> {
  const counts: Record<RunFilter, number> = { all: runs.length, running: 0, waiting: 0, needs_approval: 0, finished: 0, stopped: 0, failed: 0 };
  for (const run of runs) counts[run.status] += 1;
  return counts;
}

/** The runs in one status whose subject or automation has the words searched for. */
export function filterRuns(runs: readonly RunSummary[], status: RunFilter, query: string): RunSummary[] {
  const words = query.trim().toLowerCase();
  return runs.filter((run) =>
    (status === 'all' || run.status === status)
    && (!words || run.subject.toLowerCase().includes(words) || run.automationName.toLowerCase().includes(words)));
}

/** The newest thing any agent did in a run, or null while nothing was done. */
export function lastDone(steps: readonly RunStep[]): { agentName: string; text: string; when: string } | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i]!;
    if (step.did.length > 0) return { agentName: step.agentName, text: step.did[step.did.length - 1]!, when: step.when };
  }
  return null;
}

/**
 * Which pending approvals belong under which step of one run. An approval
 * names its agent, not its step: it goes to the waiting step of that agent,
 * and one that matches none goes to the first step that is waiting.
 */
export function approvalsForSteps<A extends { runId: string; agentName: string; stepN?: number }>(
  runId: string, steps: readonly RunStep[], approvals: readonly A[],
): Map<string, A[]> {
  const waiting = steps.filter((step) => step.status === 'waiting_approval');
  const byStep = new Map<string, A[]>();
  if (waiting.length === 0) return byStep;
  for (const approval of approvals) {
    if (approval.runId !== runId) continue;
    // The step the approval names; an older reply without one falls back to the agent's name.
    const step = waiting.find((s) => s.n === approval.stepN) ?? waiting.find((s) => s.agentName === approval.agentName) ?? waiting[0]!;
    byStep.set(step.id, [...(byStep.get(step.id) ?? []), approval]);
  }
  return byStep;
}

// ── Actions ─────────────────────────────────────────────────────────────

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** What an agent is asking to do, as one sentence. */
export function describeAction(action: ProposedAction): string {
  switch (action.type) {
    case 'add_note': return `Add this note to the lead: “${action.text}”`;
    case 'set_lead_status': return `Change the lead’s step to “${LEAD_STATUS_WORD[action.status] ?? action.status}”.`;
    case 'create_follow_up': {
      const due = action.dueInDays <= 0 ? 'due today' : `due in ${plural(action.dueInDays, 'day', 'days')}`;
      return `Create the follow-up “${action.title}”, ${due}.${action.note.trim() ? ` Note: ${action.note.trim()}` : ''}`;
    }
    case 'send_email': return `Send an email with the subject “${action.subject}”.`;
    case 'create_deal':
      return action.value == null
        ? `Open the deal “${action.name}”.`
        : `Open the deal “${action.name}” with a value of ${WHOLE.format(action.value)}.`;
    case 'move_deal': return `Move the deal to the stage “${action.stage}”.`;
    case 'mark_deal': return `Mark the deal as ${action.result}.${action.reason.trim() ? ` Reason: ${action.reason.trim()}` : ''}`;
    case 'create_project': return 'Create the project from this workspace’s project template.';
    case 'notify_owner': return `Tell the lead’s owner: “${action.text}”`;
  }
}

/**
 * What an approval is sent with. An email that was edited goes as it now
 * reads; anything else, and an email left as the agent wrote it, sends nothing.
 */
export function approveBody(
  action: ProposedAction, edited: { subject: string; body: string } | null,
): { subject?: string; body?: string } {
  if (action.type !== 'send_email' || !edited) return {};
  if (edited.subject === action.subject && edited.body === action.body) return {};
  return { subject: edited.subject, body: edited.body };
}
