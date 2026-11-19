// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agreementAction, createAgreement, TRASHED } from "../../../../api/_signroom/agreements";
import { currentWorkspace } from "../../../../api/_signroom/context";
import { encryptPayload } from "../../../../api/_signroom/jobs";
import { exportEvidence, retentionDelete, scheduleDeletion } from "../../../../api/_signroom/retention";
import type { Agreement } from "../../../../api/_signroom/shared/types";
import type { Store, StoredAgreement } from "../../../../api/_signroom/store";
import { runJobs } from "../../../../api/_signroom/worker";
import { finalising, mailSetup, newClient, OWNER } from "./agreementFixtures";
import { WS, withMemberRole } from "./helpers";

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logged.mockRestore();
  vi.useRealTimers();
});

const member = { id: "m1", email: "member@example.com", workspaceId: WS };
const DAY = 86400000;
const NOT_READY = "Evidence export becomes available after completion.";

/** A fake store where m1 is a Member of the owner's workspace (as in agreements.test.ts). */
function withMember(store: Store): Store {
  return withMemberRole(store, member.id);
}

/** A Completed agreement: Task 5's finalising fixture, then its finalise job run. */
async function completed() {
  const m = mailSetup();
  const client = await newClient(m.store);
  const f = await finalising(m.deps, client.id);
  const job = m.store.jobs().find((j) => j.dedupe === "finalise:" + f.id)!;
  await runJobs(m.deps, { ids: [job.id] });
  const a = (await m.store.getAgreement(f.workspaceId, f.id))!;
  expect(a.status).toBe("Completed");
  return { ...m, client, a };
}

type T = Awaited<ReturnType<typeof completed>>;
const reread = (t: T, id = t.a.id) => t.store.getAgreement(t.a.workspaceId, id);

/** SR v2.integration.ts 1251–1256: exported, scheduled, then the date moved into the past through the store. */
async function due(t: T): Promise<StoredAgreement> {
  await exportEvidence(t.store, OWNER, t.a.id);
  await scheduleDeletion(t.store, OWNER, t.a.id);
  const now = (await reread(t))!;
  const out = await t.store.updateAgreement(now.workspaceId, now.id, now.rowVersion, { deletionAt: new Date(Date.now() - 1000).toISOString() });
  return out!;
}

const enqueueDelete = (t: T) =>
  t.store.insertJob({ workspaceId: t.a.workspaceId, agreementId: t.a.id, kind: "delete", purpose: "retention", dedupe: "delete:" + t.a.id, payload: "" });

/** Every blob hash the agreement points at. */
const hashesOf = (a: StoredAgreement) =>
  [...new Set([a.documentHash, a.senderSignedHash, a.frozen?.sourceHash, ...Object.values(a.artifacts ?? {})].filter(Boolean) as string[])];
const path = (a: StoredAgreement, h: string) => `${a.workspaceId}/${h}`;

describe("evidence export", () => {
  it("a Completed agreement gives a signed link named signroom-evidence-<id>.zip and records the export", async () => {
    const t = await completed();
    const out = await exportEvidence(t.store, OWNER, t.a.id);
    const filename = `signroom-evidence-${t.a.id}.zip`;
    expect(out.filename).toBe(filename);
    const url = new URL(out.url);
    expect(url.pathname.endsWith(`/${t.a.workspaceId}/${t.a.artifacts!.export}`)).toBe(true);
    expect(url.searchParams.get("download")).toBe(filename);
    expect(url.searchParams.get("expires")).toBe("60");
    expect(out.agreement.exportedAt).toBeTruthy();
    expect(out.agreement).not.toHaveProperty("rowVersion");
    expect(out.agreement.events.at(-1)).toMatchObject({ type: "Authorised evidence export downloaded", actor: OWNER.email });
    const a = (await reread(t))!;
    expect(a.exportedAt).toBe(out.agreement.exportedAt);
    expect(a.events.at(-1)?.type).toBe("Authorised evidence export downloaded");
  }, 60000);

  it("a Draft is 409 with SR's sentence", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const d = await createAgreement(m.store, OWNER, { clientId: client.id, type: "NDA" });
    await expect(exportEvidence(m.store, OWNER, d.id)).rejects.toMatchObject({ status: 409, message: NOT_READY });
    expect((await m.store.getAgreement(d.workspaceId, d.id))!.exportedAt).toBeUndefined();
  });
});

