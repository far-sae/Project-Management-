// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENTS } from "../../../../api/_automation/defaults";
import { AI_OFF_MESSAGE, NOT_SET_UP_MESSAGE, STALE_MESSAGE, TABLES_MISSING_MESSAGE } from "../../../../api/_automation/messages";
import { AGENT_KINDS, LIMITS } from "../../../../api/_automation/shared/types";
import type { Agent, Automation, AutomationDraft, Overview, PersonRow, RunSummary, WorkspaceRow, WorkspaceRules } from "../../../../api/_automation/shared/types";
import { errorOf, leadArrives, MEMBER, OWNER, ready, WS, WS2, world } from "./helpers";

/** Set-up, the overview, the rules, agents and automations: each route's request and reply. */

const rulesBody = (r: WorkspaceRules, over: Record<string, unknown> = {}) => ({ ...r, ...over });

describe("POST setup and GET overview", () => {
  it("before set-up the overview says so and holds nothing", async () => {
    const w = world();
    const o = await w.ok<Overview>(OWNER, "GET", "overview");
    expect(o).toMatchObject({ setUp: false, enabled: false, role: "Owner", automation: null, chain: [], approvals: [], latestRuns: [] });
    expect(o.stats).toEqual({ automationsOn: 0, automationsPaused: 0, runsThisWeek: 0, finishedThisWeek: 0, stoppedThisWeek: 0, waitingApprovals: 0, oldestApproval: null, spentCents: 0, budgetCents: 0 });
  });

  it("set-up makes the rules, the six agents and one draft automation with the default chain", async () => {
    const w = world();
    const o = await w.ok<Overview>(OWNER, "POST", "setup");
    expect(o).toMatchObject({ setUp: true, enabled: true, role: "Owner", automation: { name: "New lead to project", status: "draft" } });
    expect(o.stats.budgetCents).toBe(2000);
    expect(o.chain.map((c) => [c.n, c.agentName, c.starts.type, c.asks])).toEqual([
      [1, "Researcher", "after_previous", false],
      [2, "Qualifier", "after_previous", false],
      [3, "Writer", "after_previous", true],
      [4, "Chaser", "no_reply_days", true],
      [5, "Deal keeper", "on_reply", true],
      [6, "Project starter", "on_deal_won", false],
    ]);
    expect(o.chain[3].starts).toEqual({ type: "no_reply_days", days: 3 });
    expect(o.chain.map((c) => c.does)).toEqual(AGENT_KINDS.map((k) => k.does));

    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    expect(rules).toMatchObject({
      workspaceId: WS,
      enabled: true,
      autonomy: "ask_external",
      monthlyBudgetCents: 2000,
      emailsPerLead: 3,
      sendWindow: { weekdaysOnly: true, startHour: 9, endHour: 18, timeZone: "Europe/London" },
      webResearch: true,
      revision: 1,
    });
    expect(rules.project).toEqual({
      nameTemplate: "{company} – {deal}",
      lead: "deal_owner",
      addEveryone: true,
      columns: ["Undefined task", "To-do", "On-Progress", "Done", "Need review"],
      tasks: [
        { title: "Kick-off call with the customer", days: 2 },
        { title: "Confirm scope and what was promised in the deal", days: 3 },
        { title: "Collect access, files and information", days: 5 },
        { title: "Agree the timeline and milestones", days: 5 },
        { title: "Plan the work and assign the team", days: 7 },
      ],
      agentMayAddTasks: true,
    });
    // Nothing the server keeps to itself leaves with the rules.
    expect(Object.keys(rules).sort()).toEqual(["autonomy", "emailsPerLead", "enabled", "monthlyBudgetCents", "project", "revision", "sendWindow", "updated", "webResearch", "workspaceId"]);

    const agents = await w.ok<Agent[]>(OWNER, "GET", "agents");
    expect(agents.map((a) => [a.kind, a.name, a.askFirst, a.paused, a.archived, a.runsThisMonth])).toEqual(DEFAULT_AGENTS.map((a) => [a.kind, a.name, false, false, false, 0]));
    expect(agents.map((a) => a.rights)).toEqual([
      ["look_up_web", "add_notes_followups"],
      ["change_lead_step", "add_notes_followups"],
      ["send_email"],
      ["add_notes_followups", "send_email"],
      ["change_deals_projects", "change_lead_step", "add_notes_followups"],
      ["change_deals_projects", "add_notes_followups"],
    ]);
    expect(agents[1].job).toContain("Decide whether this lead is a good fit for us.");
  });

  it("the organisation's own time zone is used for the send window when it chose one", async () => {
    const w = world();
    w.store.seedWorkspace({ id: WS, organizationId: "0b000000-0000-4000-8000-000000000001", name: "Studio", timeZone: "Asia/Karachi" });
    await w.ok(OWNER, "POST", "setup");
    expect((await w.ok<WorkspaceRules>(OWNER, "GET", "rules")).sendWindow.timeZone).toBe("Asia/Karachi");
  });

  it("is safe to repeat, also twice at the same moment: nothing is made twice and nothing is reset", async () => {
    const w = world();
    const [a, b] = await Promise.all([w.ok<Overview>(OWNER, "POST", "setup"), w.ok<Overview>(OWNER, "POST", "setup")]);
    expect(a.automation?.id).toBe(b.automation?.id);
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    await w.ok(OWNER, "POST", "rules", rulesBody(rules, { monthlyBudgetCents: 500 }));
    await w.ok(OWNER, "POST", `automations/${a.automation?.id}/turn-on`);
    const again = await w.ok<Overview>(OWNER, "POST", "setup");
    expect(again.stats.budgetCents).toBe(500);
    expect(again.automation?.status).toBe("on");
    expect(await w.ok<Agent[]>(OWNER, "GET", "agents")).toHaveLength(6);
    expect(await w.ok<Automation[]>(OWNER, "GET", "automations")).toHaveLength(1);
  });

  it("the overview counts the week, the approvals and the month's spend", async () => {
    const w = world();
    await ready(w);
    w.ai.agent("Writer", { decided: "Write the intro.", outcome: "continue", handoff: "Email drafted.", actions: [{ type: "send_email", subject: "Hello from Studio", body: "Hi Elena,\n\nWe help studios like yours. Could we talk this week?\n\nMia" }] });
    await leadArrives(w);
    const o = await w.ok<Overview>(OWNER, "GET", "overview");
    expect(o.stats).toMatchObject({ automationsOn: 1, automationsPaused: 0, runsThisWeek: 1, finishedThisWeek: 0, stoppedThisWeek: 0, waitingApprovals: 1, budgetCents: 2000 });
    expect(o.stats.oldestApproval).toBe(o.approvals[0].created);
    // Three structured calls and one web look-up at 1000 in and 500 out each: 4 x (0.4 + 1.0) cents.
    expect(o.stats.spentCents).toBe(6);
    expect(o.approvals).toHaveLength(1);
    expect(o.approvals[0]).toMatchObject({ agentName: "Writer", what: "Send the first email to Elena Rossi", about: "Northwind Studio", status: "pending", canDecide: true, stepN: 3, to: "elena@northwind.example" });
    expect(o.latestRuns).toHaveLength(1);
    expect(o.latestRuns[0]).toMatchObject({ subject: "Northwind Studio", status: "needs_approval", result: "Stopped at step 3: waiting for approval", stepsDone: 2, stepCount: 6, automationName: "New lead to project" });
  });
});

