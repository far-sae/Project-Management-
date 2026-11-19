// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, PDFString, degrees } from "pdf-lib";
import { createAgreement, NOT_FOUND } from "../../../../api/_signroom/agreements";
import type { SignedInUser as User } from "../../../../api/_signroom/context";
import {
  DOCUMENT_SCAN_OFF_MESSAGE,
  DOCUMENT_SIZE_MESSAGE,
  finishUpload,
  UPLOAD_GONE_MESSAGE,
  uploadUrl,
} from "../../../../api/_signroom/agreementDocument";
import { currentWorkspace } from "../../../../api/_signroom/context";
import type { MailDeps } from "../../../../api/_signroom/mail";
import type { Agreement } from "../../../../api/_signroom/shared/types";
import { SCAN_DIRTY_MESSAGE, SCAN_DOWN_MESSAGE } from "../../../../api/_signroom/virusScan";
import { madeDraft, newClient, OWNER } from "./agreementFixtures";
import { ORG2, WS, WS2, withMemberRole, seededStore, type FakeStore } from "./helpers";

const owner = OWNER;
const member: User = { id: "m1", email: "member@example.com", workspaceId: WS };
const ACTIVE = "Active content, external actions or attachments are not supported.";

type Fake = FakeStore;

/** A fake store where m1 is a Member of the owner's workspace. */
function withMember(store: Fake): Fake {
  return withMemberRole(store, member.id);
}

async function setup(over: { clean?: boolean; scan?: "none" | "throws"; spend?: () => Promise<unknown> } = {}) {
  const store = withMember(seededStore());
  const ws = (await currentWorkspace(store, owner)).workspace;
  const client = await newClient(store);
  const scanFetch = vi.fn(async () => {
    if (over.scan === "throws") throw new Error("network down");
    return new Response(JSON.stringify({ CleanResult: over.clean ?? true }), { status: 200 });
  });
  const spend = vi.fn(over.spend ?? (async () => ({ ok: true })));
  const sb = { marker: "sb" };
  const d = {
    store,
    sb,
    spend,
    ...(over.scan === "none" ? {} : { scan: { fetch: scanFetch as never, apiKey: "k" } }),
  } as unknown as MailDeps;
  return { store, ws, client, d, scanFetch, spend, sb };
}

/** A two-page PDF: page 1 is 600×800, cropped to (40,50,500,700) and turned 90°. */
async function rotatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  p1.drawRectangle({ x: 60, y: 60, width: 200, height: 200 });
  p1.setCropBox(40, 50, 500, 700);
  p1.setRotation(degrees(90));
  doc.addPage([595.28, 841.89]).drawRectangle({ x: 50, y: 50, width: 100, height: 100 });
  return new Uint8Array(await doc.save());
}

/** A PDF that runs JavaScript when it opens. */
async function scriptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj({ S: "JavaScript", JS: PDFString.of("app.alert(1)") }));
  return new Uint8Array(await doc.save());
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** Asks for a ticket for `a` and puts `bytes` where the browser would have uploaded them. */
async function staged(d: MailDeps, a: Agreement, bytes: Uint8Array, user: User = owner) {
  const t = await uploadUrl(d, user, a.id, { name: "Contract.PDF", size: bytes.length || 1, revision: a.revision, clearFields: true });
  (d.store as Fake).putQuarantine(t.path, bytes);
  return t;
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logged.mockRestore();
  vi.useRealTimers();
});

