/**
 * The assistant and agents screens' pure helpers: editing an automation draft,
 * converting between a saved automation and a draft, and the small wording
 * rules both screens share. Nothing here touches the server or the page.
 */
import {
  RIGHTS,
  type Agent, type AgentInput, type Automation, type AutomationDraft, type AutomationInput, type AutomationStep,
  type Autonomy, type DraftAgent, type Right, type StepStart,
} from '../../../api/_automation/shared/types';

// ── Lists ───────────────────────────────────────────────────────────────

/** The list with the item at `index` moved one place up (-1) or down (1). The same list when it cannot move. */
export function moveItem<T>(items: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// ── Editing a draft ─────────────────────────────────────────────────────

export function moveDraftStep(draft: AutomationDraft, index: number, by: -1 | 1): AutomationDraft {
  const steps = moveItem(draft.steps, index, by);
  return steps === draft.steps ? draft : { ...draft, steps };
}

export function removeDraftStep(draft: AutomationDraft, index: number): AutomationDraft {
  if (index < 0 || index >= draft.steps.length) return draft;
  return { ...draft, steps: draft.steps.filter((_, i) => i !== index) };
}

export function setDraftStepStart(draft: AutomationDraft, index: number, starts: StepStart): AutomationDraft {
  if (index < 0 || index >= draft.steps.length) return draft;
  return { ...draft, steps: draft.steps.map((step, i) => (i === index ? { ...step, starts } : step)) };
}

export function renameDraft(draft: AutomationDraft, name: string): AutomationDraft {
  return { ...draft, name };
}

export function setSkipImports(draft: AutomationDraft, skipImports: boolean): AutomationDraft {
  return { ...draft, trigger: { ...draft.trigger, skipImports } };
}

// ── When a step starts ──────────────────────────────────────────────────

export type StartKind = StepStart['type'];

export const DEFAULT_NO_REPLY_DAYS = 3;
export const MAX_NO_REPLY_DAYS = 60;

/** The choices of the "when it starts" control, in the order they are offered. */
export const START_CHOICES: ReadonlyArray<{ kind: StartKind; label: string }> = [
  { kind: 'after_previous', label: 'Straight away' },
  { kind: 'no_reply_days', label: 'After days with no reply' },
  { kind: 'on_reply', label: 'When the lead replies' },
  { kind: 'on_deal_won', label: 'When the deal is won' },
];

/** A start of the kind picked. `days` only matters for "after days with no reply" and is kept between 1 and 60. */
export function startOfKind(kind: StartKind, days?: number): StepStart {
  if (kind !== 'no_reply_days') return { type: kind };
  const whole = Number.isFinite(days) ? Math.round(days as number) : DEFAULT_NO_REPLY_DAYS;
  return { type: 'no_reply_days', days: Math.min(MAX_NO_REPLY_DAYS, Math.max(1, whole)) };
}

/** "after 3 days with no reply": when a step starts, as the end of a sentence. */
export function startPhrase(starts: StepStart, first: boolean): string {
  switch (starts.type) {
    case 'no_reply_days': return `after ${starts.days} ${starts.days === 1 ? 'day' : 'days'} with no reply`;
    case 'on_reply': return 'when the lead replies';
    case 'on_deal_won': return 'when the deal is won';
    default: return first ? 'as soon as the lead is added' : 'straight away';
  }
}

/** "Starts after 3 days with no reply". */
export function startInWords(starts: StepStart, first: boolean): string {
  return `Starts ${startPhrase(starts, first)}`;
}

// ── Whether a step waits for a person ───────────────────────────────────

export type ApprovalReading = {
  kind: 'automatic' | 'needs' | 'may';
  label: 'Automatic' | 'Needs approval' | 'May need approval';
  /** One sentence on why, for the pill's hint. */
  why: string;
};

const AUTOMATIC = (why: string): ApprovalReading => ({ kind: 'automatic', label: 'Automatic', why });
const NEEDS = (why: string): ApprovalReading => ({ kind: 'needs', label: 'Needs approval', why });
const MAY = (why: string): ApprovalReading => ({ kind: 'may', label: 'May need approval', why });

/**
 * What to say about a step before it has run. The server decides each action
 * when it happens, from the agent's "ask first" switch and the workspace
 * rules, so this only says "needs" or "automatic" where that is certain and
 * "may" where it depends on what the agent chooses to do, or on rules this
 * screen could not read (`autonomy` left out).
 */
export function approvalReading(agent: Pick<DraftAgent, 'rights' | 'askFirst'>, autonomy?: Autonomy | null): ApprovalReading {
  if (agent.askFirst) return NEEDS('This agent asks first: everything it does waits for a person.');
  if (autonomy === 'suggest') return NEEDS('The workspace rules make every action wait for a person.');
  const emails = agent.rights.includes('send_email');
  const deals = agent.rights.includes('change_deals_projects');
  if (autonomy === 'full') return AUTOMATIC('The workspace rules let agents act without asking.');
  if (autonomy === 'ask_external') {
    if (emails) return NEEDS('Its emails wait for a person before they are sent.');
    if (deals) return MAY('Marking a deal won or lost waits for a person. The rest it does on its own.');
    return AUTOMATIC('It sends nothing and marks no deal, so nothing waits.');
  }
  if (emails || deals) return MAY('Sending an email or marking a deal won or lost waits for a person when the workspace rules say so.');
  return AUTOMATIC('It sends nothing and marks no deal.');
}

// ── Converting ──────────────────────────────────────────────────────────

/** The first sentence of a longer text, cut to `max` characters. */
export function oneLine(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  const first = end >= 0 ? flat.slice(0, end + 1) : flat;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export function draftAgentOf(agent: Agent): DraftAgent {
  return { id: agent.id, name: agent.name, job: agent.job, rights: [...agent.rights], askFirst: agent.askFirst };
}

/**
 * A saved automation as a draft the assistant and the person can change.
 * `does` gives a one-line description per agent id where the server has one;
 * otherwise the first sentence of the agent's job is used.
 */
export function draftFromAutomation(
  automation: Pick<Automation, 'name' | 'trigger' | 'steps'>,
  agents: Agent[],
  does: Record<string, string> = {},
): AutomationDraft {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return {
    name: automation.name,
    trigger: { ...automation.trigger },
    steps: automation.steps.map((step) => {
      const agent = byId.get(step.agentId);
      return {
        agent: agent ? draftAgentOf(agent) : { id: step.agentId, name: 'Removed agent', job: '', rights: [], askFirst: false },
        starts: step.starts,
        does: does[step.agentId] || (agent ? oneLine(agent.job) : ''),
        gives: '',
      };
    }),
  };
}

/**
 * The draft as it stands once the server has saved it. Saving creates the
 * draft's new agents, so each step now names a real agent: without their ids a
 * second save would create them again. The wording the person saw is kept.
 */
export function draftAfterSave(local: AutomationDraft, saved: Pick<Automation, 'name' | 'trigger' | 'steps'>): AutomationDraft {
  return {
    name: saved.name,
    trigger: { ...saved.trigger },
    steps: saved.steps.map((step, i) => {
      const mine = local.steps[i];
      return {
        agent: mine
          ? { ...mine.agent, id: step.agentId }
          : { id: step.agentId, name: 'Agent', job: '', rights: [], askFirst: false },
        starts: step.starts,
        does: mine?.does ?? '',
        gives: mine?.gives ?? '',
      };
    }),
  };
}

/** What a saved automation's chain is saved with, optionally with other steps. */
export function automationInputOf(automation: Pick<Automation, 'name' | 'trigger' | 'steps'>, steps?: AutomationStep[]): AutomationInput {
  return { name: automation.name, trigger: automation.trigger, steps: steps ?? automation.steps };
}

export function stepsWithout(steps: AutomationStep[], stepId: string): AutomationStep[] {
  return steps.filter((step) => step.id !== stepId);
}

/** The chain with one more step at the end. */
export function stepsWithAgent(steps: AutomationStep[], agentId: string, starts: StepStart, id: string): AutomationStep[] {
  return [...steps, { id, agentId, starts }];
}

/** An id for a step added in the browser. */
export function newStepId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Falls through to the plain id below.
  }
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── An agent's form ─────────────────────────────────────────────────────

export const BLANK_AGENT: AgentInput = { name: '', job: '', rights: [], askFirst: false };

export function agentInputOf(agent: Agent): AgentInput {
  return { name: agent.name, job: agent.job, rights: [...agent.rights], askFirst: agent.askFirst };
}

export function sameAgentInput(a: AgentInput, b: AgentInput): boolean {
  return a.name === b.name && a.job === b.job && a.askFirst === b.askFirst
    && a.rights.length === b.rights.length && a.rights.every((right) => b.rights.includes(right));
}

/** The rights with one switched on or off, in the order the list of rights has. */
export function toggleRight(rights: Right[], key: Right, on: boolean): Right[] {
  return RIGHTS.map((right) => right.key).filter((right) => (right === key ? on : rights.includes(right)));
}

const UNDOABLE: Partial<Record<Right, string>> = {
  change_lead_step: 'changes the lead’s step',
  add_notes_followups: 'adds notes and follow-ups',
  look_up_web: 'looks the company up on the web',
};

const joined = (parts: string[]): string =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** What the "Ask me before it acts" switch means for an agent with these rights. */
export function askFirstSentence(name: string, rights: Right[], askFirst: boolean): string {
  if (askFirst) return `On: everything ${name.trim() || 'this agent'} wants to do waits for a person to approve it.`;
  if (rights.includes('send_email') || rights.includes('change_deals_projects')) {
    return 'Off: it acts alone where the workspace rules allow it. Sending an email or marking a deal won or lost still waits for a person when the rules say so.';
  }
  const does = RIGHTS.map((right) => right.key).filter((right) => rights.includes(right)).map((right) => UNDOABLE[right] ?? '').filter(Boolean);
  if (does.length === 0) return 'Off: this agent can only read, so there is nothing to approve.';
  return `Off for this agent: it only ${joined(does)}, which can be undone.`;
}

// ── Wording ─────────────────────────────────────────────────────────────

const COUNT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const PLACE_WORDS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

/** "Two things I assumed, change them if they are wrong:" */
export function assumptionsHeading(count: number): string {
  if (count === 1) return 'One thing I assumed, change it if it is wrong:';
  return `${COUNT_WORDS[count] ?? count} things I assumed, change them if they are wrong:`;
}

/** "Third in the chain", for a 1-based position. */
export function positionInWords(n: number): string {
  return `${PLACE_WORDS[n - 1] ?? `Number ${n}`} in the chain`;
}

export function ranThisMonth(count: number): string {
  if (count <= 0) return 'has not run this month';
  return count === 1 ? 'ran once this month' : `ran ${count} times this month`;
}
