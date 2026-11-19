// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  AGREEMENT_SAMPLE,
  authoredPdf,
  brandUploadedPdf,
  completionPdf,
  finalPdf,
  validateDrawing,
} from "../../../../api/_signroom/agreementPdf";
import { CONSENT, type Agreement, type Branding, type Field, type Participant } from "../../../../api/_signroom/shared/types";

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
  footer: "Thanks",
  layout: "letterhead",
  logoPosition: "left",
  paymentInstructions: "",
};

const A4 = { width: 595.28, height: 841.89 };

describe("authoredPdf", () => {
  it("makes two A4 pages from a page break", async () => {
    const out = await authoredPdf(
      "Synthetic",
      "# Synthetic agreement\nFirst page text.\n---PAGE BREAK---\n# Second page\nMore text.",
    );
    expect(out.pages).toHaveLength(2);
    for (const p of out.pages) expect(p).toEqual(A4);
    expect(out.bytes).toBeInstanceOf(Uint8Array);
    expect(await textOf(out.bytes)).toContain("Second page");
  }, 30000);

  it("refuses empty content", async () => {
    await expect(authoredPdf("T", "   ")).rejects.toThrow("Write the agreement before preparing the PDF.");
  });

  it("refuses an unresolved placeholder", async () => {
    await expect(authoredPdf("T", "Hi {{client_name}}")).rejects.toThrow(
      "Resolve all {{placeholders}} before preparing the PDF.",
    );
  });

  it("refuses content over 200000 characters", async () => {
    await expect(authoredPdf("T", "a".repeat(200001))).rejects.toThrow("The document is too long.");
  });

  it("draws the branded sample", async () => {
    const out = await authoredPdf(AGREEMENT_SAMPLE.title, AGREEMENT_SAMPLE.content, brand);
    expect(await textOf(out.bytes)).toContain("A clear, consistent company document");
  }, 30000);
});

describe("brandUploadedPdf", () => {
  it("keeps the page size", async () => {
    const src = await PDFDocument.create();
    src.addPage([600, 800]).drawText("Uploaded body");
    const out = await brandUploadedPdf(new Uint8Array(await src.save()), brand);
    expect(out.pages).toEqual([{ width: 600, height: 800 }]);
  }, 30000);
});

function field(over: Partial<Field>): Field {
  return {
    id: "f1",
    participantId: "p1",
    kind: "signature",
    label: "Sign",
    page: 1,
    x: 0.1,
    y: 0.1,
    width: 0.5,
    height: 0.06,
    required: true,
    ...over,
  };
}

async function agreement(participants: Participant[], fields: Field[]) {
  const src = await authoredPdf("Frozen", "# Agreement\nBody text.");
  const a = {
    id: "a1",
    workspaceId: "w1",
    updated: "2026-11-17T10:00:00Z",
    participants,
    frozen: { sourceHash: "x", fields },
  } as unknown as Agreement;
  return { a, source: src.bytes };
}

const signed: Participant = {
  id: "p1",
  name: "Signer One",
  email: "one@example.test",
  role: "signer",
  order: 1,
  progress: "signed",
  version: 1,
  signedAt: "2026-11-17T09:00:00Z",
  signature: "Synthetic first signature",
  values: { f2: true },
};
const unsigned: Participant = {
  id: "p2",
  name: "Signer Two",
  email: "two@example.test",
  role: "signer",
  order: 2,
  progress: "invited",
  version: 1,
};

describe("finalPdf", () => {
  it("draws the signed participant and skips the unsigned one when partial", async () => {
    const { a, source } = await agreement(
      [signed, unsigned],
      [field({}), field({ id: "f3", participantId: "p2", y: 0.3 })],
    );
    const out = await finalPdf(a, source, true);
    expect(await textOf(out)).toContain("Synthetic first signature");
  }, 30000);

  it("rejects an unsigned participant when not partial", async () => {
    const { a, source } = await agreement([signed, unsigned], [field({ participantId: "p2" })]);
    await expect(finalPdf(a, source, false)).rejects.toThrow("Missing accepted submission");
  }, 30000);

  it("draws a ticked box as a tick or an X, never mis-encoded", async () => {
    const { a, source } = await agreement([signed], [field({ id: "f2", kind: "checkbox", width: 0.05 })]);
    const out = await finalPdf(a, source, false);
    const text = await textOf(out);
    expect(text).not.toContain("âœ“");
    expect(/✓|X/.test(text)).toBe(true);
  }, 30000);

  it("needs a frozen agreement", async () => {
    const { source } = await agreement([signed], []);
    await expect(finalPdf({ participants: [] } as unknown as Agreement, source)).rejects.toThrow(
      "Missing frozen revision",
    );
  });
});

describe("completionPdf", () => {
  // SR "Completion record contains signer addresses and exact consent".
  it("holds each signer's address, the exact consent and the agreement id", async () => {
    const a = {
      id: "agreement-1234",
      workspaceId: "w1",
      clientId: "c1",
      senderId: "u1",
      title: "TEST NDA",
      updated: "2026-11-17T10:00:00Z",
      participants: [signed, { ...unsigned, progress: "signed", signedAt: "2026-11-17T09:30:00Z" }],
      frozen: {
        sourceHash: "s".repeat(64),
        fields: [],
        consent: CONSENT,
        sender: { name: "Owner", email: "owner@example.com", workspaceName: "Bloom Ltd" },
      },
      events: [],
      finalSnapshot: [{ seq: 1, type: "Signature accepted", actor: "one@example.test", at: "2026-11-17T09:00:00Z", detail: {} }],
    } as unknown as Agreement;
    const text = await textOf(await completionPdf(a, "s".repeat(64), "f".repeat(64)));
    expect(text).toContain("one@example.test");
    expect(text).toContain("two@example.test");
    expect(text).toContain(CONSENT.text);
    expect(text).toContain("agreement-1234");
    expect(text).toContain("Verification: email access verified by a one-time code sent to the invited address.");
    expect(text.toLowerCase()).not.toContain("sandbox");
  }, 30000);
});

describe("validateDrawing", () => {
  it("accepts nothing", async () => {
    await expect(validateDrawing(undefined)).resolves.toBeUndefined();
  });

  it("refuses an unreadable PNG", async () => {
    await expect(validateDrawing("data:image/png;base64,aW52YWxpZA==")).rejects.toThrow(
      "The drawn signature is invalid. Clear it or use your typed signature.",
    );
  });

  it("refuses a GIF", async () => {
    await expect(validateDrawing("data:image/gif;base64,AA==")).rejects.toThrow("Use a small PNG signature drawing.");
  });

  it("accepts a small real PNG", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVR4nGP4z8DwnwGM/zMwAAAf7gP9NRsAMwAAAABJRU5ErkJggg==";
    await expect(validateDrawing(png)).resolves.toBeUndefined();
  });
});
