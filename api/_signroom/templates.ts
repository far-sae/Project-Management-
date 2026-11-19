import { PDFDocument } from "pdf-lib";
import { AppError } from "./errors.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import type { MailDeps } from "./mail.js";
import type { TemplateFile } from "./shared/types.js";
import { checkPdf, looksLikePdf } from "./upload.js";
import { scanPdf } from "./virusScan.js";
import { refuseVerdict, spend as realSpend } from "./host/rateLimit.js";


export const TEMPLATE_TOOL = "signroom-template";
export const TEMPLATE_MAX_BYTES = 4 * 1024 * 1024;
export const TEMPLATE_SIZE_MESSAGE = "Choose a single-page PDF up to 4 MB.";
const A4_RATIO = 595.28 / 841.89;

/**
 * Letterhead upload: workspace member, rate limit, size, PDF magic bytes, virus
 * scan, structural check, one A4 portrait page, then the blob and its record.
 * Nothing is stored until every check has passed. Never logs the name or bytes.
 */
export async function uploadTemplate(
  d: MailDeps,
  user: SignedInUser,
  file: { bytes: Uint8Array; name: string },
): Promise<TemplateFile> {
  const { workspace } = await currentWorkspace(d.store, user, { owner: true });
  const verdict = await (d.spend ?? realSpend)(d.sb, TEMPLATE_TOOL, "workspace:" + workspace.id, 10, 10);
  refuseVerdict(verdict, () => "You can upload up to 10 letterheads every 10 minutes. Try again shortly.");

  const { bytes } = file;
  if (!bytes.length || bytes.length > TEMPLATE_MAX_BYTES) throw new AppError(TEMPLATE_SIZE_MESSAGE);
  if (!looksLikePdf(bytes)) throw new AppError("This file is not a PDF.");

  const scan = await scanPdf(bytes, d.scan ?? { fetch, apiKey: undefined });
  const checked = await checkPdf(bytes);
  if (checked.pages.length !== 1)
    throw new AppError("Use one blank letterhead page. Export a single page from your template.");
  const size = checked.pages[0];
  if (Math.abs(size.width / size.height - A4_RATIO) > 0.03)
    throw new AppError("Use an A4 portrait template so your letterhead fits the document.");

  // A blank page parses but cannot be drawn behind an invoice: prove it embeds before storing anything.
  try {
    const scratch = await PDFDocument.create();
    const [page] = await scratch.embedPdf(new Uint8Array(checked.bytes), [0]);
    await page.embed();
  } catch {
    throw new AppError("This letterhead page is empty. Export the page with your letterhead artwork.");
  }

  const hash = await d.store.putBlob(workspace.id, checked.bytes);
  const asset: TemplateFile = {
    workspaceId: workspace.id,
    hash,
    name: file.name.replace(/[^a-zA-Z0-9 ._()-]/g, "_").slice(0, 100),
  };
  await d.store.addTemplateFile({ ...asset, sizeBytes: bytes.length, scanEngine: scan.engine });
  return asset;
}

/** A stored letterhead, only when this workspace lists its hash. */
export async function templateBytes(d: MailDeps, user: SignedInUser, hash: string): Promise<Uint8Array> {
  const { workspace } = await currentWorkspace(d.store, user, { owner: true });
  const listed = (await d.store.listTemplateFiles(workspace.id)).some((f) => f.hash === hash);
  if (!hash || !listed) throw new AppError("Template not found.", 404);
  return d.store.getBlob(workspace.id, hash);
}
