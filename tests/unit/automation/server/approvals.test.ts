// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../../../api/_signroom/errors";
import type { Approval, Run, WorkspaceRules } from "../../../../api/_automation/shared/types";
import { answer, DAY, EMAIL, errorOf, HOUR, leadArrives, MEMBER, MEMBER2, OWNER, ready, runOf, WS, world, type World } from "./helpers";

/**
 * Approvals: approving (as it is, or edited), rejecting, who may decide, that
 * an approval is carried out at most once, and the email limits that hold at
 * the moment of sending: the send window, emails per lead, the lead's own
 * address, and never to an unqualified lead or for a stopped run.
 */

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logged.mockRestore();
});

/** A run stopped at the Writer's email, waiting for approval. */
async function waitingEmail(w: World, over: Parameters<typeof leadArrives>[1] = {}) {
  await ready(w);
  w.ai.agent("Writer", answer({ decided: "Introduce us.", handoff: "Intro written.", actions: [EMAIL] }));
  const { lead, run } = await leadArrives(w, over);
  const [approval] = await w.ok<Approval[]>(OWNER, "GET", "approvals");
  return { lead, run, approval };
}

const setRules = async (w: World, over: Record<string, unknown>) => {
  const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
  return w.ok<WorkspaceRules>(OWNER, "POST", "rules", { ...rules, ...over });
};

describe("GET approvals", () => {
  it("lists what is pending, oldest first, with the action, the step and where an email will go", async () => {
    const w = world();
    const { run, approval } = await waitingEmail(w);
    expect(approval).toEqual({
      id: approval.id,
      runId: run.id,
      agentName: "Writer",
      what: "Send the first email to Elena Rossi",
      about: "Northwind Studio",
      action: EMAIL,
      status: "pending",
      created: approval.created,
      canDecide: true,
      stepN: 3,
      to: "elena@northwind.example",
    });
    w.advance(HOUR);
    await leadArrives(w, { firstName: "Tom", lastName: "Okafor", email: "tom@fieldway.example" });
    const list = await w.ok<Approval[]>(OWNER, "GET", "approvals");
    expect(list.map((a) => a.what)).toEqual(["Send the first email to Elena Rossi", "Send the first email to Tom Okafor"]);
  });

  it("`to` is null for an action that is not an email", async () => {
    const w = world();
    await ready(w);
    await setRules(w, { autonomy: "suggest" });
    w.ai.agent("Researcher", answer({ actions: [{ type: "add_note", text: "A design studio." }] }));
    await leadArrives(w);
    const [approval] = await w.ok<Approval[]>(OWNER, "GET", "approvals");
    expect(approval).toMatchObject({ what: "Add a note on Elena Rossi", action: { type: "add_note", text: "A design studio." }, to: null, stepN: 1 });
  });
});

