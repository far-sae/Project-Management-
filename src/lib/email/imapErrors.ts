// Ported from the reference project's src/server/imap.ts `friendlyImapError`.
// This copy is classification-only: no ImapFlow import, no connection
// handling — the worker owns the connection and hands this an error value —
// so it stays a pure function and can run wherever `smtpErrors.ts`, its
// sibling, does.

export type ImapOutcome = 'auth' | 'unreachable' | 'other';

type ImapProvider = 'zoho' | 'ionos' | 'google' | 'other';

function messageOf(err: unknown): string {
  const e = err as { message?: string } | null;
  return e?.message ?? String(err);
}

/** The pool spans providers, so error advice has to follow the host. */
function providerOf(host = ''): ImapProvider {
  const h = host.toLowerCase();
  if (h.includes('zoho')) return 'zoho';
  if (h.includes('ionos') || h.includes('1and1')) return 'ionos';
  if (h.includes('google') || h.includes('gmail')) return 'google';
  return 'other';
}

/**
 * True when the server rejected our login. ImapFlow sets
 * `authenticationFailed` on the error it raises for a bad login; the message
 * check catches the raw `AUTHENTICATIONFAILED` IMAP response text too, for
 * errors that reach this as a plain `Error`.
 */
function isAuthFailure(err: unknown): boolean {
  const e = err as { authenticationFailed?: boolean } | null;
  return Boolean(e?.authenticationFailed) || /auth/i.test(messageOf(err));
}

const UNREACHABLE_CODES = new Set(['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH']);
const UNREACHABLE_MESSAGE = /timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i;

/** True when the mail server was never successfully reached. */
function isUnreachable(err: unknown): boolean {
  const e = err as { code?: string } | null;
  if (e?.code && UNREACHABLE_CODES.has(e.code)) return true;
  return UNREACHABLE_MESSAGE.test(messageOf(err));
}

/**
 * Classifies an IMAP failure for the worker: pause the mailbox (`auth`),
 * retry later (`unreachable`), or just log it (`other`). Auth is checked
 * first — an auth failure can otherwise also look like a generic message —
 * so it never gets misfiled as `other`.
 */
export function classifyImapError(err: unknown): ImapOutcome {
  if (isAuthFailure(err)) return 'auth';
  if (isUnreachable(err)) return 'unreachable';
  return 'other';
}

const LABEL: Record<ImapProvider, string> = {
  zoho: 'Zoho',
  ionos: 'IONOS',
  google: 'Google',
  other: 'The IMAP server',
};

const GENERIC_AUTH_HELP = 'Use the full email address as the username, and an app password if two-factor is on.';

/** What to do about a rejected IMAP login, which differs sharply by provider. */
const AUTH_HELP: Record<ImapProvider, string> = {
  zoho: 'Zoho needs an app password and IMAP access enabled for the mailbox.',
  ionos: GENERIC_AUTH_HELP,
  google: GENERIC_AUTH_HELP,
  other: GENERIC_AUTH_HELP,
};

/**
 * IMAP failures arrive as terse codes. Translate the ones a user can act on,
 * naming the provider actually being contacted — an error blaming the wrong
 * host sends people to the wrong control panel.
 */
export function friendlyImapError(err: unknown, host?: string): string {
  const provider = providerOf(host);
  const name = LABEL[provider];

  if (isAuthFailure(err)) {
    return `${name} rejected the IMAP login. ${AUTH_HELP[provider]}`;
  }
  if (isUnreachable(err)) {
    return (
      `Could not reach ${host || 'the IMAP server'} — port 993 with SSL/TLS is standard. ` +
      'Some networks block IMAP.'
    );
  }
  return messageOf(err);
}