describe("rules", () => {
  it("GET rules before set-up is 409 with the sentence", async () => {
    const w = world();
    const r = await w.call(OWNER, "GET", "rules");
    expect([r.status, errorOf(r)]).toEqual([409, NOT_SET_UP_MESSAGE]);
  });

  it("saves with the revision it was read at; a stale one is 409 and changes nothing", async () => {
    const w = world();
    await w.ok(OWNER, "POST", "setup");
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    const saved = await w.ok<WorkspaceRules>(OWNER, "POST", "rules", rulesBody(rules, { autonomy: "full", emailsPerLead: 5, webResearch: false, enabled: false }));
    expect(saved).toMatchObject({ autonomy: "full", emailsPerLead: 5, webResearch: false, enabled: false, revision: 2 });
    const stale = await w.call(OWNER, "POST", "rules", rulesBody(rules, { autonomy: "suggest" }));
    expect([stale.status, errorOf(stale)]).toEqual([409, STALE_MESSAGE]);
    expect((await w.ok<WorkspaceRules>(OWNER, "GET", "rules")).autonomy).toBe("full");
  });

  it("accepts exactly the limits the screen enforces and refuses outside them with a plain sentence", async () => {
    const w = world();
    await w.ok(OWNER, "POST", "setup");
    let rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    const save = async (over: Record<string, unknown>) => {
      const r = await w.call(OWNER, "POST", "rules", rulesBody(rules, over));
      if (r.status === 200) rules = r.json as WorkspaceRules;
      return r;
    };
    const project = (over: Record<string, unknown>) => ({ project: { ...rules.project, ...over } });
    const window = (over: Record<string, unknown>) => ({ sendWindow: { ...rules.sendWindow, ...over } });
    const good: Record<string, unknown>[] = [
      { monthlyBudgetCents: 0 },
      { monthlyBudgetCents: 10_000_000 },
      { emailsPerLead: 0 },
      { emailsPerLead: 10 },
      window({ startHour: 0, endHour: 24 }),
      window({ startHour: 23, endHour: 24, weekdaysOnly: false, timeZone: "America/New_York" }),
      project({ nameTemplate: "x".repeat(120) }),
      project({ columns: ["Only"] }),
      project({ columns: Array.from({ length: 12 }, (_, i) => `Column ${i}`) }),
      project({ columns: ["c".repeat(60)] }),
      // Anything of the right length is taken as it is: an unknown {word} stays as text, two columns may share a name.
      project({ nameTemplate: "{customer} project" }),
      project({ columns: ["To-do", "to-do"] }),
      project({ tasks: [] }),
      project({ tasks: Array.from({ length: 20 }, (_, i) => ({ title: `Task ${i}`, days: i === 0 ? 0 : 365 })) }),
      project({ tasks: [{ title: "t".repeat(160), days: 1 }] }),
      project({ lead: MEMBER.id, addEveryone: false, agentMayAddTasks: false }),
    ];
    for (const over of good) expect((await save(over)).status, JSON.stringify(over).slice(0, 80)).toBe(200);

    const bad: Record<string, unknown>[] = [
      { monthlyBudgetCents: -1 },
      { monthlyBudgetCents: 10_000_001 },
      { monthlyBudgetCents: 12.5 },
      { monthlyBudgetCents: "2000" },
      { emailsPerLead: 11 },
      { emailsPerLead: -1 },
      { autonomy: "everything" },
      window({ startHour: 9, endHour: 9 }),
      window({ startHour: 18, endHour: 9 }),
      window({ startHour: -1 }),
      window({ endHour: 25 }),
      window({ timeZone: "Mars/Olympus" }),
      project({ nameTemplate: "" }),
      project({ nameTemplate: "x".repeat(121) }),
      project({ columns: [] }),
      project({ columns: Array.from({ length: 13 }, (_, i) => `Column ${i}`) }),
      project({ columns: ["c".repeat(61)] }),
      project({ tasks: Array.from({ length: 21 }, (_, i) => ({ title: `Task ${i}`, days: 1 })) }),
      project({ tasks: [{ title: "", days: 1 }] }),
      project({ tasks: [{ title: "t".repeat(161), days: 1 }] }),
      project({ tasks: [{ title: "Call", days: 366 }] }),
      project({ tasks: [{ title: "Call", days: -1 }] }),
      project({ lead: "nobody" }),
      // A real id, but of someone who is not in this organisation, and of a viewer.
      project({ lead: "0c000000-0000-4000-8000-000000000009" }),
      project({ lead: "0c000000-0000-4000-8000-000000000004" }),
      { revision: undefined },
    ];
    for (const over of bad) {
      const r = await save(over);
      expect(r.status, JSON.stringify(over).slice(0, 80)).toBe(400);
      expect(errorOf(r)).toMatch(/^[A-Z].*\.$/);
    }
    expect(LIMITS).toMatchObject({ emailsPerLead: 10, columnTitle: 60, columns: 12, tasks: 20, taskTitle: 160, taskDays: 365, projectName: 120, monthlyBudgetCents: 10_000_000 });
  });

  it("GET workspaces lists the organisation's workspaces for an owner or admin, and none of another organisation", async () => {
    const w = world();
    await w.ok(OWNER, "POST", "setup");
    const rows = await w.ok<WorkspaceRow[]>(OWNER, "GET", "workspaces");
    expect(rows).toEqual([
      { workspaceId: WS, name: "Studio", setUp: true, enabled: true, autonomy: "ask_external", projectsThisMonth: 0 },
      { workspaceId: WS2, name: "Retainers", setUp: false, enabled: false, autonomy: null, projectsThisMonth: 0 },
    ]);
    expect(await w.ok<WorkspaceRow[]>(MEMBER, "GET", "workspaces")).toEqual([]);
  });

  it("GET people lists the organisation's active members by name, viewers left out", async () => {
    const w = world();
    const people = await w.ok<PersonRow[]>(MEMBER, "GET", "people");
    expect(people.map((p) => p.name).sort()).toEqual(["Mia", "Noor", "Sam"]);
    expect(Object.keys(people[0]).sort()).toEqual(["name", "userId"]);
  });
});

