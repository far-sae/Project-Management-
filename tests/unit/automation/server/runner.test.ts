// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { optOutFooter } from "../../../../api/_automation/email";
import { BUDGET_WAIT, MAX_ATTEMPTS } from "../../../../api/_automation/runner";
import type { Approval, Automation, Overview, Run, WorkspaceRules } from "../../../../api/_automation/shared/types";
import { answer, DAY, EMAIL, HOUR, leadArrives, MEMBER, ORG, OWNER, ready, runOf, WS, world, type World } from "./helpers";

/**
 * The background runner, from a lead arriving to the project: how a run
 * starts, how each kind of step start behaves, and what happens when a step
 * fails, the budget runs out, an agent is paused or a person steps in.
 */

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logged.mockRestore();
});

/** The six agents doing what their jobs say, for a lead that is a good fit. */
function script(w: World) {
  w.ai.agent("Researcher", answer({ decided: "Design studio, about 20 people, redesigning their website this year.", handoff: "Northwind Studio: design studio, ~20 people, website redesign planned.", actions: [{ type: "add_note", text: "Northwind Studio is a design studio of about 20 people." }] }));
  w.ai.agent("Qualifier", answer({ decided: "Good fit, 4 of 5: director level, active website project.", handoff: "Fit 4/5: director, active project.", actions: [{ type: "set_lead_status", status: "qualified" }] }));
  w.ai.agent("Writer", answer({ decided: "Introduce us and mention the website redesign.", handoff: "Intro email written.", actions: [EMAIL] }));
  w.ai.agent("Chaser", answer({ decided: "No reply yet: remind the owner and write again.", handoff: "Chased once.", actions: [{ type: "create_follow_up", title: "Call Elena", dueInDays: 2, note: "No reply to the intro email." }, { ...EMAIL, subject: "Following up", body: "Hi Elena,\n\nJust checking whether a short call about the website would be useful this month.\n\nSam" }] }));
  w.ai.agent("Deal keeper", answer({ decided: "Positive reply: open a deal and move it to the proposal stage.", handoff: "Deal opened.", actions: [{ type: "create_deal", name: "Northwind website", value: 12000 }, { type: "move_deal", stage: "proposal sent" }] }));
  w.ai.agent("Project starter", answer({ decided: "Use this workspace's project template.", handoff: "Project created.", actions: [{ type: "create_project", extraTasks: ["Send the brand guidelines"] }, { type: "notify_owner", text: "The Northwind project is ready." }] }));
}

const approveFirst = async (w: World): Promise<Approval> => {
  const [pending] = await w.ok<Approval[]>(OWNER, "GET", "approvals");
  const done = await w.ok<Approval>(OWNER, "POST", `approvals/${pending.id}/approve`);
  await w.background();
  return done;
};

