// One sent email, as the person it went to got it.
//
// Pure: no React, no Supabase, no network, like the rest of src/lib/email.
//
// Nothing extra is stored for this. A campaign keeps its subject and body, and
// each email of it keeps the values that were filled in for that one person
// (their name, their company, ...). Putting the two together again, with the
// signature of the mailbox that sent it, gives the email as it went out: the
// same steps the sender itself takes (signature first, then the fields).

import { buildMessage } from './message';
import { applySignature } from './signature';
import type { CampaignKind } from './types';

export interface SentEmailParts {
  kind: CampaignKind;
  subject: string;
  bodyHtml: string;
  /** The values filled in for this one person. */
  mergeData: Record<string, unknown>;
  /** The signature of the mailbox that sent it; empty when it has none, or the mailbox is gone. */
  signatureHtml: string;
}

export interface SentEmailView {
  subject: string;
  /** The body with every field filled in. A person's own values are escaped, so it is safe to show as HTML. */
  html: string;
  text: string;
  /** What the email also carried that is not shown here, in a sentence; null when nothing. */
  footnote: string | null;
}

export function renderSentEmail(parts: SentEmailParts): SentEmailView {
  const built = buildMessage({
    kind: parts.kind,
    subject: parts.subject,
    bodyHtml: applySignature(parts.bodyHtml, parts.signatureHtml),
    mergeData: parts.mergeData,
    // The real link was made for this one email when it was sent, and is not kept. Said in words below instead.
    unsubscribeUrl: undefined,
  });
  return {
    subject: built.subject,
    html: built.html,
    text: built.text,
    footnote: parts.kind === 'single' ? null : 'The email also had an unsubscribe link at the end.',
  };
}
