// Known mail providers, and the settings a person should not have to look up.
//
// Pure: no React, no Supabase, no network, no Node built-ins, like the rest of
// src/lib/email.
//
// This is the other direction from smtpErrors.ts and imapErrors.ts, which
// recognise a provider FROM a host in order to explain a failure. Here we
// recognise it from an address, before anything has been tried, and fill the
// host, the port and the TLS mode in — for SMTP and for IMAP, because a
// mailbox whose inbox is not configured silently never detects a reply.
//
// One thing runs through every entry below and is the real reason this module
// earns its place: almost none of these providers accept an account password
// any more. Gmail, Zoho, Yahoo, Outlook.com, iCloud and Fastmail all require
// an app-specific password, and Microsoft 365 mostly refuses password
// authentication outright. Somebody pasting the password they log in with
// will fail verification every time, and the failure arrives as an SMTP code.
// Saying so before they type it is the point.

export type ProviderId =
  | 'google'
  | 'outlook'
  | 'microsoft365'
  | 'zoho'
  | 'yahoo'
  | 'fastmail'
  | 'icloud'
  | 'ionos'
  | 'other';

export interface MailProvider {
  id: ProviderId;
  /** What the picker shows. */
  name: string;
  smtpHost: string;
  smtpPort: number;
  /**
   * TLS on connect (port 465), as opposed to STARTTLS upgrade (587).
   *
   * Both are encrypted; they differ in when. Getting it the wrong way round
   * produces a connection that hangs rather than an error that says so, which
   * is exactly the sort of thing a preset exists to prevent.
   */
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  /** Domains that identify this provider from an address, lower-cased. */
  domains: string[];
  /**
   * What the person must do before this will authenticate, in one or two
   * sentences. Shown in the form BEFORE they press Verify.
   */
  setup: string;
  /**
   * Set when this provider is likely to refuse a password entirely, whatever
   * the person does. Rendered as a warning rather than as advice, because the
   * honest answer is "this may not be possible here".
   */
  warning?: string;
}

/**
 * Every provider the picker offers, in the order it offers them — commonest
 * first rather than alphabetical, because the list is a shortcut and an
 * alphabetical shortcut is not one.
 */
export const MAIL_PROVIDERS: MailProvider[] = [
  {
    id: 'google',
    name: 'Gmail / Google Workspace',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    domains: ['gmail.com', 'googlemail.com'],
    setup:
      'Google needs an App Password, not your account password — and App Passwords only ' +
      'exist once 2-Step Verification is on. Create one at myaccount.google.com → Security → ' +
      '2-Step Verification → App passwords, and paste it here.',
  },
  {
    id: 'outlook',
    name: 'Outlook.com / Hotmail (personal)',
    smtpHost: 'smtp-mail.outlook.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    setup:
      'Create an app password at account.microsoft.com → Security → Advanced security ' +
      'options → App passwords. Two-step verification must be on first.',
  },
  {
    id: 'microsoft365',
    name: 'Microsoft 365 (work or school)',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    // No domains: a Microsoft 365 tenant uses the customer's own domain, so
    // there is nothing to match on. It is chosen from the list, never guessed.
    domains: [],
    setup:
      'A tenant administrator has to enable SMTP AUTH for this specific mailbox, in the ' +
      'Microsoft 365 admin centre under Mail settings, and enable authenticated SMTP.',
    warning:
      'Microsoft disables SMTP AUTH by default for Microsoft 365 tenants and has been ' +
      'retiring password authentication for it, so this may not work at all even with an ' +
      'app password. Where it is blocked, the supported route is OAuth, which this app does ' +
      'not support yet. A personal Outlook.com account is unaffected.',
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    smtpHost: 'smtp.zoho.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    imapSecure: true,
    domains: ['zoho.com', 'zohomail.com'],
    setup:
      'Zoho needs an app password (accounts.zoho.com → Security → App Passwords) AND IMAP ' +
      'access switched on under Mail Settings → Mail Accounts → IMAP Access. Both, or the ' +
      'inbox scan fails while sending works.',
    warning:
      'If your Zoho account is on the EU or another regional data centre, change .com to ' +
      '.eu (or your region) in both hosts above — the regional servers are separate.',
  },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    domains: ['yahoo.com', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com'],
    setup:
      'Generate an app password at login.yahoo.com → Account security → Generate app ' +
      'password. Yahoo has not accepted account passwords for mail clients for years.',
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecure: true,
    domains: ['fastmail.com', 'fastmail.fm'],
    setup:
      'Create an app password at fastmail.com → Settings → Privacy & Security → ' +
      'Integrations → App passwords, scoped to "Mail (IMAP/SMTP)".',
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    domains: ['icloud.com', 'me.com', 'mac.com'],
    setup:
      'Create an app-specific password at account.apple.com → Sign-In and Security → ' +
      'App-Specific Passwords. Two-factor authentication must be on.',
    warning:
      'iCloud only sends from an address that belongs to the account — an alias or a custom ' +
      'domain you have not verified with Apple will be rejected as a forged sender.',
  },
  {
    id: 'ionos',
    name: 'IONOS',
    smtpHost: 'smtp.ionos.co.uk',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'imap.ionos.co.uk',
    imapPort: 993,
    imapSecure: true,
    domains: ['ionos.co.uk', 'ionos.com'],
    setup: 'Use the full email address as the username, with the mailbox password.',
    warning:
      'IONOS hosts per country: if your account is not UK, change .co.uk to your own ' +
      'IONOS domain (.com, .de, .fr) in both hosts above.',
  },
];

/**
 * The provider a form is currently describing, matched on its SMTP host, or
 * `'other'`.
 *
 * Matched on the host rather than remembered as a field, so the picker tells
 * the truth about a mailbox saved before this existed, and about one whose
 * host somebody edited by hand afterwards.
 */
export function providerForHost(smtpHost: string): ProviderId {
  const host = smtpHost.trim().toLowerCase();
  if (host === '') return 'other';
  const found = MAIL_PROVIDERS.find((p) => p.smtpHost.toLowerCase() === host);
  return found ? found.id : 'other';
}

/**
 * The provider suggested by an email address, or null when its domain is not
 * one we know.
 *
 * Null rather than `'other'` because the two mean different things to the
 * caller: "this is a domain we recognise as self-hosted" would be a claim we
 * cannot make, whereas "we have no suggestion" is exactly true. A company on
 * Google Workspace uses its own domain, so most business addresses land here
 * and the person picks from the list — which is why the picker is not merely
 * a fallback for the guess.
 */
export function providerForEmail(address: string): MailProvider | null {
  const at = address.lastIndexOf('@');
  if (at === -1) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  if (domain === '') return null;
  return MAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}

/** Looks a provider up by id. */
export function providerById(id: ProviderId): MailProvider | null {
  return MAIL_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** The host, port and TLS settings a preset fills in, as strings for a form. */
export interface ProviderSettings {
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
}

/**
 * The settings for a provider, ready to merge into form state.
 *
 * IMAP is filled in alongside SMTP deliberately. It is optional — a mailbox
 * with no IMAP host simply is not scanned — but leaving it blank when we know
 * the answer means replies and bounces go undetected for a mailbox that could
 * have had both for free, and nothing on any screen says that is why.
 */
export function settingsFor(id: ProviderId): ProviderSettings | null {
  const provider = providerById(id);
  if (!provider) return null;
  return {
    smtpHost: provider.smtpHost,
    smtpPort: String(provider.smtpPort),
    smtpSecure: provider.smtpSecure,
    imapHost: provider.imapHost,
    imapPort: String(provider.imapPort),
    imapSecure: provider.imapSecure,
  };
}
