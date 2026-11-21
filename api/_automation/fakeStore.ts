import { randomUUID } from "node:crypto";
import { orgRoleOf, type OrgRole } from "../_signroom/context.js";
import { AppError, StoreError } from "../_signroom/errors.js";
import { AUTOMATION_NAME_TAKEN } from "./messages.js";
import type { Automation } from "./shared/types.js";
import type {
  AutoStore,
  Company,
  Deal,
  Lead,
  NewActivity,
  NewFollowUp,
  NewNotification,
  NewProject,
  NewProjectTask,
  NewUsage,
  Person,
  Stage,
  StoredAgent,
  StoredApproval,
  StoredEvent,
  StoredRules,
  StoredRun,
  StoredStep,
  TimelineItem,
} from "./store.js";

/**
 * The automation store in memory, for tests. It keeps the same rules as the
 * database: one run per automation and lead, one step record per position,
 * revisions that must match, claims that only one caller wins, and the CRM
 * triggers of migration 187 (the "a person ..." helpers below write the same
 * auto_events rows the triggers do; the server's own writes are marked as own).
 */

const clone = <T>(v: T): T => structuredClone(v);

type EventRow = StoredEvent & { lockedUntil: string | null; processedAt: string | null };
type FakeDeal = Deal & { workspaceId: string; closedAt: string | null; lostReason: string | null };
type FakeNote = { workspaceId: string; contactId: string; body: string; userId: string | null; at: string };
type FakeActivity = NewActivity & { workspaceId: string; organizationId: string; userId: string | null; at: string };
type FakeFollowUp = NewFollowUp & { workspaceId: string; organizationId: string };

export type SeededFollowUp = { id: string; title: string; dueDate: string | null; assignedTo: string | null; projectId: string | null; open: boolean };

export type FakeAutoStore = AutoStore & {
  /** Moves the fake's clock: every created/updated stamp it writes uses this. */
  setNow(iso: string): void;
  seedWorkspace(w: { id: string; organizationId: string; name?: string; ownerId?: string; timeZone?: string }): void;
  /** Sets (or replaces) a person in the members list of the organisation that owns the workspace. */
  setOrgMember(workspaceId: string, userId: string, role: OrgRole, opts?: { status?: string; name?: string; email?: string }): void;
  seedStages(workspaceId: string, stages?: Array<Omit<Stage, "id"> & { id?: string }>): Stage[];
  seedCompany(c: Partial<Company> & { workspaceId: string; name: string }): Company;
  /** A CRM follow-up, as a person would add one. Returns it so a test can complete or change it. */
  seedFollowUp(f: Partial<SeededFollowUp> & { title: string }): SeededFollowUp;
  /** A lead put in with no event, as if it had been there before automation was switched on. */
  seedLead(l: Partial<Lead> & { workspaceId: string }): Lead;
  /** A person (the app, an import) adds a lead: the contact trigger fires. */
  /** The address unsubscribes from the organisation's email. */
  leadUnsubscribes(organizationId: string, address: string): void;
  personAddsLead(l: Partial<Lead> & { workspaceId: string }): Lead;
  personSetsLeadStatus(workspaceId: string, contactId: string, status: Lead["leadStatus"]): void;
  /** A person deletes a lead (or changes a field of it, with `patch`). */
  personDeletesLead(contactId: string): void;
  personEditsLead(contactId: string, patch: Partial<Lead>): void;
  personLogsActivity(workspaceId: string, contactId: string, type: string, description?: string): void;
  personAddsDeal(workspaceId: string, contactId: string, d?: Partial<Deal>): Deal;
  personMovesDeal(workspaceId: string, dealId: string, patch: { stageId?: string; status?: "open" | "won" | "lost" }): void;
  /** What the tables hold, for assertions. */
  events(): EventRow[];
  notes(): FakeNote[];
  activities(): FakeActivity[];
  followUps(): FakeFollowUp[];
  projects(): NewProject[];
  projectTasks(): NewProjectTask[];
  notifications(): NewNotification[];
  usage(): Array<NewUsage & { created: string }>;
  leads(): Lead[];
  deals(): FakeDeal[];
  runs(): StoredRun[];
  approvals(): StoredApproval[];
  /** Makes the next call of one method throw a StoreError with this message (for failure tests). */
  failNext(method: keyof AutoStore, message: string): void;
};