describe("approve", () => {
  it("carries the action out, records who approved, and lets the run go on", async () => {
    const w = world();
    const { lead, run, approval } = await waitingEmail(w);
    const done = await w.ok<Approval>(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect(done).toMatchObject({ id: approval.id, status: "approved", canDecide: false, to: "elena@northwind.example" });
    expect(w.resend.calls).toHaveLength(1);
    expect(w.resend.calls[0].body.to).toEqual([lead.email]);
    await w.background();
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view).toMatchObject({ status: "waiting", stepsDone: 3, facts: { approvals: 1, emailsSent: 1 } });
    expect(view.steps[2]).toMatchObject({ status: "done", approvedBy: "Sam" });
    expect(await w.ok<Approval[]>(OWNER, "GET", "approvals")).toEqual([]);
    // The email is on the lead's timeline, and a "new" lead becomes "attempted to contact".
    expect(w.store.activities().find((a) => a.type === "email")).toMatchObject({ description: "Sent “Your website redesign”", contactId: lead.id, metadata: { automation: true, agent: "Writer", subject: EMAIL.subject, body: EMAIL.body } });
    expect(w.store.leads().find((l) => l.id === lead.id)?.leadStatus).toBe("attempted_to_contact");
  });

  it("an edited email is what goes out: only the subject and the message can change, never where it goes", async () => {
    const w = world();
    const { approval } = await waitingEmail(w);
    const body = "Hi Elena,\n\nA shorter note from me: would Thursday at ten suit you for a call?\n\nSam";
    await w.ok<Approval>(OWNER, "POST", `approvals/${approval.id}/approve`, { subject: "  A quick call?  ", body, to: "attacker@evil.example", recipient: "attacker@evil.example", contactId: "x", email: "attacker@evil.example" });
    expect(w.resend.calls).toHaveLength(1);
    expect(w.resend.calls[0].body).toMatchObject({ to: ["elena@northwind.example"], subject: "A quick call?" });
    // The edited words go out as written; only the lines that say how to stop the emails are added after them.
    expect(String(w.resend.calls[0].body.text).startsWith(body)).toBe(true);
    expect(String(w.resend.calls[0].body.text).slice(body.length)).toContain("unsubscribe here: https://app.example.com/api/email/unsubscribe?c=");
    expect(JSON.stringify(w.resend.calls)).not.toContain("attacker");
    const [row] = w.store.approvals();
    expect(row.action).toEqual({ type: "send_email", subject: "A quick call?", body });
  });

  it("refuses an edit that is empty, too long or still has a blank to fill in, and leaves the approval pending", async () => {
    const w = world();
    const { approval } = await waitingEmail(w);
    for (const edit of [{ subject: "" }, { body: "too short" }, { subject: "s".repeat(201) }, { body: "b".repeat(10_001) }]) {
      const r = await w.call(OWNER, "POST", `approvals/${approval.id}/approve`, edit);
      expect([r.status, errorOf(r)]).toEqual([400, "An email needs a subject of up to 200 characters and a message of 20 to 10000 characters."]);
    }
    for (const edit of [{ body: "Hi [First name], we would love to talk about your website." }, { subject: "For {{company}}" }]) {
      const r = await w.call(OWNER, "POST", `approvals/${approval.id}/approve`, edit);
      expect([r.status, errorOf(r)]).toEqual([400, "The email still has a blank to fill in. Replace it, then approve."]);
    }
    expect(w.resend.calls).toHaveLength(0);
    expect((await w.ok<Approval[]>(OWNER, "GET", "approvals"))[0].status).toBe("pending");
  });

  it("is carried out at most once when two people press Approve at the same moment", async () => {
    const w = world();
    w.store.setOrgMember(WS, MEMBER2.id, "admin", { name: "Noor" });
    const { approval } = await waitingEmail(w);
    const results = await Promise.all([w.call(OWNER, "POST", `approvals/${approval.id}/approve`), w.call(MEMBER2, "POST", `approvals/${approval.id}/approve`), w.call(OWNER, "POST", `approvals/${approval.id}/approve`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(["This approval was already decided.", "This run is being worked on right now. Try again in a moment."]).toContain(errorOf(r));
    await w.background();
    expect(w.resend.calls).toHaveLength(1);
    expect((await w.mailStore.listDeliveries(WS, 10)).length).toBe(1);
    const again = await w.call(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect([again.status, errorOf(again)]).toEqual([409, "This approval was already decided."]);
    expect(w.resend.calls).toHaveLength(1);
  });

  it("the claim itself is what lets only one through: a second caller that gets past every check still sends nothing", async () => {
    const w = world();
    const { approval } = await waitingEmail(w);
    // Both callers have read the approval as pending; the first has claimed it by the time the second tries.
    const first = await w.store.moveApproval(WS, approval.id, "pending", { state: "working" });
    expect(first?.state).toBe("working");
    expect(await w.store.moveApproval(WS, approval.id, "pending", { state: "working" })).toBeNull();
    const late = await w.call(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect(late.status).toBe(409);
    expect(w.resend.calls).toHaveLength(0);
  });

  it("approving each of several waiting actions carries each out once, and the run goes on after the last", async () => {
    const w = world();
    await ready(w);
    await setRules(w, { autonomy: "suggest" });
    w.ai.agent("Researcher", answer({ handoff: "A studio.", actions: [{ type: "add_note", text: "A design studio." }, { type: "create_follow_up", title: "Look at their site", dueInDays: 1, note: "" }] }));
    const { run } = await leadArrives(w);
    const pending = await w.ok<Approval[]>(OWNER, "GET", "approvals");
    expect(pending.map((a) => a.what)).toEqual(["Add a note on Elena Rossi", "Create the follow-up “Look at their site”"]);
    expect(w.store.notes()).toHaveLength(0);
    await w.ok(OWNER, "POST", `approvals/${pending[0].id}/approve`);
    await w.background();
    expect(w.store.notes()).toHaveLength(1);
    expect(runOf(w, run.id)).toMatchObject({ status: "needs_approval", position: 0 });
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run.id}`)).steps[0]).toMatchObject({ status: "waiting_approval", did: ["Added a note on the lead"] });
    await w.ok(OWNER, "POST", `approvals/${pending[1].id}/approve`);
    await w.background();
    expect(w.store.followUps()).toHaveLength(1);
    expect(w.store.notes()).toHaveLength(1);
    expect(runOf(w, run.id).position).toBeGreaterThanOrEqual(1);
  });

  it("an unknown or malformed id is 404", async () => {
    const w = world();
    await waitingEmail(w);
    for (const id of ["nope", "0d000000-0000-4000-8000-00000000dead"]) {
      expect((await w.call(OWNER, "POST", `approvals/${id}/approve`)).status).toBe(404);
      expect((await w.call(OWNER, "POST", `approvals/${id}/reject`)).status).toBe(404);
    }
  });
});

describe("reject", () => {
  it("stops the run with “Stopped at step N: not approved” and nothing is sent, then or later", async () => {
    const w = world();
    const { run, approval } = await waitingEmail(w);
    const out = await w.ok<Approval>(OWNER, "POST", `approvals/${approval.id}/reject`, { reason: "Wrong tone for this lead." });
    expect(out).toMatchObject({ status: "rejected", canDecide: false });
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view).toMatchObject({ status: "stopped", result: "Stopped at step 3: not approved", waitingFor: null, facts: { approvals: 0, emailsSent: 0 } });
    expect(view.steps[2]).toMatchObject({ status: "rejected", did: ["Not approved by Sam: Wrong tone for this lead."] });
    const late = await w.call(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect([late.status, errorOf(late)]).toEqual([409, "This approval was already decided."]);
    w.advance(5 * DAY);
    await w.cron();
    expect(w.resend.calls).toHaveLength(0);
    expect(w.ai.parses()).toHaveLength(3);
  });

  it("rejecting one of several waiting actions cancels the others with it", async () => {
    const w = world();
    await ready(w);
    await setRules(w, { autonomy: "suggest" });
    w.ai.agent("Researcher", answer({ actions: [{ type: "add_note", text: "A design studio." }, { type: "create_follow_up", title: "Look at their site", dueInDays: 1, note: "" }] }));
    await leadArrives(w);
    const pending = await w.ok<Approval[]>(OWNER, "GET", "approvals");
    await w.ok(OWNER, "POST", `approvals/${pending[0].id}/reject`);
    expect(await w.ok<Approval[]>(OWNER, "GET", "approvals")).toEqual([]);
    const other = await w.call(OWNER, "POST", `approvals/${pending[1].id}/approve`);
    expect(other.status).toBe(409);
    expect(w.store.notes()).toHaveLength(0);
    expect(w.store.followUps()).toHaveLength(0);
  });
});

describe("who may decide", () => {
  it("a Member decides only for a lead they own; canDecide says so", async () => {
    const w = world();
    const { run, approval } = await waitingEmail(w, { ownerId: MEMBER.id });
    // Noor is a Member and does not own the lead.
    expect((await w.ok<Approval[]>(MEMBER2, "GET", "approvals"))[0].canDecide).toBe(false);
    for (const action of ["approve", "reject"]) {
      const r = await w.call(MEMBER2, "POST", `approvals/${approval.id}/${action}`);
      expect([r.status, errorOf(r)]).toEqual([403, "Only a workspace owner or admin, or the person who owns this lead, can do that."]);
    }
    for (const path of [`runs/${run.id}/stop`, `runs/${run.id}/replied`]) expect((await w.call(MEMBER2, "POST", path, { positive: true })).status).toBe(403);
    expect(await w.ok<Run>(MEMBER2, "GET", `runs/${run.id}`)).toMatchObject({ canStop: false, canReply: false });
    expect(w.resend.calls).toHaveLength(0);

    // Mia owns the lead.
    expect((await w.ok<Approval[]>(MEMBER, "GET", "approvals"))[0].canDecide).toBe(true);
    expect(await w.ok<Run>(MEMBER, "GET", `runs/${run.id}`)).toMatchObject({ canStop: true, canReply: true });
    await w.ok(MEMBER, "POST", `approvals/${approval.id}/approve`);
    await w.background();
    expect(w.resend.calls).toHaveLength(1);
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run.id}`)).steps[2].approvedBy).toBe("Mia");
  });

  it("a Member who owns the lead's deal may decide too", async () => {
    const w = world();
    const { lead, approval } = await waitingEmail(w, { ownerId: OWNER.id });
    expect((await w.ok<Approval[]>(MEMBER2, "GET", "approvals"))[0].canDecide).toBe(false);
    w.store.personAddsDeal(WS, lead.id, { ownerId: MEMBER2.id });
    expect((await w.ok<Approval[]>(MEMBER2, "GET", "approvals"))[0].canDecide).toBe(true);
    expect((await w.ok<Approval[]>(MEMBER, "GET", "approvals"))[0].canDecide).toBe(false);
    expect((await w.call(MEMBER, "POST", `approvals/${approval.id}/approve`)).status).toBe(403);
    expect((await w.call(MEMBER2, "POST", `approvals/${approval.id}/approve`)).status).toBe(200);
    expect(w.resend.calls).toHaveLength(1);
  });
});

describe("what waits for a person", () => {
  const proposeAll = (w: World) => {
    w.ai.agent("Researcher", answer({ actions: [{ type: "add_note", text: "A design studio." }, { type: "notify_owner", text: "A new lead looks promising." }] }));
    w.ai.agent("Writer", answer({ actions: [EMAIL] }));
  };

  it("ask_external: only the email waits", async () => {
    const w = world();
    await ready(w);
    proposeAll(w);
    await leadArrives(w);
    expect((await w.ok<Approval[]>(OWNER, "GET", "approvals")).map((a) => a.action.type)).toEqual(["send_email"]);
    expect(w.store.notes()).toHaveLength(1);
  });

  it("suggest: everything waits (telling the owner is itself a message to a person and goes straight out)", async () => {
    const w = world();
    await ready(w);
    await setRules(w, { autonomy: "suggest" });
    proposeAll(w);
    const { run } = await leadArrives(w);
    expect((await w.ok<Approval[]>(OWNER, "GET", "approvals")).map((a) => a.action.type)).toEqual(["add_note"]);
    expect(w.store.notes()).toHaveLength(0);
    expect(w.store.notifications().some((n) => n.message === "A new lead looks promising.")).toBe(true);
    expect(runOf(w, run.id)).toMatchObject({ status: "needs_approval", position: 0 });
  });

  it("full: nothing waits and the email goes out by itself", async () => {
    const w = world();
    await ready(w);
    await setRules(w, { autonomy: "full" });
    proposeAll(w);
    const { run } = await leadArrives(w);
    expect(await w.ok<Approval[]>(OWNER, "GET", "approvals")).toEqual([]);
    expect(w.resend.calls).toHaveLength(1);
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view.steps[2]).toMatchObject({ status: "done", approvedBy: null, did: ["Sent the email “Your website redesign” to Elena Rossi"] });
    // Nobody approved anything: the email is in the ledger, not among the approvals a person gave.
    expect(view.facts).toMatchObject({ approvals: 0, emailsSent: 1 });
  });

  it("askFirst on an agent makes all of its actions wait, even under full", async () => {
    const w = world();
    const { automation } = await ready(w);
    await setRules(w, { autonomy: "full" });
    const researcher = (await w.store.getAgent(WS, automation.steps[0].agentId))!;
    await w.ok(OWNER, "PATCH", `agents/${researcher.id}`, { name: researcher.name, job: researcher.job, rights: researcher.rights, askFirst: true, revision: researcher.revision });
    proposeAll(w);
    await leadArrives(w);
    expect((await w.ok<Approval[]>(OWNER, "GET", "approvals")).map((a) => [a.agentName, a.action.type])).toEqual([["Researcher", "add_note"]]);
  });
});

