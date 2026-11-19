// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createAgreement } from "../../../../api/_signroom/agreements";
import { DOCUMENT_SCAN_OFF_MESSAGE, finishUpload, uploadUrl } from "../../../../api/_signroom/agreementDocument";
import { billingAction, billingArtifact } from "../../../../api/_signroom/billing";
import type { Invoice } from "../../../../api/_signroom/shared/types";
import { uploadTemplate } from "../../../../api/_signroom/templates";
import { SCAN_OFF_MESSAGE } from "../../../../api/_signroom/virusScan";
import { madeDraft, mailSetup, newClient, OWNER, sent } from "./agreementFixtures";
import { WS } from "./helpers";

/**
 * The virus scan fails closed. With no CLOUDMERSIVE_API_KEY every PDF upload is
 * refused with a clear sentence and nothing is stored, while agreements written
 * in the editor, and invoices, work as usual.
 */

async function onePage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawRectangle({ x: 50, y: 50, width: 100, height: 100 });
  return new Uint8Array(await doc.save());
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

/** The deps as the entry builds them when CLOUDMERSIVE_API_KEY is not set, and with no scan deps at all. */
function variants() {
  const noKey = mailSetup();
  const scanFetch = vi.fn(async () => new Response(JSON.stringify({ CleanResult: true }), { status: 200 }));
  noKey.deps.scan = { fetch: scanFetch as never, apiKey: undefined };
  const noScan = mailSetup();
  delete noScan.deps.scan;
  return [{ ...noKey, scanFetch }, { ...noScan, scanFetch }];
}

describe("with no virus scan key", () => {
  it("an uploaded agreement PDF is refused with a clear sentence, nothing is stored and the draft is unchanged", async () => {
    for (const t of variants()) {
      const client = await newClient(t.store);
      const a = await createAgreement(t.store, OWNER, { clientId: client.id, type: "NDA" });
      const ticket = await uploadUrl(t.deps, OWNER, a.id, { name: "contract.pdf", size: 1000, revision: a.revision });
      t.store.putQuarantine(ticket.path, await onePage());
      const blobsBefore = t.store.blobPaths().length;
      await expect(finishUpload(t.deps, OWNER, a.id, { uploadId: ticket.uploadId, revision: a.revision })).rejects.toMatchObject({
        status: 503,
        message: DOCUMENT_SCAN_OFF_MESSAGE,
      });
      expect(DOCUMENT_SCAN_OFF_MESSAGE).toMatch(/virus check is not set up/);
      expect(t.scanFetch).not.toHaveBeenCalled();
      expect(t.store.blobPaths()).toHaveLength(blobsBefore);
      // The quarantined file is removed however the upload ends.
      expect(t.store.quarantinePaths()).toEqual([]);
      const row = (await t.store.getAgreement(WS, a.id))!;
      expect(row.documentHash).toBeUndefined();
      expect(row.sourceKind).toBe("authored");
      expect(row.revision).toBe(a.revision);
    }
  });

  it("a letterhead PDF is refused the same way", async () => {
    for (const t of variants()) {
      await expect(uploadTemplate(t.deps, OWNER, { bytes: await onePage(), name: "letterhead.pdf" })).rejects.toMatchObject({ status: 503, message: SCAN_OFF_MESSAGE });
      expect(await t.store.listTemplateFiles(WS)).toEqual([]);
      expect(t.store.blobPaths()).toEqual([]);
    }
  });

  it("an agreement written in the editor is still prepared and sent", async () => {
    for (const t of variants()) {
      const client = await newClient(t.store);
      const draft = await madeDraft(t.deps, client.id);
      expect(draft.documentHash).toMatch(/^[0-9a-f]{64}$/);
      const out = await sent(t.deps, draft);
      expect(out.status).toBe("Awaiting signatures");
      expect(t.resend.calls).toHaveLength(1);
      expect(t.scanFetch).not.toHaveBeenCalled();
    }
  }, 30000);

  it("an invoice is still created, issued and served as a PDF", async () => {
    for (const t of variants()) {
      const client = await newClient(t.store);
      const d = (await billingAction(t.store, OWNER, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
      const s = (await billingAction(t.store, OWNER, "POST", d.id, "save", {
        revision: d.revision,
        currency: "GBP",
        issueDate: d.issueDate,
        dueDate: d.dueDate,
        lines: [{ description: "Consulting", quantity: "1", rate: "100.00" }],
        taxPercent: "0",
      })) as Invoice;
      const issued = (await billingAction(t.store, OWNER, "POST", s.id, "issue", { revision: s.revision })) as Invoice;
      expect(issued.status).toBe("Issued");
      const pdf = await billingArtifact(t.store, OWNER, issued.id);
      expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    }
  }, 30000);
});
