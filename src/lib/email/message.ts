import type { CampaignKind } from './types';
import { substitutePlaceholders } from './substitute';
import { ensureUnsubscribeLink } from './unsubscribe';

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

  let text = input.bodyText
    ? substitutePlaceholders(input.bodyText, input.mergeData)
    : htmlToText(html);

  // htmlToText() strips the anchor, leaving the bare word "Unsubscribe" with
  // nothing to act on, so the plain-text part carries the URL itself.
  if (input.kind === 'bulk' && input.unsubscribeUrl && !text.includes(input.unsubscribeUrl)) {
    text = `${text}

Unsubscribe: ${input.unsubscribeUrl}`;
  }

  return { subject, html, text, headers };
}
