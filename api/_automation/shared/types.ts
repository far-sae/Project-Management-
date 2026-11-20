/**
 * CRM automation: the shapes the server and the screens share.
 *
 * In one paragraph: an AUTOMATION belongs to one workspace. It starts when a
 * lead is added and is a chain of STEPS; each step is one AGENT doing one job
 * and handing its result to the next. One lead going through the chain is a
 * RUN. An agent never acts by itself: it proposes ACTIONS from a fixed list,
 * and the server carries them out only if the agent's RIGHTS and the
 * workspace's RULES allow it; otherwise the action waits as an APPROVAL.
 *
 * This file has no imports on purpose: the browser imports it by relative
 * path, exactly as it does for the documents server's shared types.
 */

// ── What an agent may do ────────────────────────────────────────────────

/** Reading the lead, its company and its deal is always allowed; everything else is a right. */
export type Right = "change_lead_step" | "add_notes_followups" | "send_email" | "change_deals_projects" | "look_up_web";

export const RIGHTS: ReadonlyArray<{ key: Right; label: string; note: string }> = [
  { key: "change_lead_step", label: "Change a lead's step", note: "Qualified, unqualified, contacted and so on." },
  { key: "add_notes_followups", label: "Add notes and follow-ups", note: "Notes on the lead or deal, and follow-ups for a person." },
  { key: "send_email", label: "Send email", note: "From the workspace's mailbox, to the lead's own address only." },
  { key: "change_deals_projects", label: "Create or change deals and projects", note: "Open a deal, move its stage, mark it won or lost, create the project." },
  { key: "look_up_web", label: "Look the company up on the web", note: "Public pages only. Needs web look-ups switched on in the workspace rules." },
];

/** The six agents every workspace starts with, or one the person made. */
export type AgentKind = "researcher" | "qualifier" | "writer" | "chaser" | "deal_keeper" | "project_starter" | "custom";

export type Agent = {
  id: string;
  workspaceId: string;
  kind: AgentKind;
  name: string;
  /** Its one job, in plain words. This is what the AI is told to do. */
  job: string;
  rights: Right[];
  /** Ask a person before ANY of its actions, even ones the workspace rules would let through. */
  askFirst: boolean;
  paused: boolean;
  archived: boolean;
  /** Goes up by one on every save; a save must name the revision it was read at (409 otherwise). */
  revision: number;
  /** How many steps this agent has run this calendar month. */
  runsThisMonth: number;
  created: string;
  updated: string;
};

/** What a new or edited agent is saved with. */
export type AgentInput = { name: string; job: string; rights: Right[]; askFirst: boolean };

// ── The chain ───────────────────────────────────────────────────────────

/** When a step starts. */
export type StepStart =
  /** As soon as the step before it has finished (the first step: as soon as the lead arrives). */
  | { type: "after_previous" }
  /** `days` days after the step before it finished, and only if the lead has not replied by then. A reply skips this step. */
  | { type: "no_reply_days"; days: number }
  /** When a reply or a conversation with the lead is logged. */
  | { type: "on_reply" }
  /** When the lead's deal is marked won. */
  | { type: "on_deal_won" };

export type AutomationStep = { id: string; agentId: string; starts: StepStart };

/** What starts a run. One kind for now: a lead is added in this workspace. */
export type Trigger = { type: "lead_created"; skipImports: boolean };

export type AutomationStatus = "draft" | "on" | "paused";

export type Automation = {
  id: string;
  workspaceId: string;
  name: string;
  status: AutomationStatus;
  trigger: Trigger;
  steps: AutomationStep[];
  revision: number;
  created: string;
  updated: string;
};

export type AutomationInput = { name: string; trigger: Trigger; steps: AutomationStep[] };

// ── Workspace rules ─────────────────────────────────────────────────────

/**
 * How much the agents may do alone in this workspace.
 * - suggest: every action waits for a person.
 * - ask_external: notes, follow-ups, lead steps, opening and moving a deal and creating the
 *   project are automatic; sending an email and marking a deal won or lost wait for a person.
 * - full: nothing waits (an agent with askFirst still asks).
 */
export type Autonomy = "suggest" | "ask_external" | "full";

export type ProjectTemplate = {
  /** May use {company}, {deal} and {lead}. */
  nameTemplate: string;
  /** "deal_owner", or the user id of one person. */
  lead: string;
  /** Add every member of the workspace to the project. */
  addEveryone: boolean;
  /** Board column titles, in order. */
  columns: string[];
  tasks: Array<{ title: string; days: number }>;
  /** Let the agent add tasks it finds in the deal's notes. */
  agentMayAddTasks: boolean;
};

