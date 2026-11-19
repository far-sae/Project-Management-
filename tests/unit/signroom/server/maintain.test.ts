// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agreementAction, getAgreement } from "../../../../api/_signroom/agreements";
import { exportEvidence, scheduleDeletion } from "../../../../api/_signroom/retention";
import type { Agreement } from "../../../../api/_signroom/shared/types";
import type { Store, StoredAgreement } from "../../../../api/_signroom/store";
import { maintain, runOps, runJobs } from "../../../../api/_signroom/worker";
import { finalising, madeDraft, mailSetup, newClient, OWNER, sent, type Resend } from "./agreementFixtures";

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logged.mockRestore();
  vi.useRealTimers();
});

const DAY = 86_400_000;
const subjects = (resend: Resend) => resend.calls.map((c) => (JSON.parse(String(c.init.body)) as { subject: string }).subject);
const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
const eventsOf = (a: StoredAgreement, type: string) => a.events.filter((e) => e.type === type).length;

/** A sent one-signer agreement (its invitation already sent and cleared from `resend`), saved first with `patch`. */
async function sentWith(patch: Partial<Agreement>) {
  const m = mailSetup();
  const client = await newClient(m.store);
  const draft = await madeDraft(m.deps, client.id);
  const saved = (await agreementAction(m.store, OWNER, draft.id, "save", { ...draft, ...patch })) as Agreement;
  const a = await sent(m.deps, saved);
  m.resend.calls.length = 0;
  const row = async () => (await m.store.getAgreement(a.workspaceId, a.id))!;
  return { ...m, a, row };
}

/** SR v2.integration.ts 1229–1236: one-day reminders, the last one two days ago. */
async function reminderDue() {
  const t = await sentWith({ reminderDays: 1 });
  const r = await t.row();
  await t.store.updateAgreement(r.workspaceId, r.id, r.rowVersion, { lastReminderAt: new Date(Date.now() - 2 * DAY).toISOString() });
  return t;
}

describe("maintain: automatic reminders", () => {
  it("reminds without rotating the link, once (SR: Automatic reminders preserve existing invitation sessions)", async () => {
    const t = await reminderDue();
    const before = await t.row();
    const original = (await t.store.listSignTokens(t.a.id)).find((x) => !x.revoked)!;

    await runOps(t.deps);

    const after = await t.row();
    const p = after.participants[0];
    expect(p.version).toBe(before.participants[0].version);
    expect(p.progress).toBe(before.participants[0].progress);
    expect(t.store.jobs().some((j) => j.agreementId === t.a.id && j.participantId === p.id && j.purpose === "reminder")).toBe(true);
    expect((await t.store.getSignToken(original.id))!.revoked).toBe(false);
    expect(t.resend.calls).toHaveLength(1);
    expect(subjects(t.resend)).toEqual(["Please sign: " + t.a.title]);
    expect(eventsOf(after, "Automatic reminders queued")).toBe(1);
    expect(after.events.find((e) => e.type === "Automatic reminders queued")!.actor).toBe("system");
    expect(Date.now() - Date.parse(after.lastReminderAt!)).toBeLessThan(60_000);

    await runOps(t.deps);
    expect(t.resend.calls).toHaveLength(1);
    expect(logged).not.toHaveBeenCalled();
  }, 60000);

  it("two runs at once queue exactly one set of reminders", async () => {
    const t = await reminderDue();
    await Promise.all([runOps(t.deps), runOps(t.deps)]);
    expect(count(t.store.jobs(), (j) => j.agreementId === t.a.id && j.purpose === "reminder")).toBe(1);
    expect(eventsOf(await t.row(), "Automatic reminders queued")).toBe(1);
    expect(t.resend.calls).toHaveLength(1);
  }, 60000);

  it("skips agreements with reminders off or not yet due", async () => {
    const off = await sentWith({ reminderDays: 0 });
    const r = await off.row();
    await off.store.updateAgreement(r.workspaceId, r.id, r.rowVersion, { lastReminderAt: new Date(Date.now() - 40 * DAY).toISOString() });
    await runOps(off.deps);
    expect(off.store.jobs().some((j) => j.purpose === "reminder")).toBe(false);

    const soon = await sentWith({ reminderDays: 3 });
    await runOps(soon.deps);
    expect(soon.store.jobs().some((j) => j.purpose === "reminder")).toBe(false);
    expect(eventsOf(await soon.row(), "Automatic reminders queued")).toBe(0);
  }, 60000);

  it("a reminder write that loses its race skips the agreement", async () => {
    const t = await reminderDue();
    const losing: Store = { ...t.store, updateAgreement: async () => null };
    await maintain({ ...t.deps, store: losing });
    expect(t.store.jobs().some((j) => j.purpose === "reminder")).toBe(false);
  }, 60000);
});

