// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { checkPdf, looksLikePdf } from "../../../../api/_signroom/upload";

async function a4() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]);
  return pdf;
}

describe("checkPdf", () => {
  it("re-saves a one-page A4 PDF and reports its size", async () => {
    const pdf = await a4();
    const r = await checkPdf(new Uint8Array(await pdf.save()));
    expect(r.pages).toEqual([{ width: 595.28, height: 841.89 }]);
    expect(Buffer.from(r.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("refuses a file that is not a PDF", async () => {
    await expect(checkPdf(new TextEncoder().encode("hello"))).rejects.toThrow(
      "This file is not a PDF.",
    );
  });

  it("refuses a corrupt PDF", async () => {
    await expect(checkPdf(new TextEncoder().encode("%PDF-1.7 junk"))).rejects.toThrow(
      "This PDF is corrupt or encrypted. Upload an unencrypted PDF.",
    );
  });

  it("refuses an OpenAction", async () => {
    const pdf = await a4();
    pdf.catalog.set(PDFName.of("OpenAction"), pdf.context.obj({}));
    await expect(checkPdf(new Uint8Array(await pdf.save()))).rejects.toThrow(
      "Active content, external actions or attachments are not supported.",
    );
  });
});

describe("looksLikePdf", () => {
  it("detects the header", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(looksLikePdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(false);
  });
});
