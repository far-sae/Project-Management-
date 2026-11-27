// "Send test" on a sending mailbox (POST /api/email/verify): the part that
// decides what to try and what to tell the person. No mail library and no
// database in here, so every rule can be tested without a mail server.
//
// A mail server answers a wrong setting with a code ("535", "ETIMEDOUT").
// That told a person nothing, and the page showed it as it came. Two of the
// commonest mistakes are also ones nobody should have to find by hand:
//
//   * IONOS keeps mailboxes in two regions. A mailbox of the other region is
//     refused with "wrong password" although the password is right. So when
//     IONOS refuses, the other region's server is tried once, and the one
//     that works is kept.
//   * Port 465 is encrypted from the first byte and 587 only after a word of
//     plain text. Ticked the wrong way round, the connection hangs. So for
//     those two ports the right kind is used whatever was ticked.

export type MailboxSettings = { smtpHost: string; smtpPort: number; smtpSecure: boolean; username: string; imapHost: string | null };

/** One try: connect, sign in and send the test. Throws what the mail library throws. */
export type TrySend = (s: { host: string; port: number; secure: boolean; user: string; pass: string }) => Promise<void>;

/** What was put right along the way and should be saved on the mailbox. */
export type Changed = { smtpHost?: string; imapHost?: string; smtpSecure?: boolean };
export type CheckResult = { ok: true; changed: Changed } | { ok: false; message: string };

export const NO_PASSWORD_MESSAGE = 'No password is saved for this mailbox yet. Open the mailbox, type its password again and save.';

/** The encryption a port needs. For any other port, what the person chose. */
export function secureFor(port: number, chosen: boolean): boolean {
  if (port === 465) return true;
  if (port === 587 || port === 25) return false;
  return chosen;
}

const IONOS_HOST = /^smtp\.ionos\.(com|co\.uk|de|fr|es|it|ca|mx)$/;

/**
 * The IONOS server of the other region (North America: .com; Europe: the
 * rest, which are one and the same service), or null for any host that is not
 * exactly one of IONOS's own. A password is only ever tried on those.
 */
export function ionosOtherRegion(smtpHost: string): string | null {
  const host = String(smtpHost ?? '').trim().toLowerCase();
  if (!IONOS_HOST.test(host)) return null;
  return host === 'smtp.ionos.com' ? 'smtp.ionos.co.uk' : 'smtp.ionos.com';
}

type Fault = { code?: unknown; responseCode?: unknown; message?: unknown };
const codeOf = (err: unknown): string => String((err as Fault | null)?.code ?? '');
const replyOf = (err: unknown): number => Number((err as Fault | null)?.responseCode) || 0;
const wordsOf = (err: unknown): string => String((err as Fault | null)?.message ?? '');

const isRefusedLogin = (err: unknown): boolean => codeOf(err) === 'EAUTH' || replyOf(err) === 535 || replyOf(err) === 534;
const UNREACHABLE = new Set(['ECONNECTION', 'ETIMEDOUT', 'ETIMEOUT', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH']);

function providerName(host: string): 'IONOS' | 'Google' | 'Zoho' | 'Microsoft' | 'The mail server' {
  const h = host.toLowerCase();
  if (h.includes('ionos') || h.includes('1and1')) return 'IONOS';
  if (h.includes('gmail') || h.includes('google')) return 'Google';
  if (h.includes('zoho')) return 'Zoho';
  if (h.includes('office365') || h.includes('outlook')) return 'Microsoft';
  return 'The mail server';
}

const LOGIN_HELP: Record<ReturnType<typeof providerName>, string> = {
  IONOS:
    'Check three things. The username is the whole email address. The password is the password of the mailbox itself ' +
    '(the one you use for IONOS webmail), not the password of your IONOS account. And the mailbox exists: in IONOS, under Email, the address must be listed as a mailbox, not only as a forwarding address.',
  Google: 'Google needs an App Password, not your normal password. Switch on 2-Step Verification, then make one at myaccount.google.com, Security, App passwords.',
  Zoho: 'Zoho needs an app-specific password, not your normal password. Make one in Zoho Accounts, Security, App Passwords, and check that IMAP and SMTP are switched on for the mailbox.',
  Microsoft: 'Microsoft switches sending with a password off for most work accounts. An administrator has to switch on "Authenticated SMTP" for this mailbox first.',
  'The mail server': 'Use the whole email address as the username. Many providers need a separate "app password" here instead of your normal one.',
};

/**
 * What went wrong, as a sentence a person can act on. Whatever the mail
 * server or the mail library said in its own words is never passed on: it can
 * hold an address, a hint of a password, or simply nothing a person can use.
 */
export function explainFailure(err: unknown, host: string, port: number): string {
  const name = providerName(host);
  const reply = replyOf(err);
  const code = codeOf(err);
  const words = wordsOf(err);

  if (isRefusedLogin(err) || /invalid login|authentication (failed|credentials)|username and password not accepted/i.test(words)) {
    return `${name} did not accept this email address and password. ${LOGIN_HELP[name]}`;
  }
  if (code === 'EDNS' || code === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo/i.test(words)) {
    return `There is no mail server with the name ${host}. Check the spelling of the outgoing (SMTP) server.`;
  }
  if (UNREACHABLE.has(code) || /timeout|greeting never received|socket|ECONNRESET|certificate|tls|ssl/i.test(words)) {
    return `${host} could not be reached on port ${port}. Check the name of the outgoing (SMTP) server, and use port 587 or 465: other ports are often closed.`;
  }
  if (reply === 550 || reply === 551 || reply === 553 || reply === 554) {
    return `${name} refused the sender. The "from" address must be the mailbox you signed in with, or an address that belongs to it.`;
  }
  if (reply === 421 || reply === 450 || reply === 451 || reply === 452 || /rate|too many/i.test(words)) {
    return `${name} asked to slow down: too many emails or sign-ins in a short time. Wait a few minutes and try again.`;
  }
  return `The test email could not be sent through ${host}. Check the outgoing (SMTP) server, the port, the username and the password, then try again.`;
}

/**
 * Sends the test, putting right what can be put right. `changed` holds the
 * settings that turned out to be different from what was saved.
 */
export async function checkMailbox(box: MailboxSettings, password: string, send: TrySend): Promise<CheckResult> {
  const secure = secureFor(box.smtpPort, box.smtpSecure);
  const changed: Changed = secure === box.smtpSecure ? {} : { smtpSecure: secure };
  const attempt = (host: string) => send({ host, port: box.smtpPort, secure, user: box.username, pass: password });

  try {
    await attempt(box.smtpHost);
    return { ok: true, changed };
  } catch (first) {
    const other = isRefusedLogin(first) ? ionosOtherRegion(box.smtpHost) : null;
    if (!other) return { ok: false, message: explainFailure(first, box.smtpHost, box.smtpPort) };
    try {
      await attempt(other);
    } catch {
      // Refused in both regions: it really is the address or the password. The first answer is the one to explain.
      return { ok: false, message: explainFailure(first, box.smtpHost, box.smtpPort) };
    }
    changed.smtpHost = other;
    // The inbox server moves with it, when it was IONOS's own for the old region.
    if (String(box.imapHost ?? '').trim().toLowerCase() === box.smtpHost.trim().toLowerCase().replace(/^smtp\./, 'imap.')) changed.imapHost = other.replace(/^smtp\./, 'imap.');
    return { ok: true, changed };
  }
}
