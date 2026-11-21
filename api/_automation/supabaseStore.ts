import type { SupabaseClient } from "@supabase/supabase-js";
import { orgRoleOf, type OrgRole } from "../_signroom/context.js";
import { AppError, StoreError } from "../_signroom/errors.js";
import { AUTOMATION_NAME_TAKEN } from "./messages.js";
import type { Automation, LeadStatus } from "./shared/types.js";
import type {
  ApprovalPatch,
  AutoStore,
  Company,
  Deal,
  Lead,
  Person,
  RunPatch,
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
 * The automation store on Supabase, with the service role (row level security
 * lets nobody else in). The auto_ tables are migration 187's; the CRM, project
 * and notification rows are written with the same columns the app itself
 * writes (src/services/supabase/crmHub and database.ts).
 *
 * Every read and write names the workspace. The CRM's own triggers check the
 * workspace of related rows again, for the service role too.
 */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** "Nobody holds it" and "never": the columns are never null, so a claim is one plain comparison. */
const EPOCH = "1970-01-01T00:00:00.000Z";
const OPEN_RUN = ["running", "waiting", "needs_approval"];
/** How long a mark for one of the server's own CRM writes lives. */
const MARK_MS = 60_000;
const PAGE = 1000;

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new StoreError(r.error.message);
  return r.data as T;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => Number(v ?? 0);
const held = (v: unknown): string | null => (typeof v === "string" && Date.parse(v) > 0 ? v : null);
const duplicate = (error: unknown): boolean => (error as { code?: string } | null)?.code === "23505";
/** True when the database says a column is not there yet (an optional, later CRM migration). */
const missingColumn = (error: { message?: string } | null, names: RegExp): boolean => !!error && /column|schema cache/i.test(error.message ?? "") && names.test(error.message ?? "");

function rulesFrom(r: Row): StoredRules {
  return {
    workspaceId: r.workspace_id,
    organizationId: r.organization_id,
    enabled: !!r.enabled,
    autonomy: r.autonomy,
    monthlyBudgetCents: num(r.monthly_budget_cents),
    emailsPerLead: num(r.emails_per_lead),
    sendWindow: r.send_window,
    webResearch: !!r.web_research,
    project: r.project,
    revision: num(r.revision),
    budgetNotifiedMonth: r.budget_notified_month || null,
    nudgedAt: held(r.nudged_at),
    updated: r.updated_at,
  };
}

function agentFrom(r: Row): StoredAgent {
  return { id: r.id, workspaceId: r.workspace_id, kind: r.kind, name: r.name, job: r.job, rights: r.rights ?? [], askFirst: !!r.ask_first, paused: !!r.paused, archived: !!r.archived, revision: num(r.revision), created: r.created_at, updated: r.updated_at };
}

function automationFrom(r: Row): Automation {
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, status: r.status, trigger: r.trigger, steps: r.steps ?? [], revision: num(r.revision), created: r.created_at, updated: r.updated_at };
}

function runFrom(r: Row): StoredRun {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    automationId: r.automation_id,
    automationName: r.automation_name ?? "",
    contactId: r.contact_id,
    dealId: r.deal_id ?? null,
    projectId: r.project_id ?? null,
    subject: r.subject ?? "",
    status: r.status,
    result: r.result ?? "",
    steps: r.steps ?? [],
    position: num(r.position),
    waitingOn: r.waiting_on ?? null,
    waitingFor: r.waiting_for ?? null,
    wakeAt: r.wake_at ?? null,
    handoff: r.handoff ?? "",
    stepDoneAt: r.step_done_at ?? null,
    repliedAt: r.replied_at ?? null,
    replyPositive: r.reply_positive ?? null,
    replyNote: r.reply_note ?? "",
    replySeenAt: r.reply_seen_at ?? null,
    attempts: num(r.attempts),
    lastError: r.last_error ?? null,
    lockedUntil: held(r.locked_until),
    emailsSent: num(r.emails_sent),
    started: r.started_at,
    finished: r.finished_at ?? null,
    updated: r.updated_at,
  };
}

/** Run fields -> auto_runs columns. Only keys that are present are mapped; null clears. */
function runRow(p: RunPatch): Row {
  const o: Row = {};
  const set = (col: string, v: unknown) => {
    if (v !== undefined) o[col] = v;
  };
  set("automation_name", p.automationName);
  set("deal_id", p.dealId);
  set("project_id", p.projectId);
  set("subject", p.subject);
  set("status", p.status);
  set("result", p.result);
  set("steps", p.steps);
  set("position", p.position);
  set("waiting_on", p.waitingOn);
  set("waiting_for", p.waitingFor);
  set("wake_at", p.wakeAt);
  set("handoff", p.handoff);
  set("step_done_at", p.stepDoneAt);
  set("replied_at", p.repliedAt);
  set("reply_positive", p.replyPositive);
  set("reply_note", p.replyNote);
  set("reply_seen_at", p.replySeenAt);
  set("attempts", p.attempts);
  set("last_error", p.lastError);
  set("locked_until", p.lockedUntil === null ? EPOCH : p.lockedUntil);
  set("emails_sent", p.emailsSent);
  set("finished_at", p.finished);
  return o;
}

