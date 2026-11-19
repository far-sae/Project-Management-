import { PDFDocument, rgb } from "pdf-lib";
import { AppError } from "./errors.js";
import { font, drawBranding, type BlobLoader } from "./pdf.js";
import { PAPER } from "./shared/letterhead.js";
import type { Agreement, Branding, PageInfo } from "./shared/types.js";

type Built = { bytes: Uint8Array; pages: PageInfo[] };

/** The sample the design preview draws for "Agreement" (SR's branding-preview). */
export const AGREEMENT_SAMPLE = {
  title: "Company branding preview",
  content:
    "# A clear, consistent company document\nThis sample shows your saved logo, letterhead, colours and typography.\n\nNew agreements, invoices and receipts use these settings. Existing issued documents retain their original branding.",
};

/** Draws an agreement from its text. Ported from SR pdf.ts authoredPdf; returns the bytes rather than storing them. */
export async function authoredPdf(
  title: string,
  content: string,
  branding?: Branding,
  load?: BlobLoader,
): Promise<Built> {
  if (!content.trim()) throw new AppError("Write the agreement before preparing the PDF.");
  if (/\{\{[^}]+\}\}/.test(content)) throw new AppError("Resolve all {{placeholders}} before preparing the PDF.");
  if (content.length > 200000) throw new AppError("The document is too long.");
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer("TaskCalendar");
  const f = await font(pdf, branding?.fontFamily, {
    bold: branding?.bodyBold,
    italic: branding?.bodyItalic,
  });
  const top = branding?.design ? PAPER.height - branding.design.headerHeight - 34 : branding ? 695 : 780;
  const bottom = branding?.design ? branding.design.footerHeight + 16 : 65;
  let page = pdf.addPage([595.28, 841.89]),
    y = top;
  const add = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = top;
  };
  const row = (value: string, size = branding?.fontSize || 12) => {
    if (y < bottom) add();
    page.drawText(value, { x: 48, y, size, font: f, color: rgb(0.13, 0.18, 0.2) });
    y -= size * 1.65;
  };
  const wrap = (value: string, size = branding?.fontSize || 12) => {
    let line = "";
    for (const word of value.split(/\s+/)) {
      if (f.widthOfTextAtSize(line + word, size) > 495 && line) {
        row(line, size);
        line = "";
      }
      if (f.widthOfTextAtSize(word, size) > 490) {
        for (const char of word) {
          if (f.widthOfTextAtSize(line + char, size) > 490) {
            row(line, size);
            line = "";
          }
          line += char;
        }
        line += " ";
      } else line += word + " ";
    }
    row(line, size);
  };
  wrap(title, 22);
  y -= 18;
  for (const raw of content.split("\n")) {
    if (raw.trim() === "---PAGE BREAK---") {
      add();
      continue;
    }
    if (/^\s*\|/.test(raw)) {
      const cells = raw
        .split("|")
        .slice(1, -1)
        .map((s) => s.trim());
      if (cells.every((s) => /^[-:]+$/.test(s))) continue;
      if (y < bottom + 20) add();
      const w = 499 / Math.max(1, cells.length);
      cells.forEach((cell, i) => {
        page.drawRectangle({
          x: 48 + i * w,
          y: y - 10,
          width: w,
          height: 26,
          borderWidth: 0.6,
          borderColor: rgb(0.8, 0.83, 0.8),
        });
        let label = cell;
        while (f.widthOfTextAtSize(label, 9) > w - 12) label = label.slice(0, -1);
        page.drawText(label, { x: 54 + i * w, y: y - 1, size: 9, font: f });
      });
      y -= 29;
      continue;
    }
    const match = raw.match(/^(#{1,3})\s+(.*)/);
    if (match) {
      y -= 9;
      wrap(match[2], match[1].length === 1 ? 18 : 14);
    } else wrap(raw.replace(/^[-*] /, "• "));
  }
  if (pdf.getPageCount() > 100) throw new AppError("The document exceeds the 100-page limit.");
  if (!branding?.design)
    pdf.getPages().forEach((p, i) =>
      p.drawText(`${i + 1} / ${pdf.getPageCount()}`, {
        x: 48,
        y: 29,
        size: 8,
        font: f,
        color: rgb(0.5, 0.55, 0.5),
      }),
    );
  if (branding) await drawBranding(pdf, branding, load);
  const bytes = await pdf.save();
  return {
    bytes,
    pages: pdf.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() })),
  };
}

