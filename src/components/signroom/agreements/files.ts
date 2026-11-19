/**
 * Getting agreement files in and out of the browser.
 *
 * A PDF of any size travels in two steps: the documents server hands out a
 * short-lived signed Storage link (checked against the sign-in, or the guest's
 * cookie), then the browser talks to Storage directly with no credentials. The
 * file never passes through the server function and its response size limit.
 */
import { supabase } from '@/services/supabase/config';
import { SignroomError, type SignroomClient } from '@/services/signroom/client';
import type { Agreement } from '../../../../api/_signroom/shared/types';

export type AgreementArtifactKind = 'source' | 'final' | 'completion';

export const PDF_LOAD_MESSAGE = 'The PDF could not be loaded.';
export const UPLOAD_FAILED_MESSAGE = 'The upload did not finish. Please try again.';

/** The bucket the server issues signed upload links for. */
const UPLOAD_BUCKET = 'signroom';

type SignedLink = { url: string; filename: string };

/** The server's sentence when there is one, otherwise a plain fallback. */
export const messageOf = (error: unknown, fallback = 'Something went wrong. Please try again.'): string =>
  error instanceof Error && error.message ? error.message : fallback;

async function fetchLinked(link: SignedLink): Promise<{ blob: Blob; filename: string }> {
  let response: Response;
  try {
    response = await fetch(link.url, { credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new SignroomError(PDF_LOAD_MESSAGE, 0);
  }
  if (!response.ok) throw new SignroomError(PDF_LOAD_MESSAGE, response.status);
  return { blob: await response.blob(), filename: link.filename };
}

/** An agreement PDF for the signed-in sender. */
export async function agreementPdfBlob(
  client: SignroomClient, id: string, kind: AgreementArtifactKind, download = false,
): Promise<{ blob: Blob; filename: string }> {
  const link = await client.call<SignedLink>(
    `agreements/${encodeURIComponent(id)}/artifact-url?kind=${kind}${download ? '&download=1' : ''}`,
  );
  return fetchLinked(link);
}

/** An agreement PDF for a signing guest: the link comes from the guest's cookie session. */
export async function guestPdfBlob(
  client: SignroomClient, kind: AgreementArtifactKind, download = false,
): Promise<{ blob: Blob; filename: string }> {
  const link = await client.call<SignedLink>(`guest/artifact-url?kind=${kind}${download ? '&download=1' : ''}`);
  return fetchLinked(link);
}

/** Saves a blob under a file name, then lets go of it a minute later. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Opens a signed Storage link. The link carries the attachment name, so nothing is held in memory. */
export function openSignedLink(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Saves an agreement PDF under the server's name for it (source.pdf, final.pdf, completion-record.pdf). */
export async function downloadAgreementPdf(client: SignroomClient, id: string, kind: AgreementArtifactKind): Promise<void> {
  const { blob, filename } = await agreementPdfBlob(client, id, kind, true);
  saveBlob(blob, filename);
}

export async function downloadGuestPdf(client: SignroomClient, kind: AgreementArtifactKind): Promise<void> {
  const { blob, filename } = await guestPdfBlob(client, kind, true);
  saveBlob(blob, filename);
}

/** The completed evidence ZIP for a guest with completion access. */
export async function downloadGuestExport(client: SignroomClient): Promise<void> {
  const { url } = await client.call<SignedLink>('guest/export');
  openSignedLink(url);
}

/** Records the evidence export on the agreement, then opens the ZIP. Resolves to the updated agreement. */
export async function exportEvidence(client: SignroomClient, id: string): Promise<Agreement> {
  const { url, agreement } = await client.call<SignedLink & { agreement: Agreement }>(`agreements/${id}/export`, {});
  openSignedLink(url);
  return agreement;
}

/**
 * Uploads a PDF as the agreement's document: the server issues a signed upload
 * link, the browser sends the file straight to Storage, then the server checks
 * the file (size, virus scan, structure) and attaches it to the draft.
 */
export async function uploadAgreementPdf(
  client: SignroomClient, id: string, file: File, revision: number, clearFields: boolean,
): Promise<Agreement> {
  const ticket = await client.call<{ uploadId: string; path: string; token: string }>(
    `agreements/${id}/upload-url`,
    { revision, clearFields, name: file.name, size: file.size },
  );
  // A network failure can throw instead of returning { error }: either way, one plain sentence.
  let failed: boolean;
  try {
    const { error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: 'application/pdf' });
    failed = Boolean(error);
  } catch {
    failed = true;
  }
  if (failed) throw new SignroomError(UPLOAD_FAILED_MESSAGE, 0);
  return client.call<Agreement>(`agreements/${id}/upload`, { uploadId: ticket.uploadId, revision, clearFields });
}