describe("scheduling deletion", () => {
  it("before export is 400", async () => {
    const t = await completed();
    await expect(scheduleDeletion(t.store, OWNER, t.a.id)).rejects.toMatchObject({
      status: 400,
      message: "Export the agreement before scheduling deletion.",
    });
  }, 60000);

  it("a legal hold is 409 (SR: Legal hold blocks controlled deletion)", async () => {
    const t = await completed();
    await exportEvidence(t.store, OWNER, t.a.id);
    await agreementAction(t.store, OWNER, t.a.id, "hold", { hold: true, reason: "Synthetic legal hold" });
    await expect(scheduleDeletion(t.store, OWNER, t.a.id)).rejects.toMatchObject({
      status: 409,
      message: "Release the documented legal hold before scheduling deletion.",
    });
    expect((await reread(t))!.deletionAt).toBeUndefined();
  }, 60000);

  it("an Awaiting agreement is 400", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const d = await createAgreement(m.store, OWNER, { clientId: client.id, type: "NDA" });
    const row = (await m.store.getAgreement(d.workspaceId, d.id))!;
    await m.store.updateAgreement(row.workspaceId, row.id, row.rowVersion, { status: "Awaiting signatures", exportedAt: new Date().toISOString() });
    await expect(scheduleDeletion(m.store, OWNER, d.id)).rejects.toMatchObject({ status: 400, message: "Cancel or complete this agreement first." });
  });

  it("a Member is 403", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const ms = withMember(m.store);
    const mine = await createAgreement(ms, member, { clientId: client.id, type: "NDA" });
    await expect(scheduleDeletion(ms, member, mine.id)).rejects.toMatchObject({ status: 403, message: "Only the workspace owner can do that." });
  });

  it("respects the configured retention (SR: Deletion respects configured retention)", async () => {
    const t = await completed();
    const ws = (await currentWorkspace(t.store, OWNER)).workspace;
    await t.store.updateWorkspace(ws.id, { retentionDays: 365 });
    await exportEvidence(t.store, OWNER, t.a.id);
    const s = await scheduleDeletion(t.store, OWNER, t.a.id);
    expect(Date.parse(s.deletionAt!)).toBeGreaterThan(Date.now() + 300 * DAY);
    expect(s.events.at(-1)).toMatchObject({ type: "Retention deletion scheduled", actor: OWNER.email, detail: { deletionAt: s.deletionAt } });
    expect(s).not.toHaveProperty("rowVersion");
    expect((await reread(t))!.deletionAt).toBe(s.deletionAt);
  }, 60000);

  it("works on a trashed agreement; export on a trashed one is 409 TRASHED", async () => {
    const t = await completed();
    await exportEvidence(t.store, OWNER, t.a.id);
    await agreementAction(t.store, OWNER, t.a.id, "trash", {});
    const s = await scheduleDeletion(t.store, OWNER, t.a.id);
    expect(s.trashedAt).toBeTruthy();
    expect(s.deletionAt).toBeTruthy();
    await expect(exportEvidence(t.store, OWNER, t.a.id)).rejects.toMatchObject({ status: 409, message: TRASHED });
  }, 60000);
});

