// Signatures: where one goes in a message, and how to build a first one.
//
// Pure: no React, no Supabase, no network, no Node built-ins.
//
// A signature belongs to the MAILBOX (migration 163), because a campaign sends
// from a pool and which mailbox takes a given message is decided at send time.
// So the signature is applied by the send path, once the mailbox is known —
// not written into the body while composing, when it is not yet knowable.

import { escapeHtml } from './substitute';

/**
 * The placeholder a person can put in a body to say WHERE the signature goes.
 *
 * Its absence is the ordinary case and means "at the end". Its presence is for
 * the message that needs something after the signature — a postscript, a legal
 * footer, a line that reads oddly above a name.
 */
export const SIGNATURE_PLACEHOLDER = '{{signature}}';

const SIGNATURE_PATTERN = /\{\{\s*signature\s*\}\}/gi;

/**
 * Puts the sending mailbox's signature into a message body.
 *
 * At `{{signature}}` where the body names one, at the end otherwise. Applied
 * BEFORE merge substitution by the caller, so a signature may itself contain
 * `{{first_name}}` and so the placeholder never survives into a sent message:
 * a body that says `{{signature}}` for a mailbox with no signature must not
 * arrive with the braces showing.
 *
 * An empty signature REMOVES the placeholder rather than leaving it — that is
 * the case above, and it is the one somebody hits by configuring the pool
 * later than they wrote the campaign.
 */
export function applySignature(bodyHtml: string, signatureHtml: string): string {
  const signature = signatureHtml.trim();
  const named = SIGNATURE_PATTERN.test(bodyHtml);
  // `test` with a /g regex advances lastIndex, and this regex is module-level.
  SIGNATURE_PATTERN.lastIndex = 0;

  if (named) {
    return bodyHtml.replace(SIGNATURE_PATTERN, signature);
  }

  if (signature === '') return bodyHtml;

  // A separator, so the signature is not run on to the last sentence. Two
  // breaks rather than a horizontal rule: a rule is a design decision about
  // somebody else's mail, and several clients render it heavily.
  return `${bodyHtml}<br><br>${signature}`;
}

/** The fields the quick-fill builder turns into a starting signature. */
export interface SignatureFields {
  name: string;
  role: string;
  company: string;
  phone: string;
  website: string;
  /** A hosted image URL. Empty for no logo. */
  logoUrl: string;
}

export const EMPTY_SIGNATURE_FIELDS: SignatureFields = {
  name: '',
  role: '',
  company: '',
  phone: '',
  website: '',
  logoUrl: '',
};

/** `https://acme.com` from `acme.com`, and left alone when already absolute. */
function href(website: string): string {
  const trimmed = website.trim();
  if (trimmed === '') return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * A plain signature built from the fields somebody typed.
 *
 * It generates HTML ONCE, as a starting point, and nothing binds the two
 * together afterwards: the stored signature is the HTML, and editing it in the
 * editor is editing the real thing. Keeping the fields as a live source would
 * mean two representations of one signature and a rule about which wins, and
 * the answer would be wrong for anybody who then tweaked the markup.
 *
 * Deliberately conservative markup: inline styles only, no flexbox, no
 * background images, a table-free layout. Outlook renders a surprising amount
 * of modern CSS by ignoring it, and a signature is the part of the message
 * most likely to be seen in Outlook.
 *
 * Every field is escaped. These values reach a recipient's mail client inside
 * HTML, and an apostrophe in a company name should not be able to end an
 * attribute.
 */
export function buildSignatureHtml(fields: SignatureFields): string {
  const name = fields.name.trim();
  const role = fields.role.trim();
  const company = fields.company.trim();
  const phone = fields.phone.trim();
  const url = href(fields.website);
  const logo = fields.logoUrl.trim();

  // Nothing typed, nothing built — rather than an empty shell with a stray
  // separator in it.
  if (!name && !role && !company && !phone && !url && !logo) return '';

  const lines: string[] = [];

  if (name) {
    lines.push(
      `<div style="font-weight:600;color:#111827">${escapeHtml(name)}</div>`,
    );
  }

  // Role and company on one line, joined only when both exist, so a missing
  // one does not leave a dangling comma or an orphan separator.
  const roleLine = [role, company].filter(Boolean).map(escapeHtml).join(', ');
  if (roleLine) {
    lines.push(`<div style="color:#6b7280">${roleLine}</div>`);
  }

  if (phone) {
    // tel: so it is tappable on a phone, which is where most mail is read.
    lines.push(
      `<div style="color:#6b7280">` +
        `<a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}" ` +
        `style="color:#6b7280;text-decoration:none">${escapeHtml(phone)}</a></div>`,
    );
  }

  if (url) {
    lines.push(
      `<div><a href="${escapeHtml(url)}" style="color:#2563eb">` +
        `${escapeHtml(fields.website.trim())}</a></div>`,
    );
  }

  // Only http(s). A mail client will not load a data: or javascript: source
  // anyway, so one in here is either a mistake or an attempt — and either way
  // the right answer is no image rather than a broken one.
  if (logo && /^https?:\/\//i.test(logo)) {
    // Height-capped and width-auto: a logo somebody uploads at 2000px wide
    // would otherwise arrive 2000px wide and break every narrow client.
    lines.push(
      `<div style="margin-top:8px">` +
        `<img src="${escapeHtml(logo)}" alt="${escapeHtml(company || name)}" ` +
        `height="40" style="height:40px;width:auto;border:0" /></div>`,
    );
  }

  return `<div style="font-size:13px;line-height:1.5">${lines.join('')}</div>`;
}
