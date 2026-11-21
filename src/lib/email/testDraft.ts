import { applySignature } from './signature';

/**
 * What "Send test to me" sends to the server: the email as it stands in the
 * compose form, so the test is the real email and not a fixed line.
 */

export interface TestDraft {
  subject: string;
  bodyHtml: string;
  mergeData: Record<string, string>;
}

/** True when the editor holds nothing a reader would see. */
const emptyBody = (html: string): boolean => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() === '';

/**
 * The draft to test, or null while nothing is written (the plain test then
 * only checks that the mailbox can send).
 *
 * The fields are filled from the first person on the list when there is one,
 * so the test reads as that person will read it; otherwise from the sender.
 * The signature is the chosen mailbox's own, as it will be on the real email.
 */
export function testDraftFor(
  form: { subject: string; bodyHtml: string },
  signatureHtml: string,
  firstRecipient: Record<string, unknown> | null,
  me: { name: string; email: string },
): TestDraft | null {
  const subject = form.subject.trim();
  const written = !emptyBody(form.bodyHtml);
  if (!subject && !written) return null;

  let mergeData: Record<string, string>;
  if (firstRecipient && Object.keys(firstRecipient).length > 0) {
    mergeData = Object.fromEntries(
      Object.entries(firstRecipient)
        .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
        .map(([key, value]) => [key, String(value)]),
    );
  } else {
    const fullName = me.name.trim() || me.email.split('@')[0] || '';
    const [first, ...rest] = fullName.split(/\s+/);
    mergeData = { first_name: first ?? '', last_name: rest.join(' '), full_name: fullName, email: me.email };
  }

  return { subject, bodyHtml: written ? applySignature(form.bodyHtml, signatureHtml) : '', mergeData };
}
