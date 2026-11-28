import type { DueFollowUp } from "./followUps.js";
import type { OrgRole } from "../_signroom/context.js";
import type { Agent, AgentKind, Automation, AutomationStep, LeadStatus, ProposedAction, Right, RunStatus, RunStepStatus, WorkspaceRules } from "./shared/types.js";

/**
 * Everything the automation server reads or writes goes through this
 * interface, so the logic can be tested against fakeStore.ts and run against
 * Supabase (supabaseStore.ts, service role only).
 *
 * Tenancy: every method that takes a workspace id only ever touches that
 * workspace's rows. The few that take none (the due-work lists and the claims
 * by id) are for the scheduled run, which works every workspace in turn and
 * reads the workspace from the row it claimed.
 */

// ── People and workspaces ───────────────────────────────────────────────

export type Access = { workspaceId: string; name: string; organizationId: string; role: OrgRole; timeZone: string };
export type WorkspaceInfo = { workspaceId: string; name: string; organizationId: string; timeZone: string };
export type Person = { userId: string; name: string; email: string; photoURL: string; role: OrgRole };

// ── What is stored ──────────────────────────────────────────────────────

export type StoredRules = WorkspaceRules & { organizationId: string; budgetNotifiedMonth: string | null; nudgedAt: string | null };

/** An agent as stored: everything of the shared shape except the month's count, which is worked out when it is shown. */
export type StoredAgent = Omit<Agent, "runsThisMonth">;

export type NewAgent = { workspaceId: string; kind: AgentKind; name: string; job: string; rights: Right[]; askFirst: boolean };

/**
 * An action as the server keeps it. It is the shared ProposedAction plus two
 * things the fixed list cannot say: "qualified" (a lead step the CRM keeps in
 * another column) and the extra kick-off tasks an agent found in the deal's
 * notes. A screen that reads only the shared fields loses nothing.
 */
export type AgentAction =
  | Exclude<ProposedAction, { type: "set_lead_status" } | { type: "create_project" }>
  | { type: "set_lead_status"; status: LeadStatus; qualified?: boolean }
  | { type: "create_project"; extraTasks?: string[] };

export type WaitingOn = "time" | "reply" | "deal_won" | "agent" | "budget" | "send_window";

export type StoredRun = {
  id: string;
  workspaceId: string;
  automationId: string;
  automationName: string;
  contactId: string;
  dealId: string | null;
  projectId: string | null;
  subject: string;
  status: RunStatus;
  result: string;
  /** The chain as it was when the run started. */
  steps: AutomationStep[];
  /** Index of the step to work next (0-based); equal to steps.length when every step is over. */
  position: number;
  waitingOn: WaitingOn | null;
  waitingFor: string | null;
  /** When to look at the run again; null while it waits for a person or an event. */
  wakeAt: string | null;
  /** What the last finished step handed on. */
  handoff: string;
  /** When the last step finished: `no_reply_days` counts from here. */
  stepDoneAt: string | null;
  repliedAt: string | null;
  replyPositive: boolean | null;
  replyNote: string;
  /** The reply an `on_reply` step already acted on: a later one waits for a newer reply. */
  replySeenAt: string | null;
  attempts: number;
  lastError: string | null;
  lockedUntil: string | null;
  emailsSent: number;
  started: string;
  finished: string | null;
  updated: string;
};

export type NewRun = Pick<StoredRun, "workspaceId" | "automationId" | "automationName" | "contactId" | "dealId" | "subject" | "steps" | "wakeAt">;

export type RunPatch = Partial<Omit<StoredRun, "id" | "workspaceId" | "automationId" | "contactId" | "started" | "updated">>;

/** What an agent proposed: one of the actions on the list, or something that is not on it (kept only to be shown as dropped). */
export type PlanAction = AgentAction | { type: "unknown" };

