/**
 * PDFs that are made from what is on screen and only looked at: the sample for
 * the look being edited (POST workspaces/branding-preview) and a draft
 * agreement as it is being written (POST agreements/:id/preview).
 *
 * The shared documents client can fetch a PDF only with GET, and reads every
 * POST reply as JSON. This one call posts JSON and gets a PDF back, so it is
 * made here with the same sign-in token and workspace header the client sends.
 */
import { supabase } from '@/services/supabase/config';
import { REQUEST_FAILED_MESSAGE, SIGNED_OUT_MESSAGE, SignroomError } from '@/services/signroom/client';

const PREVIEW_FAILED = 'The PDF preview could not be generated.';

/** The sample PDF for the look being edited. */
export const brandingPreviewPdf = (workspaceId: string, body: Record<string, unknown>): Promise<Blob> =>
  pdfFromPost(workspaceId, 'workspaces/branding-preview', body);

/**
 * A draft agreement as the PDF it would become, from the text on screen
 * (POST agreements/:id/preview). Nothing is stored by it.
 */
export const agreementPreviewPdf = (workspaceId: string, agreementId: string, body: { title: string; content: string }): Promise<Blob> =>
  pdfFromPost(workspaceId, `agreements/${encodeURIComponent(agreementId)}/preview`, body);

async function pdfFromPost(workspaceId: string, path: string, body: Record<string, unknown>): Promise<Blob> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new SignroomError(SIGNED_OUT_MESSAGE, 401);

  let response: Response;
  try {
    response = await fetch(`/api/signroom/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Signroom-Workspace': workspaceId,
      },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new SignroomError(REQUEST_FAILED_MESSAGE, 0);
  }
  if (!response.ok) {
    let sentence: string | null = null;
    try {
      if (response.headers.get('content-type')?.includes('json')) {
        const reply = await response.json();
        if (typeof reply?.error === 'string' && reply.error.trim()) sentence = reply.error;
      }
    } catch {
      // Not JSON after all: fall through to the plain sentence.
    }
    throw new SignroomError(sentence ?? PREVIEW_FAILED, response.status);
  }
  return response.blob();
}
