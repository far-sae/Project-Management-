// Pure email helpers for the `send-email` Edge Function (no remote imports so
// Vitest can load them). The function only ever sends these fixed templates —
// callers pass data, never raw HTML — so it can't be used as an open relay.

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only links back into the app (one of `allowedOrigins`) may appear in emails. */
export function isAllowedLink(url: string, allowedOrigins: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const origin = parsed.origin.toLowerCase();
  return allowedOrigins.some((o) => o.trim().replace(/\/+$/, '').toLowerCase() === origin);
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(value);
}

const BRAND = 'TaskCalendar';

function layout(opts: { heading: string; paragraphsHtml: string; button?: { label: string; url: string }; footer?: string }): string {
  const button = opts.button
    ? `<p style="margin:28px 0"><a href="${escapeHtml(opts.button.url)}" style="background:#16a34a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(opts.button.label)}</a></p>`
    : '';
  const footer = opts.footer ? `<p style="color:#6b7280;font-size:13px;margin:0 0 8px">${escapeHtml(opts.footer)}</p>` : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(opts.heading)}</h1>
${opts.paragraphsHtml}
${button}
${footer}
<p style="color:#9ca3af;font-size:12px;margin:24px 0 0">${BRAND}</p>
</div></body></html>`;
}

const para = (html: string) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${html}</p>`;

export function renderInvitationEmail(p: {
  toEmail: string;
  inviterName: string;
  projectName: string;
  inviteLink: string;
  role: string;
}): RenderedEmail {
  const subject = `Invitation to join ${p.projectName}`;
  const intro = `${p.inviterName} has invited you to join "${p.projectName}" as a ${p.role}.`;
  const expiry = 'This invitation expires in 7 days.';
  const html = layout({
    heading: subject,
    paragraphsHtml: para(escapeHtml(intro)),
    button: { label: 'Accept invitation', url: p.inviteLink },
    footer: expiry,
  });
  const text = [
    'Hi,',
    '',
    intro,
    '',
    `Accept the invitation here: ${p.inviteLink}`,
    '',
    expiry,
    '',
    `— ${BRAND}`,
  ].join('\n');
  return { subject, html, text };
}

export function renderNotificationEmail(p: {
  title: string;
  body: string;
  actionUrl?: string;
}): RenderedEmail {
  const html = layout({
    heading: p.title,
    paragraphsHtml: para(escapeHtml(p.body).replace(/\r?\n/g, '<br>')),
    button: p.actionUrl ? { label: 'Open in TaskCalendar', url: p.actionUrl } : undefined,
  });
  const text = [p.body, '', p.actionUrl ? `Open: ${p.actionUrl}` : '', `— ${BRAND}`]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
  return { subject: p.title, html, text };
}