describe("upload-url", () => {
  it("returns a ticket for <ws>/quarantine/<uuid>.pdf and spends the workspace's upload limit", async () => {
    const { d, ws, client, spend, sb } = await setup();
    const a = await madeDraft(d, client.id);
    const t = await uploadUrl(d, owner, a.id, { name: "contract.pdf", size: 1000, revision: a.revision, clearFields: true });
    expect(t.path).toMatch(new RegExp(`^${ws.id}/quarantine/[0-9a-f-]{36}\\.pdf$`));
    expect(t.path).toBe(`${ws.id}/quarantine/${t.uploadId}.pdf`);
    expect(typeof t.token).toBe("string");
    expect(Object.keys(t).sort()).toEqual(["path", "token", "uploadId"]);
    expect(spend).toHaveBeenCalledWith(sb, "signroom-document", "workspace:" + ws.id, 20, 10);
  }, 30000);

  it("refuses a name that is not .pdf, and a size of 0 or over 25 MB, before spending", async () => {
    const { d, client, spend } = await setup();
    const a = await createAgreement(d.store, owner, { clientId: client.id, type: "NDA" });
    const base = { revision: a.revision };
    await expect(uploadUrl(d, owner, a.id, { ...base, name: "a.docx", size: 10 })).rejects.toMatchObject({ status: 400, message: "Choose a PDF file." });
    await expect(uploadUrl(d, owner, a.id, { ...base, size: 10 })).rejects.toMatchObject({ status: 400, message: "Choose a PDF file." });
    await expect(uploadUrl(d, owner, a.id, { ...base, name: "a.pdf", size: 25 * 1024 * 1024 + 1 })).rejects.toMatchObject({
      status: 400,
      message: DOCUMENT_SIZE_MESSAGE,
    });
    await expect(uploadUrl(d, owner, a.id, { ...base, name: "a.pdf", size: 0 })).rejects.toMatchObject({ message: DOCUMENT_SIZE_MESSAGE });
    expect(spend).not.toHaveBeenCalled();
    expect(await uploadUrl(d, owner, a.id, { ...base, name: "a.pdf", size: 25 * 1024 * 1024 })).toHaveProperty("uploadId");
  });

  it("a sent agreement is 409 The document is frozen.", async () => {
    const { d, ws, client } = await setup();
    const a = await createAgreement(d.store, owner, { clientId: client.id, type: "NDA" });
    const row = (await d.store.getAgreement(ws.id, a.id))!;
    await d.store.updateAgreement(ws.id, a.id, row.rowVersion, { status: "Awaiting signatures" });
    await expect(uploadUrl(d, owner, a.id, { name: "a.pdf", size: 10, revision: a.revision })).rejects.toMatchObject({
      status: 409,
      message: "The document is frozen.",
    });
  });

  it("a stale revision is 409, and placed fields need clearFields", async () => {
    const { d, client, spend } = await setup();
    const a = await madeDraft(d, client.id);
    const body = { name: "a.pdf", size: 10 };
    await expect(uploadUrl(d, owner, a.id, { ...body, revision: a.revision - 1, clearFields: true })).rejects.toMatchObject({
      status: 409,
      message: "The draft changed. Reload it.",
    });
    await expect(uploadUrl(d, owner, a.id, { ...body, revision: a.revision, clearFields: "true" })).rejects.toMatchObject({
      status: 409,
      message: "Replacing this PDF clears all field placements. Confirm this first.",
    });
    expect(spend).not.toHaveBeenCalled();
  }, 30000);

  it("a refused rate limit is 429 with SR's sentence, and no ticket is made", async () => {
    const { d, client } = await setup({ spend: async () => ({ ok: false, minutesLeft: 3 }) });
    const create = vi.spyOn(d.store, "createUpload");
    const a = await createAgreement(d.store, owner, { clientId: client.id, type: "NDA" });
    await expect(uploadUrl(d, owner, a.id, { name: "a.pdf", size: 10, revision: a.revision })).rejects.toMatchObject({
      status: 429,
      message: "You can upload up to 20 PDFs every 10 minutes. Try again shortly.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("a sweep that fails is logged and the ticket is still made", async () => {
    const { d, client, store } = await setup();
    const a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    vi.spyOn(store, "sweepUploads").mockRejectedValueOnce(new Error("secret path"));
    const t = await uploadUrl(d, owner, a.id, { name: "a.pdf", size: 10, revision: a.revision });
    expect(t).toHaveProperty("uploadId");
    expect(logged).toHaveBeenCalledWith("[signroom] quarantine cleanup failed");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
  });

  it("sweeps a ticket made 3 hours ago, and its quarantine object, on the next upload-url", async () => {
    const { d, ws, client, store } = await setup();
    const a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 3 * 3600_000 - 60_000);
    const old = await store.createUpload(ws.id, a.id);
    store.putQuarantine(old.path, PNG);
    vi.useRealTimers();
    const fresh = await store.createUpload(ws.id, a.id);
    store.putQuarantine(fresh.path, PNG);
    await uploadUrl(d, owner, a.id, { name: "a.pdf", size: 10, revision: a.revision });
    expect(store.quarantinePaths()).not.toContain(old.path);
    expect(store.quarantinePaths()).toContain(fresh.path);
  });
});

describe("upload (finish), clean", () => {
  it("stores the normalised PDF, clears fields, bumps the revision and records the scan", async () => {
    const { d, client, store, scanFetch } = await setup();
    const a = await madeDraft(d, client.id);
    expect(a.fields.length).toBeGreaterThan(0);
    const t = await staged(d, a, await rotatedPdf());
    const out = await finishUpload(d, owner, a.id, { uploadId: t.uploadId, revision: a.revision, clearFields: true });
    expect(out.pages).toHaveLength(2);
    expect(out.pages[0]).toEqual({ width: 700, height: 500 });
    expect(out).toMatchObject({ sourceKind: "upload", fields: [], revision: a.revision + 1 });
    expect(out.documentHash).toBeTruthy();
    expect(out.documentHash).not.toBe(a.documentHash);
    expect(out).not.toHaveProperty("rowVersion");
    const blob = await store.getBlob(out.workspaceId, out.documentHash!);
    expect(new TextDecoder().decode(blob.subarray(0, 4))).toBe("%PDF");
    expect(out.events.at(-1)).toMatchObject({
      type: "PDF validated and normalised for signing",
      actor: owner.email,
      detail: {
        pages: 2,
        sourceHash: out.documentHash,
        scan: { engine: "Cloudmersive", verdict: "clean", scannedAt: expect.any(String) },
      },
    });
    expect(store.quarantinePaths()).toEqual([]);
    expect(scanFetch).toHaveBeenCalledTimes(1);
    const [, init] = scanFetch.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers.fileName).toBe("agreement.pdf");
  }, 30000);
});