export type WorkspaceRules = {
  workspaceId: string;
  /** Off: nothing runs in this workspace and new leads start no run. */
  enabled: boolean;
  autonomy: Autonomy;
  /** AI spend allowed per calendar month, in US cents. At the limit the agents pause. */
  monthlyBudgetCents: number;
  /** Emails the agents may send to one lead. After that the lead is left to a person. */
  emailsPerLead: number;
  /** Emails are drafted at any time and sent only inside this window. Hours are 0–24 in `timeZone`. */
  sendWindow: { weekdaysOnly: boolean; startHour: number; endHour: number; timeZone: string };
  /** Let agents with the look_up_web right search public web pages. */
  webResearch: boolean;
  project: ProjectTemplate;
  revision: number;
  updated: string;
};

export type WorkspaceRulesInput = Omit<WorkspaceRules, "workspaceId" | "revision" | "updated"> & { revision: number };

/** One row of "each workspace runs on its own": the workspaces of the organisation the caller may manage. */
export type WorkspaceRow = {
  workspaceId: string;
  name: string;
  /** False until automation has been set up there. */
  setUp: boolean;
  enabled: boolean;
  autonomy: Autonomy | null;
  projectsThisMonth: number;
};

// ── Actions ─────────────────────────────────────────────────────────────

/** The only things an agent can ask for. Anything else it writes is ignored. */
export type ProposedAction =
  | { type: "add_note"; text: string }
  | { type: "set_lead_status"; status: LeadStatus }
  | { type: "create_follow_up"; title: string; dueInDays: number; note: string }
  | { type: "send_email"; subject: string; body: string }
  | { type: "create_deal"; name: string; value: number | null }
  | { type: "move_deal"; stage: string }
  | { type: "mark_deal"; result: "won" | "lost"; reason: string }
  | { type: "create_project" }
  | { type: "notify_owner"; text: string };

/** crm_contacts.lead_status. */
export type LeadStatus =
  | "new" | "open" | "in_progress" | "open_deal" | "unqualified" | "attempted_to_contact" | "connected" | "bad_timing";

// ── Runs ────────────────────────────────────────────────────────────────

export type RunStatus = "running" | "waiting" | "needs_approval" | "finished" | "stopped" | "failed";

export type RunSummary = {
  id: string;
  automationId: string;
  automationName: string;
  contactId: string;
  dealId: string | null;
  projectId: string | null;
  /** Who the run is about: the company name, else the lead's name. */
  subject: string;
  status: RunStatus;
  /** One line: "Project created with 5 tasks", "Stopped at step 3: waiting for approval". */
  result: string;
  /** Steps finished so far, and how many the chain has. */
  stepsDone: number;
  stepCount: number;
  started: string;
  finished: string | null;
  updated: string;
};

export type RunStepStatus = "done" | "waiting_approval" | "rejected" | "skipped" | "failed";

export type RunStep = {
  id: string;
  /** 1-based position in the chain. */
  n: number;
  agentId: string;
  agentName: string;
  status: RunStepStatus;
  /** What it was handed. */
  received: string;
  /** What it concluded, in a sentence or two. */
  decided: string;
  /** What was actually done, one line each, in the past tense. Empty until something was. */
  did: string[];
  /** Display name of the person who approved, when someone had to. */
  approvedBy: string | null;
  when: string;
};

export type Run = RunSummary & {
  steps: RunStep[];
  /** What the run is waiting for, as a sentence, when it is waiting. */
  waitingFor: string | null;
  facts: { agentSteps: number; approvals: number; emailsSent: number; costCents: number };
  /** Whether the caller may stop this run: an owner or admin, or the lead's owner, and only while the run has not ended. */
  canStop: boolean;
  /** Whether the caller may mark this lead as replied: the same people, and only while the run has not ended. */
  canReply: boolean;
};

// ── Approvals ───────────────────────────────────────────────────────────

export type Approval = {
  id: string;
  runId: string;
  agentName: string;
  /** "Send the first email to Priya Nair". */
  what: string;
  /** The company or lead it is about. */
  about: string;
  action: ProposedAction;
  status: "pending" | "approved" | "rejected";
  created: string;
  /** Whether the caller may approve or reject it (an owner or admin, or the lead's own owner). */
  canDecide: boolean;
  /** 1-based position in the chain of the step the approval belongs to. */
  stepN: number;
  /** For a `send_email` action: the lead's own address the message will go to. Null for every other action. */
  to: string | null;
};

// ── The overview screen ─────────────────────────────────────────────────

export type ChainStep = {
  n: number;
  agentId: string;
  agentName: string;
  /** One line on what the agent does. */
  does: string;
  starts: StepStart;
  /** True when at least one of its usual actions waits for a person under the current rules. */
  asks: boolean;
};