describe("starting a run", () => {
  it("a new lead starts one run of every automation that is on, and none of a draft or a paused one", async () => {
    const w = world();
    const { automation } = await ready(w);
    const second = await w.ok<Automation>(OWNER, "POST", "automations", { name: "Second", trigger: { type: "lead_created", skipImports: false }, steps: [{ agent: { id: automation.steps[0].agentId, name: "Researcher", job: "Find out who this lead is and what the company does.", rights: [], askFirst: false }, starts: { type: "after_previous" }, does: "", gives: "" }] });
    const third = await w.ok<Automation>(OWNER, "POST", "automations", { name: "Third", trigger: { type: "lead_created", skipImports: false }, steps: second.steps.map((s) => ({ agent: { id: s.agentId, name: "Researcher", job: "Find out who this lead is and what the company does.", rights: [], askFirst: false }, starts: s.starts, does: "", gives: "" })) });
    await w.ok(OWNER, "POST", `automations/${second.id}/turn-on`);
    await w.ok(OWNER, "POST", `automations/${third.id}/turn-on`);
    await w.ok(OWNER, "POST", `automations/${third.id}/pause`);
    const lead = w.store.personAddsLead({ workspaceId: WS });
    await w.cron();
    expect(w.store.runs().filter((r) => r.contactId === lead.id).map((r) => r.automationName).sort()).toEqual(["New lead to project", "Second"]);
  });

  it("never starts two runs of the same automation for the same lead", async () => {
    const w = world();
    await ready(w);
    const lead = w.store.personAddsLead({ workspaceId: WS });
    await Promise.all([w.cron(), w.cron()]);
    // The same lead reported again (an import that touched the row twice).
    const again = await w.store.insertRun({ workspaceId: WS, automationId: w.store.runs()[0].automationId, automationName: "x", contactId: lead.id, dealId: null, subject: "x", steps: [], wakeAt: null });
    expect(again).toBeNull();
    expect(w.store.runs()).toHaveLength(1);
    // Two passes at once worked each step once.
    expect(w.ai.parses().filter((p) => String(p.system).startsWith("You are Researcher,"))).toHaveLength(1);
  });

  it("the chain is taken as it was when the run started: a later edit does not change a run under way", async () => {
    const w = world();
    const { automation } = await ready(w);
    const { run } = await leadArrives(w);
    await w.ok(OWNER, "PATCH", `automations/${automation.id}`, { name: automation.name, trigger: automation.trigger, steps: automation.steps.slice(0, 1), revision: automation.revision });
    expect(runOf(w, run.id).steps).toHaveLength(6);
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run.id}`)).stepCount).toBe(6);
  });

  it("skipImports leaves a lead whose source says it was imported alone", async () => {
    const w = world();
    const { automation } = await ready(w);
    await w.ok(OWNER, "PATCH", `automations/${automation.id}`, { name: automation.name, trigger: { type: "lead_created", skipImports: true }, steps: automation.steps, revision: automation.revision });
    for (const source of ["CSV import", "Imported from spreadsheet", "bulk upload"]) w.store.personAddsLead({ workspaceId: WS, source });
    const typed = w.store.personAddsLead({ workspaceId: WS, source: "Website" });
    await w.cron();
    expect(w.store.runs().map((r) => r.contactId)).toEqual([typed.id]);
  });

  it("someone added straight in as a customer starts no run, and neither does anything while automation is off", async () => {
    const w = world();
    await ready(w);
    w.store.personAddsLead({ workspaceId: WS, lifecycleStage: "customer" });
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    await w.ok(OWNER, "POST", "rules", { ...rules, enabled: false });
    w.store.personAddsLead({ workspaceId: WS });
    await w.cron();
    expect(w.store.runs()).toHaveLength(0);
    // The triggers write nothing for a workspace whose automation is off.
    expect(w.store.events()).toHaveLength(1);
  });
});

describe("a lead carried from arrival to project", () => {
  it("walks the whole chain, waiting where it should, and writes everything down", async () => {
    const w = world();
    await ready(w);
    script(w);
    const { lead, run } = await leadArrives(w);

    // Steps 1 to 3 ran in one pass; the email waits for a person.
    let view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view).toMatchObject({ status: "needs_approval", stepsDone: 2, stepCount: 6, subject: "Northwind Studio", waitingFor: "A person to approve: send the first email to Elena Rossi.", canStop: true, canReply: true });
    expect(view.steps.map((s) => [s.n, s.agentName, s.status])).toEqual([[1, "Researcher", "done"], [2, "Qualifier", "done"], [3, "Writer", "waiting_approval"]]);
    expect(view.steps[0]).toMatchObject({ received: "New lead: Elena Rossi, Marketing director, Northwind Studio", decided: "Design studio, about 20 people, redesigning their website this year.", did: ["Added a note on the lead"], approvedBy: null });
    expect(view.steps[1]).toMatchObject({ received: "Northwind Studio: design studio, ~20 people, website redesign planned.", did: ["Marked the lead Qualified"] });
    expect(view.steps[2].did).toEqual([]);
    expect(w.store.notes().map((n) => n.body)).toEqual(["Northwind Studio is a design studio of about 20 people.\n\n(Researcher, automation)"]);
    expect(w.store.leads().find((l) => l.id === lead.id)).toMatchObject({ leadStatus: "connected", lifecycleStage: "sales_qualified_lead" });
    expect(w.resend.calls).toHaveLength(0);
    // The owners and the lead's owner are told an approval is waiting.
    expect(w.store.notifications().filter((n) => n.title === "Approval needed").map((n) => n.userId).sort()).toEqual([OWNER.id, MEMBER.id].sort());

    // Approved: the email goes to the lead's own address through the documents server's sender.
    const approved = await approveFirst(w);
    expect(approved).toMatchObject({ status: "approved", canDecide: false });
    expect(w.resend.calls).toHaveLength(1);
    // The agent's own words, then the lines that say how to stop the emails.
    expect(w.resend.calls[0].body).toMatchObject({ to: ["elena@northwind.example"], subject: "Your website redesign" });
    expect(String(w.resend.calls[0].body.text).startsWith(`${EMAIL.body}${optOutFooter(null).slice(0, 5)}`)).toBe(true);
    const [delivery] = await w.mailStore.listDeliveries(WS, 10);
    expect(delivery).toMatchObject({ recipient: "elena@northwind.example", purpose: "automation", status: "sent", route: "securovix" });
    view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view.steps[2]).toMatchObject({ status: "done", approvedBy: "Sam", did: ["Sent the email “Your website redesign” to Elena Rossi"] });
    expect(view).toMatchObject({ status: "waiting", stepsDone: 3 });
    expect(view.waitingFor).toBe("A reply from Elena Rossi. With none by Sat 21 Nov, step 4 starts.");
    expect(w.store.leads().find((l) => l.id === lead.id)?.leadStatus).toBe("connected");

    // The lead answers the next day: a person logs the email. The Chaser is skipped, the Deal keeper acts.
    w.advance(DAY);
    w.store.personLogsActivity(WS, lead.id, "email", "Can we talk Thursday?");
    await w.cron();
    view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view.steps.map((s) => [s.n, s.status])).toEqual([[1, "done"], [2, "done"], [3, "done"], [4, "skipped"], [5, "done"]]);
    expect(view.steps[3]).toMatchObject({ agentName: "Chaser", decided: "The lead replied, so there was nothing to chase.", did: [] });
    expect(view.steps[4]).toMatchObject({ received: "A reply or conversation from Elena Rossi was logged: A email was logged: Can we talk Thursday?", did: ["Opened the deal “Northwind website” in Qualified", "Moved the deal “Northwind website” to Proposal Sent"] });
    const [deal] = w.store.deals();
    expect(deal).toMatchObject({ name: "Northwind website", value: 12000, status: "open", contactId: lead.id, ownerId: MEMBER.id, probability: 60 });
    expect(view).toMatchObject({ status: "waiting", dealId: deal.id, waitingFor: "The deal “Northwind website” to be marked won." });
    expect(w.store.leads().find((l) => l.id === lead.id)).toMatchObject({ leadStatus: "open_deal", lifecycleStage: "opportunity" });

    // A person marks the deal won a week later: the project is made.
    w.advance(7 * DAY);
    w.store.personMovesDeal(WS, deal.id, { status: "won" });
    await w.cron();
    view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view).toMatchObject({ status: "finished", result: "Project created with 6 tasks", stepsDone: 6, waitingFor: null, canStop: false, canReply: false });
    expect(view.finished).toBe(w.now().toISOString());
    expect(view.steps[5]).toMatchObject({ received: "The won deal “Northwind website”.", did: ["Created the project “Northwind Studio – Northwind website” with 6 tasks", "Told Mia in the app"] });
    expect(view.facts).toEqual({ agentSteps: 5, approvals: 1, emailsSent: 1, costCents: 8 });

    const [project] = w.store.projects();
    expect(project).toMatchObject({ name: "Northwind Studio – Northwind website", workspaceId: WS, ownerId: MEMBER.id });
    expect(project.description).toBe("Won deal: Northwind website\nValue: 12000\nCustomer: Northwind Studio\nContact: Elena Rossi (elena@northwind.example)");
    expect(project.columns.map((c) => [c.id, c.title])).toEqual([["undefined", "Undefined task"], ["todo", "To-do"], ["inprogress", "On-Progress"], ["done", "Done"], ["needreview", "Need review"]]);
    // Everyone in the organisation but its viewer; the project's owner is not repeated.
    expect(project.members.map((m) => m.displayName).sort()).toEqual(["Noor", "Sam"]);
    const tasks = w.store.projectTasks();
    expect(tasks.map((t) => t.title)).toEqual(["Kick-off call with the customer", "Confirm scope and what was promised in the deal", "Collect access, files and information", "Agree the timeline and milestones", "Plan the work and assign the team", "Send the brand guidelines"]);
    expect(tasks.every((t) => t.projectId === project.id && t.status === "todo" && t.assignee?.userId === MEMBER.id && t.dealId === deal.id && t.contactId === lead.id)).toBe(true);
    expect(tasks[0].dueDate).toBe("2026-11-28T17:00:00.000Z");
    expect(w.store.deals()[0]).toMatchObject({ projectId: project.id, status: "won" });
    expect(w.store.leads().find((l) => l.id === lead.id)?.lifecycleStage).toBe("customer");
    expect(view.projectId).toBe(project.id);
    expect(w.store.notifications().filter((n) => n.title === "Project created").map((n) => [n.userId, n.message, n.projectId])).toEqual(expect.arrayContaining([[OWNER.id, "Northwind Studio: Project created with 6 tasks", project.id], [MEMBER.id, "Northwind Studio: Project created with 6 tasks", project.id]]));
    expect(w.store.notifications().find((n) => n.message === "The Northwind project is ready.")?.userId).toBe(MEMBER.id);

    // Everything the agents did is on the lead's timeline with the agent's name.
    const own = w.store.activities().filter((a) => a.metadata.automation === true);
    expect(own.map((a) => [a.type, a.metadata.agent])).toEqual([
      ["note", "Researcher"],
      ["note", "Qualifier"],
      ["email", "Writer"],
      ["deal_created", "Deal keeper"],
      ["deal_stage_changed", "Deal keeper"],
      ["deal_updated", undefined],
    ]);
    expect(logged).not.toHaveBeenCalled();
  });

  it("every email an agent sends says how to stop them, with a link when one can be made", async () => {
    const w = world();
    await ready(w);
    script(w);
    const { lead } = await leadArrives(w);
    await approveFirst(w);
    await w.cron();
    expect(w.resend.calls).toHaveLength(1);
    const text = String(w.resend.calls[0].body.text);
    expect(text.startsWith(EMAIL.body)).toBe(true);
    expect(text).toContain(`unsubscribe here: https://app.example.com/api/email/unsubscribe?c=${lead.id}&t=signed`);

    // With no way to make a link, it asks for a reply instead of sending nothing.
    const plain = world();
    delete plain.deps.unsubscribeUrl;
    await ready(plain);
    script(plain);
    await leadArrives(plain);
    await approveFirst(plain);
    await plain.cron();
    expect(String(plain.resend.calls[0].body.text)).toContain("reply to this email and say so");
  });

  it("an agent never writes to a lead who has unsubscribed", async () => {
    const w = world();
    await ready(w);
    script(w);
    const { lead } = await leadArrives(w);
    w.store.leadUnsubscribes(ORG, " Elena@Northwind.example ");
    await approveFirst(w);
    await w.cron();
    expect(w.resend.calls).toHaveLength(0);
    expect(w.store.activities().filter((a) => a.type === "email" && a.contactId === lead.id)).toHaveLength(0);
    // The reason is kept with the email that was not sent.
    expect(JSON.stringify(w.store.approvals())).toContain("the lead has unsubscribed from email");
  });

  it("a call nobody answered is not a reply, a call that was a conversation is", async () => {
    const w = world();
    await ready(w);
    script(w);
    const { lead, run } = await leadArrives(w);
    await approveFirst(w);
    await w.cron();
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ repliedAt: null, status: "waiting", waitingOn: "time" });

    // Written by the calling server for calls placed from the CRM.
    for (const entry of [
      "Called +44 7700 900123. No answer.",
      "Called +44 7700 900123. The line was busy.",
      "Called +44 7700 900123. Hung up before it was answered.",
      "Called +44 7700 900123. 22 s. Left a voicemail.\nAsked her to ring back.",
      "Called +1 (415) 555-0132. 8 s. Wrong number.",
    ]) {
      w.store.personLogsActivity(WS, lead.id, "call", entry);
      await w.cron();
      expect(runOf(w, run.id), entry).toMatchObject({ repliedAt: null, status: "waiting", waitingOn: "time" });
    }

    w.store.personLogsActivity(WS, lead.id, "call", "Called +44 7700 900123. 3 min 12 s. Spoke to them.\nWants a quote.");
    await w.cron();
    expect(runOf(w, run.id).repliedAt).not.toBeNull();
  });

  it("a call a person typed in by hand still counts, whatever it says", async () => {
    const w = world();
    await ready(w);
    script(w);
    const { lead, run } = await leadArrives(w);
    await approveFirst(w);
    await w.cron();
    await w.cron();
    w.store.personLogsActivity(WS, lead.id, "call", "No answer the first time, then she rang back and we talked.");
    await w.cron();
    expect(runOf(w, run.id).repliedAt).not.toBeNull();
  });

  it("the server's own writes never read as a reply and never start another step", async () => {
    const w = world();
    await ready(w);
    script(w);
    const { run } = await leadArrives(w);
    await approveFirst(w);
    await w.cron();
    await w.cron();
    // The Qualifier's and the email's status changes were recorded as the server's own, already handled.
    const own = w.store.events().filter((e) => e.own);
    expect(own.map((e) => e.type)).toEqual(["lead_status_changed"]);
    expect(own.every((e) => e.processedAt !== null)).toBe(true);
    expect(w.store.events().filter((e) => !e.own).map((e) => e.type)).toEqual(["lead_created"]);
    expect(runOf(w, run.id)).toMatchObject({ repliedAt: null, status: "waiting", waitingOn: "time", position: 3 });
    expect(w.ai.parses()).toHaveLength(3);
  });
});

