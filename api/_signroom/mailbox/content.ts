import type { OutgoingMail } from "./transport.js";

/**
 * What an own-mailbox email looks like: the sender's display name, the HTML
 * form of a plain-text message, and the test email. (The parts of the source
 * helper that built invoice emails with a PDF attached are not used here:
 * documents are sent as links.)
 */
export const TEST_SUBJECT = "Test email from TaskCalendar";

/** What a display name loses: quotes, backslashes, angle brackets, control and invisible format characters. */
export const NAME_STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"<>\\]/gu;

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The sender's display name: the company name with control characters, quotes and brackets removed, at most 80 characters. */
export function displayName(company: string): string {
  const cleaned = company.replace(NAME_STRIP, " ").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, 80).join("").trim() || "Your supplier";
}

/** A plain-text message as the HTML part of an email. */
export const htmlOf = (text: string): string =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111">${escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>")}</div>`;

/** A short email to the mailbox itself, proving it can send. */
export function buildTestEmail(company: string, fromEmail: string): OutgoingMail {
  const message = `This is a test email from TaskCalendar.\n\nYour agreements, invoices and receipts will now be sent from ${fromEmail}.`;
  return {
    from: { name: displayName(company), address: fromEmail },
    to: fromEmail,
    subject: TEST_SUBJECT,
    text: message,
    html: htmlOf(message),
    attachments: [],
  };
}
