import { PDFDict, PDFDocument, degrees } from "pdf-lib";
import { AppError } from "./errors.js";

/** True when `%PDF-` appears in the first 1024 bytes. */
export function looksLikePdf(input: Uint8Array): boolean {
  return Buffer.from(input.subarray(0, 1024)).indexOf("%PDF-") >= 0;
}

/**
 * Signroom's normalisePdf, ported line for line: checks the file, refuses
 * active content, and rebuilds it page by page. Returns the re-saved bytes.
 */
export async function checkPdf(
  input: Uint8Array,
): Promise<{ bytes: Uint8Array; pages: { width: number; height: number }[] }> {
  if (input.length > 25 * 1024 * 1024)
    throw new AppError("PDFs must be 25 MB or smaller.");
  if (!looksLikePdf(input)) throw new AppError("This file is not a PDF.");
  // pdf-lib can misread pooled Node Buffers, so work on a plain copy.
  const data = new Uint8Array(input);
  let original: PDFDocument;
  let count: number;
  try {
    original = await PDFDocument.load(data, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    // pdf-lib accepts some junk on load and only fails here.
    count = original.getPageCount();
  } catch {
    throw new AppError(
      "This PDF is corrupt or encrypted. Upload an unencrypted PDF.",
    );
  }
  if (!count || count > 100)
    throw new AppError("Upload a PDF with 1 to 100 pages.");
  const forbidden = [
    "JavaScript",
    "JS",
    "OpenAction",
    "AA",
    "EmbeddedFiles",
    "EmbeddedFile",
    "Launch",
    "RichMedia",
    "XFA",
    "URI",
  ];
  for (const [, object] of original.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict) {
      for (const key of object.keys())
        if (forbidden.includes(key.decodeText()))
          throw new AppError(
            "Active content, external actions or attachments are not supported.",
          );
    }
    if (
      /\/S\s*\/(JavaScript|Launch|URI)|EICAR-STANDARD-ANTIVIRUS-TEST-FILE/.test(
        object.toString(),
      )
    )
      throw new AppError("Unsafe PDF content was detected.");
  }
  const pdf = await PDFDocument.create();
  for (const source of original.getPages()) {
    const crop = source.getCropBox(),
      r = ((source.getRotation().angle % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(r))
      throw new AppError("Unsupported PDF page rotation.");
    if (
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.width > 20000 ||
      crop.height > 20000
    )
      throw new AppError("Unsupported PDF page dimensions.");
    if (!source.node.Contents()) {
      pdf.addPage(
        r === 90 || r === 270
          ? [crop.height, crop.width]
          : [crop.width, crop.height],
      );
      continue;
    }
    const embedded = await pdf.embedPage(source, {
      left: crop.x,
      bottom: crop.y,
      right: crop.x + crop.width,
      top: crop.y + crop.height,
    });
    const w = crop.width,
      h = crop.height;
    const page = pdf.addPage(r === 90 || r === 270 ? [h, w] : [w, h]);
    page.drawPage(embedded, {
      x: r === 180 ? w : r === 270 ? h : 0,
      y: r === 90 ? w : r === 180 ? h : 0,
      rotate: degrees(r === 90 ? -90 : r === 270 ? 90 : r),
    });
  }
  const bytes = await pdf.save();
  return {
    bytes,
    pages: pdf
      .getPages()
      .map((p) => ({ width: p.getWidth(), height: p.getHeight() })),
  };
}