describe("maintain: expiry", () => {
  /** A one-signer agreement with a deadline of tomorrow, then the clock three days on. */
  async function pastDeadline() {
    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    const t = await sentWith({ deadline: tomorrow });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3 * DAY);
    return t;
  }

  it("expires a past deadline and tells the sender once over two runs", async () => {
    const t = await pastDeadline();
    await runOps(t.deps);
    await runOps(t.deps);
    const a = await t.row();
    expect(a.status).toBe("Expired");
    expect(subjects(t.resend).filter((s) => s === `Expired: ${t.a.title}`)).toHaveLength(1);
    const notice = JSON.parse(String(t.resend.calls[0].init.body)) as { to: string[]; text: string };
    expect(notice.to).toEqual([OWNER.email]);
    expect(notice.text).toContain("The signing deadline has passed. Remaining signing access was revoked.");
    expect(eventsOf(a, "Expiry notification queued")).toBe(1);
    expect(t.store.jobs().filter((j) => j.dedupe === `notice:expired:${t.a.id}`)).toHaveLength(1);
    expect((await t.store.listSignTokens(t.a.id)).every((x) => x.revoked)).toBe(true);
    expect(t.store.jobs().some((j) => j.purpose === "reminder")).toBe(false);
  }, 60000);

  it("two runs at once tell the sender once and write the event once", async () => {
    const t = await pastDeadline();
    await Promise.all([runOps(t.deps), runOps(t.deps)]);
    expect(subjects(t.resend).filter((s) => s === `Expired: ${t.a.title}`)).toHaveLength(1);
    expect(eventsOf(await t.row(), "Expiry notification queued")).toBe(1);
  }, 60000);

  it("still tells the sender when a page view expired it first (SR maintain sees every Expired agreement)", async () => {
    const t = await pastDeadline();
    expect((await getAgreement(t.store, OWNER, t.a.id)).status).toBe("Expired");
    await runOps(t.deps);
    expect(subjects(t.resend)).toEqual([`Expired: ${t.a.title}`]);
    expect(eventsOf(await t.row(), "Expiry notification queued")).toBe(1);
  }, 60000);
});

/** A Completed agreement, exported and scheduled, with its deletion date moved into the past (as in retention.test.ts). */
async function deletionDue() {
  const m = mailSetup();
  const client = await newClient(m.store);
  const f = await finalising(m.deps, client.id);
  await runJobs(m.deps, { ids: [m.store.jobs().find((j) => j.dedupe === "finalise:" + f.id)!.id] });
  await exportEvidence(m.store, OWNER, f.id);
  await scheduleDeletion(m.store, OWNER, f.id);
  const now = (await m.store.getAgreement(f.workspaceId, f.id))!;
  const a = (await m.store.updateAgreement(now.workspaceId, now.id, now.rowVersion, { deletionAt: new Date(Date.now() - 1000).toISOString() }))!;
  m.resend.calls.length = 0;
  return { ...m, a, row: () => m.store.getAgreement(a.workspaceId, a.id) };
}

describe("maintain: retention", () => {
  it("enqueues a due, unheld deletion and the same run deletes it (SR: Controlled retention removes an eligible exported agreement)", async () => {
    const t = await deletionDue();
    await runOps(t.deps);
    expect(await t.row()).toBeNull();
    expect(t.store.jobs().find((j) => j.dedupe === "delete:" + t.a.id)).toMatchObject({ kind: "delete", purpose: "retention", status: "done" });
    expect(logged).not.toHaveBeenCalled();
  }, 60000);

  it("does not enqueue a held one", async () => {
    const t = await deletionDue();
    await agreementAction(t.store, OWNER, t.a.id, "hold", { hold: true, reason: "Synthetic legal hold" });
    await runOps(t.deps);
    expect(await t.row()).not.toBeNull();
    expect(t.store.jobs().some((j) => j.kind === "delete")).toBe(false);
  }, 60000);

  it("a deletion suppressed by a hold runs again once the hold is released", async () => {
    const t = await deletionDue();
    const job = await t.store.insertJob({ workspaceId: t.a.workspaceId, agreementId: t.a.id, kind: "delete", purpose: "retention", dedupe: "delete:" + t.a.id, payload: "" });
    await agreementAction(t.store, OWNER, t.a.id, "hold", { hold: true, reason: "Synthetic legal hold" });
    await runOps(t.deps);
    expect((await t.store.getJob(job.id))!.status).toBe("suppressed");
    expect(await t.row()).not.toBeNull();

    await agreementAction(t.store, OWNER, t.a.id, "hold", { hold: false, reason: "Released" });
    await runOps(t.deps);
    expect(await t.row()).toBeNull();
    // The suppressed run's attempt is forgotten: the released job starts again from 0.
    expect(await t.store.getJob(job.id)).toMatchObject({ status: "done", attempts: 1 });
    expect(t.store.jobs().filter((j) => j.kind === "delete")).toHaveLength(1);
  }, 60000);
});