/** One proposed action inside a step, with the server's verdict and how far it got. */
export type PlanItem = {
  action: PlanAction;
  /** now: carried out straight away. ask: waits for a person. drop: not done, and `why` says so. */
  verdict: "now" | "ask" | "drop";
  why?: string;
  /** The action in words, as an approver reads it: "Send the first email to Priya Nair". */
  what?: string;
  /** todo: not started. waiting: an approval or a queued email. done / failed / rejected: over. */
  state: "todo" | "waiting" | "done" | "failed" | "rejected";
  /** While waiting: for a person to approve, or for the send window to open. */
  wait?: "person" | "window";
  /** What was done, in the past tense, once it was. */
  line?: string;
  /** The auto_approvals row, when there is one. */
  approvalId?: string;
  /** What a half-finished action already made (a project id), so a retry does not make it twice. */
  memo?: Record<string, string>;
};

export type StoredStep = {
  id: string;
  workspaceId: string;
  runId: string;
  n: number;
  agentId: string;
  agentName: string;
  /** "working" is the server's own: the step is being carried out (or will be retried). */
  status: RunStepStatus | "working";
  received: string;
  decided: string;
  outcome: "continue" | "stop";
  handoff: string;
  plan: PlanItem[];
  approvedBy: string | null;
  created: string;
  updated: string;
};

export type NewStep = Omit<StoredStep, "id" | "created" | "updated">;
export type StepPatch = Partial<Pick<StoredStep, "status" | "plan" | "approvedBy" | "decided" | "handoff" | "outcome">>;

export type ApprovalState = "pending" | "queued" | "working" | "done" | "rejected" | "failed";

export type StoredApproval = {
  id: string;
  workspaceId: string;
  runId: string;
  stepId: string;
  /** 1-based position in the chain of the step it belongs to. */
  stepN: number;
  planIndex: number;
  agentId: string;
  agentName: string;
  contactId: string;
  dealId: string | null;
  actionType: ProposedAction["type"];
  what: string;
  about: string;
  action: AgentAction;
  state: ApprovalState;
  /** True when a person had to decide it; false for an email the rules let through (kept for the email count). */
  asked: boolean;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  reason: string | null;
  /** For a queued email: when the send window opens. */
  dueAt: string | null;
  error: string | null;
  created: string;
  updated: string;
};

export type NewApproval = Omit<StoredApproval, "id" | "created" | "updated" | "decidedBy" | "decidedByName" | "decidedAt" | "reason" | "error">;
export type ApprovalPatch = Partial<Pick<StoredApproval, "state" | "action" | "decidedBy" | "decidedByName" | "decidedAt" | "reason" | "dueAt" | "error">>;

export type EventType = "lead_created" | "lead_status_changed" | "deal_created" | "deal_changed" | "activity_logged";

export type StoredEvent = {
  id: string;
  workspaceId: string;
  type: EventType;
  contactId: string | null;
  dealId: string | null;
  payload: Record<string, unknown>;
  /** True when the automation server made the change itself. */
  own: boolean;
  attempts: number;
  created: string;
};

export type UsageFeature = "step" | "web" | "assistant" | "test";

export type NewUsage = {
  workspaceId: string;
  runId: string | null;
  agentId: string | null;
  userId: string | null;
  feature: UsageFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearches: number;
  costMicroUsd: number;
};

// ── The CRM, as the automation reads it ─────────────────────────────────

export type Lead = {
  id: string;
  workspaceId: string;
  organizationId: string;
  ownerId: string | null;
  companyId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  lifecycleStage: string;
  leadStatus: LeadStatus;
  source: string;
  notes: string;
  created: string;
};

export type Company = { id: string; name: string; website: string; industry: string; city: string; country: string; companySize: string; notes: string };

export type Stage = { id: string; name: string; sortOrder: number; probability: number; status: "open" | "won" | "lost" };

export type Deal = {
  id: string;
  ownerId: string | null;
  stageId: string;
  companyId: string | null;
  contactId: string | null;
  name: string;
  value: number;
  currency: string | null;
  probability: number;
  status: "open" | "won" | "lost";
  projectId: string | null;
  notes: string;
  created: string;
};

/** One line of a lead's timeline: a note or a logged activity. */
export type TimelineItem = { kind: "note" | "activity"; type: string; text: string; at: string; byAutomation: boolean };

export type LeadPatch = { leadStatus?: LeadStatus; lifecycleStage?: string; lastContactedAt?: string };