describe("the retention deletion job", () => {
  it("removes the agreement, its tokens, sessions and deliveries, and every blob (SR: Controlled retention removes…)", async () => {
    const t = await completed();
    const a = await due(t);
    await t.store.insertSignSession({
      digest: "sess",
      tokenId: "t",
      workspaceId: a.workspaceId,
      agreementId: a.id,
      participantId: a.participants[0].id,
      purpose: "complete",
      version: 1,
      expires: Date.now() + 60000,
    });
    const other = await t.store.insertJob({ workspaceId: a.workspaceId, agreementId: a.id, kind: "mail", purpose: "notice", dedupe: "other:" + a.id, payload: "secret" });
    expect((await t.store.listSignTokens(a.id)).length).toBeGreaterThan(0);
    expect((await t.store.listAgreementDeliveries(a.id)).length).toBeGreaterThan(0);
    const hashes = hashesOf(a);
    for (const h of hashes) expect(t.store.blobPaths()).toContain(path(a, h));

    const job = await enqueueDelete(t);
    await runJobs(t.deps, { ids: [job.id] });

    expect(await reread(t)).toBeNull();
    expect(await t.store.listSignTokens(a.id)).toEqual([]);
    expect(t.store.signSessions().filter((s) => s.agreementId === a.id)).toEqual([]);
    expect(await t.store.listAgreementDeliveries(a.id)).toEqual([]);
    for (const h of hashes) expect(t.store.blobPaths()).not.toContain(path(a, h));
    expect(await t.store.getJob(job.id)).toMatchObject({ status: "done", payload: "" });
    // Ruling: a deleted agreement's still-queued mail is suppressed, not failed five times.
    expect(await t.store.getJob(other.id)).toMatchObject({ payload: "", status: "suppressed" });
    expect(logged).not.toHaveBeenCalled();
  }, 60000);

  it("also removes the agreement's leftover quarantine uploads", async () => {
    const t = await completed();
    const a = await due(t);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 4 * 3600_000);
    const ticket = await t.store.createUpload(a.workspaceId, a.id);
    vi.useRealTimers();
    t.store.putQuarantine(ticket.path, new Uint8Array([1, 2, 3]));
    const job = await enqueueDelete(t);
    await runJobs(t.deps, { ids: [job.id] });
    expect(await reread(t)).toBeNull();
    expect(t.store.quarantinePaths()).not.toContain(ticket.path);
  }, 60000);

  it("a hold applied after scheduling suppresses the job; the agreement and blobs remain", async () => {
    const t = await completed();
    const a = await due(t);
    await agreementAction(t.store, OWNER, a.id, "hold", { hold: true, reason: "Synthetic legal hold" });
    const job = await enqueueDelete(t);
    await runJobs(t.deps, { ids: [job.id] });
    expect((await t.store.getJob(job.id))!.status).toBe("suppressed");
    expect(await reread(t)).not.toBeNull();
    for (const h of hashesOf(a)) expect(t.store.blobPaths()).toContain(path(a, h));
  }, 60000);

  it("a date in the future, or none, suppresses the job", async () => {
    const t = await completed();
    await exportEvidence(t.store, OWNER, t.a.id);
    const unscheduled = await enqueueDelete(t);
    await runJobs(t.deps, { ids: [unscheduled.id] });
    expect((await t.store.getJob(unscheduled.id))!.status).toBe("suppressed");
    await scheduleDeletion(t.store, OWNER, t.a.id);
    const later = await t.store.insertJob({ workspaceId: t.a.workspaceId, agreementId: t.a.id, kind: "delete", purpose: "retention", dedupe: "delete2:" + t.a.id, payload: "" });
    await runJobs(t.deps, { ids: [later.id] });
    expect((await t.store.getJob(later.id))!.status).toBe("suppressed");
    expect(await reread(t)).not.toBeNull();
  }, 60000);

  it("a refused database delete is suppressed and removes no blob", async () => {
    const t = await completed();
    const a = await due(t);
    const refusing: Store = { ...t.store, deleteAgreement: async () => false };
    const job = await enqueueDelete(t);
    await retentionDelete({ ...t.deps, store: refusing }, job);
    expect(await t.store.getJob(job.id)).toMatchObject({ status: "suppressed", payload: "" });
    expect(await reread(t)).not.toBeNull();
    for (const h of hashesOf(a)) expect(t.store.blobPaths()).toContain(path(a, h));
  }, 60000);

  it("a blob another agreement still uses survives; the others go", async () => {
    const t = await completed();
    const a = await due(t);
    const copy = (await agreementAction(t.store, OWNER, a.id, "duplicate", {})) as Agreement;
    expect(copy.documentHash).toBe(a.documentHash);
    const job = await enqueueDelete(t);
    await runJobs(t.deps, { ids: [job.id] });
    expect(await reread(t)).toBeNull();
    expect(t.store.blobPaths()).toContain(path(a, a.documentHash!));
    const gone = hashesOf(a).filter((h) => h !== a.documentHash);
    expect(gone.length).toBeGreaterThan(0);
    for (const h of gone) expect(t.store.blobPaths()).not.toContain(path(a, h));
  }, 60000);

  it("resumes when the agreement is already gone: the encrypted hashes are removed and the job is done", async () => {
    const m = mailSetup();
    const ws = (await currentWorkspace(m.store, OWNER)).workspace;
    const h1 = await m.store.putBlob(ws.id, new Uint8Array([1]));
    const h2 = await m.store.putBlob(ws.id, new Uint8Array([2]));
    const agreementId = randomUUID();
    const job = await m.store.insertJob({
      workspaceId: ws.id,
      agreementId,
      kind: "delete",
      purpose: "retention",
      dedupe: "delete:" + agreementId,
      payload: encryptPayload(m.deps.jobKey!, { hashes: [h1, h2], workspaceId: ws.id, agreementId }),
    });
    await runJobs(m.deps, { ids: [job.id] });
    expect(m.store.blobPaths()).not.toContain(`${ws.id}/${h1}`);
    expect(m.store.blobPaths()).not.toContain(`${ws.id}/${h2}`);
    expect(await m.store.getJob(job.id)).toMatchObject({ status: "done", payload: "" });
  });
});
