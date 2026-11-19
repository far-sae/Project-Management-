// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { financialPdf, sampleFinancial } from "../../../../api/_signroom/financialPdf";
import { presetDesign } from "../../../../api/_signroom/shared/letterhead";
import type { Branding, Invoice, Payment } from "../../../../api/_signroom/shared/types";

async function textOf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  let out = "";
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return out.replace(/\s+/g, " ");
}

const brand: Branding = {
  companyName: "Acme Studio Ltd",
  address: "1 High Street\nLondon",
  companyNumber: "12345678",
  taxNumber: "GB123",
  color: "#24543b",
  fontSize: 12,
  fontFamily: "instrument",
  footer: "Thanks for your business",
  layout: "letterhead",
  logoPosition: "left",
  paymentInstructions: "Pay by bank transfer.",
};

const payment: Payment = {
  id: "p1",
  amountMinor: 500,
  paidOn: "2026-11-20",
  reference: "BACS",
  method: "Bank transfer",
  receiptNumber: "INV-2026-00001-R01",
  receiptHash: "",
  recordedAt: "2026-11-20T10:00:00Z",
};

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "i1",
    workspaceId: "w1",
    clientId: "c1",
    createdBy: "u1",
    revision: 1,
    status: "Issued",
    number: "INV-2026-00001",
    currency: "GBP",
    issueDate: "2026-11-15",
    dueDate: "2026-11-29",
    lines: [
      { description: "Website design", quantityMilli: 1000, rateMinor: 1000, totalMinor: 1000 },
      { description: "Hosting", quantityMilli: 1000, rateMinor: 500, totalMinor: 500 },
    ],
    taxBps: 2000,
    subtotalMinor: 1500,
    taxMinor: 300,
    totalMinor: 1800,
    notes: "",
    created: "2026-11-15T10:00:00Z",
    updated: "2026-11-15T10:00:00Z",
    branding: brand,
    customer: { name: "Acme Ltd", contactName: "Jo", email: "jo@acme.test", companyNumber: "" },
    payments: [],
    events: [],
    ...over,
  };
}

describe("financialPdf", () => {
  it("renders a two-line GBP invoice on one page", async () => {
    const bytes = await financialPdf(invoice());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const text = await textOf(bytes);
    expect(text).toContain("INV-2026-00001");
    expect(text).toContain("GBP 18.00");
    expect(text).toContain("Acme Studio Ltd");
  });

  it("leaves off a logo it cannot embed instead of failing", async () => {
    const webp = "data:image/webp;base64," + Buffer.from("RIFF0000WEBPVP8 ").toString("base64");
    const bytes = await financialPdf(invoice({ branding: { ...brand, logo: webp } }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(await textOf(bytes)).toContain("INV-2026-00001");
  });

  it("labels a draft", async () => {
    const text = await textOf(await financialPdf(invoice({ status: "Draft" })));
    expect(text).toContain("DRAFT - INVOICE");
  });

  it("renders a receipt", async () => {
    const text = await textOf(await financialPdf(invoice({ payments: [payment] }), payment));
    expect(text).toContain("RECEIPT");
    expect(text).toContain("INV-2026-00001-R01");
  });

  it("flows a very long invoice onto more pages", async () => {
    const long = "A long line of billing text that keeps going and going. ".repeat(6);
    const lines = Array.from({ length: 100 }, () => ({
      description: long,
      quantityMilli: 1000,
      rateMinor: 100,
      totalMinor: 100,
    }));
    const bytes = await financialPdf(invoice({ lines }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    // A hundred long lines take about 2 seconds alone and more when the whole suite runs at once.
  }, 30_000);

  it("renders a moved invoice whose branding snapshot is partial", async () => {
    const old = { companyName: "Old Co" } as unknown as Branding;
    const text = await textOf(await financialPdf(invoice({ branding: old })));
    expect(text).toContain("Old Co");
  });

  describe("letterhead background", () => {
    const LETTERHEAD_SENTENCE = "Your letterhead PDF could not be read. Choose it again in Settings.";
    async function a4(): Promise<Uint8Array> {
      const d = await PDFDocument.create();
      d.addPage([595.28, 841.89]).drawRectangle({ x: 0, y: 800, width: 595, height: 40 });
      return d.save();
    }
    const withTemplate = (over: Partial<Branding> = {}): Branding => ({
      ...brand,
      backgroundTemplate: { hash: "h1", name: "letterhead.pdf", workspaceId: "w1" },
      ...over,
    });

    it("draws a one-page letterhead behind the invoice and asks the loader for it", async () => {
      const load = vi.fn(async () => await a4());
      const bytes = await financialPdf(invoice({ branding: withTemplate() }), undefined, load);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
      expect(load).toHaveBeenCalledWith("w1", "h1");
      expect(await textOf(bytes)).toContain("INV-2026-00001");
    });

    it("leaves the design rectangles off unless the overlay is on", async () => {
      const design = presetDesign("classic", brand);
      const load = async () => await a4();
      const off = await financialPdf(invoice({ branding: withTemplate({ design, templateOverlay: false }) }), undefined, load);
      const on = await financialPdf(invoice({ branding: withTemplate({ design, templateOverlay: true }) }), undefined, load);
      expect(off.length).toBeLessThan(on.length);
    });

    it("does not call the loader when no letterhead is set", async () => {
      const load = vi.fn(async () => await a4());
      await financialPdf(invoice(), undefined, load);
      expect(load).not.toHaveBeenCalled();
    });

    it("says the letterhead could not be read when the loader throws", async () => {
      const load = async () => {
        throw new Error("Blob not found.");
      };
      await expect(financialPdf(invoice({ branding: withTemplate() }), undefined, load)).rejects.toMatchObject({
        message: LETTERHEAD_SENTENCE,
        status: 400,
      });
    });

    it("says the same for a blank letterhead page that parses but cannot be embedded", async () => {
      const blank = await PDFDocument.create();
      blank.addPage([595.28, 841.89]);
      const bytes = await blank.save();
      await expect(
        financialPdf(invoice({ branding: withTemplate() }), undefined, async () => bytes),
      ).rejects.toMatchObject({ message: LETTERHEAD_SENTENCE, status: 400 });
    });

    it("says the same when there is no loader or the bytes are not a PDF", async () => {
      await expect(financialPdf(invoice({ branding: withTemplate() }))).rejects.toThrow(LETTERHEAD_SENTENCE);
      await expect(
        financialPdf(invoice({ branding: withTemplate() }), undefined, async () => new Uint8Array([1, 2, 3])),
      ).rejects.toThrow(LETTERHEAD_SENTENCE);
    });
  });

  describe("sampleFinancial", () => {
    it("makes a sample receipt carrying its receipt number", async () => {
      const text = await textOf(await sampleFinancial(brand, true));
      expect(text).toContain("RCT-2026-00005");
      expect(text).toContain("RECEIPT");
    });

    it("makes a sample invoice by default", async () => {
      expect(await textOf(await sampleFinancial(brand))).toContain("INV-2026-00005");
    });
  });
});