export type NewDeal = { id: string; ownerId: string | null; stageId: string; companyId: string | null; contactId: string; name: string; value: number; probability: number; status: "open" | "won" | "lost"; source: string | null };

export type DealPatch = { stageId?: string; status?: "open" | "won" | "lost"; probability?: number; closedAt?: string | null; lostReason?: string | null; projectId?: string };

/** A meeting with a lead (crm_meetings, migration 221): what the invite email needs of it. */
export type StoredMeeting = {
  id: string;
  workspaceId: string;
  organizationId: string;
  contactId: string | null;
  title: string;
  /** ISO time. */
  startsAt: string;
  durationMinutes: number;
  /** The link a guest opens. Made by the call server. */
  joinUrl: string;
  invitedEmail: string | null;
  invitedAt: string | null;
  cancelledAt: string | null;
};

export type NewActivity = { type: string; description: string; contactId: string | null; companyId: string | null; dealId: string | null; metadata: Record<string, unknown>; /** The person who logged it; none for an agent. */ userId?: string | null };

export type NewFollowUp = { ownerId: string | null; contactId: string; companyId: string | null; dealId: string | null; title: string; description: string; dueDate: string };

export type BoardColumn = { id: string; title: string; color: string; order: number };

export type NewProject = {
  id: string;
  organizationId: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description: string;
  columns: BoardColumn[];
  members: Array<{ userId: string; email: string; displayName: string; photoURL: string; role: "owner" | "admin" | "member" | "viewer"; addedAt: string }>;
};

export type NewProjectTask = {
  id: string;
  projectId: string;
  organizationId: string;
  title: string;
  status: string;
  dueDate: string;
  position: number;
  createdBy: string;
  assignee: { userId: string; displayName: string; email: string; photoURL: string } | null;
  dealId: string;
  contactId: string | null;
};

export type NewNotification = {
  userId: string;
  title: string;
  message: string;
  link: string | null;
  projectId?: string | null;
  actorName?: string | null;
  /** The kind of notification, as the bell and people's own settings know it. "automation" when omitted. */
  type?: string;
};

export type RunFilter = { status?: RunStatus; contactId?: string; dealId?: string; since?: string; limit: number };

export interface AutoStore {
  /** Throws (a StoreError naming an auto_ table) while migration 187 has not been run; does nothing otherwise. */
  ready(): Promise<void>;

  // ── people and workspaces ──
  /**
   * The TaskCalendar workspace with this id and the person's role in the
   * organisation that owns it, read fresh on every call; null when there is no
   * such workspace or they are not an active member of that organisation.
   */
  workspaceAccess(workspaceId: string, userId: string): Promise<Access | null>;
  /** The same workspace with no person in mind (the scheduled run). */
  workspaceInfo(workspaceId: string): Promise<WorkspaceInfo | null>;
  /** The organisation's active people, its owner first. */
  orgPeople(organizationId: string): Promise<Person[]>;
  /** Every workspace of the organisation, oldest first. */
  orgWorkspaces(organizationId: string): Promise<Array<{ workspaceId: string; name: string }>>;

  // ── rules ──
  getRules(workspaceId: string): Promise<StoredRules | null>;
  /** Several workspaces' rules at once (for the "each workspace" table). */
  listRules(workspaceIds: string[]): Promise<StoredRules[]>;
  /** Creates the row; when one is already there (a parallel first call) that row is returned unchanged. */
  insertRules(r: Omit<StoredRules, "revision" | "updated" | "budgetNotifiedMonth" | "nudgedAt">): Promise<StoredRules>;
  /** Saves only while the stored revision is the one given; null otherwise. */
  updateRules(workspaceId: string, revision: number, patch: Partial<Omit<WorkspaceRules, "workspaceId" | "revision" | "updated">>): Promise<StoredRules | null>;
  /** Stamps the month the owners were told the budget was reached. True only for the call that set it. */
  markBudgetNotified(workspaceId: string, month: string): Promise<boolean>;
  /** Stamps "process now". True only when the last one was at least `gapMs` ago. */
  takeNudge(workspaceId: string, now: string, gapMs: number): Promise<boolean>;