describe("agents", () => {
  const input = { name: "Welcome writer", job: "Write a short welcome note for every new customer and add it to the lead.", rights: ["add_notes_followups"], askFirst: true };

  it("makes, edits, pauses, resumes and archives a custom agent", async () => {
    const w = world();
    await w.ok(OWNER, "POST", "setup");
    const made = await w.ok<Agent>(OWNER, "POST", "agents", input);
    expect(made).toMatchObject({ ...input, kind: "custom", workspaceId: WS, paused: false, archived: false, revision: 1, runsThisMonth: 0 });
    // Chain order first, the others after.
    expect((await w.ok<Agent[]>(OWNER, "GET", "agents")).map((a) => a.name)).toEqual([...DEFAULT_AGENTS.map((a) => a.name), "Welcome writer"]);

    const edited = await w.ok<Agent>(OWNER, "PATCH", `agents/${made.id}`, { ...input, name: "Welcomer", rights: ["add_notes_followups", "send_email", "send_email"], askFirst: false, revision: 1 });
    expect(edited).toMatchObject({ name: "Welcomer", rights: ["add_notes_followups", "send_email"], askFirst: false, revision: 2 });
    const stale = await w.call(OWNER, "PATCH", `agents/${made.id}`, { ...input, revision: 1 });
    expect([stale.status, errorOf(stale)]).toEqual([409, STALE_MESSAGE]);

    expect((await w.ok<Agent>(OWNER, "POST", `agents/${made.id}/pause`)).paused).toBe(true);
    expect((await w.ok<Agent>(OWNER, "POST", `agents/${made.id}/resume`)).paused).toBe(false);
    expect(await w.ok(OWNER, "DELETE", `agents/${made.id}`)).toEqual({ ok: true });
    expect((await w.ok<Agent[]>(OWNER, "GET", "agents")).map((a) => a.name)).not.toContain("Welcomer");
    expect((await w.call(OWNER, "PATCH", `agents/${made.id}`, { ...input, revision: 4 })).status).toBe(404);
  });

  it("refuses a bad agent with a plain sentence", async () => {
    const w = world();
    await w.ok(OWNER, "POST", "setup");
    for (const over of [{ name: "" }, { name: "n".repeat(61) }, { job: "too short" }, { job: "j".repeat(2001) }, { rights: ["delete_everything"] }, { rights: "send_email" }]) {
      const r = await w.call(OWNER, "POST", "agents", { ...input, ...over });
      expect(r.status, JSON.stringify(over).slice(0, 60)).toBe(400);
      expect(errorOf(r)).toMatch(/\.$/);
    }
  });

  it("an agent a chain uses cannot be archived: 409 naming the automation", async () => {
    const w = world();
    const { overview } = await ready(w);
    const r = await w.call(OWNER, "DELETE", `agents/${overview.chain[0].agentId}`);
    expect(r.status).toBe(409);
    expect(errorOf(r)).toBe("This agent is a step of the automation “New lead to project”. Take it out of that chain first.");
    expect(await w.ok<Agent[]>(OWNER, "GET", "agents")).toHaveLength(6);
  });

  it("runsThisMonth counts the steps an agent ran this calendar month", async () => {
    const w = world();
    await ready(w);
    await leadArrives(w);
    const agents = await w.ok<Agent[]>(OWNER, "GET", "agents");
    expect(agents.map((a) => a.runsThisMonth)).toEqual([1, 1, 1, 0, 0, 0]);
    w.setNow("2026-12-01T10:00:00.000Z");
    expect((await w.ok<Agent[]>(OWNER, "GET", "agents")).map((a) => a.runsThisMonth)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("an unknown id, a malformed id and an unknown action are 404", async () => {
    const w = world();
    await w.ok(OWNER, "POST", "setup");
    for (const [method, path] of [
      ["PATCH", "agents/not-a-uuid"],
      ["DELETE", "agents/0d000000-0000-4000-8000-00000000dead"],
      ["POST", "agents/0d000000-0000-4000-8000-00000000dead/pause"],
      ["POST", "agents/0d000000-0000-4000-8000-00000000dead/explode"],
      ["GET", "agents/0d000000-0000-4000-8000-00000000dead"],
      ["GET", "nothing"],
      ["DELETE", "rules"],
      ["GET", "setup"],
    ])
      expect((await w.call(OWNER, method, path, { ...input, revision: 1 })).status, `${method} ${path}`).toBe(404);
  });
});

describe("automations", () => {
  const draft = (over: Partial<AutomationDraft> = {}): AutomationDraft => ({
    name: "Thank new customers",
    trigger: { type: "lead_created", skipImports: true },
    steps: [
      { agent: { id: null, name: "Greeter", job: "Greet the new lead with a short note on their record.", rights: ["add_notes_followups"], askFirst: false }, starts: { type: "after_previous" }, does: "Adds a greeting note.", gives: "the note" },
      { agent: { id: null, name: "Nudger", job: "Remind the lead's owner when the lead stays silent for a while.", rights: ["add_notes_followups"], askFirst: true }, starts: { type: "no_reply_days", days: 5 }, does: "Reminds the owner.", gives: "the reminder" },
    ],
    ...over,
  });

  it("saves a draft as a new automation (not on), creating its new agents, with steps in the order sent", async () => {
    const w = world();
    const { overview } = await ready(w);
    const researcher = overview.chain[0].agentId;
    const d = draft();
    d.steps.splice(1, 0, { agent: { id: researcher, name: "Researcher", job: DEFAULT_AGENTS[0].job, rights: ["look_up_web", "add_notes_followups"], askFirst: false }, starts: { type: "after_previous" }, does: "Looks the company up.", gives: "the summary" });
    const made = await w.ok<Automation>(OWNER, "POST", "automations", d as never);
    expect(made).toMatchObject({ name: "Thank new customers", status: "draft", trigger: { type: "lead_created", skipImports: true }, revision: 1, workspaceId: WS });
    expect(made.steps.map((s) => s.starts)).toEqual([{ type: "after_previous" }, { type: "after_previous" }, { type: "no_reply_days", days: 5 }]);
    // The existing agent is reused, not copied; the two new ones were created.
    expect(made.steps[1].agentId).toBe(researcher);
    const agents = await w.ok<Agent[]>(OWNER, "GET", "agents");
    expect(agents).toHaveLength(8);
    expect(agents.filter((a) => a.name === "Researcher")).toHaveLength(1);
    const byId = new Map(agents.map((a) => [a.id, a]));
    expect([byId.get(made.steps[0].agentId)?.name, byId.get(made.steps[2].agentId)?.name]).toEqual(["Greeter", "Nudger"]);
    expect(byId.get(made.steps[2].agentId)).toMatchObject({ kind: "custom", askFirst: true });
    expect(new Set(made.steps.map((s) => s.id)).size).toBe(3);

    expect(await w.ok<Automation>(MEMBER, "GET", `automations/${made.id}`)).toEqual(made);
    expect((await w.ok<Automation[]>(OWNER, "GET", "automations")).map((a) => a.name)).toEqual(["New lead to project", "Thank new customers"]);
  });

  it("a draft step that changes an existing agent saves the change to that agent", async () => {
    const w = world();
    const { overview } = await ready(w);
    const writer = (await w.ok<Agent[]>(OWNER, "GET", "agents"))[2];
    const d = draft({ steps: [{ agent: { id: writer.id, name: "Writer", job: writer.job, rights: writer.rights, askFirst: true }, starts: { type: "after_previous" }, does: "Writes.", gives: "the email" }] });
    await w.ok<Automation>(OWNER, "POST", "automations", d as never);
    const after = (await w.ok<Agent[]>(OWNER, "GET", "agents")).find((a) => a.id === writer.id);
    expect(after).toMatchObject({ askFirst: true, revision: writer.revision + 1, kind: "writer" });
    expect(overview.chain[2].agentId).toBe(writer.id);
  });

  it("PATCH takes a saved chain or a draft, both with the revision; a stale one is 409", async () => {
    const w = world();
    const { automation } = await ready(w);
    const shorter = { name: "Lead to deal", trigger: { type: "lead_created", skipImports: true }, steps: automation.steps.slice(0, 2).reverse() };
    const a = await w.ok<Automation>(OWNER, "PATCH", `automations/${automation.id}`, { ...shorter, revision: automation.revision });
    expect(a).toMatchObject({ name: "Lead to deal", trigger: { skipImports: true }, revision: automation.revision + 1, status: "on" });
    expect(a.steps).toEqual(shorter.steps);

    const stale = await w.call(OWNER, "PATCH", `automations/${automation.id}`, { ...shorter, revision: automation.revision });
    expect([stale.status, errorOf(stale)]).toEqual([409, STALE_MESSAGE]);

    const b = await w.ok<Automation>(OWNER, "PATCH", `automations/${automation.id}`, { ...draft({ name: "Greeting chain" }), revision: a.revision } as never);
    expect(b).toMatchObject({ name: "Greeting chain", revision: a.revision + 1 });
    expect(b.steps).toHaveLength(2);
    expect(b.steps[1].starts).toEqual({ type: "no_reply_days", days: 5 });
  });

  it("refuses a chain that names an agent of another workspace, an archived agent, or too many steps", async () => {
    const w = world();
    const { automation } = await ready(w);
    const other = await w.store.insertAgent({ workspaceId: WS2, kind: "custom", name: "Foreign", job: "An agent of another workspace entirely.", rights: [], askFirst: false });
    const body = (steps: unknown[]) => ({ name: "X", trigger: { type: "lead_created", skipImports: false }, steps, revision: automation.revision });
    const foreign = await w.call(OWNER, "PATCH", `automations/${automation.id}`, body([{ id: "x", agentId: other.id, starts: { type: "after_previous" } }]));
    expect([foreign.status, errorOf(foreign)]).toEqual([400, "One of the steps uses an agent that no longer exists. Choose another agent for it."]);
    const many = await w.call(OWNER, "PATCH", `automations/${automation.id}`, body(Array.from({ length: 13 }, () => automation.steps[0])));
    expect([many.status, errorOf(many)]).toEqual([400, "A chain can have up to 12 steps."]);
    for (const starts of [{ type: "whenever" }, { type: "no_reply_days", days: 0 }, { type: "no_reply_days", days: 61 }, { type: "no_reply_days" }, null])
      expect((await w.call(OWNER, "PATCH", `automations/${automation.id}`, body([{ ...automation.steps[0], starts }]))).status).toBe(400);
    expect((await w.ok<Automation>(OWNER, "GET", `automations/${automation.id}`)).revision).toBe(automation.revision);
  });

  it("two automations of one workspace cannot share a name", async () => {
    const w = world();
    await ready(w);
    const r = await w.call(OWNER, "POST", "automations", draft({ name: "new lead to PROJECT" }) as never);
    expect([r.status, errorOf(r)]).toEqual([409, "This workspace already has an automation with that name."]);
  });

  it("turn-on needs at least one step and no missing agent; pause always works", async () => {
    const w = world();
    const o = await w.ok<Overview>(OWNER, "POST", "setup");
    const id = o.automation?.id as string;
    const on = await w.ok<Automation>(OWNER, "POST", `automations/${id}/turn-on`);
    expect(on.status).toBe("on");
    expect((await w.ok<Automation>(OWNER, "POST", `automations/${id}/pause`)).status).toBe("paused");

    const empty = await w.ok<Automation>(OWNER, "PATCH", `automations/${id}`, { name: on.name, trigger: on.trigger, steps: [], revision: on.revision + 1 });
    const refused = await w.call(OWNER, "POST", `automations/${id}/turn-on`);
    expect([refused.status, errorOf(refused)]).toEqual([400, "Add at least one step before turning this on."]);
    expect(empty.status).toBe("paused");

    // An agent archived behind the chain's back (the route refuses that; the store is told directly).
    await w.ok<Automation>(OWNER, "PATCH", `automations/${id}`, { name: on.name, trigger: on.trigger, steps: on.steps, revision: empty.revision });
    await w.store.updateAgent(WS, on.steps[0].agentId, null, { archived: true });
    const gone = await w.call(OWNER, "POST", `automations/${id}/turn-on`);
    expect([gone.status, errorOf(gone)]).toEqual([400, "One of the steps uses an agent that no longer exists. Choose another agent for it."]);
  });

  it("creating an automation before set-up is 409", async () => {
    const w = world();
    const r = await w.call(OWNER, "POST", "automations", draft() as never);
    expect([r.status, errorOf(r)]).toEqual([409, NOT_SET_UP_MESSAGE]);
    expect(await w.store.listAgents(WS)).toHaveLength(0);
  });
});

describe("runs: the list", () => {
  it("newest first, at most 100, narrowed by status, contact and deal", async () => {
    const w = world();
    await ready(w);
    const a = await leadArrives(w, { firstName: "Ana", email: "ana@a.example" });
    w.advance(60_000);
    const b = await leadArrives(w, { firstName: "Ben", email: "ben@b.example" });
    const all = await w.ok<RunSummary[]>(MEMBER, "GET", "runs");
    expect(all.map((r) => r.contactId)).toEqual([b.lead.id, a.lead.id]);
    expect(await w.ok<RunSummary[]>(OWNER, "GET", "runs", {}, { contactId: a.lead.id })).toHaveLength(1);
    expect(await w.ok<RunSummary[]>(OWNER, "GET", "runs", {}, { status: "waiting" })).toHaveLength(2);
    expect(await w.ok<RunSummary[]>(OWNER, "GET", "runs", {}, { status: "finished" })).toHaveLength(0);
    expect(await w.ok<RunSummary[]>(OWNER, "GET", "runs", {}, { limit: "1" })).toHaveLength(1);
    expect(await w.ok<RunSummary[]>(OWNER, "GET", "runs", {}, { limit: "5000" })).toHaveLength(2);
    // A value that can name nothing gives nothing, not an error.
    for (const query of [{ status: "exploded" }, { contactId: "x' or 1=1" }, { dealId: "nope" }]) expect(await w.ok<RunSummary[]>(OWNER, "GET", "runs", {}, query)).toEqual([]);
  });
});

describe("until the database and the key are there", () => {
  it("every route answers 503 naming the file while migration 187 has not been run", async () => {
    const w = world();
    const routes: Array<[string, string]> = [
      ["GET", "overview"], ["POST", "setup"], ["POST", "nudge"], ["GET", "rules"], ["POST", "rules"], ["GET", "workspaces"], ["GET", "people"], ["GET", "agents"], ["POST", "agents"],
      ["PATCH", "agents/x"], ["DELETE", "agents/x"], ["POST", "agents/x/pause"], ["POST", "agents/x/test"], ["GET", "automations"], ["GET", "automations/x"], ["POST", "automations"],
      ["PATCH", "automations/x"], ["POST", "automations/x/turn-on"], ["POST", "automations/x/test"], ["POST", "automations/test-draft"], ["POST", "assistant"], ["GET", "runs"], ["GET", "runs/x"],
      ["POST", "runs/x/stop"], ["POST", "runs/x/replied"], ["GET", "approvals"], ["POST", "approvals/x/approve"], ["POST", "approvals/x/reject"],
    ];
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const user of [OWNER, MEMBER]) {
      for (const [method, path] of routes) {
        w.store.failNext("ready", "Could not find the table 'public.auto_rules' in the schema cache");
        const r = await w.call(user, method, path);
        expect([r.status, errorOf(r)], `${method} ${path}`).toEqual([503, TABLES_MISSING_MESSAGE]);
      }
    }
    expect(TABLES_MISSING_MESSAGE).toContain("supabase/migrations/187_automation.sql");
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("any other database failure is a plain 500 that says nothing of the error, in the reply or the log", async () => {
    const w = world();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    w.store.failNext("ready", "connection reset by peer at 10.0.0.7 secret-detail");
    const r = await w.call(OWNER, "GET", "overview");
    expect([r.status, errorOf(r)]).toEqual([500, "Something went wrong. Please try again."]);
    expect(logged.mock.calls).toEqual([["[automation] failed", "StoreError"]]);
    logged.mockRestore();
  });

  it("with no ANTHROPIC_API_KEY the reads and the set-up still work, and what needs the AI says so", async () => {
    const w = world({ key: false });
    const { overview, automation } = await ready(w);
    for (const path of ["overview", "rules", "agents", "automations", `automations/${automation.id}`, "runs", "approvals", "workspaces", "people"]) expect((await w.call(OWNER, "GET", path)).status, path).toBe(200);
    w.store.seedLead({ workspaceId: WS });
    const needAi: Array<[string, Record<string, unknown>]> = [
      ["assistant", { messages: [{ role: "user", text: "Email every new lead." }], draft: null }],
      [`agents/${overview.chain[0].agentId}/test`, {}],
      [`automations/${automation.id}/test`, {}],
    ];
    for (const [path, body] of needAi) {
      const r = await w.call(OWNER, "POST", path, body);
      expect([r.status, errorOf(r)], path).toEqual([503, AI_OFF_MESSAGE]);
    }
    expect(AI_OFF_MESSAGE).toBe("The automation's AI is not set up yet: ANTHROPIC_API_KEY is missing in Vercel's environment variables.");
    // The scheduled run still reads what happened and starts the run; it just cannot work a step yet.
    const lead = w.store.personAddsLead({ workspaceId: WS });
    const cron = await w.cron();
    expect(cron).toEqual({ status: 200, json: { events: 1, emails: 0, runs: 0, ai: false } });
    const run = w.store.runs().find((r) => r.contactId === lead.id);
    expect(run).toMatchObject({ status: "running", position: 0, attempts: 0 });
    expect(w.ai.calls).toHaveLength(0);
  });
});
