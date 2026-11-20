// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, StoreError } from "../../../../api/_signroom/errors";
import { supabaseStore } from "../../../../api/_automation/supabaseStore";
import type { Lead } from "../../../../api/_automation/store";

/**
 * The store on Supabase, against a recording stand-in for the client: that
 * every query names the workspace, that the claims are single conditional
 * updates, that an ended run is never changed, and that the server marks its
 * own CRM writes exactly when the CRM trigger would report them.
 */

type Call = { table?: string; rpc?: string; ops: [string, ...unknown[]][]; args?: unknown };
type Answer = unknown | { __error: { message: string; code?: string } } | { __count: number };

/** Answers each table's calls from its own queue (the last answer repeats), and records every call. */
function fakeSb(results: Record<string, Answer[]>) {
  const calls: Call[] = [];
  const next = (key: string) => {
    const queue = results[key] ?? [];
    const v = queue.length > 1 ? queue.shift() : queue[0];
    if (v && typeof v === "object" && "__error" in v) return { data: null, count: null, error: (v as { __error: unknown }).__error };
    if (v && typeof v === "object" && "__count" in v) return { data: null, count: (v as { __count: number }).__count, error: null };
    return { data: v ?? null, count: null, error: null };
  };
  const builder = (call: Call, key: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "gt", "gte", "lt", "lte"]) {
      b[m] = (...a: unknown[]) => {
        call.ops.push([m, ...a]);
        return b;
      };
    }
    b.maybeSingle = () => Promise.resolve(next(key));
    b.single = () => Promise.resolve(next(key));
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(next(key)).then(res, rej);
    return b;
  };
  const sb = {
    from(table: string) {
      const c: Call = { table, ops: [] };
      calls.push(c);
      return builder(c, table);
    },
    rpc(fn: string, args: unknown) {
      calls.push({ rpc: fn, ops: [], args });
      return Promise.resolve(next(fn));
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const W = "0a000000-0000-4000-8000-000000000001";
const NOW = "2026-11-18T10:00:00.000Z";
const EPOCH = "1970-01-01T00:00:00.000Z";
const has = (c: Call, ...op: unknown[]) => c.ops.some((o) => JSON.stringify(o) === JSON.stringify(op));
const opOf = (c: Call, name: string) => c.ops.find((o) => o[0] === name)?.[1] as Record<string, unknown>;

const runRow = { id: "r1", workspace_id: W, automation_id: "a1", automation_name: "Chain", contact_id: "c1", deal_id: null, project_id: null, subject: "Northwind", status: "waiting", result: "", steps: [], position: 2, waiting_on: "reply", waiting_for: "A reply.", wake_at: null, handoff: "h", step_done_at: NOW, replied_at: null, reply_positive: null, reply_note: "", reply_seen_at: null, attempts: 0, last_error: null, locked_until: "1970-01-01T00:00:00+00:00", emails_sent: 1, started_at: NOW, finished_at: null, updated_at: NOW };
const lead: Lead = { id: "c1", workspaceId: W, organizationId: "o1", ownerId: "u1", companyId: null, firstName: "Elena", lastName: "Rossi", email: "e@n.example", phone: "", jobTitle: "", lifecycleStage: "lead", leadStatus: "new", source: "", notes: "", created: NOW };

describe("supabaseStore: workspaces and people", () => {
  it("reads the workspace, then the organisation that owns it, and works out the role as the documents server does", async () => {
    const { sb, calls } = fakeSb({ workspaces: [{ workspace_id: W, organization_id: "o1", name: "Studio" }], organizations: [{ owner_id: "u9", members: [{ userId: "u1", role: "admin", status: "active" }, { userId: "u2", role: "member", status: "removed" }], default_timezone: "Asia/Karachi" }] });
    const store = supabaseStore(sb);
    expect(await store.workspaceAccess(W, "u1")).toEqual({ workspaceId: W, name: "Studio", organizationId: "o1", role: "admin", timeZone: "Asia/Karachi" });
    expect(await store.workspaceAccess(W, "u9")).toMatchObject({ role: "owner" });
    expect(await store.workspaceAccess(W, "u2")).toBeNull();
    expect(await store.workspaceAccess(W, "nobody")).toBeNull();
    expect(has(calls[0], "eq", "workspace_id", W)).toBe(true);
    expect(has(calls[1], "eq", "organization_id", "o1")).toBe(true);
  });

  it("an unknown workspace is no access, and an organisation with no time zone column reads as UTC", async () => {
    expect(await supabaseStore(fakeSb({ workspaces: [null] }).sb).workspaceAccess(W, "u1")).toBeNull();
    const { sb } = fakeSb({ workspaces: [{ workspace_id: W, organization_id: "o1", name: "Studio" }], organizations: [{ owner_id: "u1", members: [] }] });
    expect(await supabaseStore(sb).workspaceInfo(W)).toEqual({ workspaceId: W, name: "Studio", organizationId: "o1", timeZone: "UTC" });
  });

  it("the organisation's people: active ones only, named from their profiles", async () => {
    const { sb } = fakeSb({
      organizations: [{ owner_id: "u9", members: [{ userId: "u1", role: "admin", status: "active", displayName: "Old name", email: "sam@x.example" }, { userId: "u2", role: "member", status: "invited" }, { userId: "u3", role: "viewer" }] }],
      user_profiles: [[{ id: "u1", email: "sam@studio.example", display_name: "Sam", photo_url: "p.png" }, { id: "u9", email: "boss@studio.example", display_name: "", photo_url: null }]],
    });
    expect(await supabaseStore(sb).orgPeople("o1")).toEqual([
      { userId: "u9", name: "boss@studio.example", email: "boss@studio.example", photoURL: "", role: "owner" },
      { userId: "u1", name: "Sam", email: "sam@studio.example", photoURL: "p.png", role: "admin" },
      { userId: "u3", name: "", email: "", photoURL: "", role: "viewer" },
    ]);
  });
});

describe("supabaseStore: runs", () => {
  it("maps a run row, reading the epoch as “nobody holds it”", async () => {
    const { sb, calls } = fakeSb({ auto_runs: [runRow] });
    const run = await supabaseStore(sb).getRun(W, "r1");
    expect(run).toMatchObject({ id: "r1", workspaceId: W, automationId: "a1", contactId: "c1", status: "waiting", position: 2, waitingOn: "reply", lockedUntil: null, emailsSent: 1, started: NOW, finished: null });
    expect(has(calls[0], "eq", "workspace_id", W) && has(calls[0], "eq", "id", "r1")).toBe(true);
  });

  it("claims a run with one conditional update: not ended, and nobody holding it", async () => {
    const { sb, calls } = fakeSb({ auto_runs: [{ ...runRow, locked_until: "2026-11-18T10:06:00.000Z" }, null] });
    const store = supabaseStore(sb);
    const mine = await store.claimRun("r1", NOW, 360_000);
    expect(mine?.lockedUntil).toBe("2026-11-18T10:06:00.000Z");
    expect(opOf(calls[0], "update")).toEqual({ locked_until: "2026-11-18T10:06:00.000Z" });
    expect(has(calls[0], "eq", "id", "r1")).toBe(true);
    expect(has(calls[0], "in", "status", ["running", "waiting", "needs_approval"])).toBe(true);
    expect(has(calls[0], "lt", "locked_until", NOW)).toBe(true);
    // The row did not match for the second caller.
    expect(await store.claimRun("r1", NOW, 360_000)).toBeNull();
  });

  it("due runs are those awake, not ended and not held", async () => {
    const { sb, calls } = fakeSb({ auto_runs: [[runRow]] });
    await supabaseStore(sb).listDueRuns(NOW, 50, W);
    expect(has(calls[0], "in", "status", ["running", "waiting"])).toBe(true);
    expect(has(calls[0], "lte", "wake_at", NOW)).toBe(true);
    expect(has(calls[0], "lt", "locked_until", NOW)).toBe(true);
    expect(has(calls[0], "eq", "workspace_id", W)).toBe(true);
  });

  it("an update only ever changes a run that has not ended; an ended run comes back as it ended, and its hold can still be given back", async () => {
    const ended = { ...runRow, status: "stopped", result: "Stopped by a person." };
    const { sb, calls } = fakeSb({ auto_runs: [null, { __count: 0 }, ended] });
    const out = await supabaseStore(sb).updateRun(W, "r1", { status: "running", wakeAt: NOW, lockedUntil: null });
    expect(out).toMatchObject({ status: "stopped", result: "Stopped by a person." });
    expect(has(calls[0], "in", "status", ["running", "waiting", "needs_approval"])).toBe(true);
    expect(opOf(calls[0], "update")).toMatchObject({ status: "running", wake_at: NOW, locked_until: EPOCH });
    // Only the hold is written to the ended run.
    expect(opOf(calls[1], "update")).toEqual({ locked_until: EPOCH });
    expect(calls).toHaveLength(3);
  });

  it("a second run of the same automation for the same lead is refused by the database and reads as “already there”", async () => {
    const { sb } = fakeSb({ auto_runs: [{ __error: { message: "duplicate key value violates unique constraint auto_runs_one_per_lead", code: "23505" } }] });
    expect(await supabaseStore(sb).insertRun({ workspaceId: W, automationId: "a1", automationName: "Chain", contactId: "c1", dealId: null, subject: "x", steps: [], wakeAt: NOW })).toBeNull();
    const other = fakeSb({ auto_runs: [{ __error: { message: "connection reset" } }] });
    await expect(supabaseStore(other.sb).insertRun({ workspaceId: W, automationId: "a1", automationName: "Chain", contactId: "c1", dealId: null, subject: "x", steps: [], wakeAt: NOW })).rejects.toBeInstanceOf(StoreError);
  });

  it("the lead's active runs are asked for inside the workspace", async () => {
    const { sb, calls } = fakeSb({ auto_runs: [[]] });
    const store = supabaseStore(sb);
    await store.activeRuns(W, { contactId: "c1", dealId: "d1" });
    expect(has(calls[0], "eq", "workspace_id", W)).toBe(true);
    expect(has(calls[0], "or", "contact_id.eq.c1,deal_id.eq.d1")).toBe(true);
    expect(await store.activeRuns(W, {})).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("supabaseStore: approvals, rules and events", () => {
  it("moves an approval only from the state it is expected in: the claim that makes it happen once", async () => {
    const row = { id: "p1", workspace_id: W, run_id: "r1", step_id: "s1", step_n: 3, plan_index: 0, agent_id: "g1", agent_name: "Writer", contact_id: "c1", deal_id: null, action_type: "send_email", what: "Send", about: "N", action: { type: "send_email", subject: "s", body: "b" }, state: "working", asked: true, created_at: NOW, updated_at: NOW };
    const { sb, calls } = fakeSb({ auto_approvals: [row, null] });
    const store = supabaseStore(sb);
    expect(await store.moveApproval(W, "p1", "pending", { state: "working", decidedBy: "u1" })).toMatchObject({ state: "working", stepN: 3, actionType: "send_email" });
    expect(has(calls[0], "eq", "state", "pending") && has(calls[0], "eq", "workspace_id", W) && has(calls[0], "eq", "id", "p1")).toBe(true);
    expect(opOf(calls[0], "update")).toMatchObject({ state: "working", decided_by: "u1" });
    expect(await store.moveApproval(W, "p1", "pending", { state: "working" })).toBeNull();
  });

  it("counts a lead's emails that were sent or still wait, inside the workspace", async () => {
    const { sb, calls } = fakeSb({ auto_approvals: [{ __count: 2 }] });
    expect(await supabaseStore(sb).countEmails(W, "c1")).toBe(2);
    expect(has(calls[0], "eq", "workspace_id", W) && has(calls[0], "eq", "contact_id", "c1") && has(calls[0], "eq", "action_type", "send_email")).toBe(true);
    expect(has(calls[0], "in", "state", ["pending", "queued", "working", "done"])).toBe(true);
  });

  it("saves rules only at the revision they were read at", async () => {
    const { sb, calls } = fakeSb({ auto_rules: [null] });
    expect(await supabaseStore(sb).updateRules(W, 4, { enabled: false, monthlyBudgetCents: 500 })).toBeNull();
    expect(has(calls[0], "eq", "revision", 4) && has(calls[0], "eq", "workspace_id", W)).toBe(true);
    expect(opOf(calls[0], "update")).toMatchObject({ enabled: false, monthly_budget_cents: 500, revision: 5 });
  });

  it("“process now” and “budget reached” are single conditional updates", async () => {
    const { sb, calls } = fakeSb({ auto_rules: [[{ workspace_id: W }], []] });
    const store = supabaseStore(sb);
    expect(await store.takeNudge(W, NOW, 60_000)).toBe(true);
    expect(has(calls[0], "lte", "nudged_at", "2026-11-18T09:59:00.000Z")).toBe(true);
    expect(await store.markBudgetNotified(W, "2026-11")).toBe(false);
    expect(has(calls[1], "neq", "budget_notified_month", "2026-11")).toBe(true);
  });

  it("the first set-up wins a race: a second insert of the rules reads the row that is there", async () => {
    const existing = { workspace_id: W, organization_id: "o1", enabled: true, autonomy: "ask_external", monthly_budget_cents: 500, emails_per_lead: 3, send_window: {}, web_research: true, project: {}, revision: 7, budget_notified_month: "", nudged_at: "1970-01-01T00:00:00+00:00", updated_at: NOW };
    const { sb } = fakeSb({ auto_rules: [{ __error: { message: "duplicate key", code: "23505" } }, existing] });
    const out = await supabaseStore(sb).insertRules({ workspaceId: W, organizationId: "o1", enabled: true, autonomy: "full", monthlyBudgetCents: 2000, emailsPerLead: 3, sendWindow: { weekdaysOnly: true, startHour: 9, endHour: 18, timeZone: "UTC" }, webResearch: true, project: { nameTemplate: "x", lead: "deal_owner", addEveryone: true, columns: [], tasks: [], agentMayAddTasks: true } });
    expect(out).toMatchObject({ monthlyBudgetCents: 500, revision: 7, autonomy: "ask_external", budgetNotifiedMonth: null, nudgedAt: null });
  });

  it("open events are the ones not handled, not the server's own and not held; a claim is one conditional update", async () => {
    const event = { id: "e1", workspace_id: W, type: "lead_created", contact_id: "c1", deal_id: null, payload: { source: null }, own: false, attempts: 0, created_at: NOW };
    const { sb, calls } = fakeSb({ auto_events: [[event], event, null, null] });
    const store = supabaseStore(sb);
    expect(await store.listOpenEvents(NOW, 50)).toEqual([{ id: "e1", workspaceId: W, type: "lead_created", contactId: "c1", dealId: null, payload: { source: null }, own: false, attempts: 0, created: NOW }]);
    expect(has(calls[0], "is", "processed_at", null) && has(calls[0], "eq", "own", false) && has(calls[0], "lt", "locked_until", NOW)).toBe(true);
    expect((await store.claimEvent("e1", NOW, 300_000))?.attempts).toBe(1);
    expect(has(calls[1], "is", "processed_at", null) && has(calls[1], "lt", "locked_until", NOW)).toBe(true);
    expect(opOf(calls[2], "update")).toEqual({ attempts: 1 });
    expect(await store.claimEvent("e1", NOW, 300_000)).toBeNull();
  });

  it("the month's spend is summed in the database", async () => {
    const { sb, calls } = fakeSb({ auto_spent_micro_usd: ["4200000"] });
    const store = supabaseStore(sb);
    expect(await store.spentMicroUsd(W, "2026-11-01T00:00:00.000Z")).toBe(4_200_000);
    expect(calls[0]).toMatchObject({ rpc: "auto_spent_micro_usd", args: { p_workspace: W, p_since: "2026-11-01T00:00:00.000Z", p_run: null } });
    await store.runCostMicroUsd(W, "r1");
    expect(calls[1].args).toEqual({ p_workspace: W, p_since: null, p_run: "r1" });
  });

  it("a duplicate automation name is a 409 sentence; any other failure is a StoreError", async () => {
    const taken = fakeSb({ auto_automations: [{ __error: { message: "duplicate key", code: "23505" } }] });
    const e = await supabaseStore(taken.sb).insertAutomation({ workspaceId: W, name: "Chain", status: "draft", trigger: { type: "lead_created", skipImports: false }, steps: [] }).then(() => null, (err: unknown) => err);
    expect(e).toBeInstanceOf(AppError);
    expect([(e as AppError).status, (e as AppError).message]).toEqual([409, "This workspace already has an automation with that name."]);
    const missing = fakeSb({ auto_rules: [{ __error: { message: "Could not find the table 'public.auto_rules' in the schema cache" } }] });
    await expect(supabaseStore(missing.sb).ready()).rejects.toThrow("Could not find the table 'public.auto_rules' in the schema cache");
  });
});

describe("supabaseStore: the CRM, written as the app writes it", () => {
  it("a lead's status change is marked as the server's own first, and only when the status really changes", async () => {
    const { sb, calls } = fakeSb({});
    const store = supabaseStore(sb);
    await store.updateLead(lead, { leadStatus: "connected", lifecycleStage: "sales_qualified_lead" });
    expect(calls.map((c) => c.table)).toEqual(["auto_marks", "crm_contacts"]);
    expect(opOf(calls[0], "insert")).toMatchObject({ workspace_id: W, entity_id: "c1" });
    expect(Date.parse(String(opOf(calls[0], "insert").expires_at))).toBeGreaterThan(Date.now());
    expect(opOf(calls[1], "update")).toEqual({ lifecycle_stage: "sales_qualified_lead", lead_status: "connected" });
    expect(has(calls[1], "eq", "workspace_id", W) && has(calls[1], "eq", "id", "c1")).toBe(true);

    // The same status again, or no status at all: the trigger will report nothing, so no mark is left behind.
    calls.length = 0;
    await store.updateLead(lead, { leadStatus: "new", lifecycleStage: "customer" });
    await store.updateLead(lead, { lastContactedAt: NOW });
    expect(calls.map((c) => c.table)).toEqual(["crm_contacts", "crm_contacts"]);
    expect(opOf(calls[0], "update")).toEqual({ lifecycle_stage: "customer" });
    calls.length = 0;
    await store.updateLead(lead, { leadStatus: "new" });
    expect(calls).toHaveLength(0);
  });

  it("a mark whose write failed is taken away again", async () => {
    const { sb, calls } = fakeSb({ crm_contacts: [{ __error: { message: "Related CRM records must belong to the same workspace" } }] });
    await expect(supabaseStore(sb).updateLead(lead, { leadStatus: "unqualified" })).rejects.toBeInstanceOf(StoreError);
    expect(calls.map((c) => [c.table, c.ops[0][0]])).toEqual([["auto_marks", "insert"], ["crm_contacts", "update"], ["auto_marks", "delete"]]);
    expect(has(calls[2], "eq", "entity_id", "c1")).toBe(true);
  });

  it("opens a deal with the app's columns under an id the server chose, marked first", async () => {
    const { sb, calls } = fakeSb({});
    await supabaseStore(sb).insertDeal(lead, { id: "d1", ownerId: "u1", stageId: "s2", companyId: null, contactId: "c1", name: "Website", value: 12000, probability: 25, status: "open", source: null });
    expect(calls.map((c) => c.table)).toEqual(["auto_marks", "crm_deals"]);
    expect(opOf(calls[0], "insert").entity_id).toBe("d1");
    expect(opOf(calls[1], "insert")).toEqual({ id: "d1", organization_id: "o1", workspace_id: W, owner_id: "u1", stage_id: "s2", company_id: null, contact_id: "c1", name: "Website", value: 12000, probability: 25, status: "open", expected_close_date: null, source: null, notes: null });
  });

  it("a deal's stage or status change is marked; linking a project is not; before migration 180 the close fields are left out", async () => {
    const { sb, calls } = fakeSb({ crm_deals: [{ stage_id: "s2", status: "open" }, null] });
    const store = supabaseStore(sb);
    await store.updateDeal(W, "d1", { stageId: "s6", status: "won", probability: 100, closedAt: NOW, lostReason: null });
    expect(calls.map((c) => c.table)).toEqual(["crm_deals", "auto_marks", "crm_deals"]);
    expect(opOf(calls[2], "update")).toEqual({ stage_id: "s6", status: "won", probability: 100, closed_at: NOW, lost_reason: null });
    expect(has(calls[2], "eq", "workspace_id", W) && has(calls[2], "eq", "id", "d1")).toBe(true);

    const link = fakeSb({ crm_deals: [{ stage_id: "s6", status: "won" }, null] });
    await supabaseStore(link.sb).updateDeal(W, "d1", { projectId: "p1" });
    expect(link.calls.map((c) => c.table)).toEqual(["crm_deals", "crm_deals"]);
    expect(opOf(link.calls[1], "update")).toEqual({ project_id: "p1", workspace_id: W });

    const old = fakeSb({ crm_deals: [{ stage_id: "s2", status: "open" }, { __error: { message: "Could not find the 'closed_at' column of 'crm_deals' in the schema cache" } }, null] });
    await supabaseStore(old.sb).updateDeal(W, "d1", { stageId: "s6", status: "won", closedAt: NOW });
    expect(opOf(old.calls[3], "update")).toEqual({ stage_id: "s6", status: "won" });

    await expect(supabaseStore(fakeSb({ crm_deals: [null] }).sb).updateDeal(W, "gone", { status: "won" })).rejects.toBeInstanceOf(StoreError);
  });

  it("notes, activities and follow-ups carry the lead's own organisation and workspace", async () => {
    const { sb, calls } = fakeSb({});
    const store = supabaseStore(sb);
    await store.addNote(lead, "A note.");
    await store.logActivity(lead, { type: "email", description: "Sent", contactId: "c1", companyId: null, dealId: null, metadata: { automation: true, agent: "Writer" } });
    await store.addFollowUp(lead, { ownerId: "u1", contactId: "c1", companyId: null, dealId: null, title: "Call", description: "d", dueDate: NOW });
    expect(opOf(calls[0], "insert")).toEqual({ organization_id: "o1", workspace_id: W, user_id: null, body: "A note.", contact_id: "c1", company_id: null, deal_id: null });
    expect(opOf(calls[1], "insert")).toEqual({ organization_id: "o1", workspace_id: W, user_id: null, type: "email", description: "Sent", contact_id: "c1", company_id: null, deal_id: null, task_id: null, metadata: { automation: true, agent: "Writer" } });
    expect(opOf(calls[2], "insert")).toEqual({ organization_id: "o1", workspace_id: W, project_id: null, shared_task_id: null, owner_id: "u1", assigned_to: "u1", contact_id: "c1", company_id: null, deal_id: null, title: "Call", description: "d", due_date: NOW, priority: "medium", status: "pending" });
    expect(calls.map((c) => c.table)).toEqual(["crm_notes", "crm_activities", "crm_tasks"]);
  });

  it("every CRM read is inside the workspace", async () => {
    const { sb, calls } = fakeSb({});
    const store = supabaseStore(sb);
    await store.getLead(W, "c1");
    await store.newestLead(W);
    await store.getCompany(W, "co1");
    await store.getDeal(W, "d1");
    await store.dealsOfLead(W, "c1");
    await store.listStages(W);
    await store.timeline(W, "c1", 15);
    expect(calls.map((c) => c.table)).toEqual(["crm_contacts", "crm_contacts", "crm_companies", "crm_deals", "crm_deals", "crm_deal_stages", "crm_notes", "crm_activities"]);
    for (const c of calls) expect(has(c, "eq", "workspace_id", W), c.table).toBe(true);
  });

  it("a project and its tasks are the rows the app itself writes; a database without the CRM source columns still gets the task", async () => {
    const { sb, calls } = fakeSb({ tasks: [{ __error: { message: "Could not find the 'source_crm_deal_id' column of 'tasks' in the schema cache" } }, null] });
    const store = supabaseStore(sb);
    await store.insertProject({ id: "p1", organizationId: "o1", workspaceId: W, ownerId: "u1", name: "Northwind", description: "Won deal", columns: [{ id: "todo", title: "To-do", color: "#FF9800", order: 0 }], members: [] });
    expect(opOf(calls[0], "insert")).toMatchObject({ project_id: "p1", name: "Northwind", description: "Won deal", cover_color: "#2563eb", owner_id: "u1", organization_id: "o1", workspace_id: W, created_by: "u1", columns: [{ id: "todo", title: "To-do", color: "#FF9800", order: 0 }], members: [] });
    await store.insertProjectTask({ id: "t1", projectId: "p1", organizationId: "o1", title: "Kick-off", status: "todo", dueDate: NOW, position: 0, createdBy: "u1", assignee: { userId: "u1", displayName: "Sam", email: "s@x.example", photoURL: "" }, dealId: "d1", contactId: "c1" });
    expect(opOf(calls[1], "insert")).toMatchObject({ task_id: "t1", project_id: "p1", organization_id: "o1", title: "Kick-off", status: "todo", priority: "medium", priority_color: "#FFA500", due_date: NOW, assignees: [{ userId: "u1", displayName: "Sam", email: "s@x.example", photoURL: "" }], position: 0, created_by: "u1", source_crm_deal_id: "d1", source_crm_contact_id: "c1" });
    expect("source_crm_deal_id" in opOf(calls[2], "insert")).toBe(false);
    expect(opOf(calls[2], "insert")).toMatchObject({ task_id: "t1", title: "Kick-off" });
  });

  it("notifications go to the app's own table, one row per person", async () => {
    const { sb, calls } = fakeSb({});
    const store = supabaseStore(sb);
    await store.notify([]);
    expect(calls).toHaveLength(0);
    await store.notify([{ userId: "u1", title: "Approval needed", message: "Writer is waiting.", link: "/crm/automation", actorName: "Writer" }]);
    expect(calls[0].table).toBe("notifications");
    expect((opOf(calls[0], "insert") as unknown as Record<string, unknown>[])[0]).toMatchObject({ user_id: "u1", type: "automation", title: "Approval needed", message: "Writer is waiting.", link: "/crm/automation", actor_display_name: "Writer", read: false, project_id: null });
  });
});