describe("maintain: finishing never strands", () => {
  it("re-queues finalise for a Finalising agreement whose job was never queued, and finishes it", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const f = await finalising(m.deps, client.id);
    // The enqueue after the Finalising write failed: no job exists.
    const job = m.store.jobs().find((j) => j.dedupe === "finalise:" + f.id)!;
    await m.store.updateJob(job.id, { status: "done" });
    await m.store.purgeJobs(new Date(Date.now() + 1000).toISOString());
    expect(m.store.jobs().some((j) => j.dedupe === "finalise:" + f.id)).toBe(false);

    await runOps(m.deps);
    expect((await m.store.getAgreement(f.workspaceId, f.id))!.status).toBe("Completed");
    expect(m.store.jobs().filter((j) => j.dedupe === "finalise:" + f.id)).toHaveLength(1);
  }, 60000);

  it("leaves a queued finalise alone, and retries a failed one only after an hour", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const f = await finalising(m.deps, client.id);
    const job = m.store.jobs().find((j) => j.dedupe === "finalise:" + f.id)!;
    await m.store.updateJob(job.id, { status: "failed", error: "Processing failed after 5 attempts." });
    await maintain(m.deps);
    expect((await m.store.getJob(job.id))!.status).toBe("failed");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61 * 60_000);
    await maintain(m.deps);
    expect(await m.store.getJob(job.id)).toMatchObject({ status: "queued" });
    expect((await m.store.getJob(job.id))!.error).toBeUndefined();
    expect(m.store.jobs().filter((j) => j.dedupe === "finalise:" + f.id)).toHaveLength(1);
  }, 60000);

  it("a finalise that keeps failing after its fifth attempt adds no more evidence events", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const f = await finalising(m.deps, client.id);
    const job = m.store.jobs().find((j) => j.dedupe === "finalise:" + f.id)!;
    for (let n = 0; n < 5; n++) await m.store.claimJobs(1, -1, [job.id]);
    await m.store.updateJob(job.id, { status: "failed", error: "Processing failed after 5 attempts." });
    const before = (await m.store.getAgreement(f.workspaceId, f.id))!.events.length;
    m.deps.evidenceKey = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61 * 60_000);
    await runOps(m.deps);
    const a = (await m.store.getAgreement(f.workspaceId, f.id))!;
    expect(a.status).toBe("Finalising");
    expect(a.events).toHaveLength(before);
    expect(await m.store.getJob(job.id)).toMatchObject({ status: "failed", attempts: 6 });
    // The next try waits two hours, not one.
    vi.setSystemTime(Date.now() + 61 * 60_000);
    await maintain(m.deps);
    expect((await m.store.getJob(job.id))!.status).toBe("failed");
    expect(logged).toHaveBeenCalledWith("[signroom] job failed", "finalise", 503);
  }, 60000);
});