describe("each way a step starts", () => {
  it("no_reply_days: waits that long after the step before, then runs when there was no reply", async () => {
    const w = world();
    await ready(w);
    script(w);
    const { run } = await leadArrives(w);
    await approveFirst(w);
    expect(runOf(w, run.id)).toMatchObject({ status: "waiting", waitingOn: "time", wakeAt: "2026-11-21T10:00:00.000Z" });
    w.advance(3 * DAY - HOUR);
    await w.cron();
    expect(runOf(w, run.id).position).toBe(3);
    w.advance(HOUR);
    await w.cron();
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view.steps[3]).toMatchObject({ agentName: "Chaser", status: "waiting_approval", received: "No reply from Elena Rossi after 3 days.", did: ["Created the follow-up “Call Elena”, due Mon 23 Nov"] });
    expect(w.store.followUps()).toEqual([expect.objectContaining({ title: "Call Elena", ownerId: MEMBER.id, dueDate: "2026-11-23T10:00:00.000Z", description: "No reply to the intro email.\n\n(Chaser, automation)" })]);
    const [second] = await w.ok<Approval[]>(OWNER, "GET", "approvals");
    expect(second).toMatchObject({ what: "Send a follow-up email to Elena Rossi", stepN: 4, to: "elena@northwind.example" });
  });

  it("on_reply: waits until a reply is logged; a person moving the lead forward counts as one", async () => {
    const w = world();
    await ready(w);
    script(w);
    w.ai.agent("Chaser", answer({ decided: "Reminded the owner.", actions: [] }));
    const { lead, run } = await leadArrives(w);
    await approveFirst(w);
    w.advance(3 * DAY);
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "waiting", waitingOn: "reply", wakeAt: null, position: 4 });
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run.id}`)).waitingFor).toBe("A reply from Elena Rossi, or a call, email or meeting with them being logged.");
    // A note is not a reply; neither is a move backwards.
    w.store.personLogsActivity(WS, lead.id, "note", "Left a voicemail.");
    w.store.personSetsLeadStatus(WS, lead.id, "open");
    await w.cron();
    expect(runOf(w, run.id).position).toBe(4);
    w.store.personSetsLeadStatus(WS, lead.id, "in_progress");
    await w.cron();
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view.steps[4]).toMatchObject({ agentName: "Deal keeper", status: "done", received: "A reply or conversation from Elena Rossi was logged: A person moved the lead forward." });
  });

  it("runs/:id/replied logs the reply on the lead and wakes the run; a later on_reply step waits for a newer reply", async () => {
    const w = world();
    const { automation } = await ready(w);
    // Researcher, then two steps that each wait for a reply.
    const keeper = automation.steps[4];
    await w.ok(OWNER, "PATCH", `automations/${automation.id}`, { name: automation.name, trigger: automation.trigger, steps: [automation.steps[0], keeper, { ...keeper, id: "second" }], revision: automation.revision });
    w.ai.agent("Deal keeper", answer({ decided: "Noted the reply.", actions: [] }));
    const { lead, run } = await leadArrives(w);
    expect(runOf(w, run.id)).toMatchObject({ status: "waiting", waitingOn: "reply", position: 1 });

    const bad = await w.call(OWNER, "POST", `runs/${run.id}/replied`, { note: "no flag" });
    expect([bad.status, (bad.json as { error: string }).error]).toEqual([400, "Say whether the reply was positive."]);
    const view = await w.ok<Run>(MEMBER, "POST", `runs/${run.id}/replied`, { positive: true, note: "Wants a proposal by Friday." });
    expect(view.id).toBe(run.id);
    await w.background();
    expect(w.store.activities().find((a) => a.metadata.reply === true)).toMatchObject({ type: "note", description: "The lead replied (positive): Wants a proposal by Friday.", userId: MEMBER.id, contactId: lead.id });
    // Logged by the route itself, so the CRM trigger does not report it a second time.
    expect(w.store.events().filter((e) => e.type === "activity_logged")).toHaveLength(0);
    const after = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(after.steps[1]).toMatchObject({ status: "done", received: "A positive reply from Elena Rossi was logged: Wants a proposal by Friday." });
    // The second on_reply step does not reuse the same reply.
    expect(after).toMatchObject({ status: "waiting", stepsDone: 2 });
    w.advance(HOUR);
    await w.ok<Run>(OWNER, "POST", `runs/${run.id}/replied`, { positive: false });
    await w.background();
    const last = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(last.steps[2].received).toBe("A negative reply from Elena Rossi was logged.");
    expect(last.status).toBe("finished");
  });

  it("on_deal_won: a deal a person opened and won is picked up", async () => {
    const w = world();
    const { automation } = await ready(w);
    await w.ok(OWNER, "PATCH", `automations/${automation.id}`, { name: automation.name, trigger: automation.trigger, steps: [automation.steps[5]], revision: automation.revision });
    script(w);
    const { lead, run } = await leadArrives(w);
    expect(runOf(w, run.id)).toMatchObject({ status: "waiting", waitingOn: "deal_won", waitingFor: "A deal for Elena Rossi to be opened and won." });
    const deal = w.store.personAddsDeal(WS, lead.id, { name: "Retainer", ownerId: OWNER.id });
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "waiting", dealId: deal.id });
    w.store.personMovesDeal(WS, deal.id, { status: "won" });
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "finished", result: "Project created with 6 tasks" });
    // The project lead is whoever owns the deal.
    expect(w.store.projects()[0]).toMatchObject({ ownerId: OWNER.id, name: "Northwind Studio – Retainer" });
  });
});

describe("an agent ends the run", () => {
  it("not a fit: the lead is marked unqualified, the run ends there and no later agent is asked", async () => {
    const w = world();
    await ready(w);
    script(w);
    w.ai.agent("Qualifier", answer({ decided: "Not a fit: a student enquiry.", outcome: "stop", handoff: "", actions: [{ type: "set_lead_status", status: "unqualified" }, { type: "add_note", text: "Student enquiry, no company." }] }));
    const { lead, run } = await leadArrives(w);
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view).toMatchObject({ status: "finished", result: "Not a fit: a student enquiry.", stepsDone: 2, stepCount: 6 });
    expect(view.steps[1].did).toEqual(["Marked the lead Unqualified", "Added a note on the lead"]);
    expect(w.store.leads().find((l) => l.id === lead.id)?.leadStatus).toBe("unqualified");
    expect(w.ai.parses().map((p) => /^You are ([^,]+),/.exec(p.system)?.[1])).toEqual(["Researcher", "Qualifier"]);
    await w.cron();
    expect(w.ai.parses()).toHaveLength(2);
  });
});

describe("a person steps in", () => {
  it("stop: the run stops, what was waiting is cancelled, and it can never send afterwards", async () => {
    const w = world();
    await ready(w);
    script(w);
    const { run } = await leadArrives(w);
    const [pending] = await w.ok<Approval[]>(OWNER, "GET", "approvals");
    const stopped = await w.ok<Run>(OWNER, "POST", `runs/${run.id}/stop`);
    expect(stopped).toMatchObject({ status: "stopped", result: "Stopped at step 3 by a person.", waitingFor: null, canStop: false });
    expect(stopped.steps[2]).toMatchObject({ status: "rejected", did: ["Not carried out: the run was stopped"] });
    expect(await w.ok<Approval[]>(OWNER, "GET", "approvals")).toEqual([]);
    const late = await w.call(OWNER, "POST", `approvals/${pending.id}/approve`);
    expect([late.status, (late.json as { error: string }).error]).toEqual([409, "This approval was already decided."]);
    await w.cron();
    expect(w.resend.calls).toHaveLength(0);
    // Stopping again changes nothing.
    expect((await w.ok<Run>(OWNER, "POST", `runs/${run.id}/stop`)).finished).toBe(stopped.finished);
    const replied = await w.call(OWNER, "POST", `runs/${run.id}/replied`, { positive: true });
    expect([replied.status, (replied.json as { error: string }).error]).toEqual([409, "This run has already ended."]);
  });

  it("a person marking the lead unqualified, or the deal lost, stops the run", async () => {
    const w = world();
    await ready(w);
    script(w);
    const a = await leadArrives(w, { email: "a@a.example" });
    w.store.personSetsLeadStatus(WS, a.lead.id, "unqualified");
    await w.cron();
    expect(runOf(w, a.run.id)).toMatchObject({ status: "stopped", result: "Stopped: the lead was marked unqualified." });
    expect(await w.ok<Approval[]>(OWNER, "GET", "approvals")).toEqual([]);

    const b = await leadArrives(w, { email: "b@b.example" });
    const deal = w.store.personAddsDeal(WS, b.lead.id);
    w.store.personMovesDeal(WS, deal.id, { status: "lost" });
    await w.cron();
    expect(runOf(w, b.run.id)).toMatchObject({ status: "stopped", result: "Stopped: the deal was marked lost." });
    expect(w.resend.calls).toHaveLength(0);
  });

  it("a lead deleted mid-run ends the run without a failure", async () => {
    const w = world();
    await ready(w);
    const { lead, run } = await leadArrives(w);
    expect(runOf(w, run.id)).toMatchObject({ status: "waiting", waitingOn: "time", position: 3 });
    w.store.personDeletesLead(lead.id);
    w.advance(3 * DAY);
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "stopped", result: "Stopped: the lead no longer exists.", attempts: 0 });
    expect(w.store.notifications()).toEqual([]);
  });
});

describe("when a step fails", () => {
  it("is tried again on the next pass, three times, then the run is failed with a plain reason and the owners are told", async () => {
    const w = world();
    await ready(w);
    w.ai.agent("Researcher", new Anthropic.APIError(529, { error: "overloaded: secret request text" }, "overloaded: secret request text", new Headers()));
    const { run } = await leadArrives(w);
    expect(runOf(w, run.id)).toMatchObject({ status: "running", attempts: 1, lastError: "ai failed", position: 0 });
    // The same pass does not try it again.
    expect(w.ai.parses()).toHaveLength(1);
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "running", attempts: 2 });
    await w.cron();
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(MAX_ATTEMPTS).toBe(3);
    expect(view).toMatchObject({ status: "failed", result: "Failed at step 1: The step could not be completed after three tries.", stepsDone: 0 });
    expect(view.finished).not.toBeNull();
    expect(w.ai.parses()).toHaveLength(3);
    expect(w.store.notifications().filter((n) => n.title === "An automation run failed")).toEqual([expect.objectContaining({ userId: OWNER.id, message: "Northwind Studio: Failed at step 1: The step could not be completed after three tries.", link: `/crm/automation/runs/${run.id}` })]);
    await w.cron();
    expect(w.ai.parses()).toHaveLength(3);
    // The log has a status and names, never the text of the error.
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret request text");
    expect(logged.mock.calls).toContainEqual(["[automation] ai call failed", 529]);
    expect(logged.mock.calls).toContainEqual(["[automation] step failed", "failed"]);
  });

  it("a step that recovers carries on, and the count starts again for the next step", async () => {
    const w = world();
    await ready(w);
    script(w);
    w.ai.agent("Researcher", new Error("socket hang up"), answer({ decided: "Found them.", handoff: "A studio." }));
    const { run } = await leadArrives(w);
    expect(runOf(w, run.id)).toMatchObject({ attempts: 1, position: 0 });
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ attempts: 0, position: 2, status: "needs_approval" });
  });

  it("a plan that broke off half-way is picked up where it stopped: the AI is not asked again and nothing is done twice", async () => {
    const w = world();
    await ready(w);
    script(w);
    w.ai.agent("Researcher", answer({ decided: "Found them.", handoff: "A studio.", actions: [{ type: "add_note", text: "First note." }, { type: "add_note", text: "Second note." }, { type: "create_follow_up", title: "Check the site", dueInDays: 1, note: "" }] }));
    const lead = w.store.personAddsLead({ workspaceId: WS, email: "elena@northwind.example" });
    // The first note cannot be written on the first try.
    w.store.failNext("addNote", "deadlock detected");
    await w.cron();
    const run = w.store.runs().find((r) => r.contactId === lead.id);
    expect(run).toMatchObject({ attempts: 1, position: 0 });
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run?.id}`)).steps).toEqual([]);
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run?.id}`)).waitingFor).toBe("Step 1 did not go through and will be tried again.");
    await w.cron();
    expect(w.store.notes().map((n) => n.body.split("\n")[0])).toEqual(["First note.", "Second note."]);
    expect(w.store.followUps()).toHaveLength(1);
    expect(w.ai.parses().filter((p) => String(p.system).startsWith("You are Researcher,"))).toHaveLength(1);
    expect(runOf(w, run?.id as string).position).toBeGreaterThan(0);
  });

  it("an agent archived behind a running chain fails the run with the reason", async () => {
    const w = world();
    const { automation } = await ready(w);
    script(w);
    const { run } = await leadArrives(w);
    await approveFirst(w);
    await w.store.updateAgent(WS, automation.steps[3].agentId, null, { archived: true });
    w.advance(3 * DAY);
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "failed", result: "Step 4 could not run: its agent no longer exists." });
  });
});

describe("limits on the runner", () => {
  it("at the monthly AI budget runs wait, the owners are told once, and a raised budget lets them go on", async () => {
    const w = world();
    await ready(w);
    script(w);
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    // Each call costs 1.4 cents. The Researcher's look-up and step make 2.8, the Qualifier's step 4.2: the 4-cent budget is reached.
    await w.ok(OWNER, "POST", "rules", { ...rules, monthlyBudgetCents: 4 });
    const { run } = await leadArrives(w);
    expect(runOf(w, run.id)).toMatchObject({ status: "waiting", waitingOn: "budget", position: 2, wakeAt: "2026-12-01T00:00:00.000Z" });
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run.id}`)).waitingFor).toBe(BUDGET_WAIT);
    const second = await leadArrives(w, { email: "second@b.example" });
    expect(runOf(w, second.run.id)).toMatchObject({ status: "waiting", waitingOn: "budget", position: 0 });
    await w.cron();
    expect(w.ai.parses()).toHaveLength(2);
    const told = w.store.notifications().filter((n) => n.title === "AI budget reached");
    expect(told.map((n) => n.userId)).toEqual([OWNER.id]);
    expect(told[0].message).toContain("Studio");
    expect((await w.ok<Overview>(OWNER, "GET", "overview")).stats).toMatchObject({ spentCents: 4, budgetCents: 4 });

    const now = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    await w.ok(OWNER, "POST", "rules", { ...now, monthlyBudgetCents: 2000 });
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "needs_approval", position: 2 });
    expect(runOf(w, second.run.id).position).toBe(2);
  });

  it("the budget is per calendar month: last month's spend does not hold this month's runs", async () => {
    const w = world();
    await ready(w);
    script(w);
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    await w.ok(OWNER, "POST", "rules", { ...rules, monthlyBudgetCents: 4 });
    const { run } = await leadArrives(w);
    expect(runOf(w, run.id)).toMatchObject({ waitingOn: "budget", position: 2 });
    await w.cron();
    expect(runOf(w, run.id).position).toBe(2);
    // The first of the next month: the run wakes by itself and the Writer runs.
    w.setNow("2026-12-01T00:00:00.000Z");
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "needs_approval", waitingOn: null, position: 2 });
    expect(w.ai.parses()).toHaveLength(3);
    expect(w.store.notifications().filter((n) => n.title === "AI budget reached")).toHaveLength(1);
  });

  it("a paused agent's step waits, and goes on when the agent is resumed", async () => {
    const w = world();
    const { automation } = await ready(w);
    script(w);
    await w.ok(OWNER, "POST", `agents/${automation.steps[1].agentId}/pause`);
    const { run } = await leadArrives(w);
    expect(runOf(w, run.id)).toMatchObject({ status: "waiting", waitingOn: "agent", position: 1 });
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run.id}`)).waitingFor).toBe("Qualifier is paused. Step 2 starts when it is resumed.");
    await w.cron();
    expect(runOf(w, run.id).position).toBe(1);
    await w.ok(OWNER, "POST", `agents/${automation.steps[1].agentId}/resume`);
    await w.cron();
    expect(runOf(w, run.id)).toMatchObject({ status: "needs_approval", position: 2 });
  });

  it("switching automation off leaves runs where they are; switching it on again lets them go on", async () => {
    const w = world();
    await ready(w);
    script(w);
    const { run } = await leadArrives(w);
    await approveFirst(w);
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    const off = await w.ok<WorkspaceRules>(OWNER, "POST", "rules", { ...rules, enabled: false });
    w.advance(3 * DAY);
    await w.cron();
    expect(runOf(w, run.id).position).toBe(3);
    expect(w.ai.parses()).toHaveLength(3);
    await w.ok(OWNER, "POST", "rules", { ...off, enabled: true });
    w.advance(HOUR);
    await w.cron();
    expect(runOf(w, run.id).position).toBe(3);
    expect(w.ai.parses()).toHaveLength(4);
  });
});

describe("POST nudge", () => {
  it("processes this workspace's events and due runs after the reply, at most once a minute", async () => {
    const w = world();
    await ready(w);
    const lead = w.store.personAddsLead({ workspaceId: WS });
    expect(await w.ok(MEMBER, "POST", "nudge")).toEqual({ ok: true });
    expect(w.kept).toHaveLength(1);
    await w.background();
    expect(w.store.runs().filter((r) => r.contactId === lead.id)).toHaveLength(1);

    w.store.personAddsLead({ workspaceId: WS, email: "two@b.example" });
    expect(await w.ok(OWNER, "POST", "nudge")).toEqual({ ok: true });
    expect(w.kept).toHaveLength(0);
    expect(w.store.runs()).toHaveLength(1);
    w.advance(61_000);
    await w.ok(OWNER, "POST", "nudge");
    await w.background();
    expect(w.store.runs()).toHaveLength(2);
  });
});