/** Brands an uploaded PDF: each page is scaled into the letterhead's body area. Ported from SR brandUploadedPdf. */
export async function brandUploadedPdf(bytes: Uint8Array, brand: Branding, load?: BlobLoader): Promise<Built> {
  // a plain copy: pdf-lib misreads pooled Buffers
  const source = await PDFDocument.load(new Uint8Array(bytes)),
    pdf = await PDFDocument.create();
  for (const original of source.getPages()) {
    const w = original.getWidth(),
      h = original.getHeight();
    if (!original.node.Contents()) {
      pdf.addPage([w, h]);
      continue;
    }
    const embedded = await pdf.embedPage(original);
    const page = pdf.addPage([w, h]);
    const header = brand.design ? (brand.design.headerHeight * h) / PAPER.height + 20 : 110;
    const footer = brand.design ? (brand.design.footerHeight * h) / PAPER.height + 12 : 55;
    const scale = Math.min((w - 70) / w, (h - header - footer) / h);
    page.drawPage(embedded, {
      x: (w - w * scale) / 2,
      y: footer,
      width: w * scale,
      height: h * scale,
    });
  }
  await drawBranding(pdf, brand, load);
  return {
    bytes: await pdf.save(),
    pages: pdf.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() })),
  };
}

/**
 * The final (or, with `partial`, sender-signed) PDF: every accepted field is drawn on the frozen source.
 * Ported from SR finalPdf; the source arrives as bytes, and a ticked box draws a tick only when the
 * embedded font has one (Ruling A11), otherwise an X.
 */
export async function finalPdf(a: Agreement, source: Uint8Array, partial = false): Promise<Uint8Array> {
  if (!a.frozen) throw Error("Missing frozen revision");
  const pdf = await PDFDocument.load(new Uint8Array(source));
  const f = await font(pdf);
  const tick = f.getCharacterSet().includes(0x2713) ? "✓" : "X";
  for (const field of a.frozen.fields) {
    const p = a.participants.find((p) => p.id === field.participantId);
    if (!p || p.progress !== "signed") {
      if (partial) continue;
      throw Error("Missing accepted submission");
    }
    const page = pdf.getPage(field.page - 1);
    const { width: w, height: h } = page.getSize();
    const x = field.x * w,
      y = h - (field.y + field.height) * h,
      width = field.width * w,
      height = field.height * h;
    let value =
      field.kind === "signature"
        ? p.signature || ""
        : field.kind === "date_signed"
          ? new Date(p.signedAt!).toISOString().slice(0, 10)
          : String(p.values?.[field.id] ?? "");
    if (field.kind === "checkbox") value = p.values?.[field.id] ? tick : "";
    if (field.kind === "signature" && p.drawing) {
      try {
        const image = await pdf.embedPng(new Uint8Array(Buffer.from(p.drawing.split(",")[1], "base64")));
        page.drawImage(image, { x, y, width, height });
        continue;
      } catch {
        throw Error("Invalid accepted signature image");
      }
    }
    let size = Math.min(field.kind === "signature" ? 20 : 12, height * 0.7);
    while (f.widthOfTextAtSize(value, size) > width - 5 && size > 5) size -= 0.5;
    page.drawText(value, {
      x: x + 2,
      y: y + Math.max(2, (height - size) / 2),
      font: f,
      size,
      color: rgb(0.1, 0.16, 0.24),
    });
  }
  pdf.setModificationDate(new Date(a.updated));
  return pdf.save();
}

/**
 * The completion record. Ported from SR pdf.ts completionPdf (330–343); it
 * returns the bytes rather than storing them, and its Verification line says
 * how access is really verified (SR's named a local sandbox inbox).
 */
export async function completionPdf(a: Agreement, source: string, final: string, load?: BlobLoader): Promise<Uint8Array> {
  const content = `# Completion record\nAgreement ID: ${a.id}\nSender: ${a.frozen?.sender?.name || a.senderId} (${a.frozen?.sender?.email || "see timeline"})\nBusiness: ${a.frozen?.sender?.workspaceName || a.workspaceId}\nWorkspace ID: ${a.workspaceId}\nClient record: ${a.clientId}\nConsent ${a.frozen?.consent.version}: ${a.frozen?.consent.text}\nVerification: email access verified by a one-time code sent to the invited address. This verifies mailbox access, not legal identity.\nAll timestamps are server UTC.\n\n# Signers\n${a.participants.map((p) => `${p.name} <${p.email}> — ${p.role} — ${p.progress} ${p.signedAt || ""}`).join("\n")}\n\n# SHA-256 digests\nFrozen source: ${source}\nFinal agreement: ${final}\n\n# Evidence timeline\n${(a.finalSnapshot || a.events).map((e) => `${e.seq}. ${e.at} — ${e.type} — ${e.actor}`).join("\n")}\n\nApplication-level evidence export. No certificate or universal enforceability claim is made.`;
  return (await authoredPdf(a.title + " — completion record", content, a.frozen?.branding || a.branding, load)).bytes;
}

/** Checks a drawn signature (a small PNG data URL). Ported from SR validateDrawing. */
export async function validateDrawing(data: unknown): Promise<void> {
  if (!data) return;
  const value = String(data);
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > 200000)
    throw new AppError("Use a small PNG signature drawing.");
  try {
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(new Uint8Array(Buffer.from(value.split(",")[1], "base64")));
    if (image.width > 2000 || image.height > 1000) throw Error("Image too large");
  } catch {
    throw new AppError("The drawn signature is invalid. Clear it or use your typed signature.");
  }
}