  // ── agents ──
  /** Oldest first. Archived ones only when asked for. */
  listAgents(workspaceId: string, includeArchived?: boolean): Promise<StoredAgent[]>;
  getAgent(workspaceId: string, id: string): Promise<StoredAgent | null>;
  insertAgent(a: NewAgent): Promise<StoredAgent>;
  /** One of the six starting agents: the workspace's agent of that kind (archived or not) when it has one, else a new one. Safe to call twice at once. */
  ensureDefaultAgent(a: NewAgent): Promise<StoredAgent>;
  /** With a revision: saves only while the stored one matches (null otherwise). With null: saves whatever the revision. */
  updateAgent(workspaceId: string, id: string, revision: number | null, patch: Partial<Pick<StoredAgent, "name" | "job" | "rights" | "askFirst" | "paused" | "archived">>): Promise<StoredAgent | null>;
  /** How many steps each agent has run since `since` (skipped ones not counted). */
  agentStepCounts(workspaceId: string, since: string): Promise<Record<string, number>>;

  // ── automations ──
  /** Oldest first. */
  listAutomations(workspaceId: string): Promise<Automation[]>;
  getAutomation(workspaceId: string, id: string): Promise<Automation | null>;
  /** A workspace's automations have different names: a name already taken is a 409 AppError. */
  insertAutomation(a: Pick<Automation, "workspaceId" | "name" | "status" | "trigger" | "steps">): Promise<Automation>;
  /** null = the revision moved or it is not in the workspace. A name already taken is a 409 AppError. */
  updateAutomation(workspaceId: string, id: string, revision: number | null, patch: Partial<Pick<Automation, "name" | "status" | "trigger" | "steps">>): Promise<Automation | null>;

  // ── runs ──
  /** null when this automation already has a run for this lead. */
  insertRun(r: NewRun): Promise<StoredRun | null>;
  getRun(workspaceId: string, id: string): Promise<StoredRun | null>;
  /** Newest first. */
  listRuns(workspaceId: string, filter: RunFilter): Promise<StoredRun[]>;
  /** The lead's (or deal's) runs that have not ended. */
  activeRuns(workspaceId: string, by: { contactId?: string | null; dealId?: string | null }): Promise<StoredRun[]>;
  /** Runs whose wake time has passed and that nobody holds, earliest first; one workspace's when given. */
  listDueRuns(now: string, limit: number, workspaceId?: string): Promise<StoredRun[]>;
  /** Takes the run for `leaseMs` only if nobody holds it and it has not ended. null when someone else has it. */
  claimRun(id: string, now: string, leaseMs: number): Promise<StoredRun | null>;
  /**
   * Changes a run that has not ended. A run that is finished, stopped or
   * failed stays exactly as it ended (only its hold can still be given back),
   * and is returned unchanged.
   */
  updateRun(workspaceId: string, id: string, patch: RunPatch): Promise<StoredRun>;
  /** How many runs of the workspace made a project and ended since `since`. */
  projectsSince(workspaceId: string, since: string): Promise<number>;
  /** Makes every run of the workspace that waits on this (and, when given, on this agent's step) due now. */
  wakeRuns(workspaceId: string, waitingOn: WaitingOn, now: string): Promise<void>;

  // ── steps ──
  insertStep(s: NewStep): Promise<StoredStep>;
  getStep(workspaceId: string, id: string): Promise<StoredStep | null>;
  /** In chain order. */
  listSteps(workspaceId: string, runId: string): Promise<StoredStep[]>;
  updateStep(workspaceId: string, id: string, patch: StepPatch): Promise<StoredStep>;

  // ── approvals and the email ledger ──
  insertApproval(a: NewApproval): Promise<StoredApproval>;
  getApproval(workspaceId: string, id: string): Promise<StoredApproval | null>;
  /** Oldest first; narrowed to states and/or one run. */
  listApprovals(workspaceId: string, filter?: { states?: ApprovalState[]; runId?: string }): Promise<StoredApproval[]>;
  /** One conditional update: applies the patch only while the row is still in `from`. null when it has moved on. */
  moveApproval(workspaceId: string, id: string, from: ApprovalState, patch: ApprovalPatch): Promise<StoredApproval | null>;
  /** Queued emails whose time has come, earliest first; one workspace's when given. */
  listQueuedDue(now: string, limit: number, workspaceId?: string): Promise<StoredApproval[]>;
  /** Emails to this lead that were sent, are being sent, or still wait (pending or queued). */
  countEmails(workspaceId: string, contactId: string): Promise<number>;
  /** True when this address has unsubscribed from the organisation's email (or bounced, or complained). */
  emailSuppressed(organizationId: string, address: string): Promise<boolean>;

