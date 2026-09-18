// Ported from the reference project's src/server/mailer.ts. This copy is
// classification-only: no nodemailer import, no transport creation, so it
// stays a pure function of an error value and can run in the worker, in
// Vercel functions and in the browser.

export type SmtpProvider = 'zoho' | 'ionos' | 'google' | 'microsoft' | 'other';
export type SmtpOutcome = 'permanent' | 'hard_bounce' | 'transient';

const responseCodeOf = (err: unknown): number => (err as { responseCode?: number })?.responseCode ?? 0;

/** The pool spans providers, so error advice has to follow the host. */
export function providerOf(host = ''): SmtpProvider {
  const h = host.toLowerCase();
  if (h.includes('zoho')) return 'zoho';
  if (h.includes('ionos') || h.includes('1and1')) return 'ionos';
  if (h.includes('gmail') || h.includes('google')) return 'google';
  if (h.includes('office365') || h.includes('outlook')) return 'microsoft';
  return 'other';
}

/**
 * True when the *recipient* is bad, so the address belongs on the
 * suppression list. Deliberately narrower than "any 5xx": 535 is also a
 * 5xx, but it means our own credentials were rejected — suppressing the
 * recipient for that would blame the wrong party and quietly destroy the
 * list.
 */
function isHardBounce(err: unknown): boolean {
  const code = responseCodeOf(err);
  return code === 550 || code === 551 || code === 553;
}

/**
 * True when retrying cannot help. 5xx is permanent per RFC 5321; 4xx
 * (including IONOS throttling at 421/450/451) is worth another attempt
 * later.
 */
function isPermanent(err: unknown): boolean {
  const code = responseCodeOf(err);
  return code >= 500 && code < 600;
}

/**
 * Classifies an SMTP failure for retry and suppression decisions.
 * Hard-bounce is checked before permanent because 550/551/553 are both —
 * only the hard-bounce path should trigger suppressing the recipient.
 */
export function classifySmtpError(err: unknown): SmtpOutcome {
  if (isHardBounce(err)) return 'hard_bounce';
  if (isPermanent(err)) return 'permanent';
  return 'transient';
}

const LABEL: Record<SmtpProvider, string> = {
  zoho: 'Zoho',
  ionos: 'IONOS',
  google: 'Google',
  microsoft: 'Microsoft',
  other: 'The mail server',
};

/** What to do about a rejected login, which differs sharply by provider. */
const AUTH_HELP: Record<SmtpProvider, string> = {
  zoho:
    'Zoho requires an app-specific password for SMTP — your normal password will not work. ' +
    'Create one at accounts.zoho.eu → Security → App Passwords, and paste that here. ' +
    'Also confirm IMAP/SMTP access is enabled for this mailbox.',
  ionos:
    'Use the full email address as the username. IONOS requires an app password if ' +
    'two-factor authentication is enabled on the account.',
  google:
    'Google needs an App Password, which requires 2-Step Verification to be on. ' +
    'Your normal account password is always rejected for SMTP.',
  microsoft:
    'Microsoft has disabled SMTP basic authentication (SMTP AUTH) on most tenants. An admin must ' +
    're-enable SMTP AUTH for this mailbox, or the account cannot send this way.',
  other:
    'Use the full email address as the username. Many providers also require an ' +
    'app-specific password rather than your normal one.',
};

/**
 * SMTP failures arrive as terse codes. Translate the ones a user can act on,
 * naming the provider actually being contacted — an error blaming the wrong
 * host sends people to the wrong control panel.
 */
export function friendlySmtpError(err: unknown, host?: string): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const code = e?.code ?? '';
  const responseCode = e?.responseCode ?? 0;
  const msg = e?.message ?? String(err);
  const provider = providerOf(host);
  const name = LABEL[provider];

  if (code === 'EAUTH' || responseCode === 535) {
    return `${name} rejected the username or password. ${AUTH_HELP[provider]}`;
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return (
      `Could not reach ${host || 'the SMTP server'}. Check the host and port — ` +
      '465 needs SSL/TLS, 587 needs STARTTLS. Some networks block outbound SMTP entirely.'
    );
  }
  if (responseCode === 550 || responseCode === 551 || responseCode === 553) {
    return (
      `${name} refused the sender address. The From address must be a mailbox that ` +
      'belongs to the account you authenticated with.'
    );
  }
  if (responseCode === 421 || responseCode === 450 || responseCode === 451 || /rate|too many/i.test(msg)) {
    return (
      `${name} is throttling this account — too many messages too quickly. ` +
      'Increase the delay between messages, or lower the daily limit, and try again later.'
    );
  }
  return msg;
}
