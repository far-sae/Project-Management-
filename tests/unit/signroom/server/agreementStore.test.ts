// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeStore } from "../../../../api/_signroom/fakeStore";
import type { Agreement } from "../../../../api/_signroom/shared/types";

type NewAgreement = Omit<Agreement, "id" | "created" | "updated" | "deliveries">;

const draft = (over: Partial<NewAgreement> = {}): NewAgreement => ({
  workspaceId: "w1",
  senderId: "u1",
  clientId: "c1",
  type: "NDA",
  title: "Mutual NDA",
  status: "Draft",
  revision: 1,
  content: "Body text",
  sourceKind: "authored",
  pages: [],
  participants: [],
  fields: [],
  sequential: false,
  deadline: "",
  reminderDays: 3,
  subject: "",
  message: "",
  events: [],
  legalHold: false,
  ...over,
});

const ev = (seq: number) => ({ seq, type: "created", actor: "u1", at: "2026-11-17T10:00:00Z", detail: {} });
const person = [{ id: "p1", name: "A", email: "a@b.co", role: "signer" as const, order: 1, progress: "invited" as const, version: 1 }];

afterEach(() => vi.useRealTimers());

describe("fakeStore agreements", () => {
  it("returns null for a stale rowVersion and applies a fresh one", async () => {
    const s = fakeStore();
    const a = await s.insertAgreement(draft());
    expect(a.rowVersion).toBe(1);
    const b = await s.updateAgreement("w1", a.id, 1, { title: "New" });
    expect(b?.title).toBe("New");
    expect(b?.rowVersion).toBe(2);
    expect(await s.updateAgreement("w1", a.id, 1, { title: "Again" })).toBeNull();
    expect(await s.updateAgreement("other", a.id, 2, { title: "Again" })).toBeNull();
  });

  it("refuses an update that drops or edits an earlier event", async () => {
    const s = fakeStore();
    const a = await s.insertAgreement(draft({ events: [ev(1), ev(2)] }));
    await expect(s.updateAgreement("w1", a.id, 1, { events: [ev(1)] })).rejects.toThrow("Evidence history is append-only.");
    await expect(s.updateAgreement("w1", a.id, 1, { events: [ev(1), { ...ev(2), type: "edited" }] })).rejects.toThrow(
      "Evidence history is append-only.",
    );
    const ok = await s.updateAgreement("w1", a.id, 1, { events: [ev(1), ev(2), ev(3)] });
    expect(ok?.events).toHaveLength(3);
  });

  it("locks a sent agreement apart from the allowed columns", async () => {
    const s = fakeStore();
    const a = await s.insertAgreement(draft());
    const sent = await s.updateAgreement("w1", a.id, 1, {
      status: "Awaiting signatures",
      frozen: {
        sourceHash: "h",
        snapshotHash: "s",
        consent: { version: "v", text: "t" },
        revision: 1,
        participants: [],
        fields: [],
        settings: { sequential: false, deadline: "" },
      },
    });
    expect(sent?.status).toBe("Awaiting signatures");
    await expect(s.updateAgreement("w1", a.id, 2, { content: "changed" })).rejects.toThrow("Sent and finished agreements cannot change.");
    expect(await s.updateAgreement("w1", a.id, 2, { archivedAt: "2026-11-18T00:00:00Z" })).not.toBeNull();
    expect(await s.updateAgreement("w1", a.id, 3, { participants: person })).not.toBeNull();
  });

  it("locks a cancelled agreement's participants", async () => {
    const s = fakeStore();
    const a = await s.insertAgreement(draft());
    await s.updateAgreement("w1", a.id, 1, { status: "Awaiting signatures" });
    await s.updateAgreement("w1", a.id, 2, { status: "Cancelled" });
    await expect(s.updateAgreement("w1", a.id, 3, { participants: person })).rejects.toThrow(
      "Sent and finished agreements cannot change.",
    );
    expect(await s.updateAgreement("w1", a.id, 3, { legalHold: true })).not.toBeNull();
  });

  it("sets the sender-signed hash once", async () => {
    const s = fakeStore();
    const a = await s.insertAgreement(draft());
    await s.updateAgreement("w1", a.id, 1, { status: "Awaiting signatures" });
    await s.updateAgreement("w1", a.id, 2, { senderSignedHash: "h1" });
    expect(await s.updateAgreement("w1", a.id, 3, { senderSignedHash: "h1" })).not.toBeNull();
    await expect(s.updateAgreement("w1", a.id, 4, { senderSignedHash: "h2" })).rejects.toThrow(
      "Sender-signed document is immutable.",
    );
  });

  it("refuses to clear a locked field with an empty string", async () => {
    const s = fakeStore();
    const a = await s.insertAgreement(draft({ documentHash: "dh", sendKey: "sk" }));
    await s.updateAgreement("w1", a.id, 1, { status: "Awaiting signatures", sentAt: "2026-11-17T10:00:00Z" });
    await expect(s.updateAgreement("w1", a.id, 2, { documentHash: "" })).rejects.toThrow("Sent and finished agreements cannot change.");
    await expect(s.updateAgreement("w1", a.id, 2, { sendKey: "" })).rejects.toThrow("Sent and finished agreements cannot change.");
    expect((await s.getAgreement("w1", a.id))?.documentHash).toBe("dh");
    await s.updateAgreement("w1", a.id, 2, { status: "Completed", completedAt: "2026-11-18T10:00:00Z" });
    await expect(s.updateAgreement("w1", a.id, 3, { completedAt: "" })).rejects.toThrow("Sent and finished agreements cannot change.");
    await expect(s.updateAgreement("w1", a.id, 3, { sentAt: "" })).rejects.toThrow("Sent and finished agreements cannot change.");
  });

  it("lists summaries for one sender, newest first, without the heavy fields", async () => {
    const s = fakeStore();
    await s.insertAgreement(draft({ title: "one", senderId: "u1" }));
    await s.insertAgreement(draft({ title: "two", senderId: "u2" }));
    await s.insertAgreement(draft({ title: "three", senderId: "u2" }));
    await s.insertAgreement(draft({ workspaceId: "w2", title: "elsewhere", senderId: "u2" }));
    const mine = await s.listAgreements("w1", "u2");
    expect(mine.map((a) => a.title)).toEqual(["three", "two"]);
    for (const k of ["content", "events", "branding", "frozen", "fields"]) expect(mine[0]).not.toHaveProperty(k);
    expect((await s.listAgreements("w1", null)).map((a) => a.title)).toEqual(["three", "two", "one"]);
  });

  it("counts non-trashed drafts", async () => {
    const s = fakeStore();
    await s.insertAgreement(draft());
    await s.insertAgreement(draft({ trashedAt: "2026-11-17T10:00:00Z" }));
    await s.insertAgreement(draft({ status: "Awaiting signatures" }));
    await s.insertAgreement(draft({ workspaceId: "w2" }));
    expect(await s.countDrafts("w1")).toBe(1);
  });

  it("keeps workspace scope on get", async () => {
    const s = fakeStore();
    const a = await s.insertAgreement(draft());
    expect((await s.getAgreement("w1", a.id))?.title).toBe("Mutual NDA");
    expect(await s.getAgreement("w2", a.id)).toBeNull();
  });

  it("versions templates per name", async () => {
    const s = fakeStore();
    const t = { workspaceId: "w1", name: "NDA", type: "NDA", content: "x", roles: ["Client"], fields: [] };
    expect((await s.insertAgreementTemplate(t)).version).toBe(1);
    expect((await s.insertAgreementTemplate(t)).version).toBe(2);
    expect((await s.insertAgreementTemplate({ ...t, name: "Other" })).version).toBe(1);
    const list = await s.listAgreementTemplates("w1");
    expect(list).toHaveLength(3);
    expect(Object.keys(list[0]).sort()).toEqual(["created", "id", "name", "type", "version"]);
    const second = list.find((x) => x.name === "NDA" && x.version === 2)!;
    expect((await s.getAgreementTemplate("w1", second.id))?.content).toBe("x");
    expect(await s.getAgreementTemplate("w2", second.id)).toBeNull();
  });

  it("stores and revokes sign tokens", async () => {
    const s = fakeStore();
    const base = { digest: "d1", purpose: "sign" as const, workspaceId: "w1", agreementId: "a1", participantId: "p1", email: "a@b.co", version: 1, expires: 1, revoked: false };
    await s.insertSignToken(base);
    await s.insertSignToken({ ...base, digest: "d2", participantId: "p2" });
    await s.insertSignToken({ ...base, digest: "d3", agreementId: "a2" });
    await s.revokeSignTokens("a1", "p1");
    expect((await s.listSignTokens("a1")).map((t) => t.revoked)).toEqual([true, false]);
    await s.revokeSignTokens("a1");
    expect((await s.listSignTokens("a1")).every((t) => t.revoked)).toBe(true);
    expect((await s.listSignTokens("a2"))[0].revoked).toBe(false);
  });

  it("lists an agreement's deliveries oldest first", async () => {
    const s = fakeStore();
    const d = { workspaceId: "w1", agreementId: "a1", participantId: "p1", recipient: "a@b.co", subject: "s", purpose: "invite", route: "securovix" as const, status: "sent" as const };
    await s.insertDelivery({ ...d, subject: "first" });
    await s.insertDelivery({ ...d, subject: "second" });
    await s.insertDelivery({ ...d, agreementId: "a2", subject: "other" });
    expect((await s.listAgreementDeliveries("a1")).map((x) => x.subject)).toEqual(["first", "second"]);
  });

  it("holdJobDelivery fails only the job's own rows", async () => {
    const s = fakeStore();
    const d = { workspaceId: "w1", agreementId: "a1", participantId: "p1", recipient: "a@b.co", subject: "s", purpose: "invite", route: "securovix" as const, status: "sending" as const };
    const mine = await s.insertDelivery({ ...d, jobId: "j1" });
    const other = await s.insertDelivery({ ...d, jobId: "j2" });
    expect(await s.holdJobDelivery("j1", "held")).toBe(true);
    expect(await s.holdJobDelivery("j3", "held")).toBe(false);
    const rows = await s.listAgreementDeliveries("a1");
    expect(rows.find((x) => x.id === mine.id)).toMatchObject({ status: "failed", error: "held", jobId: "j1" });
    expect(rows.find((x) => x.id === other.id)).toMatchObject({ status: "sending" });
  });

  describe("uploads", () => {
    it("takes a ticket once, only in its workspace", async () => {
      const s = fakeStore();
      const t = await s.createUpload("w1", "a1");
      expect(t.path).toBe(`w1/quarantine/${t.id}.pdf`);
      expect(t.token).toBeTruthy();
      expect(await s.takeUpload("w2", t.id)).toBeNull();
      expect((await s.takeUpload("w1", t.id))?.id).toBe(t.id);
      expect(await s.takeUpload("w1", t.id)).toBeNull();
      expect(await s.takeUpload("w1", "not-a-uuid")).toBeNull();
    });

    it("refuses a ticket older than 2 hours", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
      const s = fakeStore();
      const t = await s.createUpload("w1", "a1");
      vi.setSystemTime(new Date("2026-11-17T12:00:01Z"));
      expect(await s.takeUpload("w1", t.id)).toBeNull();
    });

    it("reads and removes quarantine objects, never throwing on remove", async () => {
      const s = fakeStore();
      s.putQuarantine("w1/quarantine/x.pdf", new Uint8Array([1, 2]));
      expect([...(await s.readQuarantine("w1/quarantine/x.pdf"))!]).toEqual([1, 2]);
      await s.removeQuarantine("w1/quarantine/x.pdf");
      await s.removeQuarantine("w1/quarantine/x.pdf");
      expect(s.quarantinePaths()).toEqual([]);
      expect(await s.readQuarantine("w1/quarantine/x.pdf")).toBeNull();
    });

    it("sweeps one workspace's tickets created before a time", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
      const s = fakeStore();
      const old = await s.createUpload("w1", "a1");
      const other = await s.createUpload("w2", "a2");
      s.putQuarantine(old.path, new Uint8Array([1]));
      s.putQuarantine(other.path, new Uint8Array([1]));
      vi.setSystemTime(new Date("2026-11-17T11:00:00Z"));
      const fresh = await s.createUpload("w1", "a1");
      s.putQuarantine(fresh.path, new Uint8Array([1]));
      await s.sweepUploads("w1", "2026-11-17T10:30:00Z");
      expect(s.quarantinePaths().sort()).toEqual([fresh.path, other.path].sort());
      expect(await s.takeUpload("w1", old.id)).toBeNull();
      expect((await s.takeUpload("w1", fresh.id))?.id).toBe(fresh.id);
    });
  });
});