export type Overview = {
  /** False until "Set up automation" has been pressed for this workspace. */
  setUp: boolean;
  enabled: boolean;
  /** "Owner": may change everything. "Member": may look, and decide approvals for their own leads. */
  role: "Owner" | "Member";
  stats: {
    automationsOn: number;
    automationsPaused: number;
    runsThisWeek: number;
    finishedThisWeek: number;
    stoppedThisWeek: number;
    waitingApprovals: number;
    oldestApproval: string | null;
    spentCents: number;
    budgetCents: number;
  };
  /** The automation shown on the overview: the first one that is on, else the first draft. Null when there is none. */
  automation: { id: string; name: string; status: AutomationStatus } | null;
  chain: ChainStep[];
  approvals: Approval[];
  latestRuns: RunSummary[];
};

// ── The assistant ───────────────────────────────────────────────────────

export type AssistantMessage = { role: "user" | "assistant"; text: string };

/** An agent inside a draft: an existing one (by id) or a new one to be created when the draft is saved. */
export type DraftAgent = { id: string | null; name: string; job: string; rights: Right[]; askFirst: boolean };

export type DraftStep = {
  agent: DraftAgent;
  starts: StepStart;
  /** One line: what this step does. */
  does: string;
  /** One short phrase: what it hands to the next step. */
  gives: string;
};

export type AutomationDraft = { name: string; trigger: Trigger; steps: DraftStep[] };

/** What the assistant answers with. `draft` is the whole automation as it now stands, or null when it only asked or explained. */
export type AssistantReply = { reply: string; assumptions: string[]; draft: AutomationDraft | null };

/** Trying a chain on one lead without doing anything. */
export type TestResult = {
  leadName: string;
  steps: Array<{
    n: number;
    agentName: string;
    received: string;
    decided: string;
    /** What it would do, one line each. */
    wouldDo: string[];
    /** True when at least one of those would wait for a person. */
    needsApproval: boolean;
    /** True when this step would end the run (for example: not a fit). */
    stopsChain: boolean;
  }>;
  /** Why the test ended where it did, when it did not reach the last step ("Step 4 waits 3 days for a reply."). */
  note: string | null;
};

// ── Added by the server build (nothing above was changed) ────────────────

/** One row of `GET people`: a member of the workspace's organisation (for "project lead"). */
export type PersonRow = { userId: string; name: string };

/** Every lead status, in the order a lead usually moves through them. */
export const LEAD_STATUSES: ReadonlyArray<LeadStatus> = [
  "new", "open", "attempted_to_contact", "in_progress", "connected", "open_deal", "bad_timing", "unqualified",
];

/** The right an agent needs for each action it can propose. */
export const ACTION_RIGHT: Readonly<Record<ProposedAction["type"], Right>> = {
  add_note: "add_notes_followups",
  create_follow_up: "add_notes_followups",
  notify_owner: "add_notes_followups",
  set_lead_status: "change_lead_step",
  send_email: "send_email",
  create_deal: "change_deals_projects",
  move_deal: "change_deals_projects",
  mark_deal: "change_deals_projects",
  create_project: "change_deals_projects",
};

/** The six starting agents: the one line shown under each on the overview and what each hands to the next. */
export const AGENT_KINDS: ReadonlyArray<{ kind: Exclude<AgentKind, "custom">; name: string; does: string; gives: string }> = [
  { kind: "researcher", name: "Researcher", does: "Reads the lead and their company and writes a short summary on the lead.", gives: "the summary" },
  { kind: "qualifier", name: "Qualifier", does: "Marks the lead Qualified or Unqualified and says why.", gives: "fit, score and reason" },
  { kind: "writer", name: "Writer", does: "Drafts the first email to the lead, in your tone.", gives: "the sent email" },
  { kind: "chaser", name: "Chaser", does: "Creates follow-ups and chases again when there is no reply.", gives: "reply or no reply" },
  { kind: "deal_keeper", name: "Deal keeper", does: "Opens the deal and moves its stage as replies and meetings come in.", gives: "the deal, when it is won" },
  { kind: "project_starter", name: "Project starter", does: "When the deal is won, creates the project here with brief, tasks and team.", gives: "the project" },
];

/** The limits the server enforces on what is saved, so a screen can check the same before sending. */
export const LIMITS = {
  agentName: 60,
  agentJob: 2000,
  automationName: 80,
  /** Steps in one chain. */
  steps: 12,
  /** `no_reply_days` may wait 1 to this many days. */
  waitDays: 60,
  monthlyBudgetCents: 10_000_000,
  emailsPerLead: 10,
  projectName: 120,
  columns: 12,
  columnTitle: 60,
  tasks: 20,
  taskTitle: 160,
  taskDays: 365,
  /** Messages kept in one assistant conversation, and the length of each. */
  assistantMessages: 40,
  assistantMessage: 4000,
  emailSubject: 200,
  emailBody: 10_000,
} as const;
