// @vitest-environment node
// Deleting an agreement now. The owner asked for a Delete button like the one
// on invoices. It is the owner's alone to press. Two things are never deleted
// this way: an agreement people are signing right now, and one under a legal
// hold.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agreementAction } from "../../../../api/_signroom/agreements";
import { deleteAgreementNow } from "../../../../api/_signroom/retention";
import { route } from "../../../../api/_signroom/router";
import type { StoredAgreement } from "../../../../api/_signroom/store";
import { runJobs } from "../../../../api/_signroom/worker";
import { finalising, madeDraft, mailSetup, newClient, OWNER, sent } from "./agreementFixtures";
import { WS, withMemberRole } from "./helpers";

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => { logged = vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { logged.mockRestore(); });

const member = { id: "m1", email: "member@example.com", workspaceId: WS };

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
const hashesOf = (a: StoredAgreement) =>
  [...new Set([a.documentHash, a.senderSignedHash, a.frozen?.sourceHash, ...Object.values(a.artifacts ?? {})].filter((h): h is string => Boolean(h)))];

describe("deleting an agreement now", () => {
  it("removes a draft", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const draft = await madeDraft(m.deps, client.id);
    expect(await deleteAgreementNow(m.store, OWNER, draft.id)).toEqual({ deleted: true, title: draft.title });
    expect(await m.store.getAgreement(WS, draft.id)).toBeNull();
  });

  it("removes a signed agreement too, with its stored files, without waiting for the retention time", async () => {
    const t = await completed();
    const hashes = hashesOf(t.a);
    expect(hashes.length).toBeGreaterThan(0);
    // Not exported, and no deletion date: the ordinary way would refuse this.
    expect(t.a.exportedAt).toBeFalsy();
    expect(t.a.deletionAt).toBeFalsy();

    await deleteAgreementNow(t.store, OWNER, t.a.id);

    expect(await t.store.getAgreement(WS, t.a.id)).toBeNull();
    for (const hash of hashes) {
      expect(await t.store.blobInUse(WS, hash)).toBe(false);
      expect(await t.store.getBlob(WS, hash).then(() => "still there").catch(() => null)).toBeNull();
    }
  });

  it("never deletes an agreement that people are signing right now", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const out = await sent(m.deps, await madeDraft(m.deps, client.id));
    expect(out.status).toBe("Awaiting signatures");
    await expect(deleteAgreementNow(m.store, OWNER, out.id)).rejects.toMatchObject({ status: 409, message: "Cancel or complete this agreement first." });
    expect(await m.store.getAgreement(WS, out.id)).not.toBeNull();
  });

  it("never deletes an agreement under a legal hold", async () => {
    const t = await completed();
    await agreementAction(t.store, OWNER, t.a.id, "hold", { hold: true, reason: "A dispute is open" });
    await expect(deleteAgreementNow(t.store, OWNER, t.a.id)).rejects.toMatchObject({ status: 409, message: "Release the documented legal hold before deleting this agreement." });
    const kept = await t.store.getAgreement(WS, t.a.id);
    expect(kept).not.toBeNull();
    // A refused delete leaves no deletion date behind.
    expect(kept?.deletionAt).toBeFalsy();
  });

  it("is for the owner only: a member cannot delete, not even an agreement they sent", async () => {
    const m = mailSetup();
    const store = withMemberRole(m.store, member.id);
    const client = await newClient(store);
    const theirs = await madeDraft({ store }, client.id, { user: member });
    await expect(deleteAgreementNow(store, member, theirs.id)).rejects.toMatchObject({ status: 403 });
    expect(await store.getAgreement(WS, theirs.id)).not.toBeNull();
  });

  it("says not found for an agreement that is not there", async () => {
    const m = mailSetup();
    await expect(deleteAgreementNow(m.store, OWNER, "0d000000-0000-4000-8000-000000000999")).rejects.toMatchObject({ status: 404 });
    await expect(deleteAgreementNow(m.store, OWNER, "not-an-id")).rejects.toMatchObject({ status: 404 });
  });

  it("leaves every other agreement as it was", async () => {
    const t = await completed();
    const other = await madeDraft(t.deps, t.client.id);
    await deleteAgreementNow(t.store, OWNER, t.a.id);
    expect((await t.store.getAgreement(WS, other.id))?.title).toBe(other.title);
  });

  it("has an address of its own, and the scheduled deletion keeps its own", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const draft = await madeDraft(m.deps, client.id);
    const deps = { mail: m.deps } as never;
    const asked = { path: ["agreements", draft.id, "delete-now"], query: {}, body: {}, user: OWNER, origin: "https://app.example.com" };
    expect((await route(deps, { ...asked, method: "GET" } as never)).status).toBe(404);
    const out = await route(deps, { ...asked, method: "POST" } as never);
    expect(out).toMatchObject({ status: 200, json: { deleted: true } });
    expect(await m.store.getAgreement(WS, draft.id)).toBeNull();
  });
});
