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
const DEFAULT_LOGO = 'https://taskcalendar.co.uk/logo.png';

/** Label colours. Text colours are dark enough for WCAG AA on their tint. */
export type EmailTone = 'brand' | 'info' | 'warning' | 'danger' | 'success' | 'meeting' | 'neutral';
const TONES: Record<EmailTone, { fg: string; bg: string; bar: string }> = {
  brand: { fg: '#c2410c', bg: '#fff7ed', bar: '#f97316' },
  info: { fg: '#1d4ed8', bg: '#eff6ff', bar: '#3b82f6' },
  warning: { fg: '#b45309', bg: '#fffbeb', bar: '#f59e0b' },
  danger: { fg: '#b91c1c', bg: '#fef2f2', bar: '#ef4444' },
  success: { fg: '#15803d', bg: '#f0fdf4', bar: '#22c55e' },
  meeting: { fg: '#6d28d9', bg: '#f5f3ff', bar: '#8b5cf6' },
  neutral: { fg: '#374151', bg: '#f3f4f6', bar: '#9ca3af' },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BUTTON_BG = '#c2410c'; // brand orange, dark enough for white text (AA)

interface LayoutOptions {
  heading: string;
  /** Inbox preview text (hidden in the body). */
  preheader?: string;
  eyebrow?: string;
  tone?: EmailTone;
  /** Already-escaped HTML paragraphs. */
  bodyHtml: string;
  details?: Array<[string, string]>;
  button?: { label: string; url: string };
  footer?: string;
  settingsUrl?: string;
  logoUrl?: string;
}

function detailsTable(details: Array<[string, string]>): string {
  if (!details.length) return '';
  const rows = details
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:10px 16px;${i ? 'border-top:1px solid #eceef1;' : ''}color:#6b7280;font-size:13px;width:96px;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:10px 16px;${i ? 'border-top:1px solid #eceef1;' : ''}color:#111827;font-size:14px;font-weight:600;vertical-align:top">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#f9fafb;border:1px solid #eceef1;border-radius:10px;margin:20px 0 4px">${rows}</table>`;
}

function buttonHtml(button: { label: string; url: string }): string {
  const url = escapeHtml(button.url);
  // Table-based "bulletproof" button: renders as a real button in Outlook too.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px"><tr><td style="border-radius:8px;background:${BUTTON_BG}"><a href="${url}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(button.label)}</a></td></tr></table>
<p style="margin:0 0 4px;font-size:12px;line-height:1.5;color:#9ca3af">Button not working? Paste this link into your browser:<br><a href="${url}" style="color:#6b7280;word-break:break-all">${url}</a></p>`;
}

function layout(o: LayoutOptions): string {
  const tone = TONES[o.tone ?? 'brand'];
  const preheader = o.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(o.preheader)}${'&#8204;&nbsp;'.repeat(20)}</div>`
    : '';
  const eyebrow = o.eyebrow
    ? `<p style="margin:0 0 12px"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-size:12px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase">${escapeHtml(o.eyebrow)}</span></p>`
    : '';
  const footer = [
    o.footer ? escapeHtml(o.footer) : '',
    o.settingsUrl
      ? `<a href="${escapeHtml(o.settingsUrl)}" style="color:#6b7280;text-decoration:underline">Email settings</a>`
      : '',
  ]
    .filter(Boolean)
    .join(' &middot; ');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-text-size-adjust:100%">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};color:#111827">
<tr><td style="padding:0 4px 16px"><img src="${escapeHtml(o.logoUrl ?? DEFAULT_LOGO)}" width="28" height="28" alt="${BRAND}" style="vertical-align:middle;border:0;border-radius:6px"> <span style="vertical-align:middle;font-size:16px;font-weight:700;color:#111827;margin-left:6px">${BRAND}</span></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-top:4px solid ${tone.bar};border-radius:12px;padding:32px 32px 28px">
${eyebrow}<h1 style="margin:0 0 12px;font-size:21px;line-height:1.35;font-weight:700;color:#111827">${escapeHtml(o.heading)}</h1>
${o.bodyHtml}${detailsTable(o.details ?? [])}${o.button ? buttonHtml(o.button) : ''}
</td></tr>
<tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:#6b7280;text-align:center">${footer ? `${footer}<br>` : ''}Sent by ${BRAND}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const para = (html: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151">${html}</p>`;

function textVersion(lines: Array<string | null | undefined>): string {
  return lines
    .filter((l): l is string => l !== null && l !== undefined)
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
    .trim();
}

const article = (role: string) => (/^[aeiou]/i.test(role) ? 'an' : 'a');

export function renderInvitationEmail(p: {
  toEmail: string;
  inviterName: string;
  projectName: string;
  inviteLink: string;
  role: string;
}): RenderedEmail {
  const subject = `Invitation to join ${p.projectName}`;
  const intro = `${p.inviterName} has invited you to join "${p.projectName}" as ${article(p.role)} ${p.role}.`;
  const expiry = 'This invitation expires in 7 days.';
  const html = layout({
    heading: subject,
    preheader: intro,
    eyebrow: 'Invitation',
    tone: 'brand',
    bodyHtml:
      para(escapeHtml(intro)) +
      para(escapeHtml('TaskCalendar is where your team plans work, tracks tasks and meets.')),
    details: [
      ['Project', p.projectName],
      ['Role', p.role],
      ['Invited by', p.inviterName],
    ],
    button: { label: 'Accept invitation', url: p.inviteLink },
    footer: `${expiry} If you weren't expecting this, you can ignore it.`,
  });
  const text = textVersion([
    'Hi,',
    '',
    intro,
    '',
    `Accept the invitation here: ${p.inviteLink}`,
    '',
    expiry,
    '',
    `— ${BRAND}`,
  ]);
  return { subject, html, text };
}

export function renderNotificationEmail(p: {
  title: string;
  body: string;
  actionUrl?: string;
  /** Defaults to the title. */
  subject?: string;
  /** Label/value rows shown under the message (e.g. a task's project, due date). */
  details?: Array<[string, string]>;
  actionLabel?: string;
  footer?: string;
  /** Small coloured label above the heading, e.g. "Overdue". */
  eyebrow?: string;
  tone?: EmailTone;
  /** Inbox preview line; defaults to the body. */
  preheader?: string;
  settingsUrl?: string;
}): RenderedEmail {
  const details = (p.details ?? []).filter(([, v]) => v);
  const html = layout({
    heading: p.title,
    preheader: p.preheader ?? p.body,
    eyebrow: p.eyebrow,
    tone: p.tone,
    bodyHtml: p.body ? para(escapeHtml(p.body).replace(/\r?\n/g, '<br>')) : '',
    details,
    button: p.actionUrl ? { label: p.actionLabel || 'Open in TaskCalendar', url: p.actionUrl } : undefined,
    footer: p.footer,
    settingsUrl: p.settingsUrl,
  });
  const text = textVersion([
    p.body,
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    details.length ? '' : null,
    p.actionUrl ? `Open: ${p.actionUrl}` : null,
    p.footer ?? null,
    p.settingsUrl ? `Email settings: ${p.settingsUrl}` : null,
    '',
    `— ${BRAND}`,
  ]);
  return { subject: p.subject || p.title, html, text };
}
