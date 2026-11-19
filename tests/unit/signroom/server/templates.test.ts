// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { templateBytes, uploadTemplate } from "../../../../api/_signroom/templates";
import { SCAN_DIRTY_MESSAGE, SCAN_OFF_MESSAGE } from "../../../../api/_signroom/virusScan";
import { ORG2, seededStore, WS, WS2 } from "./helpers";

const owner = { id: "u1", email: "owner@example.com", workspaceId: WS };
/** A member (not an admin) of the same organisation: a Signroom Member. */
const other = { id: "u2", email: "other@example.com", workspaceId: WS };
/** An admin of another organisation, working in its own workspace. */
const outsider = { id: "u3", email: "outsider@example.com", workspaceId: WS2 };
const SIZE = "Choose a single-page PDF up to 4 MB.";

async function pdf(pages: [number, number][]) {
  const doc = await PDFDocument.create();
  for (const p of pages) doc.addPage(p);
  return new Uint8Array(await doc.save());
}
const blankA4 = () => pdf([[595.28, 841.89]]);
/** One A4 page with some artwork, so it can be drawn behind a document. */
async function a4() {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawRectangle({ x: 0, y: 800, width: 595, height: 40 });
  return new Uint8Array(await doc.save());
}

function setup(over: { clean?: boolean; spend?: unknown; scan?: boolean } = {}) {
  const store = seededStore(owner);
  store.addMember(WS, other.id, "Member");
  store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Another company" });
  store.setOrgMember(WS2, outsider.id, "admin");
  const putBlob = vi.spyOn(store, "putBlob");
  const scanFetch = vi.fn(async () => new Response(JSON.stringify({ CleanResult: over.clean ?? true }), { status: 200 }));
  const spend = vi.fn(over.spend ? (over.spend as never) : async () => ({ ok: true }));
  const d = {
    store,
    sb: {} as never,
    spend,
    ...(over.scan === false ? {} : { scan: { fetch: scanFetch as never, apiKey: "k" } }),
  } as never;
  return { store, d, putBlob, scanFetch, spend };
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

describe("uploadTemplate", () => {
  it("stores, lists and returns a clean one-page A4 PDF with a sanitised name", async () => {
    const { store, d, spend, scanFetch } = setup();
    const bytes = await a4();
    const out = await uploadTemplate(d, owner, { bytes, name: "my letterhead?.pdf" });
    const workspace = (await store.getWorkspace(WS))!;
    expect(out).toEqual({ workspaceId: workspace.id, hash: expect.any(String), name: "my letterhead_.pdf" });
    expect(await store.listTemplateFiles(workspace.id)).toEqual([out]);
    expect((await store.getBlob(workspace.id, out.hash)).length).toBeGreaterThan(0);
    expect(spend).toHaveBeenCalledWith(expect.anything(), "signroom-template", "workspace:" + workspace.id, 10, 10);
    expect(scanFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a blank one-page A4 PDF and stores nothing", async () => {
    const { store, d, putBlob } = setup();
    const add = vi.spyOn(store, "addTemplateFile");
    await expect(uploadTemplate(d, owner, { bytes: await blankA4(), name: "a.pdf" })).rejects.toMatchObject({
      message: "This letterhead page is empty. Export the page with your letterhead artwork.",
      status: 400,
    });
    expect(putBlob).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("refuses a two-page PDF", async () => {
    const { d, putBlob } = setup();
    const bytes = await pdf([
      [595.28, 841.89],
      [595.28, 841.89],
    ]);
    await expect(uploadTemplate(d, owner, { bytes, name: "a.pdf" })).rejects.toThrow(
      "Use one blank letterhead page. Export a single page from your template.",
    );
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("refuses a landscape A4 PDF", async () => {
    const { d, putBlob } = setup();
    const bytes = await pdf([[841.89, 595.28]]);
    await expect(uploadTemplate(d, owner, { bytes, name: "a.pdf" })).rejects.toThrow(
      "Use an A4 portrait template so your letterhead fits the document.",
    );
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("refuses a Member (not the owner) with 403 before the rate limit, scan or storage", async () => {
    const { d, scanFetch, putBlob, spend } = setup();
    await expect(uploadTemplate(d, other, { bytes: await a4(), name: "a.pdf" })).rejects.toMatchObject({ status: 403, message: "Only the workspace owner can do that." });
    expect(scanFetch).toHaveBeenCalledTimes(0);
    expect(putBlob).not.toHaveBeenCalled();
    expect(spend).not.toHaveBeenCalled();
  });

  it("refuses PNG bytes without calling the scan", async () => {
    const { d, scanFetch } = setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await expect(uploadTemplate(d, owner, { bytes: png, name: "a.png" })).rejects.toThrow("This file is not a PDF.");
    expect(scanFetch).toHaveBeenCalledTimes(0);
  });

  it("refuses a body of 4 MB plus one byte, and an empty one, with the size sentence", async () => {
    const { d, scanFetch } = setup();
    await expect(uploadTemplate(d, owner, { bytes: new Uint8Array(4 * 1024 * 1024 + 1), name: "a.pdf" })).rejects.toThrow(SIZE);
    await expect(uploadTemplate(d, owner, { bytes: new Uint8Array(0), name: "a.pdf" })).rejects.toThrow(SIZE);
    expect(scanFetch).toHaveBeenCalledTimes(0);
  });

  it("stores nothing when the scan is dirty", async () => {
    const { store, d, putBlob } = setup({ clean: false });
    await expect(uploadTemplate(d, owner, { bytes: await a4(), name: "a.pdf" })).rejects.toThrow(SCAN_DIRTY_MESSAGE);
    expect(await store.listTemplateFiles(WS)).toEqual([]);
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("fails closed when no scan is configured", async () => {
    const { d, putBlob } = setup({ scan: false });
    await expect(uploadTemplate(d, owner, { bytes: await a4(), name: "a.pdf" })).rejects.toThrow(SCAN_OFF_MESSAGE);
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("answers 429 with its sentence when the rate limit refuses", async () => {
    const { d, scanFetch } = setup({ spend: async () => ({ ok: false, minutesLeft: 4 }) });
    await expect(uploadTemplate(d, owner, { bytes: await a4(), name: "a.pdf" })).rejects.toMatchObject({
      status: 429,
      message: "You can upload up to 10 letterheads every 10 minutes. Try again shortly.",
    });
    expect(scanFetch).toHaveBeenCalledTimes(0);
  });

  it("answers 503 when the limiter is unavailable", async () => {
    const { d } = setup({ spend: async () => ({ ok: false, minutesLeft: 1, unavailable: true }) });
    await expect(uploadTemplate(d, owner, { bytes: await a4(), name: "a.pdf" })).rejects.toMatchObject({ status: 503 });
  });

  it("never logs the file name", async () => {
    const { d } = setup({ clean: false });
    await uploadTemplate(d, owner, { bytes: await a4(), name: "secret-name.pdf" }).catch(() => undefined);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret-name");
  });
});

describe("templateBytes", () => {
  it("returns a listed template and 404s a hash from another workspace", async () => {
    const { d } = setup();
    const mine = await uploadTemplate(d, owner, { bytes: await a4(), name: "a.pdf" });
    expect(Buffer.from((await templateBytes(d, owner, mine.hash)).subarray(0, 5)).toString()).toBe("%PDF-");
    // Another organisation's workspace does not list this hash, and its admin cannot name this workspace.
    await expect(templateBytes(d, outsider, mine.hash)).rejects.toMatchObject({ status: 404, message: "Template not found." });
    await expect(templateBytes(d, { ...outsider, workspaceId: WS }, mine.hash)).rejects.toMatchObject({ status: 403, message: "Choose a workspace." });
    await expect(templateBytes(d, owner, "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a Member with 403 on GET", async () => {
    const { d } = setup();
    await expect(templateBytes(d, other, "h")).rejects.toMatchObject({ status: 403, message: "Only the workspace owner can do that." });
  });
});