describe("upload (finish), refused", () => {
  async function refused(
    over: Parameters<typeof setup>[0],
    bytes: () => Promise<Uint8Array> | Uint8Array,
    expected: { status: number; message?: string },
  ) {
    const s = await setup(over);
    const a = await madeDraft(s.d, s.client.id);
    const t = await staged(s.d, a, await bytes());
    const putBlob = vi.spyOn(s.store, "putBlob");
    await expect(finishUpload(s.d, owner, a.id, { uploadId: t.uploadId, revision: a.revision, clearFields: true })).rejects.toMatchObject(expected);
    expect(s.store.quarantinePaths()).toEqual([]);
    const after = (await s.store.getAgreement(a.workspaceId, a.id))!;
    expect(after.revision).toBe(a.revision);
    expect(after.documentHash).toBe(a.documentHash);
    expect(after.fields).toEqual(a.fields);
    expect(putBlob).not.toHaveBeenCalled();
    return s;
  }

  it("PNG bytes are not a PDF, without a scan", async () => {
    const s = await refused({}, () => PNG, { status: 400, message: "This file is not a PDF." });
    expect(s.scanFetch).toHaveBeenCalledTimes(0);
  }, 30000);

  it("an empty file is the size sentence", async () => {
    const s = await refused({}, () => new Uint8Array(0), { status: 400, message: DOCUMENT_SIZE_MESSAGE });
    expect(s.scanFetch).toHaveBeenCalledTimes(0);
  }, 30000);

  it("a PDF with an /OpenAction script is 400 with the active-content sentence", async () => {
    await refused({}, scriptedPdf, { status: 400, message: ACTIVE });
  }, 30000);

  it("a dirty scan is 422", async () => {
    await refused({ clean: false }, rotatedPdf, { status: 422, message: SCAN_DIRTY_MESSAGE });
  }, 30000);

  it("no scan key is 503 with the agreement sentence", async () => {
    await refused({ scan: "none" }, rotatedPdf, { status: 503, message: DOCUMENT_SCAN_OFF_MESSAGE });
  }, 30000);

  it("a scan that cannot be reached is 503 SCAN_DOWN_MESSAGE", async () => {
    await refused({ scan: "throws" }, rotatedPdf, { status: 503, message: SCAN_DOWN_MESSAGE });
  }, 30000);

  it("the draft saved meanwhile is 409, checked against the fresh row", async () => {
    const s = await setup();
    const a = await madeDraft(s.d, s.client.id);
    const t = await staged(s.d, a, await rotatedPdf());
    const row = (await s.store.getAgreement(a.workspaceId, a.id))!;
    await s.store.updateAgreement(a.workspaceId, a.id, row.rowVersion, { revision: a.revision + 1 });
    const putBlob = vi.spyOn(s.store, "putBlob");
    await expect(finishUpload(s.d, owner, a.id, { uploadId: t.uploadId, revision: a.revision, clearFields: true })).rejects.toMatchObject({
      status: 409,
      message: "The draft changed. Reload it.",
    });
    expect(s.store.quarantinePaths()).toEqual([]);
    expect(putBlob).not.toHaveBeenCalled();
  }, 30000);

  it("fields placed meanwhile need clearFields", async () => {
    const s = await setup();
    const a = await madeDraft(s.d, s.client.id);
    const t = await staged(s.d, a, await rotatedPdf());
    await expect(finishUpload(s.d, owner, a.id, { uploadId: t.uploadId, revision: a.revision })).rejects.toMatchObject({
      status: 409,
      message: "Replacing this PDF clears all field placements. Confirm this first.",
    });
    expect(s.store.quarantinePaths()).toEqual([]);
  }, 30000);

  it("a lost compare-and-set is 409 with the validating sentence, and the quarantine is still removed", async () => {
    const s = await setup();
    const a = await madeDraft(s.d, s.client.id);
    const t = await staged(s.d, a, await rotatedPdf());
    vi.spyOn(s.store, "updateAgreement").mockResolvedValueOnce(null);
    await expect(finishUpload(s.d, owner, a.id, { uploadId: t.uploadId, revision: a.revision, clearFields: true })).rejects.toMatchObject({
      status: 409,
      message: "The draft changed while validating the PDF. Try again.",
    });
    expect(s.store.quarantinePaths()).toEqual([]);
    expect((await s.store.getAgreement(a.workspaceId, a.id))!.revision).toBe(a.revision);
  }, 30000);
});

