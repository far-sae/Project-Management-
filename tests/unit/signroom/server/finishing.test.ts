// @vitest-environment node
import { createHash, generateKeyPairSync } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withEvent } from "../../../../api/_signroom/agreements";
import { verifyManifest } from "../../../../api/_signroom/evidence";
import { runJobs } from "../../../../api/_signroom/worker";
import type { StoredAgreement } from "../../../../api/_signroom/store";
import { finalising, mailSetup, newClient, OWNER, testEvidenceKey, type Resend } from "./agreementFixtures";

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
type Sent = { to: string[]; subject: string; text: string };
const mails = (resend: Resend): Sent[] => resend.calls.map((c) => JSON.parse(String(c.init.body)) as Sent);

/** Port of SR v2.integration.ts 504–561: two signers and a copy recipient, all signed, finishing queued. */
async function setup(opts: { senderFirst?: boolean } = {}) {
  const m = mailSetup();
  const client = await newClient(m.store);
  const a = await finalising(m.deps, client.id, { signers: 2, copies: 1, ...opts });
  m.resend.calls.length = 0;
  const job = m.store.jobs().find((j) => j.dedupe === "finalise:" + a.id)!;
  return { ...m, a, job };
}

const reread = async (t: Awaited<ReturnType<typeof setup>>): Promise<StoredAgreement> => (await t.store.getAgreement(t.a.workspaceId, t.a.id))!;
const blob = (t: Awaited<ReturnType<typeof setup>>, hash: string) => t.store.getBlob(t.a.workspaceId, hash);
const manifestOf = async (t: Awaited<ReturnType<typeof setup>>, a: StoredAgreement) =>
  JSON.parse(new TextDecoder().decode(await blob(t, a.artifacts!.manifest)));

