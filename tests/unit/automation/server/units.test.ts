// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { defaultRules, defaultTimeZone, isTimeZone } from "../../../../api/_automation/defaults";
import { fromImport } from "../../../../api/_automation/events";
import { boardColumns, dueIn, projectBrief, projectLead, projectName, taskColumn } from "../../../../api/_automation/project";
import { nextOpening, windowLabel, windowOpen } from "../../../../api/_automation/sendWindow";
import type { Run, WorkspaceRules } from "../../../../api/_automation/shared/types";
import type { Deal, Lead, Person } from "../../../../api/_automation/store";
import { agentInput, automationInput, clean, oneLine } from "../../../../api/_automation/validate";
import { answer, DAY, EMAIL, leadArrives, MEMBER, OWNER, ready, runOf, WS, world } from "./helpers";

/** The small rules on their own: the send window, the project a deal becomes, and what is read from a request. */

const london = { weekdaysOnly: true, startHour: 9, endHour: 18, timeZone: "Europe/London" };
const at = (iso: string) => new Date(iso);

describe("the send window", () => {
  it("is open on weekdays from the start hour up to, not including, the end hour, in its own time zone", () => {
    expect(windowOpen(london, at("2026-11-18T09:00:00Z"))).toBe(true);
    expect(windowOpen(london, at("2026-11-18T08:59:59Z"))).toBe(false);
    expect(windowOpen(london, at("2026-11-18T17:59:59Z"))).toBe(true);
    expect(windowOpen(london, at("2026-11-18T18:00:00Z"))).toBe(false);
    expect(windowOpen(london, at("2026-11-21T12:00:00Z"))).toBe(false);
    expect(windowOpen({ ...london, weekdaysOnly: false }, at("2026-11-21T12:00:00Z"))).toBe(true);
    // British summer time: 09:00 in London is 08:00 UTC in July.
    expect(windowOpen(london, at("2026-07-15T08:00:00Z"))).toBe(true);
    expect(windowOpen(london, at("2026-07-15T17:00:00Z"))).toBe(false);
    // Kolkata is five and a half hours ahead.
    const kolkata = { ...london, timeZone: "Asia/Kolkata" };
    expect(windowOpen(kolkata, at("2026-11-18T03:30:00Z"))).toBe(true);
    expect(windowOpen(kolkata, at("2026-11-18T03:29:00Z"))).toBe(false);
    expect(windowOpen({ ...london, startHour: 0, endHour: 24, weekdaysOnly: false }, at("2026-11-22T23:59:59Z"))).toBe(true);
  });

  it("the next opening: now when it is open, else the first moment it opens, weekends skipped", () => {
    expect(nextOpening(london, at("2026-11-18T10:07:00Z")).toISOString()).toBe("2026-11-18T10:07:00.000Z");
    expect(nextOpening(london, at("2026-11-18T19:30:00Z")).toISOString()).toBe("2026-11-19T09:00:00.000Z");
    expect(nextOpening(london, at("2026-11-20T18:00:00Z")).toISOString()).toBe("2026-11-23T09:00:00.000Z");
    expect(nextOpening({ ...london, timeZone: "Asia/Kolkata" }, at("2026-11-18T13:00:00Z")).toISOString()).toBe("2026-11-19T03:30:00.000Z");
    expect(windowLabel(london, at("2026-11-23T09:00:00Z"))).toBe("Mon 09:00");
  });

  it("a time zone the runtime does not know reads as UTC: an email can be late but is never lost", () => {
    const odd = { ...london, timeZone: "Mars/Olympus" };
    expect(windowOpen(odd, at("2026-11-18T09:00:00Z"))).toBe(true);
    expect(nextOpening(odd, at("2026-11-18T20:00:00Z")).toISOString()).toBe("2026-11-19T09:00:00.000Z");
  });

  it("the default zone is the organisation's when it chose one, else London", () => {
    expect([defaultTimeZone("Asia/Karachi"), defaultTimeZone("UTC"), defaultTimeZone(""), defaultTimeZone("Nowhere/Land")]).toEqual(["Asia/Karachi", "Europe/London", "Europe/London", "Europe/London"]);
    expect([isTimeZone("Europe/London"), isTimeZone("Nowhere/Land"), isTimeZone(5), isTimeZone("")]).toEqual([true, false, false, false]);
    expect(defaultRules(WS, "UTC")).toMatchObject({ enabled: true, autonomy: "ask_external", monthlyBudgetCents: 2000, emailsPerLead: 3, webResearch: true });
  });
});

