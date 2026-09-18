import { substitutePlaceholders } from './substitute';
import { ensureUnsubscribeLink } from './unsubscribe';

// Copy of the shared message builder — see tests/unit/emailApiParity.test.ts
// for why api/ may not import across its own boundary. The only edit to the
// body is this type: the original imports CampaignKind from ./types, a module
// of browser-side domain interfaces the routes never touch, so the one member
// used here is declared locally rather than dragging that file in too.
export type CampaignKind = 'single' | 'bulk';

export interface BuildMessageInput {
  kind: CampaignKind;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  mergeData: Record<string, unknown>;
  /** Required for bulk; ignored for single (transactional mail is exempt). */
  unsubscribeUrl?: string;
}

export interface BuiltMessage {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildMessage(input: BuildMessageInput): BuiltMessage {
  const subject = substitutePlaceholders(input.subject, input.mergeData);
  let html = substitutePlaceholders(input.bodyHtml, input.mergeData);
  const headers: Record<string, string> = {};

  // Gmail and Yahoo require one-click unsubscribe from bulk senders. Single
  // sends are transactional and must not carry it.
  if (input.kind === 'bulk' && input.unsubscribeUrl) {
    html = ensureUnsubscribeLink(html, input.unsubscribeUrl);
    headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const text = input.bodyText
    ? substitutePlaceholders(input.bodyText, input.mergeData)
    : htmlToText(html);

  return { subject, html, text, headers };
}
