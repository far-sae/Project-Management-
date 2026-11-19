import { AppError } from "./errors.js";
import type { SignedInUser } from "./context.js";
import { authoredPdf, brandUploadedPdf } from "./agreementPdf.js";
import { openAgreement, publicAgreement, withEvent, writeAgreement } from "./agreements.js";
import { brandingOf } from "./branding.js";
import type { MailDeps } from "./mail.js";
import type { Store, StoredAgreement } from "./store.js";
import type { Agreement } from "./shared/types.js";
import { checkPdf, looksLikePdf } from "./upload.js";
import { scanPdf } from "./virusScan.js";
import { refuseVerdict, spend as realSpend } from "./host/rateLimit.js";

type Body = Record<string, unknown>;

/** Port of SR route.ts "prepare": draws the draft's text as a branded PDF, stores it and points the draft at it. */
export async function prepareAgreement(store: Store, user: SignedInUser, id: string, b: Body): Promise<Agreement> {
  const { ctx, a } = await openAgreement(store, user, id, "prepare");
  if (a.status !== "Draft") throw new AppError("The document is frozen.", 409);
  if (Number(b.revision) !== a.revision) throw new AppError("The draft changed. Reload it.", 409);
  if (a.fields.length && !b.clearFields) throw new AppError("Replacing the PDF clears field placements. Confirm this first.", 409);
  const brand = brandingOf(ctx.workspace);
  const result = await authoredPdf(a.title, a.content, brand, (w, h) => store.getBlob(w, h));
  const hash = await store.putBlob(a.workspaceId, result.bytes);
  const out = await writeAgreement(
    store,
    a,
    {
      documentHash: hash,
      pages: result.pages,
      sourceKind: "authored",
      branding: brand,
      ...(b.clearFields ? { fields: [] } : {}),
      revision: a.revision + 1,
      events: withEvent(a, "Authored PDF prepared", user.email, { sourceHash: hash }).events,
    },
    "The draft changed during PDF generation. Try again.",
  );
  return publicAgreement(out);
}

export const DOCUMENT_TOOL = "signroom-document";
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_SIZE_MESSAGE = "PDFs must be 25 MB or smaller.";
export const DOCUMENT_SCAN_OFF_MESSAGE = "PDF uploads are not switched on yet: the virus check is not set up. You can still write the agreement here.";
export const UPLOAD_GONE_MESSAGE = "This upload has expired. Choose the PDF again.";
/** Quarantine objects older than this are removed on the workspace's next upload-url. */
export const SWEEP_AFTER_MS = 3 * 3600_000;
/** A 25 MB file can take Cloudmersive longer than the letterhead's 30 s (Ruling A3). */
const DOCUMENT_SCAN_TIMEOUT_MS = 120000;

/** SR route.ts upload: the draft checks, run again against the fresh row before the write. */
function refuseStaleDraft(a: StoredAgreement, b: Body): void {
  if (Number(b.revision) !== a.revision) throw new AppError("The draft changed. Reload it.", 409);
  if (a.fields.length && b.clearFields !== true)
    throw new AppError("Replacing this PDF clears all field placements. Confirm this first.", 409);
}

/**
 * The first half of SR route.ts "upload" (Ruling A2): the same checks, then a
 * ticket for <ws>/quarantine/<ticket>.pdf that the browser uploads to directly.
 */
export async function uploadUrl(d: MailDeps, user: SignedInUser, id: string, b: Body): Promise<{ uploadId: string; path: string; token: string }> {
  const { a } = await openAgreement(d.store, user, id, "upload");
  if (a.status !== "Draft") throw new AppError("The document is frozen.", 409);
  if (!String(b.name).toLowerCase().endsWith(".pdf")) throw new AppError("Choose a PDF file.");
  if (!(Number(b.size) > 0 && Number(b.size) <= DOCUMENT_MAX_BYTES)) throw new AppError(DOCUMENT_SIZE_MESSAGE);
  refuseStaleDraft(a, b);
  const ws = a.workspaceId;
  const verdict = await (d.spend ?? realSpend)(d.sb, DOCUMENT_TOOL, "workspace:" + ws, 20, 10);
  refuseVerdict(verdict, () => "You can upload up to 20 PDFs every 10 minutes. Try again shortly.");
  try {
    await d.store.sweepUploads(ws, new Date(Date.now() - SWEEP_AFTER_MS).toISOString());
  } catch {
    // The limit is already spent: a failed sweep must not cost the user their upload.
    console.error("[signroom] quarantine cleanup failed");
  }
  const ticket = await d.store.createUpload(ws, a.id);
  return { uploadId: ticket.id, path: ticket.path, token: ticket.token };
}

/**
 * The second half of SR route.ts "upload": takes the ticket once, then checks the
 * uploaded file (size, PDF header, virus scan, structure), brands it, stores it and
 * points the draft at it. Nothing is stored until every check has passed, and the
 * quarantine object is deleted however this ends. Never logs the name or bytes.
 */
export async function finishUpload(d: MailDeps, user: SignedInUser, id: string, b: Body): Promise<Agreement> {
  const { ctx, a } = await openAgreement(d.store, user, id, "upload");
  const ws = a.workspaceId;
  const ticket = await d.store.takeUpload(ws, String(b.uploadId ?? ""));
  if (!ticket) throw new AppError(UPLOAD_GONE_MESSAGE, 404);
  try {
    if (ticket.agreementId !== a.id) throw new AppError(UPLOAD_GONE_MESSAGE, 404);
    const bytes = await d.store.readQuarantine(ticket.path);
    if (!bytes) throw new AppError(UPLOAD_GONE_MESSAGE, 404);
    if (!bytes.length || bytes.length > DOCUMENT_MAX_BYTES) throw new AppError(DOCUMENT_SIZE_MESSAGE);
    if (!looksLikePdf(bytes)) throw new AppError("This file is not a PDF.");
    const scan = await scanPdf(
      bytes,
      { ...(d.scan ?? { fetch, apiKey: undefined }), timeoutMs: DOCUMENT_SCAN_TIMEOUT_MS },
      { fileName: "agreement.pdf", offMessage: DOCUMENT_SCAN_OFF_MESSAGE },
    );
    const checked = await checkPdf(bytes);

    const { a: fresh } = await openAgreement(d.store, user, id, "upload");
    if (fresh.status !== "Draft") throw new AppError("The document is frozen.", 409);
    refuseStaleDraft(fresh, b);

    const brand = brandingOf(ctx.workspace);
    const result = await brandUploadedPdf(checked.bytes, brand, (w, h) => d.store.getBlob(w, h));
    const hash = await d.store.putBlob(ws, result.bytes);
    const out = await writeAgreement(
      d.store,
      fresh,
      {
        documentHash: hash,
        pages: result.pages,
        fields: [],
        sourceKind: "upload",
        branding: brand,
        revision: fresh.revision + 1,
        events: withEvent(fresh, "PDF validated and normalised for signing", user.email, {
          pages: result.pages.length,
          sourceHash: hash,
          scan: { engine: scan.engine, verdict: scan.verdict, scannedAt: scan.scannedAt },
        }).events,
      },
      "The draft changed while validating the PDF. Try again.",
    );
    return publicAgreement(out);
  } finally {
    await d.store.removeQuarantine(ticket.path);
  }
}