describe("the project a won deal becomes", () => {
  const lead = { firstName: "Elena", lastName: "Rossi", email: "elena@northwind.example" };
  const person = (userId: string, role: Person["role"]): Person => ({ userId, name: userId, email: `${userId}@x.example`, photoURL: "", role });
  const deal = (over: Partial<Deal> = {}): Deal => ({ id: "d1", ownerId: "u2", stageId: "s", companyId: null, contactId: "c1", name: "Website", value: 12000, currency: "GBP", probability: 100, status: "won", projectId: null, notes: "Promised a launch in March.", created: "", ...over });

  it("its name comes from the template, and a company already in the deal's name is not said twice", () => {
    expect(projectName("{company} – {deal}", { name: "Website" }, { name: "Northwind Studio" }, lead)).toBe("Northwind Studio – Website");
    expect(projectName("{company} – {deal}", { name: "Northwind Studio website" }, { name: "Northwind Studio" }, lead)).toBe("Northwind Studio website");
    expect(projectName("{company} – {deal}", { name: "Website" }, null, lead)).toBe("Website");
    expect(projectName("{deal} for {lead}", { name: "Website" }, null, lead)).toBe("Website for Elena Rossi");
    expect(projectName("Delivery: {company}", { name: "" }, { name: "Northwind" }, lead)).toBe("Delivery: Northwind");
    expect(projectName("{company}", { name: "" }, null, lead)).toBe("New project");
    expect(projectName("{deal}", { name: "x".repeat(300) }, null, lead)).toHaveLength(160);
  });

  it("its brief says what was sold and to whom", () => {
    const l = { ...lead, id: "c1", workspaceId: WS, organizationId: "o", ownerId: null, companyId: null, phone: "", jobTitle: "", lifecycleStage: "lead", leadStatus: "new", source: "", notes: "", created: "" } as Lead;
    expect(projectBrief(deal(), { id: "co", name: "Northwind Studio", website: "", industry: "", city: "", country: "", companySize: "", notes: "" }, l)).toBe("Won deal: Website\nValue: 12000 GBP\nCustomer: Northwind Studio\nContact: Elena Rossi (elena@northwind.example)\n\nPromised a launch in March.");
    expect(projectBrief(deal({ value: 0, notes: "" }), null, l)).toBe("Won deal: Website\nContact: Elena Rossi (elena@northwind.example)");
  });

  it("its board: a column the app knows keeps its id and colour, any other gets its own; tasks land in To-do", () => {
    const columns = boardColumns(["Undefined task", "to-do", "Waiting on customer", "Done", "Waiting on customer!"]);
    expect(columns).toEqual([
      { id: "undefined", title: "Undefined task", color: "#9E9E9E", order: 0 },
      { id: "todo", title: "to-do", color: "#FF9800", order: 1 },
      { id: "waitingoncustomer", title: "Waiting on customer", color: "#9E9E9E", order: 2 },
      { id: "done", title: "Done", color: "#4CAF50", order: 3 },
      { id: "waitingoncustomer5", title: "Waiting on customer!", color: "#9E9E9E", order: 4 },
    ]);
    expect(taskColumn(columns)).toBe("todo");
    expect(taskColumn(boardColumns(["Backlog", "Doing"]))).toBe("backlog");
    expect(dueIn(at("2026-11-18T10:00:00Z"), 2)).toBe("2026-11-20T17:00:00.000Z");
  });

  it("its lead: the person the rules name, else the deal's owner, else the lead's, else the organisation's owner; never someone outside it", () => {
    const people = [person("u1", "owner"), person("u2", "member"), person("u3", "admin"), person("u4", "viewer")];
    const l = { ownerId: "u3" } as Lead;
    const template = (who: string) => ({ ...defaultRules(WS, "UTC").project, lead: who });
    expect(projectLead(template("deal_owner"), deal(), l, people)?.userId).toBe("u2");
    expect(projectLead(template("u3"), deal(), l, people)?.userId).toBe("u3");
    // The named person has left: the deal's owner leads.
    expect(projectLead(template("gone"), deal(), l, people)?.userId).toBe("u2");
    expect(projectLead(template("deal_owner"), deal({ ownerId: "gone" }), l, people)?.userId).toBe("u3");
    expect(projectLead(template("deal_owner"), deal({ ownerId: null }), { ownerId: null } as Lead, people)?.userId).toBe("u1");
    // A viewer never leads.
    expect(projectLead(template("u4"), deal({ ownerId: "u4" }), { ownerId: "u4" } as Lead, people)?.userId).toBe("u1");
    expect(projectLead(template("deal_owner"), deal(), l, [])).toBeNull();
  });

  it("a project that cannot be made is said so in the step's record, and the run ends without one", async () => {
    const w = world();
    const { automation } = await ready(w);
    await w.ok(OWNER, "PATCH", `automations/${automation.id}`, { name: automation.name, trigger: automation.trigger, steps: [automation.steps[5]], revision: automation.revision });
    w.ai.agent("Project starter", answer({ actions: [{ type: "create_project", extraTasks: [] }] }));
    const { lead, run } = await leadArrives(w);
    const d = w.store.personAddsDeal(WS, lead.id, { status: "won", ownerId: MEMBER.id });
    // Someone linked the deal to a project by hand in the meantime.
    await w.store.updateDeal(WS, d.id, { projectId: "0e000000-0000-4000-8000-000000000001" });
    await w.cron();
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view.steps[0].did).toEqual(["Not done (create the project for “Website”): the deal already has a project."]);
    expect(view).toMatchObject({ status: "finished", projectId: null });
    expect(w.store.projects()).toHaveLength(0);
  });

  it("a hand-off that broke off after the project was made does not make a second one", async () => {
    const w = world();
    const { automation } = await ready(w);
    await w.ok(OWNER, "PATCH", `automations/${automation.id}`, { name: automation.name, trigger: automation.trigger, steps: [automation.steps[5]], revision: automation.revision });
    w.ai.agent("Project starter", answer({ actions: [{ type: "create_project", extraTasks: [] }] }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { lead, run } = await leadArrives(w);
    w.store.personAddsDeal(WS, lead.id, { status: "won", ownerId: MEMBER.id });
    // The project and its tasks are written; linking the deal fails the first time.
    w.store.failNext("updateDeal", "deadlock detected");
    await w.cron();
    expect(w.store.projects()).toHaveLength(1);
    expect(runOf(w, run.id)).toMatchObject({ status: "running", attempts: 1, projectId: null });
    await w.cron();
    expect(w.store.projects()).toHaveLength(1);
    expect(w.store.projectTasks()).toHaveLength(5);
    expect(runOf(w, run.id)).toMatchObject({ status: "finished", result: "Project created with 5 tasks", projectId: w.store.projects()[0].id });
    expect(w.store.deals()[0].projectId).toBe(w.store.projects()[0].id);
    logged.mockRestore();
  });

  it("the workspace's own template decides the columns, the tasks, the lead and who is added", async () => {
    const w = world();
    const { automation } = await ready(w);
    await w.ok(OWNER, "PATCH", `automations/${automation.id}`, { name: automation.name, trigger: automation.trigger, steps: [automation.steps[5]], revision: automation.revision });
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    await w.ok(OWNER, "POST", "rules", { ...rules, project: { nameTemplate: "{lead}: {deal}", lead: OWNER.id, addEveryone: false, columns: ["Backlog", "Doing", "Done"], tasks: [{ title: "Say hello", days: 0 }], agentMayAddTasks: false } });
    w.ai.agent("Project starter", answer({ actions: [{ type: "create_project", extraTasks: ["An extra the rules do not allow"] }] }));
    const { lead } = await leadArrives(w);
    w.store.personAddsDeal(WS, lead.id, { status: "won", ownerId: MEMBER.id, name: "Retainer" });
    await w.cron();
    const [project] = w.store.projects();
    expect(project).toMatchObject({ name: "Elena Rossi: Retainer", ownerId: OWNER.id, members: [] });
    expect(project.columns.map((c) => c.id)).toEqual(["backlog", "doing", "done"]);
    expect(w.store.projectTasks().map((t) => [t.title, t.status, t.assignee?.userId, t.dueDate])).toEqual([["Say hello", "backlog", OWNER.id, "2026-11-18T17:00:00.000Z"]]);
  });
});

describe("a send that broke off", () => {
  it("an email that was being sent when the work broke off is never sent a second time", async () => {
    const w = world();
    const { automation } = await ready(w);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    await w.ok(OWNER, "POST", "rules", { ...rules, autonomy: "full" });
    const lead = w.store.seedLead({ workspaceId: WS, email: "elena@northwind.example" });
    // The state a crash leaves: the step's plan written, the email's ledger row claimed for sending, nothing after.
    const run = (await w.store.insertRun({ workspaceId: WS, automationId: automation.id, automationName: automation.name, contactId: lead.id, dealId: null, subject: "Northwind", steps: [automation.steps[2]], wakeAt: w.now().toISOString() }))!;
    const action = { type: "send_email" as const, subject: EMAIL.subject, body: EMAIL.body };
    const step = await w.store.insertStep({ workspaceId: WS, runId: run.id, n: 1, agentId: automation.steps[2].agentId, agentName: "Writer", status: "working", received: "r", decided: "d", outcome: "continue", handoff: "", plan: [{ action, verdict: "now", state: "todo", what: "Send the first email to Elena" }], approvedBy: null });
    await w.store.insertApproval({ workspaceId: WS, runId: run.id, stepId: step.id, stepN: 1, planIndex: 0, agentId: step.agentId, agentName: "Writer", contactId: lead.id, dealId: null, actionType: "send_email", what: "Send", about: "Northwind", action, state: "working", asked: false, dueAt: null });
    await w.cron();
    expect(w.resend.calls).toHaveLength(0);
    expect(w.ai.calls).toHaveLength(0);
    expect(runOf(w, run.id)).toMatchObject({ status: "failed", result: "Failed at step 1: The email may not have been delivered: sending broke off." });
    expect(w.store.approvals()[0].state).toBe("failed");
    w.advance(DAY);
    await w.cron();
    expect(w.resend.calls).toHaveLength(0);
    logged.mockRestore();
  });
});

describe("what is read from a request", () => {
  it("text is trimmed, control characters go, and a one-line field has no line breaks", () => {
    expect(clean("  a\u0000b\u0007\tc\nd  ", 100)).toBe("ab\tc\nd");
    expect(clean(5, 100)).toBe("");
    expect(clean("abcdef", 3)).toBe("abc");
    expect(oneLine("  a\r\n b \t c  ", 100)).toBe("a b c");
    expect(agentInput({ name: " Greeter\n", job: "Greet every new lead with a short note.", rights: ["send_email", "send_email"], askFirst: "yes" })).toEqual({ name: "Greeter", job: "Greet every new lead with a short note.", rights: ["send_email"], askFirst: false });
  });

  it("a saved chain keeps a step's id when it is a uuid and gives it a new one otherwise or when it repeats", () => {
    const id = "0f000000-0000-4000-8000-000000000001";
    const agentId = "0f000000-0000-4000-8000-000000000002";
    const out = automationInput({ name: "Chain", trigger: { skipImports: true }, steps: [{ id, agentId, starts: { type: "after_previous" } }, { id, agentId, starts: { type: "on_reply" } }, { id: "mine", agentId, starts: { type: "no_reply_days", days: 60 } }] });
    expect(out.trigger).toEqual({ type: "lead_created", skipImports: true });
    expect(out.steps[0].id).toBe(id);
    expect(new Set(out.steps.map((s) => s.id)).size).toBe(3);
    expect(out.steps.map((s) => s.starts)).toEqual([{ type: "after_previous" }, { type: "on_reply" }, { type: "no_reply_days", days: 60 }]);
    expect(() => automationInput({ name: "Chain", trigger: { type: "deal_won" }, steps: [] })).toThrow("An automation starts when a lead is added.");
    expect(() => automationInput({ name: "Chain", steps: [{ agentId: "nope", starts: { type: "after_previous" } }] })).toThrow("Every step needs an agent.");
  });

  it("an import is told by its source", () => {
    for (const source of ["CSV import", "Imported", "spreadsheet", "Bulk upload", "csv"]) expect(fromImport(source), source).toBe(true);
    for (const source of ["Website", "Referral", "", "LinkedIn"]) expect(fromImport(source), source).toBe(false);
  });
});