describe("maintain: completion emails refused by a send limit", () => {
  /** A one-signer agreement finished while every email is refused before sending (the day limit). */
  async function refusedCompletion() {
    const m = mailSetup();
    const client = await newClient(m.store);
    const f = await finalising(m.deps, client.id);
    m.resend.calls.length = 0;
    const refuse = { on: true };
    m.deps.peek = async () => (refuse.on ? { ok: false, minutesLeft: 600 } : { ok: true });
    const fin = m.store.jobs().find((j) => j.dedupe === "finalise:" + f.id)!;
    await runJobs(m.deps, { ids: [fin.id] });
    expect((await m.store.getAgreement(f.workspaceId, f.id))!.status).toBe("Completed");
    const job = () => m.store.jobs().find((j) => j.agreementId === f.id && j.purpose === "completion")!;
    vi.useFakeTimers({ toFake: ["Date"] });
    // Four more quick tries (the backoff is at most an hour), then failed.
    for (let n = 0; n < 4; n++) {
      vi.setSystemTime(Date.now() + 61 * 60_000);
      await runOps(m.deps);
    }
    expect(job()).toMatchObject({ status: "failed", attempts: 5, manualReview: false });
    return { ...m, f, job, refuse };
  }

  it("is queued again a day after it failed, and sent once the limit allows", async () => {
    const t = await refusedCompletion();
    vi.setSystemTime(Date.now() + 23 * 3600_000);
    await runOps(t.deps);
    expect(t.job()).toMatchObject({ status: "failed", attempts: 5 });

    vi.setSystemTime(Date.now() + 61 * 60_000);
    t.refuse.on = false;
    await runOps(t.deps);
    expect(t.job()).toMatchObject({ status: "done", attempts: 6 });
    const sent = t.resend.calls.map((c) => JSON.parse(String(c.init.body)) as { to: string[]; subject: string });
    expect(sent.filter((m) => m.subject === "Completed: " + t.f.title && m.to[0] === t.f.participants[0].email)).toHaveLength(1);
  }, 60000);

  it("is tried once a day, seven times, then left failed", async () => {
    const t = await refusedCompletion();
    // Keep the link alive past a week, so only the requeue count stops it.
    for (const x of await t.store.listSignTokens(t.f.id)) await t.store.updateSignToken(x.id, { expires: Date.now() + 30 * DAY });
    const events = (await t.store.getAgreement(t.f.workspaceId, t.f.id))!.events.length;
    for (let day = 1; day <= 7; day++) {
      vi.setSystemTime(Date.now() + DAY + 60_000);
      await runOps(t.deps);
      expect(t.job()).toMatchObject({ status: "failed", attempts: 5 + day });
    }
    vi.setSystemTime(Date.now() + 3 * DAY);
    await runOps(t.deps);
    expect(t.job()).toMatchObject({ status: "failed", attempts: 12 });
    expect(t.resend.calls).toHaveLength(0);
    // The daily tries add no evidence events.
    expect((await t.store.getAgreement(t.f.workspaceId, t.f.id))!.events).toHaveLength(events);
  }, 60000);

  it("never queues a held completion email again", async () => {
    const t = await refusedCompletion();
    await t.store.updateJob(t.job().id, { manualReview: true });
    vi.setSystemTime(Date.now() + 2 * DAY);
    await runOps(t.deps);
    expect(t.job()).toMatchObject({ status: "failed", attempts: 5 });
  }, 60000);
});

describe("maintain: cleanup", () => {
  it("removes sign sessions expired over a day ago and purges settled jobs after 30 days", async () => {
    const m = mailSetup();
    const session = (digest: string, expires: number) =>
      m.store.insertSignSession({ digest, tokenId: "t", workspaceId: "w", agreementId: "a", participantId: "p", purpose: "sign", version: 1, expires });
    await session("old", Date.now() - 2 * DAY);
    await session("recent", Date.now() - 3600_000);
    const done = await m.store.insertJob({ workspaceId: "w", kind: "mail", purpose: "notice", dedupe: "old-done", payload: "" });
    await m.store.updateJob(done.id, { status: "done" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * DAY);
    await session("fresh", Date.now() + 60_000);
    await runOps(m.deps);
    expect(m.store.signSessions().map((s) => s.digest)).toEqual(["fresh"]);
    expect(await m.store.getJob(done.id)).toBeNull();
  });

  it("a session expired less than a day ago stays", async () => {
    const m = mailSetup();
    await m.store.insertSignSession({ digest: "recent", tokenId: "t", workspaceId: "w", agreementId: "a", participantId: "p", purpose: "sign", version: 1, expires: Date.now() - 3600_000 });
    await runOps(m.deps);
    expect(m.store.signSessions().map((s) => s.digest)).toEqual(["recent"]);
  });
});

describe("runOps", () => {
  it("maintains, then runs due jobs, and answers how many it ran", async () => {
    const t = await reminderDue();
    expect(await runOps(t.deps)).toEqual({ processed: 1 });
    expect(await runOps(t.deps)).toEqual({ processed: 0 });
  }, 60000);

  it("a failing list or a failing claim is logged by name and the run goes on", async () => {
    const m = mailSetup();
    const boom = async () => {
      throw new TypeError("secret row data");
    };
    const store: Store = { ...m.store, listDueAgreements: boom, listDeletionsDue: boom, listStrandedFinalising: boom, claimJobs: boom };
    expect(await runOps({ ...m.deps, store })).toEqual({ processed: 0 });
    expect(logged).toHaveBeenCalled();
    for (const call of logged.mock.calls) {
      expect(String(call[0])).toMatch(/^\[signroom\] .+ failed$/);
      expect(call.slice(1)).toEqual(["TypeError"]);
    }
  });
});