describe("upload tickets", () => {
  it("a ticket whose object was never uploaded is 404 This upload has expired., spent, nothing stored", async () => {
    const { d, client, store, scanFetch } = await setup();
    const a = await madeDraft(d, client.id);
    const t = await uploadUrl(d, owner, a.id, { name: "a.pdf", size: 10, revision: a.revision, clearFields: true });
    const putBlob = vi.spyOn(store, "putBlob");
    const remove = vi.spyOn(store, "removeQuarantine");
    const body = { uploadId: t.uploadId, revision: a.revision, clearFields: true };
    await expect(finishUpload(d, owner, a.id, body)).rejects.toMatchObject({ status: 404, message: UPLOAD_GONE_MESSAGE });
    expect(remove).toHaveBeenCalledWith(t.path);
    expect(putBlob).not.toHaveBeenCalled();
    expect(scanFetch).not.toHaveBeenCalled();
    expect((await store.getAgreement(a.workspaceId, a.id))!.revision).toBe(a.revision);
    store.putQuarantine(t.path, await rotatedPdf());
    await expect(finishUpload(d, owner, a.id, body)).rejects.toMatchObject({ status: 404, message: UPLOAD_GONE_MESSAGE });
  }, 30000);

  it("a ticket from another workspace is 404, stores nothing, and stays good there", async () => {
    const { d, client, store } = await setup();
    const a = await madeDraft(d, client.id);
    store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Another company" });
    store.setOrgMember(WS2, "u9", "admin");
    const stranger: User = { id: "u9", email: "stranger@example.com", workspaceId: WS2 };
    const theirWs = (await currentWorkspace(store, stranger)).workspace;
    expect(theirWs.id).not.toBe(a.workspaceId);
    const theirClient = await newClient(store, stranger);
    const theirs = await createAgreement(store, stranger, { clientId: theirClient.id, type: "NDA" });
    const t = await staged(d, theirs, await rotatedPdf(), stranger);
    const putBlob = vi.spyOn(store, "putBlob");
    await expect(finishUpload(d, owner, a.id, { uploadId: t.uploadId, revision: a.revision, clearFields: true })).rejects.toMatchObject({
      status: 404,
      message: UPLOAD_GONE_MESSAGE,
    });
    expect(putBlob).not.toHaveBeenCalled();
    expect(store.quarantinePaths()).toEqual([t.path]);
    const out = await finishUpload(d, stranger, theirs.id, { uploadId: t.uploadId, revision: theirs.revision });
    expect(out.sourceKind).toBe("upload");
  }, 30000);

  it("a ticket older than 2 hours is 404", async () => {
    const { d, client, store } = await setup();
    const a = await madeDraft(d, client.id);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 2 * 3600_000 - 60_000);
    const t = await store.createUpload(a.workspaceId, a.id);
    vi.useRealTimers();
    store.putQuarantine(t.path, await rotatedPdf());
    const putBlob = vi.spyOn(store, "putBlob");
    await expect(finishUpload(d, owner, a.id, { uploadId: t.id, revision: a.revision, clearFields: true })).rejects.toMatchObject({
      status: 404,
      message: UPLOAD_GONE_MESSAGE,
    });
    expect(putBlob).not.toHaveBeenCalled();
  }, 30000);

  it("a used ticket is 404 This upload has expired.", async () => {
    const { d, client, store } = await setup();
    const a = await madeDraft(d, client.id);
    const t = await staged(d, a, await rotatedPdf());
    const out = await finishUpload(d, owner, a.id, { uploadId: t.uploadId, revision: a.revision, clearFields: true });
    store.putQuarantine(t.path, await rotatedPdf());
    await expect(finishUpload(d, owner, a.id, { uploadId: t.uploadId, revision: out.revision, clearFields: true })).rejects.toMatchObject({
      status: 404,
      message: UPLOAD_GONE_MESSAGE,
    });
    expect((await store.getAgreement(a.workspaceId, a.id))!.revision).toBe(out.revision);
  }, 30000);

  it("a refused upload spends its ticket too", async () => {
    const { d, client } = await setup({ clean: false });
    const a = await madeDraft(d, client.id);
    const t = await staged(d, a, await rotatedPdf());
    const body = { uploadId: t.uploadId, revision: a.revision, clearFields: true };
    await expect(finishUpload(d, owner, a.id, body)).rejects.toMatchObject({ status: 422 });
    await expect(finishUpload(d, owner, a.id, body)).rejects.toMatchObject({ status: 404, message: UPLOAD_GONE_MESSAGE });
  }, 30000);

  it("a ticket for agreement A used on B is 404, spent, and its quarantine removed", async () => {
    const { d, client, store, scanFetch } = await setup();
    const a = await madeDraft(d, client.id);
    const b = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    const t = await staged(d, a, await rotatedPdf());
    await expect(finishUpload(d, owner, b.id, { uploadId: t.uploadId, revision: b.revision, clearFields: true })).rejects.toMatchObject({
      status: 404,
      message: UPLOAD_GONE_MESSAGE,
    });
    expect(store.quarantinePaths()).toEqual([]);
    expect(scanFetch).not.toHaveBeenCalled();
    await expect(finishUpload(d, owner, a.id, { uploadId: t.uploadId, revision: a.revision, clearFields: true })).rejects.toMatchObject({
      status: 404,
      message: UPLOAD_GONE_MESSAGE,
    });
  }, 30000);

  it("an unknown or malformed uploadId is 404", async () => {
    const { d, client } = await setup();
    const a = await createAgreement(d.store, owner, { clientId: client.id, type: "NDA" });
    for (const uploadId of [undefined, "", "not-an-id", "11111111-2222-4333-8444-555555555555", 42])
      await expect(finishUpload(d, owner, a.id, { uploadId, revision: a.revision })).rejects.toMatchObject({
        status: 404,
        message: UPLOAD_GONE_MESSAGE,
      });
  });

  it("a Member who is not the sender gets 404 Agreement not found. on both routes, and the ticket stays good", async () => {
    const { d, client, store } = await setup();
    const a = await madeDraft(d, client.id);
    await expect(uploadUrl(d, member, a.id, { name: "a.pdf", size: 10, revision: a.revision, clearFields: true })).rejects.toMatchObject({
      status: 404,
      message: NOT_FOUND,
    });
    const t = await staged(d, a, await rotatedPdf());
    await expect(finishUpload(d, member, a.id, { uploadId: t.uploadId, revision: a.revision, clearFields: true })).rejects.toMatchObject({
      status: 404,
      message: NOT_FOUND,
    });
    expect(store.quarantinePaths()).toEqual([t.path]);
    const out = await finishUpload(d, owner, a.id, { uploadId: t.uploadId, revision: a.revision, clearFields: true });
    expect(out.sourceKind).toBe("upload");
  }, 30000);

  it("a Member uploads to their own agreement", async () => {
    const { d, client } = await setup();
    const a = await createAgreement(d.store, member, { clientId: client.id, type: "NDA" });
    const t = await staged(d, a, await rotatedPdf(), member);
    const out = await finishUpload(d, member, a.id, { uploadId: t.uploadId, revision: a.revision });
    expect(out).toMatchObject({ sourceKind: "upload", revision: a.revision + 1 });
  }, 30000);
});