function stepFrom(r: Row): StoredStep {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    runId: r.run_id,
    n: num(r.n),
    agentId: r.agent_id ?? "",
    agentName: r.agent_name ?? "",
    status: r.status,
    received: r.received ?? "",
    decided: r.decided ?? "",
    outcome: r.outcome,
    handoff: r.handoff ?? "",
    plan: r.plan ?? [],
    approvedBy: r.approved_by ?? null,
    created: r.created_at,
    updated: r.updated_at,
  };
}

function approvalFrom(r: Row): StoredApproval {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    runId: r.run_id,
    stepId: r.step_id,
    stepN: num(r.step_n),
    planIndex: num(r.plan_index),
    agentId: r.agent_id ?? "",
    agentName: r.agent_name ?? "",
    contactId: r.contact_id,
    dealId: r.deal_id ?? null,
    actionType: r.action_type,
    what: r.what ?? "",
    about: r.about ?? "",
    action: r.action,
    state: r.state,
    asked: !!r.asked,
    decidedBy: r.decided_by ?? null,
    decidedByName: r.decided_by_name ?? null,
    decidedAt: r.decided_at ?? null,
    reason: r.reason ?? null,
    dueAt: r.due_at ?? null,
    error: r.error ?? null,
    created: r.created_at,
    updated: r.updated_at,
  };
}

function approvalRow(p: ApprovalPatch): Row {
  const o: Row = {};
  const set = (col: string, v: unknown) => {
    if (v !== undefined) o[col] = v;
  };
  set("state", p.state);
  set("action", p.action);
  set("decided_by", p.decidedBy);
  set("decided_by_name", p.decidedByName);
  set("decided_at", p.decidedAt);
  set("reason", p.reason);
  set("due_at", p.dueAt);
  set("error", p.error);
  return o;
}

function eventFrom(r: Row): StoredEvent {
  return { id: r.id, workspaceId: r.workspace_id, type: r.type, contactId: r.contact_id ?? null, dealId: r.deal_id ?? null, payload: r.payload ?? {}, own: !!r.own, attempts: num(r.attempts), created: r.created_at };
}

function leadFrom(r: Row): Lead {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    organizationId: r.organization_id,
    ownerId: r.owner_id ?? null,
    companyId: r.company_id ?? null,
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    email: str(r.email),
    phone: str(r.phone),
    jobTitle: str(r.job_title),
    lifecycleStage: str(r.lifecycle_stage),
    leadStatus: r.lead_status as LeadStatus,
    source: str(r.source),
    notes: str(r.notes),
    created: r.created_at,
  };
}

function companyFrom(r: Row): Company {
  return { id: r.id, name: str(r.name), website: str(r.website), industry: str(r.industry), city: str(r.city), country: str(r.country), companySize: str(r.company_size), notes: str(r.notes) };
}

function dealFrom(r: Row): Deal {
  return {
    id: r.id,
    ownerId: r.owner_id ?? null,
    stageId: r.stage_id,
    companyId: r.company_id ?? null,
    contactId: r.contact_id ?? null,
    name: str(r.name),
    value: num(r.value),
    currency: str(r.currency).trim().toUpperCase() || null,
    probability: num(r.probability),
    status: r.status,
    projectId: r.project_id ?? null,
    notes: str(r.notes),
    created: r.created_at,
  };
}

const stageFrom = (r: Row): Stage => ({ id: r.id, name: str(r.name), sortOrder: num(r.sort_order), probability: num(r.probability), status: r.status });