export function fakeStore(): FakeAutoStore {
  let clock: string | null = null;
  let tick = 0;
  /** Stamps are strictly increasing so "oldest first" is stable inside one millisecond. */
  const now = (): string => {
    const base = clock ? Date.parse(clock) : Date.now();
    tick += 1;
    return new Date(base + (clock ? tick : 0)).toISOString();
  };

  const tcWorkspaces = new Map<string, { id: string; organizationId: string; name: string; timeZone: string; created: string }>();
  const orgs = new Map<string, { owner_id: string | null; members: Array<{ userId: string; role: string; status?: string; displayName?: string; email?: string }> }>();
  const rules = new Map<string, StoredRules>();
  const agents = new Map<string, StoredAgent>();
  const automations = new Map<string, Automation>();
  const runs = new Map<string, StoredRun>();
  const steps = new Map<string, StoredStep>();
  const approvals = new Map<string, StoredApproval>();
  /** "organisation|address" of everyone who unsubscribed. */
  const suppressed = new Set<string>();
  const events: EventRow[] = [];
  const usage: Array<NewUsage & { created: string }> = [];
  const leads = new Map<string, Lead>();
  const companies = new Map<string, Company & { workspaceId: string }>();
  const deals = new Map<string, FakeDeal>();
  const stages = new Map<string, Stage & { workspaceId: string }>();
  const notes: FakeNote[] = [];
  const activities: FakeActivity[] = [];
  const followUps: FakeFollowUp[] = [];
  const projects: NewProject[] = [];
  const projectTasks: NewProjectTask[] = [];
  const notifications: NewNotification[] = [];
  /** When each linked notification was written, for "sent before" questions. */
  const notifiedAt = new Map<string, string>();
  /** CRM follow-ups a person added (the reminders read these); not the ones an agent creates. */
  const crmFollowUps: SeededFollowUp[] = [];
  const failing = new Map<string, string>();

  const fail = (method: string) => {
    const message = failing.get(method);
    if (message === undefined) return;
    failing.delete(method);
    throw new StoreError(message);
  };

  const enabled = (workspaceId: string) => rules.get(workspaceId)?.enabled === true;

  /** What the triggers of migration 187 write. */
  const emit = (workspaceId: string, type: StoredEvent["type"], contactId: string | null, dealId: string | null, payload: Record<string, unknown>, own = false) => {
    if (!enabled(workspaceId)) return;
    const at = now();
    events.push({ id: randomUUID(), workspaceId, type, contactId, dealId, payload, own, attempts: 0, created: at, lockedUntil: null, processedAt: own ? at : null });
  };

  const makeLead = (l: Partial<Lead> & { workspaceId: string }): Lead => {
    const w = tcWorkspaces.get(l.workspaceId);
    if (!w) throw new Error("Seed the workspace first.");
    const lead: Lead = {
      id: l.id ?? randomUUID(),
      workspaceId: l.workspaceId,
      organizationId: w.organizationId,
      ownerId: l.ownerId ?? null,
      companyId: l.companyId ?? null,
      firstName: l.firstName ?? "Priya",
      lastName: l.lastName ?? "Nair",
      email: l.email ?? "priya@harbourdental.example",
      phone: l.phone ?? "",
      jobTitle: l.jobTitle ?? "Practice manager",
      lifecycleStage: l.lifecycleStage ?? "lead",
      leadStatus: l.leadStatus ?? "new",
      source: l.source ?? "",
      notes: l.notes ?? "",
      created: l.created ?? now(),
    };
    leads.set(lead.id, lead);
    return lead;
  };

  const nameTaken = (workspaceId: string, name: string, exceptId: string | null): boolean =>
    [...automations.values()].some((a) => a.workspaceId === workspaceId && a.id !== exceptId && a.name.toLowerCase() === name.toLowerCase());

  const inWorkspace = <T extends { workspaceId: string }>(m: Map<string, T>, workspaceId: string, id: string): T | null => {
    const row = m.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  };

  const store: FakeAutoStore = {
    setNow(iso) {
      clock = iso;
      tick = 0;
    },
    failNext(method, message) {
      failing.set(method, message);
    },
    seedWorkspace(w) {
      tcWorkspaces.set(w.id, { id: w.id, organizationId: w.organizationId, name: w.name ?? "Studio", timeZone: w.timeZone ?? "UTC", created: now() });
      const org = orgs.get(w.organizationId) ?? { owner_id: null, members: [] };
      if (w.ownerId !== undefined) org.owner_id = w.ownerId;
      orgs.set(w.organizationId, org);
    },
    setOrgMember(workspaceId, userId, role, opts = {}) {
      const w = tcWorkspaces.get(workspaceId);
      const org = w && orgs.get(w.organizationId);
      if (!org) throw new Error("Seed the workspace first.");
      org.members = org.members.filter((m) => m.userId !== userId);
      org.members.push({ userId, role, status: opts.status ?? "active", displayName: opts.name ?? userId, email: opts.email ?? `${userId}@example.com` });
    },
    seedStages(workspaceId, list) {
      const base = list ?? [
        { name: "New Lead", sortOrder: 1, probability: 10, status: "open" as const },
        { name: "Qualified", sortOrder: 2, probability: 25, status: "open" as const },
        { name: "Proposal Sent", sortOrder: 4, probability: 60, status: "open" as const },
        { name: "Won", sortOrder: 6, probability: 100, status: "won" as const },
        { name: "Lost", sortOrder: 7, probability: 0, status: "lost" as const },
      ];
      return base.map((s) => {
        const row = { ...s, id: s.id ?? randomUUID(), workspaceId };
        stages.set(row.id, row);
        const { workspaceId: _w, ...stage } = row;
        return stage;
      });
    },
    seedFollowUp(f) {
      const row: SeededFollowUp = { id: f.id ?? randomUUID(), title: f.title, dueDate: f.dueDate ?? null, assignedTo: f.assignedTo ?? null, projectId: f.projectId ?? null, open: f.open ?? true };
      crmFollowUps.push(row);
      return row;
    },
    seedCompany(c) {
      const row = { id: c.id ?? randomUUID(), workspaceId: c.workspaceId, name: c.name, website: c.website ?? "", industry: c.industry ?? "", city: c.city ?? "", country: c.country ?? "", companySize: c.companySize ?? "", notes: c.notes ?? "" };
      companies.set(row.id, row);
      const { workspaceId: _w, ...company } = row;
      return company;
    },
    seedLead: (l) => clone(makeLead(l)),
    leadUnsubscribes(organizationId, address) {
      suppressed.add(`${organizationId}|${address.trim().toLowerCase()}`);
    },
    personAddsLead(l) {
      const lead = makeLead(l);
      emit(lead.workspaceId, "lead_created", lead.id, null, { source: lead.source || null, lifecycle_stage: lead.lifecycleStage, lead_status: lead.leadStatus });
      return clone(lead);
    },
    personSetsLeadStatus(workspaceId, contactId, status) {
      const lead = inWorkspace(leads, workspaceId, contactId);
      if (!lead) throw new Error("No such lead.");
      const old = lead.leadStatus;
      lead.leadStatus = status;
      if (old !== status) emit(workspaceId, "lead_status_changed", contactId, null, { old, new: status });
    },
    personDeletesLead(contactId) {
      leads.delete(contactId);
    },
    personEditsLead(contactId, patch) {
      const lead = leads.get(contactId);
      if (!lead) throw new Error("No such lead.");
      Object.assign(lead, patch);
    },
    personLogsActivity(workspaceId, contactId, type, description = "") {
      const lead = inWorkspace(leads, workspaceId, contactId);
      if (!lead) throw new Error("No such lead.");
      activities.push({ workspaceId, organizationId: lead.organizationId, userId: "person", type, description, contactId, companyId: null, dealId: null, metadata: {}, at: now() });
      if (["call", "email", "meeting"].includes(type)) emit(workspaceId, "activity_logged", contactId, null, { activity_type: type, description: description.slice(0, 500) });
    },
    personAddsDeal(workspaceId, contactId, d = {}) {
      const open = [...stages.values()].filter((s) => s.workspaceId === workspaceId && s.status === "open").sort((a, b) => a.sortOrder - b.sortOrder)[0];
      const deal: FakeDeal = {
        id: d.id ?? randomUUID(),
        workspaceId,
        ownerId: d.ownerId ?? null,
        stageId: d.stageId ?? open?.id ?? randomUUID(),
        companyId: d.companyId ?? null,
        contactId,
        name: d.name ?? "Website",
        value: d.value ?? 0,
        currency: d.currency ?? null,
        probability: d.probability ?? 10,
        status: d.status ?? "open",
        projectId: d.projectId ?? null,
        notes: d.notes ?? "",
        created: now(),
        closedAt: null,
        lostReason: null,
      };
      deals.set(deal.id, deal);
      emit(workspaceId, "deal_created", contactId, deal.id, { status: deal.status });
      return clone(deal);
    },
    personMovesDeal(workspaceId, dealId, patch) {
      const deal = inWorkspace(deals, workspaceId, dealId);
      if (!deal) throw new Error("No such deal.");
      const old = { status: deal.status, stageId: deal.stageId };
      if (patch.stageId) deal.stageId = patch.stageId;
      if (patch.status) deal.status = patch.status;
      if (old.status !== deal.status || old.stageId !== deal.stageId)
        emit(workspaceId, "deal_changed", deal.contactId, deal.id, { old_status: old.status, new_status: deal.status, stage_changed: old.stageId !== deal.stageId });
    },
    events: () => events.map(clone),
    notes: () => notes.map(clone),
    activities: () => activities.map(clone),
    followUps: () => followUps.map(clone),
    projects: () => projects.map(clone),
    projectTasks: () => projectTasks.map(clone),
    notifications: () => notifications.map(clone),
    usage: () => usage.map(clone),
    leads: () => [...leads.values()].map(clone),
    deals: () => [...deals.values()].map(clone),
    runs: () => [...runs.values()].map(clone),
    approvals: () => [...approvals.values()].map(clone),

    async ready() {
      fail("ready");
    },

    // ── people and workspaces ──
    async workspaceAccess(workspaceId, userId) {
      fail("workspaceAccess");
      const w = tcWorkspaces.get(String(workspaceId).toLowerCase());
      const org = w && orgs.get(w.organizationId);
      const role = org ? orgRoleOf(org, userId) : null;
      return w && role ? { workspaceId: w.id, name: w.name, organizationId: w.organizationId, role, timeZone: w.timeZone } : null;
    },
    async workspaceInfo(workspaceId) {
      const w = tcWorkspaces.get(workspaceId);
      return w ? { workspaceId: w.id, name: w.name, organizationId: w.organizationId, timeZone: w.timeZone } : null;
    },
    async orgPeople(organizationId) {
      const org = orgs.get(organizationId);
      if (!org) return [];
      const out: Person[] = [];
      if (org.owner_id) out.push({ userId: org.owner_id, name: org.members.find((m) => m.userId === org.owner_id)?.displayName ?? org.owner_id, email: `${org.owner_id}@example.com`, photoURL: "", role: "owner" });
      for (const m of org.members) {
        if (m.userId === org.owner_id) continue;
        const role = orgRoleOf(org, m.userId);
        if (role) out.push({ userId: m.userId, name: m.displayName ?? m.userId, email: m.email ?? "", photoURL: "", role });
      }
      return out;
    },
    async orgWorkspaces(organizationId) {
      return [...tcWorkspaces.values()]
        .filter((w) => w.organizationId === organizationId)
        .sort((a, b) => a.created.localeCompare(b.created))
        .map((w) => ({ workspaceId: w.id, name: w.name }));
    },

    // ── rules ──
    async getRules(workspaceId) {
      fail("getRules");
      const r = rules.get(workspaceId);
      return r ? clone(r) : null;
    },
    async listRules(workspaceIds) {
      return workspaceIds.flatMap((id) => (rules.has(id) ? [clone(rules.get(id) as StoredRules)] : []));
    },
    async insertRules(r) {
      const existing = rules.get(r.workspaceId);
      if (existing) return clone(existing);
      const row: StoredRules = { ...clone(r), revision: 1, updated: now(), budgetNotifiedMonth: null, nudgedAt: null };
      rules.set(row.workspaceId, row);
      return clone(row);
    },
    async updateRules(workspaceId, revision, patch) {
      const r = rules.get(workspaceId);
      if (!r || r.revision !== revision) return null;
      Object.assign(r, clone(patch), { revision: r.revision + 1, updated: now() });
      return clone(r);
    },
    async markBudgetNotified(workspaceId, month) {
      const r = rules.get(workspaceId);
      if (!r || r.budgetNotifiedMonth === month) return false;
      r.budgetNotifiedMonth = month;
      return true;
    },
    async takeNudge(workspaceId, at, gapMs) {
      const r = rules.get(workspaceId);
      if (!r) return false;
      if (r.nudgedAt && Date.parse(at) - Date.parse(r.nudgedAt) < gapMs) return false;
      r.nudgedAt = at;
      return true;
    },

    // ── agents ──
    async listAgents(workspaceId, includeArchived = false) {
      return [...agents.values()]
        .filter((a) => a.workspaceId === workspaceId && (includeArchived || !a.archived))
        .sort((a, b) => a.created.localeCompare(b.created))
        .map(clone);
    },
    async getAgent(workspaceId, id) {
      const a = inWorkspace(agents, workspaceId, id);
      return a ? clone(a) : null;
    },
    async insertAgent(a) {
      fail("insertAgent");
      const at = now();
      const row: StoredAgent = { ...clone(a), id: randomUUID(), paused: false, archived: false, revision: 1, created: at, updated: at };
      agents.set(row.id, row);
      return clone(row);
    },
    async ensureDefaultAgent(a) {
      const existing = [...agents.values()].find((x) => x.workspaceId === a.workspaceId && x.kind === a.kind);
      return existing ? clone(existing) : store.insertAgent(a);
    },
    async updateAgent(workspaceId, id, revision, patch) {
      const a = inWorkspace(agents, workspaceId, id);
      if (!a || (revision !== null && a.revision !== revision)) return null;
      Object.assign(a, clone(patch), { revision: a.revision + 1, updated: now() });
      return clone(a);
    },
    async agentStepCounts(workspaceId, since) {
      const out: Record<string, number> = {};
      for (const s of steps.values()) {
        if (s.workspaceId !== workspaceId || s.status === "skipped" || s.created < since) continue;
        out[s.agentId] = (out[s.agentId] ?? 0) + 1;
      }
      return out;
    },

    // ── automations ──
    async listAutomations(workspaceId) {
      return [...automations.values()]
        .filter((a) => a.workspaceId === workspaceId)
        .sort((a, b) => a.created.localeCompare(b.created))
        .map(clone);
    },
    async getAutomation(workspaceId, id) {
      const a = inWorkspace(automations, workspaceId, id);
      return a ? clone(a) : null;
    },
    async insertAutomation(a) {
      if (nameTaken(a.workspaceId, a.name, null)) throw new AppError(AUTOMATION_NAME_TAKEN, 409);
      const at = now();
      const row: Automation = { ...clone(a), id: randomUUID(), revision: 1, created: at, updated: at };
      automations.set(row.id, row);
      return clone(row);
    },
    async updateAutomation(workspaceId, id, revision, patch) {
      const a = inWorkspace(automations, workspaceId, id);
      if (!a || (revision !== null && a.revision !== revision)) return null;
      if (patch.name !== undefined && nameTaken(workspaceId, patch.name, id)) throw new AppError(AUTOMATION_NAME_TAKEN, 409);
      Object.assign(a, clone(patch), { revision: a.revision + 1, updated: now() });
      return clone(a);
    },

    // ── runs ──
    async insertRun(r) {
      for (const x of runs.values()) if (x.automationId === r.automationId && x.contactId === r.contactId) return null;
      const at = now();
      const row: StoredRun = {
        ...clone(r),
        id: randomUUID(),
        projectId: null,
        status: "running",
        result: "",
        position: 0,
        waitingOn: null,
        waitingFor: null,
        handoff: "",
        stepDoneAt: null,
        repliedAt: null,
        replyPositive: null,
        replyNote: "",
        replySeenAt: null,
        attempts: 0,
        lastError: null,
        lockedUntil: null,
        emailsSent: 0,
        started: at,
        finished: null,
        updated: at,
      };
      runs.set(row.id, row);
      return clone(row);
    },
    async getRun(workspaceId, id) {
      const r = inWorkspace(runs, workspaceId, id);
      return r ? clone(r) : null;
    },
    async listRuns(workspaceId, filter) {
      return [...runs.values()]
        .filter((r) => r.workspaceId === workspaceId)
        .filter((r) => !filter.status || r.status === filter.status)
        .filter((r) => !filter.contactId || r.contactId === filter.contactId)
        .filter((r) => !filter.dealId || r.dealId === filter.dealId)
        .filter((r) => !filter.since || r.started >= filter.since)
        .sort((a, b) => b.started.localeCompare(a.started))
        .slice(0, filter.limit)
        .map(clone);
    },
    async activeRuns(workspaceId, by) {
      return [...runs.values()]
        .filter((r) => r.workspaceId === workspaceId && ["running", "waiting", "needs_approval"].includes(r.status))
        .filter((r) => (by.contactId && r.contactId === by.contactId) || (by.dealId && r.dealId === by.dealId))
        .map(clone);
    },
    async listDueRuns(at, limit, workspaceId) {
      return [...runs.values()]
        .filter((r) => (r.status === "running" || r.status === "waiting") && r.wakeAt !== null && r.wakeAt <= at)
        .filter((r) => !r.lockedUntil || r.lockedUntil < at)
        .filter((r) => !workspaceId || r.workspaceId === workspaceId)
        .sort((a, b) => String(a.wakeAt).localeCompare(String(b.wakeAt)))
        .slice(0, limit)
        .map(clone);
    },
    async claimRun(id, at, leaseMs) {
      fail("claimRun");
      const r = runs.get(id);
      if (!r || (r.lockedUntil && r.lockedUntil >= at) || ["finished", "stopped", "failed"].includes(r.status)) return null;
      r.lockedUntil = new Date(Date.parse(at) + leaseMs).toISOString();
      return clone(r);
    },
    async updateRun(workspaceId, id, patch) {
      fail("updateRun");
      const r = inWorkspace(runs, workspaceId, id);
      if (!r) throw new StoreError("run not found");
      // A run that has ended stays as it ended; only its hold can still be given back.
      if (["finished", "stopped", "failed"].includes(r.status)) {
        if (patch.lockedUntil === null) r.lockedUntil = null;
        return clone(r);
      }
      Object.assign(r, clone(patch), { updated: now() });
      return clone(r);
    },
    async projectsSince(workspaceId, since) {
      return [...runs.values()].filter((r) => r.workspaceId === workspaceId && r.projectId !== null && r.finished !== null && r.finished >= since).length;
    },
    async wakeRuns(workspaceId, waitingOn, at) {
      for (const r of runs.values()) {
        if (r.workspaceId !== workspaceId || r.status !== "waiting" || r.waitingOn !== waitingOn) continue;
        Object.assign(r, { status: "running", wakeAt: at, waitingOn: null, waitingFor: null, updated: now() });
      }
    },

    // ── steps ──
    async insertStep(s) {
      fail("insertStep");
      for (const x of steps.values()) if (x.runId === s.runId && x.n === s.n) throw new StoreError("duplicate key value violates unique constraint auto_run_steps_one_per_step");
      const at = now();
      const row: StoredStep = { ...clone(s), id: randomUUID(), created: at, updated: at };
      steps.set(row.id, row);
      return clone(row);
    },
    async getStep(workspaceId, id) {
      const s = inWorkspace(steps, workspaceId, id);
      return s ? clone(s) : null;
    },
    async listSteps(workspaceId, runId) {
      return [...steps.values()]
        .filter((s) => s.workspaceId === workspaceId && s.runId === runId)
        .sort((a, b) => a.n - b.n)
        .map(clone);
    },
    async updateStep(workspaceId, id, patch) {
      const s = inWorkspace(steps, workspaceId, id);
      if (!s) throw new StoreError("step not found");
      Object.assign(s, clone(patch), { updated: now() });
      return clone(s);
    },

    // ── approvals ──
    async insertApproval(a) {
      const at = now();
      const row: StoredApproval = { ...clone(a), id: randomUUID(), decidedBy: null, decidedByName: null, decidedAt: null, reason: null, error: null, created: at, updated: at };
      approvals.set(row.id, row);
      return clone(row);
    },
    async getApproval(workspaceId, id) {
      const a = inWorkspace(approvals, workspaceId, id);
      return a ? clone(a) : null;
    },
    async listApprovals(workspaceId, filter = {}) {
      return [...approvals.values()]
        .filter((a) => a.workspaceId === workspaceId)
        .filter((a) => !filter.states || filter.states.includes(a.state))
        .filter((a) => !filter.runId || a.runId === filter.runId)
        .sort((a, b) => a.created.localeCompare(b.created))
        .map(clone);
    },
    async moveApproval(workspaceId, id, from, patch) {
      fail("moveApproval");
      const a = inWorkspace(approvals, workspaceId, id);
      if (!a || a.state !== from) return null;
      Object.assign(a, clone(patch), { updated: now() });
      return clone(a);
    },
    async listQueuedDue(at, limit, workspaceId) {
      return [...approvals.values()]
        .filter((a) => a.state === "queued" && a.dueAt !== null && a.dueAt <= at)
        .filter((a) => !workspaceId || a.workspaceId === workspaceId)
        .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
        .slice(0, limit)
        .map(clone);
    },
    async countEmails(workspaceId, contactId) {
      return [...approvals.values()].filter(
        (a) => a.workspaceId === workspaceId && a.contactId === contactId && a.actionType === "send_email" && ["pending", "queued", "working", "done"].includes(a.state),
      ).length;
    },

    async emailSuppressed(organizationId, address) {
      return suppressed.has(`${organizationId}|${address.trim().toLowerCase()}`);
    },

    // ── events ──
    async listOpenEvents(at, limit, workspaceId) {
      return events
        .filter((e) => !e.processedAt && !e.own && (!e.lockedUntil || e.lockedUntil < at))
        .filter((e) => !workspaceId || e.workspaceId === workspaceId)
        .slice(0, limit)
        .map(({ lockedUntil: _l, processedAt: _p, ...e }) => clone(e));
    },
    async claimEvent(id, at, leaseMs) {
      const e = events.find((x) => x.id === id);
      if (!e || e.processedAt || (e.lockedUntil && e.lockedUntil >= at)) return null;
      e.lockedUntil = new Date(Date.parse(at) + leaseMs).toISOString();
      e.attempts += 1;
      const { lockedUntil: _l, processedAt: _p, ...out } = e;
      return clone(out);
    },
    async finishEvent(id, at) {
      const e = events.find((x) => x.id === id);
      if (e) e.processedAt = at;
    },
    async purge(before) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].processedAt && (events[i].processedAt as string) < before) events.splice(i, 1);
    },

    // ── usage ──
    async insertUsage(u) {
      fail("insertUsage");
      usage.push({ ...clone(u), created: now() });
    },
    async spentMicroUsd(workspaceId, since) {
      return usage.filter((u) => u.workspaceId === workspaceId && u.created >= since).reduce((sum, u) => sum + u.costMicroUsd, 0);
    },
    async runCostMicroUsd(workspaceId, runId) {
      return usage.filter((u) => u.workspaceId === workspaceId && u.runId === runId).reduce((sum, u) => sum + u.costMicroUsd, 0);
    },
    async countUsage(workspaceId, by) {
      return usage.filter((u) => u.workspaceId === workspaceId && u.feature === by.feature && u.userId === by.userId && u.created >= by.since).length;
    },

    // ── the CRM ──
    async getLead(workspaceId, id) {
      fail("getLead");
      const l = inWorkspace(leads, workspaceId, id);
      return l ? clone(l) : null;
    },
    async newestLead(workspaceId) {
      const all = [...leads.values()].filter((l) => l.workspaceId === workspaceId).sort((a, b) => b.created.localeCompare(a.created));
      return all[0] ? clone(all[0]) : null;
    },
    async getCompany(workspaceId, id) {
      const c = inWorkspace(companies, workspaceId, id);
      if (!c) return null;
      const { workspaceId: _w, ...company } = c;
      return clone(company);
    },
    async getDeal(workspaceId, id) {
      const d = inWorkspace(deals, workspaceId, id);
      return d ? clone(d) : null;
    },
    async dealsOfLead(workspaceId, contactId) {
      return [...deals.values()]
        .filter((d) => d.workspaceId === workspaceId && d.contactId === contactId)
        .sort((a, b) => b.created.localeCompare(a.created))
        .map(clone);
    },
    async listStages(workspaceId) {
      return [...stages.values()]
        .filter((s) => s.workspaceId === workspaceId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ workspaceId: _w, ...s }) => clone(s));
    },
    async timeline(workspaceId, contactId, limit) {
      const fromNotes: TimelineItem[] = notes
        .filter((n) => n.workspaceId === workspaceId && n.contactId === contactId)
        .map((n) => ({ kind: "note" as const, type: "note", text: n.body, at: n.at, byAutomation: n.userId === null }));
      const fromActivities: TimelineItem[] = activities
        .filter((a) => a.workspaceId === workspaceId && a.contactId === contactId && a.type !== "note")
        .map((a) => ({ kind: "activity" as const, type: a.type, text: a.description, at: a.at, byAutomation: a.metadata.automation === true }));
      const newest = (list: TimelineItem[]) => list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
      return [...newest(fromNotes), ...newest(fromActivities)].sort((a, b) => b.at.localeCompare(a.at));
    },
    async addNote(lead, body) {
      fail("addNote");
      notes.push({ workspaceId: lead.workspaceId, contactId: lead.id, body, userId: null, at: now() });
    },
    async logActivity(lead, a) {
      activities.push({ ...clone(a), workspaceId: lead.workspaceId, organizationId: lead.organizationId, userId: a.userId ?? null, at: now() });
      // The activity trigger writes nothing for metadata.automation = true; anything else would be an event.
      if (a.metadata.automation !== true && a.contactId && ["call", "email", "meeting"].includes(a.type)) emit(lead.workspaceId, "activity_logged", a.contactId, a.dealId, { activity_type: a.type, description: a.description });
    },
    async updateLead(lead, patch) {
      fail("updateLead");
      const l = inWorkspace(leads, lead.workspaceId, lead.id);
      if (!l) throw new StoreError("lead not found");
      const old = l.leadStatus;
      if (patch.leadStatus !== undefined) l.leadStatus = patch.leadStatus;
      if (patch.lifecycleStage !== undefined) l.lifecycleStage = patch.lifecycleStage;
      if (old !== l.leadStatus) emit(l.workspaceId, "lead_status_changed", l.id, null, { old, new: l.leadStatus }, true);
    },
    async addFollowUp(lead, f) {
      followUps.push({ ...clone(f), workspaceId: lead.workspaceId, organizationId: lead.organizationId });
    },
    async insertDeal(lead, d) {
      fail("insertDeal");
      const stage = stages.get(d.stageId);
      if (!stage || stage.workspaceId !== lead.workspaceId) throw new StoreError("Related CRM records must belong to the same workspace");
      deals.set(d.id, { ...clone(d), workspaceId: lead.workspaceId, currency: null, projectId: null, notes: "", created: now(), closedAt: null, lostReason: null });
      emit(lead.workspaceId, "deal_created", lead.id, d.id, { status: d.status }, true);
    },
    async updateDeal(workspaceId, id, patch) {
      fail("updateDeal");
      const d = inWorkspace(deals, workspaceId, id);
      if (!d) throw new StoreError("deal not found");
      const old = { status: d.status, stageId: d.stageId };
      if (patch.stageId !== undefined) d.stageId = patch.stageId;
      if (patch.status !== undefined) d.status = patch.status;
      if (patch.probability !== undefined) d.probability = patch.probability;
      if (patch.closedAt !== undefined) d.closedAt = patch.closedAt;
      if (patch.lostReason !== undefined) d.lostReason = patch.lostReason;
      if (patch.projectId !== undefined) d.projectId = patch.projectId;
      if (old.status !== d.status || old.stageId !== d.stageId)
        emit(workspaceId, "deal_changed", d.contactId, d.id, { old_status: old.status, new_status: d.status, stage_changed: old.stageId !== d.stageId }, true);
    },

    // ── projects and notifications ──
    async insertProject(p) {
      fail("insertProject");
      projects.push(clone(p));
    },
    async insertProjectTask(t) {
      fail("insertProjectTask");
      projectTasks.push(clone(t));
    },
    async notify(rows) {
      fail("notify");
      notifications.push(...rows.map(clone));
      for (const row of rows) if (row.link) notifiedAt.set(row.link, clock ?? new Date().toISOString());
    },

    async dueFollowUps(until, limit) {
      return crmFollowUps
        .filter((f) => f.open && f.projectId === null && f.assignedTo !== null && f.dueDate !== null && f.dueDate <= until)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
        .slice(0, limit)
        .map((f) => ({ id: f.id, title: f.title, dueDate: f.dueDate as string, assignedTo: f.assignedTo as string }));
    },
    async remindedFollowUps(links, before) {
      return notifications
        .filter((n) => n.type === "task_reminder" && n.link !== null && links.includes(n.link))
        .filter((n) => !before || (notifiedAt.get(n.link as string) ?? "") < before)
        .map((n) => n.link as string);
    },
  };
  return store;
}