describe("finishing", () => {
  it("completes with the final PDF, completion record, events, signed manifest and export", async () => {
    const t = await setup();
    await runJobs(t.deps, { ids: [t.job.id] });
    const a = await reread(t);
    expect(a.status).toBe("Completed");
    expect(a.completedAt).toBeTruthy();
    expect(Object.keys(a.artifacts!).sort()).toEqual(["completion", "events", "export", "final", "manifest", "source"]);
    expect(a.artifacts!.source).toBe(a.frozen!.sourceHash);
    expect((await PDFDocument.load(await blob(t, a.artifacts!.final))).getPageCount()).toBe(2);
    const m = await manifestOf(t, a);
    expect(verifyManifest(m, testEvidenceKey().publicKeyPem)).toBe(true);
    expect(m.payload.keyId).toBe("taskcalendar-ed25519-v1");
    expect(m.payload.completedAt).toBe(a.finalSnapshot!.at(-1)!.at);
    expect(m.payload.senderSignedHash).toBeUndefined();
    expect(t.store.evidenceKeys().get("taskcalendar-ed25519-v1")).toBe(testEvidenceKey().publicKeyPem);
    const persisted = a.events.filter((e) => e.type === "Completion artifacts persisted");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].actor).toBe("system");
    expect(persisted[0].detail).toEqual({
      sourceHash: a.artifacts!.source,
      finalHash: a.artifacts!.final,
      completionHash: a.artifacts!.completion,
      manifestHash: a.artifacts!.manifest,
    });
    expect((await t.store.getJob(t.job.id))!.status).toBe("done");
  }, 60000);

  it("exports a ZIP whose every digest matches the manifest", async () => {
    const t = await setup();
    await runJobs(t.deps, { ids: [t.job.id] });
    const a = await reread(t);
    const files = unzipSync(await blob(t, a.artifacts!.export));
    expect(Object.keys(files).sort()).toEqual([
      "README.txt",
      "completion.pdf",
      "events.json",
      "final.pdf",
      "manifest.json",
      "public-key.pem",
      "source.pdf",
    ]);
    const m = JSON.parse(strFromU8(files["manifest.json"]));
    expect(verifyManifest(m, testEvidenceKey().publicKeyPem)).toBe(true);
    for (const [name, key] of [
      ["source.pdf", "sourceHash"],
      ["final.pdf", "finalHash"],
      ["completion.pdf", "completionHash"],
      ["events.json", "eventsHash"],
    ])
      expect(sha(files[name])).toBe(m.payload[key]);
    expect(sha(files["manifest.json"])).toBe(a.artifacts!.manifest);
    expect(strFromU8(files["public-key.pem"])).toBe(testEvidenceKey().publicKeyPem);
    expect(JSON.parse(strFromU8(files["events.json"]))).toEqual(a.finalSnapshot);
    const modified = new Uint8Array(files["final.pdf"]);
    modified[30] ^= 1;
    expect(sha(modified)).not.toBe(m.payload.finalHash);
  }, 60000);

  it("adds the sender-signed PDF when the sender signed first", async () => {
    const t = await setup({ senderFirst: true });
    await runJobs(t.deps, { ids: [t.job.id] });
    const a = await reread(t);
    expect(a.status).toBe("Completed");
    expect(a.artifacts!.senderSigned).toBe(a.senderSignedHash);
    const files = unzipSync(await blob(t, a.artifacts!.export));
    expect(files["sender-signed.pdf"]).toBeDefined();
    const m = JSON.parse(strFromU8(files["manifest.json"]));
    expect(m.payload.senderSignedHash).toBe(sha(files["sender-signed.pdf"]));
    expect(verifyManifest(m, testEvidenceKey().publicKeyPem)).toBe(true);
  }, 60000);

  it("emails every participant a completion link and the sender a notice", async () => {
    const t = await setup();
    await runJobs(t.deps, { ids: [t.job.id] });
    const subject = "Completed: " + t.a.title;
    const sent = mails(t.resend);
    for (const p of t.a.participants) {
      const mine = sent.filter((s) => s.to[0] === p.email && s.subject === subject);
      expect(mine).toHaveLength(1);
      expect(mine[0].text).toContain("#access=");
    }
    expect(t.a.participants.some((p) => p.role === "copy")).toBe(true);
    const notice = sent.filter((s) => s.to[0] === t.a.frozen!.sender!.email && s.subject === subject);
    expect(notice).toHaveLength(1);
    expect(notice[0].text).toBe(
      "The signed agreement, completion record and application-level evidence export are ready in the workspace.",
    );
    expect(t.a.frozen!.sender!.email).toBe(OWNER.email);
    const complete = (await t.store.listSignTokens(t.a.id)).filter((x) => !x.revoked);
    expect(complete).toHaveLength(t.a.participants.length);
    expect(complete.every((x) => x.purpose === "complete")).toBe(true);
  }, 60000);

  // SR "Interrupted finalisation resumes without replacing existing artifact".
  it("resumes an interrupted run and completes once", async () => {
    const t = await setup();
    // The run that claimed it died: still working, lease expired.
    const [claimed] = await t.store.claimJobs(1, -1, [t.job.id]);
    expect(claimed.status).toBe("working");
    await runJobs(t.deps);
    await runJobs(t.deps);
    const a = await reread(t);
    expect(a.status).toBe("Completed");
    expect(t.store.jobs().filter((j) => j.dedupe === "finalise:" + a.id)).toHaveLength(1);
    expect(a.events.filter((e) => e.type === "Completion artifacts persisted")).toHaveLength(1);
  }, 60000);

  it("retries a commit lost to another write once", async () => {
    const t = await setup();
    const update = t.store.updateAgreement.bind(t.store);
    let raced = 0;
    t.store.updateAgreement = async (w, id, rv, patch) => {
      if (patch.status === "Completed" && raced++ === 0) {
        const cur = (await t.store.getAgreement(w, id))!;
        await update(w, id, cur.rowVersion, { events: withEvent(cur, "Email accepted by provider", "system").events });
      }
      return update(w, id, rv, patch);
    };
    await runJobs(t.deps, { ids: [t.job.id] });
    const a = await reread(t);
    expect(a.status).toBe("Completed");
    expect(raced).toBe(2);
    expect(a.events.filter((e) => e.type === "Completion artifacts persisted")).toHaveLength(1);
  }, 60000);

  it("throws when the agreement leaves Finalising mid-run", async () => {
    const t = await setup();
    const update = t.store.updateAgreement.bind(t.store);
    t.store.updateAgreement = async (w, id, rv, patch) => {
      if (patch.status === "Completed") {
        const cur = (await t.store.getAgreement(w, id))!;
        await update(w, id, cur.rowVersion, { status: "Cancelled" });
      }
      return update(w, id, rv, patch);
    };
    await runJobs(t.deps, { ids: [t.job.id] });
    const a = await reread(t);
    expect(a.status).toBe("Cancelled");
    expect(a.artifacts).toBeUndefined();
    expect((await t.store.getJob(t.job.id))!.status).toBe("queued");
    expect(mails(t.resend)).toHaveLength(0);
  }, 60000);

  it("refuses to replace the artifacts of a completed agreement", async () => {
    const t = await setup();
    await runJobs(t.deps, { ids: [t.job.id] });
    const a = await reread(t);
    await expect(
      t.store.updateAgreement(a.workspaceId, a.id, a.rowVersion, { artifacts: { ...a.artifacts!, final: "0".repeat(64) } }),
    ).rejects.toThrow("Completed artifacts are immutable.");
  }, 60000);

  it("stays Finalising when the evidence key does not match its recorded public key", async () => {
    const t = await setup();
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    await t.store.registerEvidenceKey("taskcalendar-ed25519-v1", other);
    await runJobs(t.deps, { ids: [t.job.id] });
    const a = await reread(t);
    expect(a.status).toBe("Finalising");
    expect(a.artifacts).toBeUndefined();
    const job = (await t.store.getJob(t.job.id))!;
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(1);
    expect(t.store.evidenceKeys().get("taskcalendar-ed25519-v1")).toBe(other);
    expect(mails(t.resend)).toHaveLength(0);
  }, 60000);

  it("stays Finalising without an evidence key", async () => {
    const t = await setup();
    t.deps.evidenceKey = null;
    await runJobs(t.deps, { ids: [t.job.id] });
    const a = await reread(t);
    expect(a.status).toBe("Finalising");
    const job = (await t.store.getJob(t.job.id))!;
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(1);
    expect(t.store.evidenceKeys().size).toBe(0);
  }, 60000);

  it("a completion link that cannot be queued retries the job, and the rerun re-issues to that participant only", async () => {
    const t = await setup();
    const [, missed] = t.a.participants;
    const insert = t.store.insertJob.bind(t.store);
    let refused = 0;
    t.store.insertJob = async (j) => {
      if (j.purpose === "completion" && j.participantId === missed.id && refused++ === 0) throw new Error("down");
      return insert(j);
    };
    await runJobs(t.deps, { ids: [t.job.id] });
    expect((await reread(t)).status).toBe("Completed");
    const job = (await t.store.getJob(t.job.id))!;
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(1);
    const liveFor = async (id: string) =>
      (await t.store.listSignTokens(t.a.id)).filter((x) => x.participantId === id && x.purpose === "complete" && !x.revoked);
    expect(await liveFor(missed.id)).toHaveLength(0);
    const before = new Map(await Promise.all(t.a.participants.map(async (p) => [p.id, (await liveFor(p.id)).map((x) => x.id)] as const)));

    // The rerun, once its backoff has passed.
    await t.store.updateJob(t.job.id, { available: Date.now() });
    await runJobs(t.deps, { ids: [t.job.id] });
    expect((await t.store.getJob(t.job.id))!.status).toBe("done");
    for (const p of t.a.participants) {
      const live = (await liveFor(p.id)).map((x) => x.id);
      expect(live).toHaveLength(1);
      if (p.id !== missed.id) expect(live).toEqual(before.get(p.id));
    }
    // The every-minute run sends the links queued by the first run.
    await runJobs(t.deps);
    const subject = "Completed: " + t.a.title;
    for (const p of t.a.participants) expect(mails(t.resend).filter((m) => m.to[0] === p.email && m.subject === subject)).toHaveLength(1);
    expect(mails(t.resend).filter((m) => m.to[0] === t.a.frozen!.sender!.email && m.subject === subject)).toHaveLength(1);
    expect(t.store.jobs().filter((j) => j.purpose === "completion")).toHaveLength(t.a.participants.length);
  }, 60000);

  it("a notice that cannot be queued retries the job; the rerun queues it once and sends no second link", async () => {
    const t = await setup();
    const insert = t.store.insertJob.bind(t.store);
    let refused = 0;
    t.store.insertJob = async (j) => {
      if (j.purpose === "notice" && refused++ === 0) throw new Error("down");
      return insert(j);
    };
    await runJobs(t.deps, { ids: [t.job.id] });
    expect((await t.store.getJob(t.job.id))!.status).toBe("queued");
    expect(logged).toHaveBeenCalledWith("[signroom] completion notice failed", "Error");
    await t.store.updateJob(t.job.id, { available: Date.now() });
    await runJobs(t.deps, { ids: [t.job.id] });
    await runJobs(t.deps);
    const subject = "Completed: " + t.a.title;
    expect(mails(t.resend).filter((m) => m.to[0] === t.a.frozen!.sender!.email && m.subject === subject)).toHaveLength(1);
    expect(mails(t.resend).filter((m) => m.subject === subject)).toHaveLength(t.a.participants.length + 1);
  }, 60000);

  it("a rerun on a Completed agreement re-issues the link only to a participant without a live one", async () => {
    const t = await setup();
    await runJobs(t.deps, { ids: [t.job.id] });
    const [has, lost] = t.a.participants;
    // The run died between the commit and that participant's link: none is live.
    await t.store.revokeSignTokens(t.a.id, lost.id, "complete");
    const tokensBefore = (await t.store.listSignTokens(t.a.id)).length;
    const sentBefore = mails(t.resend).length;
    const hasLink = (await t.store.listSignTokens(t.a.id)).find((x) => x.participantId === has.id && x.purpose === "complete" && !x.revoked)!;

    await t.store.updateJob(t.job.id, { status: "queued" });
    await runJobs(t.deps, { ids: [t.job.id] });

    expect((await t.store.getJob(t.job.id))!.status).toBe("done");
    const tokens = await t.store.listSignTokens(t.a.id);
    expect(tokens).toHaveLength(tokensBefore + 1);
    expect(tokens.at(-1)!.participantId).toBe(lost.id);
    expect(tokens.find((x) => x.id === hasLink.id)!.revoked).toBe(false);
    const fresh = mails(t.resend).slice(sentBefore);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].to[0]).toBe(lost.email);
    expect(fresh[0].subject).toBe("Completed: " + t.a.title);
    // The notice's dedupe keeps it to one.
    expect(t.store.jobs().filter((j) => j.dedupe === "notice:completed:" + t.a.id)).toHaveLength(1);
    expect((await reread(t)).events.filter((e) => e.type === "Completion artifacts persisted")).toHaveLength(1);
  }, 60000);

  it("logs no addresses, names or keys", async () => {
    const t = await setup();
    t.deps.evidenceKey = null;
    await runJobs(t.deps, { ids: [t.job.id] });
    const out = JSON.stringify(logged.mock.calls);
    for (const p of t.a.participants) {
      expect(out).not.toContain(p.email);
      expect(out).not.toContain(p.name);
    }
    expect(out).not.toContain("PRIVATE KEY");
  }, 60000);
});