describe("fakeStore part 3B", () => {
  const sent = (over: Partial<NewAgreement> = {}) => draft({ status: "Finalising", participants: person, ...over });
  const tok = (over = {}) => ({ digest: "d1", purpose: "sign" as const, workspaceId: "w1", agreementId: "a1", participantId: "p1", email: "a@b.co", version: 1, expires: Date.now() + 1000, revoked: false, ...over });
  const newJob = (over = {}) => ({ workspaceId: "w1", agreementId: "a1", kind: "mail" as const, purpose: "invite", dedupe: "x", payload: "", ...over });

  it("sets artifacts once and refuses a change", async () => {
    const s = fakeStore();
    const a = await s.insertAgreement(sent());
    const b = await s.updateAgreement("w1", a.id, 1, { artifacts: { final: "h1" } });
    expect(b?.artifacts).toEqual({ final: "h1" });
    await expect(s.updateAgreement("w1", a.id, 2, { artifacts: { final: "h2" } })).rejects.toThrow("Completed artifacts are immutable.");
  });

  it("lets a Completed row record exportedAt and deletionAt but not content", async () => {
    const s = fakeStore();
    const a = await s.insertAgreement(sent({ status: "Completed" }));
    const b = await s.updateAgreement("w1", a.id, 1, { exportedAt: "2026-11-17T10:00:00Z", deletionAt: "2030-01-01T00:00:00Z" });
    expect(b).toMatchObject({ exportedAt: "2026-11-17T10:00:00Z", deletionAt: "2030-01-01T00:00:00Z" });
    await expect(s.updateAgreement("w1", a.id, 2, { content: "x" })).rejects.toThrow("Sent and finished agreements cannot change.");
    const c = await s.updateAgreement("w1", a.id, 2, { deletionAt: "" });
    expect(c?.deletionAt).toBeUndefined();
  });

  it("deleteAgreement follows the retention rule and cascades", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    const s = fakeStore();
    const a = await s.insertAgreement(sent({ status: "Completed", deletionAt: "2026-11-18T00:00:00Z" }));
    await s.insertSignToken(tok({ agreementId: a.id }));
    await s.insertSignSession({ digest: "s1", tokenId: "t", workspaceId: "w1", agreementId: a.id, participantId: "p1", purpose: "sign", version: 1, expires: Date.now() + 1000 });
    expect(await s.deleteAgreement("w1", a.id)).toBe(false);
    vi.setSystemTime(new Date("2026-11-19T00:00:00Z"));
    const held = await s.updateAgreement("w1", a.id, 1, { legalHold: true });
    expect(await s.deleteAgreement("w1", a.id)).toBe(false);
    await s.updateAgreement("w1", a.id, held!.rowVersion, { legalHold: false });
    expect(await s.deleteAgreement("w1", "other")).toBe(false);
    expect(await s.deleteAgreement("w1", a.id)).toBe(true);
    expect(await s.getAgreement("w1", a.id)).toBeNull();
    expect(await s.listSignTokens(a.id)).toEqual([]);
    expect(s.signSessions()).toEqual([]);
  });

  it("insertJob dedupes, claimJobs leases and re-claims after the lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    const s = fakeStore();
    const j1 = await s.insertJob(newJob());
    const j2 = await s.insertJob(newJob());
    expect(j2.id).toBe(j1.id);
    expect(s.jobs()).toHaveLength(1);
    expect(await s.claimJobs(1, 360)).toHaveLength(1);
    expect(await s.claimJobs(1, 360)).toHaveLength(0);
    vi.setSystemTime(new Date(Date.now() + 361_000));
    const again = await s.claimJobs(1, 360);
    expect(again).toHaveLength(1);
    expect(again[0].attempts).toBe(2);
    expect(await s.claimJobs(5, 360, ["nope"])).toHaveLength(0);
  });

  it("markLiveAttempt is true once", async () => {
    const s = fakeStore();
    const j = await s.insertJob(newJob());
    expect(await s.markLiveAttempt(j.id)).toBe(true);
    expect(await s.markLiveAttempt(j.id)).toBe(false);
    const got = await s.getJob(j.id);
    expect(got?.manualReview).toBe(true);
    expect(got?.liveAttemptedAt).toBeTruthy();
  });

  it("clears payloads except one, updates and purges jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    const s = fakeStore();
    const a = await s.insertJob(newJob({ dedupe: "a", payload: "pa" }));
    const b = await s.insertJob(newJob({ dedupe: "b", payload: "pb" }));
    const w = await s.insertJob(newJob({ dedupe: "w", payload: "pw" }));
    await s.claimJobs(5, 360, [w.id]);
    await s.clearJobPayloads("a1", b.id);
    expect(await s.getJob(a.id)).toMatchObject({ payload: "", status: "suppressed" });
    expect(await s.getJob(w.id)).toMatchObject({ payload: "", status: "working" });
    expect(await s.getJob(b.id)).toMatchObject({ payload: "pb", status: "queued" });
    await s.updateJob(a.id, { status: "done" });
    await s.updateJob(b.id, { status: "failed" });
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    await s.purgeJobs("2026-11-18T00:00:00Z");
    expect(s.jobs().map((j) => j.id)).toEqual([b.id, w.id]);
  });

  it("updateSignTokenIf refuses stale counters", async () => {
    const s = fakeStore();
    const t = await s.insertSignToken(tok());
    expect(t).toMatchObject({ attempts: 0, codeSends: 0 });
    expect(await s.updateSignTokenIf(t.id, { attempts: 1, codeSends: 0 }, { attempts: 2 })).toBe(false);
    expect((await s.getSignToken(t.id))?.attempts).toBe(0);
    expect(await s.updateSignTokenIf(t.id, { attempts: 0, codeSends: 0 }, { attempts: 1, codeDigest: "c" })).toBe(true);
    expect(await s.findSignToken("d1")).toMatchObject({ attempts: 1, codeDigest: "c" });
    await s.revokeSignTokens("a1", "p1", "complete");
    expect((await s.getSignToken(t.id))?.revoked).toBe(false);
    await s.revokeSignTokens("a1", "p1", "sign");
    expect((await s.getSignToken(t.id))?.revoked).toBe(true);
  });

  it("sessions are found by digest and swept by expiry", async () => {
    const s = fakeStore();
    await s.insertSignSession({ digest: "s1", tokenId: "t", workspaceId: "w1", agreementId: "a1", participantId: "p1", purpose: "complete", version: 1, expires: 100 });
    expect((await s.findSignSession("s1"))?.purpose).toBe("complete");
    await s.deleteSignSessions(100);
    expect(s.signSessions()).toHaveLength(1);
    await s.deleteSignSessions(101);
    expect(await s.findSignSession("s1")).toBeNull();
  });

  it("blobInUse sees agreement artifacts and removeBlob removes", async () => {
    const s = fakeStore();
    await s.insertAgreement(sent({ artifacts: { final: "hh" } }));
    expect(await s.blobInUse("w1", "hh")).toBe(true);
    expect(await s.blobInUse("w2", "hh")).toBe(false);
    expect(await s.blobInUse("w1", "zz")).toBe(false);
    const hash = await s.putBlob("w1", new Uint8Array([1]));
    expect(s.blobPaths()).toEqual([`w1/${hash}`]);
    await s.removeBlob("w1", hash);
    await s.removeBlob("w1", hash);
    expect(s.blobPaths()).toEqual([]);
  });

  it("lists due agreements across workspaces: deadline passed, reminder due, or expired without its notice; earliest due first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const s = fakeStore();
    const awaiting = (over: Partial<NewAgreement> = {}) => sent({ status: "Awaiting signatures", sentAt: "2026-11-19T12:00:00Z", reminderDays: 3, ...over });
    // Reminder due on 2026-11-19T10:00 (last reminder + 1 day).
    const remind = await s.insertAgreement(awaiting({ workspaceId: "w2", reminderDays: 1, lastReminderAt: "2026-11-18T10:00:00Z" }));
    // Deadline 2026-11-18: due from 2026-11-19T00:00.
    const late = await s.insertAgreement(awaiting({ deadline: "2026-11-18" }));
    // Reminder from sentAt: due 2026-11-19T11:00.
    const fromSent = await s.insertAgreement(awaiting({ reminderDays: 1, sentAt: "2026-11-18T11:00:00Z" }));
    const expired = await s.insertAgreement(sent({ status: "Expired" }));
    // Not due: deadline today, reminder not yet, reminders off, sender must sign first, notice already queued, other statuses.
    await s.insertAgreement(awaiting({ deadline: "2026-11-20" }));
    await s.insertAgreement(awaiting({ reminderDays: 1, lastReminderAt: "2026-11-19T11:00:00Z" }));
    await s.insertAgreement(awaiting({ reminderDays: 0, sentAt: "2026-01-01T00:00:00Z" }));
    await s.insertAgreement(awaiting({ senderReleasePending: true, reminderDays: 1, sentAt: "2026-01-01T00:00:00Z" }));
    await s.insertAgreement(sent({ status: "Expired", events: [{ seq: 1, type: "Expiry notification queued", actor: "system", at: "x", detail: {} }] }));
    await s.insertAgreement(sent({ status: "Completed", deadline: "2026-01-01" }));
    expect((await s.listDueAgreements(10)).map((x) => x.id)).toEqual([late.id, remind.id, fromSent.id, expired.id]);
    expect((await s.listDueAgreements(2)).map((x) => x.id)).toEqual([late.id, remind.id]);
    expect((await s.getAgreementById(remind.id))?.workspaceId).toBe("w2");
    expect(await s.getAgreementById("nope")).toBeNull();
  });

  it("lists deletions due, earliest first: unheld, not being signed, with no delete job other than a suppressed one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const s = fakeStore();
    const done = (deletionAt: string, over: Partial<NewAgreement> = {}) => s.insertAgreement(sent({ status: "Completed", deletionAt, ...over }));
    const second = await done("2026-11-19T00:00:00Z", { workspaceId: "w2" });
    const first = await done("2026-11-01T00:00:00Z");
    await done("2030-01-01T00:00:00Z");
    await done("2026-11-01T00:00:00Z", { legalHold: true });
    await s.insertAgreement(sent({ status: "Finalising", deletionAt: "2026-11-01T00:00:00Z" }));
    await s.insertAgreement(sent({ status: "Awaiting signatures", deletionAt: "2026-11-01T00:00:00Z" }));
    const queued = await done("2026-11-02T00:00:00Z");
    await s.insertJob(newJob({ agreementId: queued.id, kind: "delete", purpose: "retention", dedupe: "delete:" + queued.id }));
    const failed = await done("2026-11-02T00:00:00Z");
    const f = await s.insertJob(newJob({ agreementId: failed.id, kind: "delete", purpose: "retention", dedupe: "delete:" + failed.id }));
    await s.updateJob(f.id, { status: "failed" });
    const released = await done("2026-11-03T00:00:00Z");
    const r = await s.insertJob(newJob({ agreementId: released.id, kind: "delete", purpose: "retention", dedupe: "delete:" + released.id }));
    await s.updateJob(r.id, { status: "suppressed" });
    expect((await s.listDeletionsDue(10)).map((x) => x.id)).toEqual([first.id, released.id, second.id]);
    expect(await s.listDeletionsDue(1)).toHaveLength(1);
  });

  it("lists Finalising agreements with no finalise job, or only one that failed over an hour ago", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const s = fakeStore();
    const stranded = await s.insertAgreement(sent({ workspaceId: "w2" }));
    const running = await s.insertAgreement(sent());
    await s.insertJob(newJob({ agreementId: running.id, kind: "finalise", purpose: "finalise", dedupe: "finalise:" + running.id }));
    const failed = await s.insertAgreement(sent());
    const f = await s.insertJob(newJob({ agreementId: failed.id, kind: "finalise", purpose: "finalise", dedupe: "finalise:" + failed.id }));
    await s.updateJob(f.id, { status: "failed" });
    await s.insertAgreement(sent({ status: "Completed" }));
    expect((await s.listStrandedFinalising(10)).map((x) => x.id)).toEqual([stranded.id]);
    vi.setSystemTime(new Date("2026-11-20T11:00:01Z"));
    expect((await s.listStrandedFinalising(10)).map((x) => x.id)).toEqual([stranded.id, failed.id]);
    expect(await s.listStrandedFinalising(1)).toHaveLength(1);
  });

  it("waits longer before listing a finalise that keeps failing: 2^(attempts-5) hours, at most a day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const s = fakeStore();
    const failedAfter = async (attempts: number) => {
      const a = await s.insertAgreement(sent());
      const j = await s.insertJob(newJob({ agreementId: a.id, kind: "finalise", purpose: "finalise", dedupe: "finalise:" + a.id }));
      for (let n = 0; n < attempts; n++) await s.claimJobs(1, -1, [j.id]);
      await s.updateJob(j.id, { status: "failed" });
      return a.id;
    };
    const six = await failedAfter(6);
    const many = await failedAfter(20);
    const listed = async () => (await s.listStrandedFinalising(10)).map((x) => x.id);
    vi.setSystemTime(new Date("2026-11-20T11:59:59Z"));
    expect(await listed()).toEqual([]);
    vi.setSystemTime(new Date("2026-11-20T12:00:01Z"));
    expect(await listed()).toEqual([six]);
    vi.setSystemTime(new Date("2026-11-21T09:59:59Z"));
    expect(await listed()).toEqual([six]);
    vi.setSystemTime(new Date("2026-11-21T10:00:01Z"));
    expect(await listed()).toEqual([six, many]);
  });

  it("lists completion emails refused before sending, a day after each failure, below 12 attempts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const s = fakeStore();
    const failedAfter = async (dedupe: string, attempts: number, over: Record<string, unknown> = {}) => {
      const j = await s.insertJob(newJob({ purpose: "completion", dedupe, payload: "enc", ...over }));
      for (let n = 0; n < attempts; n++) await s.claimJobs(1, -1, [j.id]);
      await s.updateJob(j.id, { status: "failed" });
      return j.id;
    };
    const first = await failedAfter("c1", 5);
    const eleven = await failedAfter("c2", 11);
    await failedAfter("c3", 12);
    await failedAfter("c4", 5, { purpose: "invite" });
    await failedAfter("c5", 5, { payload: "" });
    const held = await failedAfter("c6", 5);
    await s.markLiveAttempt(held);
    await s.updateJob(held, { status: "failed" });
    const listed = async () => (await s.listRefusedCompletionMail(10)).map((j) => j.id);
    vi.setSystemTime(new Date("2026-11-21T09:59:59Z"));
    expect(await listed()).toEqual([]);
    vi.setSystemTime(new Date("2026-11-21T10:00:01Z"));
    expect(await listed()).toEqual([first, eleven].sort((a, b) => (a < b ? -1 : 1)));
    expect(await s.listRefusedCompletionMail(1)).toHaveLength(1);
  });

  it("requeueJob moves a job back to queued only from the status given", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    const s = fakeStore();
    const j = await s.insertJob(newJob({ available: Date.parse("2026-11-20T09:00:00Z") }));
    await s.claimJobs(1, 360, [j.id]);
    await s.updateJob(j.id, { status: "suppressed", error: "x" });
    expect(await s.requeueJob(j.id, "failed")).toBe(false);
    expect((await s.getJob(j.id))!.status).toBe("suppressed");
    vi.setSystemTime(new Date("2026-11-20T10:05:00Z"));
    expect(await s.requeueJob(j.id, "suppressed", { resetAttempts: true })).toBe(true);
    const got = (await s.getJob(j.id))!;
    expect(got).toMatchObject({ status: "queued", attempts: 0, available: Date.parse("2026-11-20T10:05:00Z") });
    expect(got.error).toBeUndefined();
    expect(await s.requeueJob(j.id, "suppressed")).toBe(false);
    await s.claimJobs(1, 360, [j.id]);
    await s.updateJob(j.id, { status: "failed" });
    expect(await s.requeueJob(j.id, "failed")).toBe(true);
    expect((await s.getJob(j.id))!).toMatchObject({ status: "queued", attempts: 1 });
    expect(await s.requeueJob("nope", "failed")).toBe(false);
  });

  it("registers an evidence key once and refuses a different public key", async () => {
    const s = fakeStore();
    await s.registerEvidenceKey("taskcalendar-ed25519-v1", "A");
    await s.registerEvidenceKey("taskcalendar-ed25519-v1", "A");
    await expect(s.registerEvidenceKey("taskcalendar-ed25519-v1", "B")).rejects.toThrow("does not match its recorded public key");
    expect(s.evidenceKeys().get("taskcalendar-ed25519-v1")).toBe("A");
  });
});