  // ── events ──
  /** Unprocessed events that are not the server's own and that nobody holds, oldest first. */
  listOpenEvents(now: string, limit: number, workspaceId?: string): Promise<StoredEvent[]>;
  /** Takes the event for `leaseMs` and counts the attempt; null when someone else has it or it is done. */
  claimEvent(id: string, now: string, leaseMs: number): Promise<StoredEvent | null>;
  finishEvent(id: string, now: string): Promise<void>;
  /** Deletes processed events and expired marks older than `before`. */
  purge(before: string): Promise<void>;

  // ── usage ──
  insertUsage(u: NewUsage): Promise<void>;
  /** The workspace's AI spend since `since`, in millionths of a dollar. */
  spentMicroUsd(workspaceId: string, since: string): Promise<number>;
  /** One run's AI spend, in millionths of a dollar. */
  runCostMicroUsd(workspaceId: string, runId: string): Promise<number>;
  /** How many AI calls of this kind this person made since `since`. */
  countUsage(workspaceId: string, by: { feature: UsageFeature; userId: string; since: string }): Promise<number>;

  // ── the CRM (always inside the workspace) ──
  getLead(workspaceId: string, id: string): Promise<Lead | null>;
  newestLead(workspaceId: string): Promise<Lead | null>;
  getCompany(workspaceId: string, id: string): Promise<Company | null>;
  getDeal(workspaceId: string, id: string): Promise<Deal | null>;
  /** The lead's deals, newest first. */
  dealsOfLead(workspaceId: string, contactId: string): Promise<Deal[]>;
  /** The workspace's pipeline, in order. */
  listStages(workspaceId: string): Promise<Stage[]>;
  /** The lead's notes and activities, newest first, at most `limit` of each. */
  timeline(workspaceId: string, contactId: string, limit: number): Promise<TimelineItem[]>;
  /** A note on the lead (crm_notes) written as the app writes one. */
  addNote(lead: Lead, body: string): Promise<void>;
  /** One crm_activities row. The caller sets metadata.automation. */
  logActivity(lead: Lead, a: NewActivity): Promise<void>;
  /** A meeting of this workspace, or null. */
  getMeeting(workspaceId: string, id: string): Promise<StoredMeeting | null>;
  /** Writes down that the invite went out, and to which address. */
  markMeetingInvited(workspaceId: string, id: string, email: string, at: string): Promise<void>;
  /** Changes the lead. A status change is marked as the server's own first. */
  updateLead(lead: Lead, patch: LeadPatch): Promise<void>;
  /** A follow-up (crm_tasks) for a person, as the app writes one without a project. */
  addFollowUp(lead: Lead, f: NewFollowUp): Promise<void>;
  /** Opens a deal, marked as the server's own. */
  insertDeal(lead: Lead, d: NewDeal): Promise<void>;
  /** Changes a deal of the workspace. A stage or status change is marked as the server's own first. */
  updateDeal(workspaceId: string, id: string, patch: DealPatch): Promise<void>;

  // ── projects and notifications ──
  insertProject(p: NewProject): Promise<void>;
  insertProjectTask(t: NewProjectTask): Promise<void>;
  /** In-app notifications (the bell). */
  notify(rows: NewNotification[]): Promise<void>;

  // ── follow-up reminders (every workspace, with or without automation) ──
  /** CRM follow-ups with no project that are due by `until`, still open, and have somebody to do them. */
  dueFollowUps(until: string, limit: number): Promise<DueFollowUp[]>;
  /** Which of these reminder links have already been sent. */
  /** Of these reminder links, the ones already sent. With `before`, only those sent before that moment. */
  remindedFollowUps(links: string[], before?: string): Promise<string[]>;
}