export function supabaseStore(sb: SupabaseClient): AutoStore {
  /** Leaves a mark just before the server changes a lead's status or a deal, so the CRM trigger records the change as the server's own. */
  async function mark(workspaceId: string, entityId: string): Promise<void> {
    const r = await sb.from("auto_marks").insert({ workspace_id: workspaceId, entity_id: entityId, expires_at: new Date(Date.now() + MARK_MS).toISOString() });
    if (r.error) throw new StoreError(r.error.message);
  }

  /** A mark whose write did not happen is taken away again, so it cannot hide a person's change. Never throws. */
  async function unmark(entityId: string): Promise<void> {
    await sb.from("auto_marks").delete().eq("entity_id", entityId).then(() => undefined, () => undefined);
  }

  async function workspaceRow(workspaceId: string): Promise<{ w: Row; o: Row } | null> {
    // TaskCalendar's own tables, read with the service role: the workspace, then the organisation that owns it.
    const w = must(await sb.from("workspaces").select("workspace_id, organization_id, name").eq("workspace_id", workspaceId).maybeSingle()) as Row | null;
    if (!w || !w.organization_id) return null;
    // select("*"): default_timezone is a later column and may not be there.
    const o = must(await sb.from("organizations").select("*").eq("organization_id", w.organization_id).maybeSingle()) as Row | null;
    return o ? { w, o } : null;
  }

  const info = ({ w, o }: { w: Row; o: Row }) => ({ workspaceId: w.workspace_id as string, name: str(w.name), organizationId: w.organization_id as string, timeZone: str(o.default_timezone) || "UTC" });

  async function runById(workspaceId: string, id: string): Promise<StoredRun | null> {
    const data = must(await sb.from("auto_runs").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
    return data ? runFrom(data) : null;
  }

  async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
    const r = await q;
    if (r.error) throw new StoreError(r.error.message);
    return r.count ?? 0;
  }

  async function spent(workspaceId: string, since: string | null, runId: string | null): Promise<number> {
    return num(must(await sb.rpc("auto_spent_micro_usd", { p_workspace: workspaceId, p_since: since, p_run: runId })));
  }

  return {
    async ready() {
      const r = await sb.from("auto_rules").select("workspace_id", { count: "exact", head: true }).limit(1);
      if (r.error) throw new StoreError(r.error.message);
    },

    // ── people and workspaces ──
    async workspaceAccess(workspaceId, userId) {
      const row = await workspaceRow(workspaceId);
      const role = row ? orgRoleOf(row.o, userId) : null;
      return row && role ? { ...info(row), role } : null;
    },

    async workspaceInfo(workspaceId) {
      const row = await workspaceRow(workspaceId);
      return row ? info(row) : null;
    },

    async orgPeople(organizationId) {
      const o = must(await sb.from("organizations").select("owner_id, members").eq("organization_id", organizationId).maybeSingle()) as Row | null;
      if (!o) return [];
      const listed = new Map<string, Row>();
      for (const m of Array.isArray(o.members) ? (o.members as Row[]) : []) if (m && typeof m.userId === "string") listed.set(m.userId, m);
      const ids = [...new Set([...(typeof o.owner_id === "string" ? [o.owner_id as string] : []), ...listed.keys()])].filter((id) => orgRoleOf(o, id));
      if (ids.length === 0) return [];
      // Names and pictures as the people themselves keep them; the members list is the fallback.
      const profiles = new Map<string, Row>();
      const got = await sb.from("user_profiles").select("id, email, display_name, photo_url").in("id", ids);
      if (!got.error) for (const p of (got.data ?? []) as Row[]) profiles.set(p.id, p);
      return ids.map((userId): Person => {
        const p = profiles.get(userId);
        const m = listed.get(userId);
        return { userId, name: str(p?.display_name) || str(m?.displayName) || str(p?.email) || str(m?.email), email: str(p?.email) || str(m?.email), photoURL: str(p?.photo_url) || str(m?.photoURL), role: orgRoleOf(o, userId) as OrgRole };
      });
    },

    async orgWorkspaces(organizationId) {
      const data = must(await sb.from("workspaces").select("workspace_id, name, created_at").eq("organization_id", organizationId).order("created_at", { ascending: true })) as Row[] | null;
      return (data ?? []).map((w) => ({ workspaceId: w.workspace_id as string, name: str(w.name) }));
    },

    // ── rules ──
    async getRules(workspaceId) {
      const data = must(await sb.from("auto_rules").select("*").eq("workspace_id", workspaceId).maybeSingle()) as Row | null;
      return data ? rulesFrom(data) : null;
    },

    async listRules(workspaceIds) {
      if (workspaceIds.length === 0) return [];
      const data = must(await sb.from("auto_rules").select("*").in("workspace_id", workspaceIds)) as Row[] | null;
      return (data ?? []).map(rulesFrom);
    },

    async insertRules(r) {
      const row = {
        workspace_id: r.workspaceId,
        organization_id: r.organizationId,
        enabled: r.enabled,
        autonomy: r.autonomy,
        monthly_budget_cents: r.monthlyBudgetCents,
        emails_per_lead: r.emailsPerLead,
        send_window: r.sendWindow,
        web_research: r.webResearch,
        project: r.project,
      };
      const made = await sb.from("auto_rules").insert(row).select("*").single();
      if (!made.error) return rulesFrom(made.data as Row);
      // The primary key: a parallel first call won. Use its row.
      const existing = duplicate(made.error) ? (must(await sb.from("auto_rules").select("*").eq("workspace_id", r.workspaceId).maybeSingle()) as Row | null) : null;
      if (!existing) throw new StoreError(made.error.message);
      return rulesFrom(existing);
    },

    async updateRules(workspaceId, revision, patch) {
      const o: Row = { revision: revision + 1, updated_at: new Date().toISOString() };
      if (patch.enabled !== undefined) o.enabled = patch.enabled;
      if (patch.autonomy !== undefined) o.autonomy = patch.autonomy;
      if (patch.monthlyBudgetCents !== undefined) o.monthly_budget_cents = patch.monthlyBudgetCents;
      if (patch.emailsPerLead !== undefined) o.emails_per_lead = patch.emailsPerLead;
      if (patch.sendWindow !== undefined) o.send_window = patch.sendWindow;
      if (patch.webResearch !== undefined) o.web_research = patch.webResearch;
      if (patch.project !== undefined) o.project = patch.project;
      const data = must(await sb.from("auto_rules").update(o).eq("workspace_id", workspaceId).eq("revision", revision).select("*").maybeSingle()) as Row | null;
      return data ? rulesFrom(data) : null;
    },

    async markBudgetNotified(workspaceId, month) {
      const data = must(await sb.from("auto_rules").update({ budget_notified_month: month }).eq("workspace_id", workspaceId).neq("budget_notified_month", month).select("workspace_id")) as Row[] | null;
      return (data ?? []).length > 0;
    },

    async takeNudge(workspaceId, now, gapMs) {
      const before = new Date(Date.parse(now) - gapMs).toISOString();
      const data = must(await sb.from("auto_rules").update({ nudged_at: now }).eq("workspace_id", workspaceId).lte("nudged_at", before).select("workspace_id")) as Row[] | null;
      return (data ?? []).length > 0;
    },

    // ── agents ──
    async listAgents(workspaceId, includeArchived = false) {
      let q = sb.from("auto_agents").select("*").eq("workspace_id", workspaceId);
      if (!includeArchived) q = q.eq("archived", false);
      const data = must(await q.order("created_at", { ascending: true }).order("id", { ascending: true })) as Row[] | null;
      return (data ?? []).map(agentFrom);
    },

    async getAgent(workspaceId, id) {
      const data = must(await sb.from("auto_agents").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      return data ? agentFrom(data) : null;
    },

    async insertAgent(a) {
      const row = { workspace_id: a.workspaceId, kind: a.kind, name: a.name, job: a.job, rights: a.rights, ask_first: a.askFirst };
      return agentFrom(must(await sb.from("auto_agents").insert(row).select("*").single()) as Row);
    },

    async ensureDefaultAgent(a) {
      const find = async () => must(await sb.from("auto_agents").select("*").eq("workspace_id", a.workspaceId).eq("kind", a.kind).limit(1).maybeSingle()) as Row | null;
      const existing = await find();
      if (existing) return agentFrom(existing);
      const row = { workspace_id: a.workspaceId, kind: a.kind, name: a.name, job: a.job, rights: a.rights, ask_first: a.askFirst };
      const made = await sb.from("auto_agents").insert(row).select("*").single();
      if (!made.error) return agentFrom(made.data as Row);
      // One of each kind per workspace: a parallel "Set up" made it a moment ago.
      const other = duplicate(made.error) ? await find() : null;
      if (!other) throw new StoreError(made.error.message);
      return agentFrom(other);
    },

    async updateAgent(workspaceId, id, revision, patch) {
      const current = must(await sb.from("auto_agents").select("revision").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      if (!current) return null;
      const at = revision ?? num(current.revision);
      const o: Row = { revision: at + 1, updated_at: new Date().toISOString() };
      if (patch.name !== undefined) o.name = patch.name;
      if (patch.job !== undefined) o.job = patch.job;
      if (patch.rights !== undefined) o.rights = patch.rights;
      if (patch.askFirst !== undefined) o.ask_first = patch.askFirst;
      if (patch.paused !== undefined) o.paused = patch.paused;
      if (patch.archived !== undefined) o.archived = patch.archived;
      const data = must(await sb.from("auto_agents").update(o).eq("workspace_id", workspaceId).eq("id", id).eq("revision", at).select("*").maybeSingle()) as Row | null;
      return data ? agentFrom(data) : null;
    },

    async agentStepCounts(workspaceId, since) {
      const out: Record<string, number> = {};
      for (let from = 0; from < 20 * PAGE; from += PAGE) {
        const r = await sb.from("auto_run_steps").select("agent_id").eq("workspace_id", workspaceId).gte("created_at", since).neq("status", "skipped").order("created_at", { ascending: true }).range(from, from + PAGE - 1);
        const rows = (must(r) as Row[] | null) ?? [];
        for (const s of rows) if (s.agent_id) out[s.agent_id] = (out[s.agent_id] ?? 0) + 1;
        if (rows.length < PAGE) break;
      }
      return out;
    },

    // ── automations ──
    async listAutomations(workspaceId) {
      const data = must(await sb.from("auto_automations").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true }).order("id", { ascending: true })) as Row[] | null;
      return (data ?? []).map(automationFrom);
    },

    async getAutomation(workspaceId, id) {
      const data = must(await sb.from("auto_automations").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      return data ? automationFrom(data) : null;
    },

    async insertAutomation(a) {
      const row = { workspace_id: a.workspaceId, name: a.name, status: a.status, trigger: a.trigger, steps: a.steps };
      const made = await sb.from("auto_automations").insert(row).select("*").single();
      if (made.error) {
        if (duplicate(made.error)) throw new AppError(AUTOMATION_NAME_TAKEN, 409);
        throw new StoreError(made.error.message);
      }
      return automationFrom(made.data as Row);
    },

    async updateAutomation(workspaceId, id, revision, patch) {
      const current = must(await sb.from("auto_automations").select("revision").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      if (!current) return null;
      const at = revision ?? num(current.revision);
      const o: Row = { revision: at + 1, updated_at: new Date().toISOString() };
      if (patch.name !== undefined) o.name = patch.name;
      if (patch.status !== undefined) o.status = patch.status;
      if (patch.trigger !== undefined) o.trigger = patch.trigger;
      if (patch.steps !== undefined) o.steps = patch.steps;
      const r = await sb.from("auto_automations").update(o).eq("workspace_id", workspaceId).eq("id", id).eq("revision", at).select("*").maybeSingle();
      if (r.error) {
        if (duplicate(r.error)) throw new AppError(AUTOMATION_NAME_TAKEN, 409);
        throw new StoreError(r.error.message);
      }
      return r.data ? automationFrom(r.data as Row) : null;
    },

    // ── runs ──
    async insertRun(r) {
      const row = {
        workspace_id: r.workspaceId,
        automation_id: r.automationId,
        automation_name: r.automationName,
        contact_id: r.contactId,
        deal_id: r.dealId,
        subject: r.subject,
        steps: r.steps,
        wake_at: r.wakeAt,
      };
      const made = await sb.from("auto_runs").insert(row).select("*").single();
      if (!made.error) return runFrom(made.data as Row);
      // One run per automation and lead: this lead already has one.
      if (duplicate(made.error)) return null;
      throw new StoreError(made.error.message);
    },

    getRun: runById,

    async listRuns(workspaceId, filter) {
      let q = sb.from("auto_runs").select("*").eq("workspace_id", workspaceId);
      if (filter.status) q = q.eq("status", filter.status);
      if (filter.contactId) q = q.eq("contact_id", filter.contactId);
      if (filter.dealId) q = q.eq("deal_id", filter.dealId);
      if (filter.since) q = q.gte("started_at", filter.since);
      const data = must(await q.order("started_at", { ascending: false }).order("id", { ascending: false }).limit(Math.min(filter.limit, PAGE))) as Row[] | null;
      return (data ?? []).map(runFrom);
    },

    async activeRuns(workspaceId, by) {
      if (!by.contactId && !by.dealId) return [];
      let q = sb.from("auto_runs").select("*").eq("workspace_id", workspaceId).in("status", OPEN_RUN);
      // Both are uuids read from our own rows, so they are safe inside the filter text.
      if (by.contactId && by.dealId) q = q.or(`contact_id.eq.${by.contactId},deal_id.eq.${by.dealId}`);
      else if (by.contactId) q = q.eq("contact_id", by.contactId);
      else q = q.eq("deal_id", by.dealId as string);
      return ((must(await q) as Row[] | null) ?? []).map(runFrom);
    },

    async listDueRuns(now, limit, workspaceId) {
      let q = sb.from("auto_runs").select("*").in("status", ["running", "waiting"]).lte("wake_at", now).lt("locked_until", now);
      if (workspaceId) q = q.eq("workspace_id", workspaceId);
      return ((must(await q.order("wake_at", { ascending: true }).limit(limit)) as Row[] | null) ?? []).map(runFrom);
    },

    async claimRun(id, now, leaseMs) {
      // One conditional update: only one caller moves the hold into the future.
      const until = new Date(Date.parse(now) + leaseMs).toISOString();
      const data = must(await sb.from("auto_runs").update({ locked_until: until }).eq("id", id).in("status", OPEN_RUN).lt("locked_until", now).select("*").maybeSingle()) as Row | null;
      return data ? runFrom(data) : null;
    },

    async updateRun(workspaceId, id, patch) {
      const o = { ...runRow(patch), updated_at: new Date().toISOString() };
      // Only a run that has not ended is changed: an ended run stays exactly as it ended.
      const data = must(await sb.from("auto_runs").update(o).eq("workspace_id", workspaceId).eq("id", id).in("status", OPEN_RUN).select("*").maybeSingle()) as Row | null;
      if (data) return runFrom(data);
      if (patch.lockedUntil === null) {
        const r = await sb.from("auto_runs").update({ locked_until: EPOCH }).eq("workspace_id", workspaceId).eq("id", id);
        if (r.error) throw new StoreError(r.error.message);
      }
      const current = await runById(workspaceId, id);
      if (!current) throw new StoreError("run not found");
      return current;
    },

    async projectsSince(workspaceId, since) {
      return count(sb.from("auto_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).not("project_id", "is", null).gte("finished_at", since));
    },

    async wakeRuns(workspaceId, waitingOn, now) {
      const o = { status: "running", wake_at: now, waiting_on: null, waiting_for: null, updated_at: new Date().toISOString() };
      const r = await sb.from("auto_runs").update(o).eq("workspace_id", workspaceId).eq("status", "waiting").eq("waiting_on", waitingOn);
      if (r.error) throw new StoreError(r.error.message);
    },

    // ── steps ──
    async insertStep(s) {
      const row = {
        workspace_id: s.workspaceId,
        run_id: s.runId,
        n: s.n,
        agent_id: s.agentId || null,
        agent_name: s.agentName,
        status: s.status,
        received: s.received,
        decided: s.decided,
        outcome: s.outcome,
        handoff: s.handoff,
        plan: s.plan,
        approved_by: s.approvedBy,
      };
      return stepFrom(must(await sb.from("auto_run_steps").insert(row).select("*").single()) as Row);
    },

    async getStep(workspaceId, id) {
      const data = must(await sb.from("auto_run_steps").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      return data ? stepFrom(data) : null;
    },

    async listSteps(workspaceId, runId) {
      const data = must(await sb.from("auto_run_steps").select("*").eq("workspace_id", workspaceId).eq("run_id", runId).order("n", { ascending: true })) as Row[] | null;
      return (data ?? []).map(stepFrom);
    },

    async updateStep(workspaceId, id, patch) {
      const o: Row = { updated_at: new Date().toISOString() };
      if (patch.status !== undefined) o.status = patch.status;
      if (patch.plan !== undefined) o.plan = patch.plan;
      if (patch.approvedBy !== undefined) o.approved_by = patch.approvedBy;
      if (patch.decided !== undefined) o.decided = patch.decided;
      if (patch.handoff !== undefined) o.handoff = patch.handoff;
      if (patch.outcome !== undefined) o.outcome = patch.outcome;
      const data = must(await sb.from("auto_run_steps").update(o).eq("workspace_id", workspaceId).eq("id", id).select("*").maybeSingle()) as Row | null;
      if (!data) throw new StoreError("step not found");
      return stepFrom(data);
    },

    // ── approvals and the email ledger ──
    async insertApproval(a) {
      const row = {
        workspace_id: a.workspaceId,
        run_id: a.runId,
        step_id: a.stepId,
        step_n: a.stepN,
        plan_index: a.planIndex,
        agent_id: a.agentId || null,
        agent_name: a.agentName,
        contact_id: a.contactId,
        deal_id: a.dealId,
        action_type: a.actionType,
        what: a.what,
        about: a.about,
        action: a.action,
        state: a.state,
        asked: a.asked,
        due_at: a.dueAt,
      };
      return approvalFrom(must(await sb.from("auto_approvals").insert(row).select("*").single()) as Row);
    },

    async getApproval(workspaceId, id) {
      const data = must(await sb.from("auto_approvals").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      return data ? approvalFrom(data) : null;
    },

    async listApprovals(workspaceId, filter = {}) {
      let q = sb.from("auto_approvals").select("*").eq("workspace_id", workspaceId);
      if (filter.states) q = q.in("state", filter.states);
      if (filter.runId) q = q.eq("run_id", filter.runId);
      const data = must(await q.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(PAGE)) as Row[] | null;
      return (data ?? []).map(approvalFrom);
    },

    async moveApproval(workspaceId, id, from, patch) {
      // One conditional update on the state: the claim that lets an approval be carried out at most once.
      const o = { ...approvalRow(patch), updated_at: new Date().toISOString() };
      const data = must(await sb.from("auto_approvals").update(o).eq("workspace_id", workspaceId).eq("id", id).eq("state", from).select("*").maybeSingle()) as Row | null;
      return data ? approvalFrom(data) : null;
    },

    async listQueuedDue(now, limit, workspaceId) {
      let q = sb.from("auto_approvals").select("*").eq("state", "queued").lte("due_at", now);
      if (workspaceId) q = q.eq("workspace_id", workspaceId);
      return ((must(await q.order("due_at", { ascending: true }).limit(limit)) as Row[] | null) ?? []).map(approvalFrom);
    },

    async countEmails(workspaceId, contactId) {
      return count(
        sb.from("auto_approvals").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("contact_id", contactId).eq("action_type", "send_email").in("state", ["pending", "queued", "working", "done"]),
      );
    },

    async emailSuppressed(organizationId, address) {
      // The suppression list belongs to the Email area. Where its table does not exist, nobody can have unsubscribed.
      const got = await sb.from("email_suppressions").select("email").eq("organization_id", organizationId).eq("email", address.trim().toLowerCase()).limit(1);
      return !got.error && Array.isArray(got.data) && got.data.length > 0;
    },

    // ── events ──
    async listOpenEvents(now, limit, workspaceId) {
      let q = sb.from("auto_events").select("*").is("processed_at", null).eq("own", false).lt("locked_until", now);
      if (workspaceId) q = q.eq("workspace_id", workspaceId);
      return ((must(await q.order("created_at", { ascending: true }).limit(limit)) as Row[] | null) ?? []).map(eventFrom);
    },

    async claimEvent(id, now, leaseMs) {
      const until = new Date(Date.parse(now) + leaseMs).toISOString();
      const data = must(await sb.from("auto_events").update({ locked_until: until }).eq("id", id).is("processed_at", null).lt("locked_until", now).select("*").maybeSingle()) as Row | null;
      if (!data) return null;
      // We hold it now, so counting the attempt cannot race with another worker.
      const attempts = num(data.attempts) + 1;
      await sb.from("auto_events").update({ attempts }).eq("id", id);
      return { ...eventFrom(data), attempts };
    },

    async finishEvent(id, now) {
      const r = await sb.from("auto_events").update({ processed_at: now }).eq("id", id);
      if (r.error) throw new StoreError(r.error.message);
    },

    async purge(before) {
      const events = await sb.from("auto_events").delete().lt("processed_at", before);
      if (events.error) throw new StoreError(events.error.message);
      const marks = await sb.from("auto_marks").delete().lt("expires_at", before);
      if (marks.error) throw new StoreError(marks.error.message);
    },

    // ── usage ──
    async insertUsage(u) {
      const r = await sb.from("auto_usage").insert({
        workspace_id: u.workspaceId,
        run_id: u.runId,
        agent_id: u.agentId,
        user_id: u.userId,
        feature: u.feature,
        model: u.model,
        input_tokens: u.inputTokens,
        output_tokens: u.outputTokens,
        cache_read_input_tokens: u.cacheReadInputTokens,
        cache_creation_input_tokens: u.cacheCreationInputTokens,
        web_searches: u.webSearches,
        cost_micro_usd: u.costMicroUsd,
      });
      if (r.error) throw new StoreError(r.error.message);
    },

    spentMicroUsd: (workspaceId, since) => spent(workspaceId, since, null),
    runCostMicroUsd: (workspaceId, runId) => spent(workspaceId, null, runId),

    async countUsage(workspaceId, by) {
      return count(sb.from("auto_usage").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("feature", by.feature).eq("user_id", by.userId).gte("created_at", by.since));
    },

    // ── the CRM (always inside the workspace) ──
    async getLead(workspaceId, id) {
      const data = must(await sb.from("crm_contacts").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      return data ? leadFrom(data) : null;
    },

    async newestLead(workspaceId) {
      const data = must(await sb.from("crm_contacts").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1)) as Row[] | null;
      return data && data.length > 0 ? leadFrom(data[0]) : null;
    },

    async getCompany(workspaceId, id) {
      const data = must(await sb.from("crm_companies").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      return data ? companyFrom(data) : null;
    },

    async getDeal(workspaceId, id) {
      const data = must(await sb.from("crm_deals").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      return data ? dealFrom(data) : null;
    },

    async dealsOfLead(workspaceId, contactId) {
      const data = must(await sb.from("crm_deals").select("*").eq("workspace_id", workspaceId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(50)) as Row[] | null;
      return (data ?? []).map(dealFrom);
    },

    async listStages(workspaceId) {
      const data = must(await sb.from("crm_deal_stages").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true })) as Row[] | null;
      return (data ?? []).map(stageFrom);
    },

    async timeline(workspaceId, contactId, limit) {
      const notes = must(await sb.from("crm_notes").select("body, user_id, created_at").eq("workspace_id", workspaceId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(limit)) as Row[] | null;
      // A `note` activity only repeats a note, so those are left out.
      const acts = must(
        await sb.from("crm_activities").select("type, description, metadata, created_at").eq("workspace_id", workspaceId).eq("contact_id", contactId).neq("type", "note").order("created_at", { ascending: false }).limit(limit),
      ) as Row[] | null;
      const out: TimelineItem[] = [
        ...(notes ?? []).map((n): TimelineItem => ({ kind: "note", type: "note", text: str(n.body), at: n.created_at, byAutomation: !n.user_id })),
        ...(acts ?? []).map((a): TimelineItem => ({ kind: "activity", type: str(a.type), text: str(a.description), at: a.created_at, byAutomation: a.metadata?.automation === true })),
      ];
      return out.sort((a, b) => b.at.localeCompare(a.at));
    },

    async addNote(lead, body) {
      const r = await sb.from("crm_notes").insert({ organization_id: lead.organizationId, workspace_id: lead.workspaceId, user_id: null, body, contact_id: lead.id, company_id: null, deal_id: null });
      if (r.error) throw new StoreError(r.error.message);
    },

    async logActivity(lead, a) {
      const r = await sb.from("crm_activities").insert({
        organization_id: lead.organizationId,
        workspace_id: lead.workspaceId,
        user_id: a.userId ?? null,
        type: a.type,
        description: a.description,
        contact_id: a.contactId,
        company_id: a.companyId,
        deal_id: a.dealId,
        task_id: null,
        metadata: a.metadata,
      });
      if (r.error) throw new StoreError(r.error.message);
    },

    async updateLead(lead, patch) {
      const o: Row = {};
      if (patch.lifecycleStage !== undefined) o.lifecycle_stage = patch.lifecycleStage;
      if (patch.lastContactedAt !== undefined) o.last_contacted_at = patch.lastContactedAt;
      // The status is written (and marked as our own) only when it really changes: the CRM trigger fires on that alone.
      const statusChanges = patch.leadStatus !== undefined && patch.leadStatus !== lead.leadStatus;
      if (statusChanges) o.lead_status = patch.leadStatus;
      if (Object.keys(o).length === 0) return;
      if (statusChanges) await mark(lead.workspaceId, lead.id);
      const r = await sb.from("crm_contacts").update(o).eq("workspace_id", lead.workspaceId).eq("id", lead.id);
      if (r.error) {
        if (statusChanges) await unmark(lead.id);
        throw new StoreError(r.error.message);
      }
    },

    async addFollowUp(lead, f) {
      const r = await sb.from("crm_tasks").insert({
        organization_id: lead.organizationId,
        workspace_id: lead.workspaceId,
        project_id: null,
        shared_task_id: null,
        owner_id: f.ownerId,
        assigned_to: f.ownerId,
        contact_id: f.contactId,
        company_id: f.companyId,
        deal_id: f.dealId,
        title: f.title,
        description: f.description,
        due_date: f.dueDate,
        priority: "medium",
        status: "pending",
      });
      if (r.error) throw new StoreError(r.error.message);
    },

    async insertDeal(lead, d) {
      await mark(lead.workspaceId, d.id);
      const r = await sb.from("crm_deals").insert({
        id: d.id,
        organization_id: lead.organizationId,
        workspace_id: lead.workspaceId,
        owner_id: d.ownerId,
        stage_id: d.stageId,
        company_id: d.companyId,
        contact_id: d.contactId,
        name: d.name,
        value: d.value,
        probability: d.probability,
        status: d.status,
        expected_close_date: null,
        source: d.source,
        notes: null,
      });
      if (r.error) {
        await unmark(d.id);
        throw new StoreError(r.error.message);
      }
    },

    async updateDeal(workspaceId, id, patch) {
      const current = must(await sb.from("crm_deals").select("stage_id, status").eq("workspace_id", workspaceId).eq("id", id).maybeSingle()) as Row | null;
      if (!current) throw new StoreError("deal not found");
      const o: Row = {};
      if (patch.stageId !== undefined) o.stage_id = patch.stageId;
      if (patch.status !== undefined) o.status = patch.status;
      if (patch.probability !== undefined) o.probability = patch.probability;
      if (patch.projectId !== undefined) {
        // The hand-off link, as the app's linkDealHandoff writes it.
        o.project_id = patch.projectId;
        o.workspace_id = workspaceId;
      }
      const closing: Row = {};
      if (patch.closedAt !== undefined) closing.closed_at = patch.closedAt;
      if (patch.lostReason !== undefined) closing.lost_reason = patch.lostReason;
      // The CRM trigger reports a change of stage or status: only then is the write marked as our own.
      const moves = (patch.stageId !== undefined && patch.stageId !== current.stage_id) || (patch.status !== undefined && patch.status !== current.status);
      if (moves) await mark(workspaceId, id);
      const write = (values: Row) => sb.from("crm_deals").update(values).eq("workspace_id", workspaceId).eq("id", id);
      let r = await write({ ...o, ...closing });
      // Before migration 180 the close date and the lost reason have no column: the rest is still saved.
      if (r.error && missingColumn(r.error, /closed_at|lost_reason/) && Object.keys(o).length > 0) r = await write(o);
      if (r.error) {
        if (moves) await unmark(id);
        throw new StoreError(r.error.message);
      }
    },

    // ── projects and notifications ──
    async insertProject(p) {
      const now = new Date().toISOString();
      const r = await sb.from("projects").insert({
        project_id: p.id,
        name: p.name,
        description: p.description,
        cover_color: "#2563eb",
        owner_id: p.ownerId,
        organization_id: p.organizationId,
        workspace_id: p.workspaceId,
        created_by: p.ownerId,
        columns: p.columns,
        members: p.members,
        created_at: now,
        updated_at: now,
      });
      if (r.error) throw new StoreError(r.error.message);
    },

    async insertProjectTask(t) {
      const now = new Date().toISOString();
      const row: Row = {
        task_id: t.id,
        project_id: t.projectId,
        organization_id: t.organizationId,
        title: t.title,
        description: "",
        status: t.status,
        priority: "medium",
        priority_color: "#FFA500",
        due_date: t.dueDate,
        assignees: t.assignee ? [t.assignee] : [],
        tags: [],
        subtasks: [],
        parent_task_id: null,
        urgent: false,
        meeting_starts_at: null,
        meeting_duration_minutes: null,
        is_locked: false,
        lock_pin_hash: null,
        position: t.position,
        attachments: [],
        comments_count: 0,
        created_by: t.createdBy,
        created_at: now,
        updated_at: now,
        completed_at: null,
        source_deal_id: null,
        source_client_id: null,
      };
      const source: Row = { source_crm_deal_id: t.dealId, ...(t.contactId ? { source_crm_contact_id: t.contactId } : {}) };
      let r = await sb.from("tasks").insert({ ...row, ...source });
      // As the app does: a database without the CRM source columns still gets the task.
      if (r.error && missingColumn(r.error, /source_crm_/)) r = await sb.from("tasks").insert(row);
      if (r.error) throw new StoreError(r.error.message);
    },

    async notify(rows) {
      if (rows.length === 0) return;
      const now = new Date().toISOString();
      const r = await sb.from("notifications").insert(
        rows.map((n) => ({
          user_id: n.userId,
          type: "automation",
          title: n.title,
          message: n.message,
          task_id: null,
          project_id: n.projectId ?? null,
          actor_user_id: null,
          actor_display_name: n.actorName ?? null,
          read: false,
          link: n.link,
          created_at: now,
        })),
      );
      if (r.error) throw new StoreError(r.error.message);
    },
  };
}