describe("the email limits", () => {
  it("the send window: an email approved outside it is sent when the window opens", async () => {
    const w = world();
    const { run, approval } = await waitingEmail(w);
    // Friday 20 November, 19:30 in London: after hours, and the weekend follows.
    w.setNow("2026-11-20T19:30:00.000Z");
    const done = await w.ok<Approval>(OWNER, "POST", `approvals/${approval.id}/approve`);
    await w.background();
    expect(done.status).toBe("approved");
    expect(w.resend.calls).toHaveLength(0);
    let view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view).toMatchObject({ status: "waiting", stepsDone: 2 });
    expect(view.waitingFor).toBe("The email “Your website redesign” is ready and goes out when the send window opens (Mon 09:00).");
    expect(view.steps[2]).toMatchObject({ status: "done", approvedBy: "Sam", did: ["The email “Your website redesign” is ready and goes out when the send window opens (Mon 09:00)"] });
    expect(w.store.approvals()[0]).toMatchObject({ state: "queued", dueAt: "2026-11-23T09:00:00.000Z" });
    expect(await w.ok<Approval[]>(OWNER, "GET", "approvals")).toEqual([]);

    // Saturday and Sunday pass; nothing goes out.
    w.setNow("2026-11-22T12:00:00.000Z");
    await w.cron();
    expect(w.resend.calls).toHaveLength(0);
    // Monday 09:00: it goes, once, and the run moves on.
    w.setNow("2026-11-23T09:00:00.000Z");
    await Promise.all([w.cron(), w.cron()]);
    await w.cron();
    expect(w.resend.calls).toHaveLength(1);
    view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view.steps[2].did).toEqual(["Sent the email “Your website redesign” to Elena Rossi"]);
    expect(view).toMatchObject({ status: "waiting", stepsDone: 3, facts: { emailsSent: 1 } });
    // The three days without a reply count from when it was sent.
    expect(runOf(w, run.id).wakeAt).toBe("2026-11-26T09:00:00.000Z");
  });

  it("the send window holds for an email nobody has to approve, in the workspace's own time zone", async () => {
    const w = world();
    await ready(w);
    const rules = await w.ok<WorkspaceRules>(OWNER, "GET", "rules");
    await w.ok(OWNER, "POST", "rules", { ...rules, autonomy: "full", sendWindow: { weekdaysOnly: false, startHour: 9, endHour: 18, timeZone: "Asia/Tokyo" } });
    w.ai.agent("Writer", answer({ actions: [EMAIL] }));
    // 10:00 in London is 19:00 in Tokyo: shut.
    const { run } = await leadArrives(w);
    expect(w.resend.calls).toHaveLength(0);
    expect(w.store.approvals()[0]).toMatchObject({ state: "queued", asked: false, dueAt: "2026-11-19T00:00:00.000Z" });
    expect(runOf(w, run.id)).toMatchObject({ status: "waiting", waitingOn: "send_window" });
    w.setNow("2026-11-19T00:00:00.000Z");
    await w.cron();
    expect(w.resend.calls).toHaveLength(1);
  });

  it("emails per lead: after the limit the agents' emails to that lead are dropped, and the step's record says so", async () => {
    const w = world();
    const { automation } = await ready(w);
    await setRules(w, { autonomy: "full", emailsPerLead: 1 });
    // Writer, then a Chaser that starts straight away and wants to write again.
    const steps = [automation.steps[2], { ...automation.steps[3], starts: { type: "after_previous" } }];
    await w.ok(OWNER, "PATCH", `automations/${automation.id}`, { name: automation.name, trigger: automation.trigger, steps, revision: automation.revision });
    w.ai.agent("Writer", answer({ actions: [EMAIL, { ...EMAIL, subject: "And one more thing" }] }));
    w.ai.agent("Chaser", answer({ actions: [{ ...EMAIL, subject: "Following up" }] }));
    const { run } = await leadArrives(w);
    expect(w.resend.calls.map((c) => c.body.subject)).toEqual(["Your website redesign"]);
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view.steps[0].did).toEqual(["Sent the email “Your website redesign” to Elena Rossi", "Not done (send a follow-up email to Elena Rossi): an agent sends one email per step."]);
    expect(view.steps[1].did).toEqual(["Not done (send a follow-up email to Elena Rossi): the limit of 1 emails for one lead is reached."]);
    expect(view.status).toBe("finished");
    // The agent was told where the lead stands.
    expect(w.ai.userText(w.ai.parses()[1])).toContain("The agents have sent this lead 1 of at most 1 emails.");
  });

  it("emails per lead is checked again when an approval is carried out: a limit lowered meanwhile holds", async () => {
    const w = world();
    const { run, approval } = await waitingEmail(w);
    await setRules(w, { emailsPerLead: 0 });
    await w.ok(OWNER, "POST", `approvals/${approval.id}/approve`);
    await w.background();
    expect(w.resend.calls).toHaveLength(0);
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run.id}`)).steps[2].did).toEqual(["Not done (send the first email to Elena Rossi): the limit of 0 emails for one lead is reached."]);
    expect(w.store.approvals()[0].state).toBe("failed");
  });

  it("never emails a lead marked unqualified after the email was written, nor a lead whose address was removed", async () => {
    const w = world();
    const a = await waitingEmail(w);
    // The status is changed without the runner having seen it yet.
    w.store.personEditsLead(a.lead.id, { leadStatus: "unqualified" });
    await w.ok(OWNER, "POST", `approvals/${a.approval.id}/approve`);
    await w.background();
    expect(w.resend.calls).toHaveLength(0);
    expect((await w.ok<Run>(OWNER, "GET", `runs/${a.run.id}`)).steps[2].did).toEqual(["Not done (send the first email to Elena Rossi): the lead is marked unqualified."]);

    const b = await leadArrives(w, { firstName: "Tom", lastName: "Okafor", email: "tom@fieldway.example" });
    const [approval] = await w.ok<Approval[]>(OWNER, "GET", "approvals");
    w.store.personEditsLead(b.lead.id, { email: "" });
    expect((await w.ok<Approval[]>(OWNER, "GET", "approvals"))[0].to).toBeNull();
    await w.ok(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect(w.resend.calls).toHaveLength(0);
    expect((await w.ok<Run>(OWNER, "GET", `runs/${b.run.id}`)).steps[2].did).toEqual(["Not done (send the first email to Tom Okafor): the lead has no email address on file."]);
  });

  it("a queued email is cancelled when the run is stopped before the window opens", async () => {
    const w = world();
    const { run, approval } = await waitingEmail(w);
    w.setNow("2026-11-20T19:30:00.000Z");
    await w.ok(OWNER, "POST", `approvals/${approval.id}/approve`);
    await w.ok(OWNER, "POST", `runs/${run.id}/stop`);
    w.setNow("2026-11-23T09:00:00.000Z");
    await w.cron();
    expect(w.resend.calls).toHaveLength(0);
    expect(w.store.approvals()[0].state).toBe("rejected");
  });

  it("the email is addressed from the CRM at the moment of sending: a changed address is the one used", async () => {
    const w = world();
    const { lead, approval } = await waitingEmail(w);
    w.store.personEditsLead(lead.id, { email: "elena.rossi@northwind.example" });
    await w.ok(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect(w.resend.calls[0].body.to).toEqual(["elena.rossi@northwind.example"]);
  });
});

describe("when the email cannot be sent", () => {
  it("nothing could be sent (a sending limit): the approval goes back to pending and the person is told why", async () => {
    const w = world();
    const { run, approval } = await waitingEmail(w);
    w.mail.spend = async () => ({ ok: false, minutesLeft: 1 });
    const r = await w.call(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect([r.status, errorOf(r)]).toEqual([503, "The email could not be sent just now: You can send up to 20 emails a minute. Try again in a minute."]);
    expect(w.resend.calls).toHaveLength(0);
    expect((await w.ok<Approval[]>(OWNER, "GET", "approvals"))[0]).toMatchObject({ id: approval.id, status: "pending" });
    expect(runOf(w, run.id).status).toBe("needs_approval");
    // Pressed again once the limit has passed, it goes out, once.
    w.mail.spend = async () => ({ ok: true });
    await w.ok(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect(w.resend.calls).toHaveLength(1);
  });

  it("a server with no way to send email says so and keeps the approval", async () => {
    const w = world({ mail: false });
    const { approval } = await waitingEmail(w);
    const r = await w.call(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect([r.status, errorOf(r)]).toEqual([503, "The email could not be sent just now: email is not set up on this server."]);
    expect(w.store.approvals()[0].state).toBe("pending");
  });

  it("an automatic email that cannot go out yet is tried again later, and given up after a day", async () => {
    const w = world();
    await ready(w);
    await setRules(w, { autonomy: "full", sendWindow: { weekdaysOnly: false, startHour: 0, endHour: 24, timeZone: "UTC" } });
    w.ai.agent("Writer", answer({ actions: [EMAIL] }));
    w.mail.spend = async () => ({ ok: false, minutesLeft: 1 });
    const { run } = await leadArrives(w);
    expect(w.store.approvals()[0]).toMatchObject({ state: "queued", dueAt: "2026-11-18T10:15:00.000Z" });
    expect((await w.ok<Run>(OWNER, "GET", `runs/${run.id}`)).steps[2].did).toEqual(["The email “Your website redesign” could not be sent yet (You can send up to 20 emails a minute. Try again in a minute.); it will be tried again"]);
    w.advance(16 * 60_000);
    w.mail.spend = async () => ({ ok: true });
    await w.cron();
    expect(w.resend.calls).toHaveLength(1);
    expect(runOf(w, run.id).position).toBe(3);

    // A second lead, and this time the limit never lifts.
    w.mail.spend = async () => ({ ok: false, minutesLeft: 1 });
    const second = await leadArrives(w, { email: "two@b.example" });
    w.advance(DAY + HOUR);
    await w.cron();
    expect(runOf(w, second.run.id)).toMatchObject({ status: "failed" });
    expect(runOf(w, second.run.id).result).toContain("Could not send the email “Your website redesign”");
    expect(w.resend.calls).toHaveLength(1);
  });

  it("a send that broke off part-way is never repeated: the run fails and the owners are told", async () => {
    const w = world();
    const { run, approval } = await waitingEmail(w);
    w.resend.fail = new Error("socket hang up while sending to elena@northwind.example");
    const done = await w.ok<Approval>(OWNER, "POST", `approvals/${approval.id}/approve`);
    await w.background();
    expect(done.status).toBe("approved");
    const view = await w.ok<Run>(OWNER, "GET", `runs/${run.id}`);
    expect(view).toMatchObject({ status: "failed", result: "Failed at step 3: The email “Your website redesign” may not have been delivered: sending failed part-way." });
    expect(view.steps[2].status).toBe("failed");
    w.resend.fail = null;
    await w.cron();
    const again = await w.call(OWNER, "POST", `approvals/${approval.id}/approve`);
    expect(again.status).toBe(409);
    expect(w.resend.calls).toHaveLength(0);
    expect(w.store.notifications().some((n) => n.title === "An automation run failed")).toBe(true);
    // No address and no error text in the log.
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/elena@|socket hang up/);
    expect(new AppError("x").status).toBe(400);
  });
});
