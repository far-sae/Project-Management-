/**
 * The rules behind "send from your own mailbox": the provider presets, the
 * checks a save must pass (word for word the server's sentences), the request
 * bodies, and which state and step the panel shows. Pure: no React, no network.
 */

// ---------------------------------------------------------------- what the server sends

export type SignInProvider = 'google' | 'microsoft';
/** How a workspace connects its mailbox: with a password, or by signing in at Google or Microsoft. */
export type ConnectionWay = 'smtp' | SignInProvider;
export type Security = 'tls' | 'starttls';
export type MailboxPort = 465 | 587 | 2525;

/** `GET email-connection`. Passwords, client secrets and tokens are never part of it. */
export interface EmailConnectionView {
  /** False until something has been saved. */
  configured: boolean;
  provider: ConnectionWay;
  /** "authenticated": signed in at the provider, the test code not yet confirmed. */
  status: 'none' | 'configured' | 'authenticated' | 'verified';
  /** "live": the workspace's own mailbox sends. "platform": TaskCalendar sends. */
  mode: 'live' | 'platform';
  email?: string;
  // Password connection only.
  host?: string;
  port?: number;
  security?: string;
  username?: string;
  /** The provider preset the mailbox was saved with ("gmail", "custom"…). */
  preset?: string;
  // Google or Microsoft sign-in only.
  clientId?: string;
  tenant?: string;
  hasClientSecret?: boolean;
  lastTestAt?: string;
  // Both.
  verifiedAt?: string;
  lastError?: string;
  /** The redirect address to register with Google or Microsoft. Empty when the site's address is not a known one. */
  callbackUri?: string;
  /** A password connection is stored behind the Google or Microsoft one. */
  smtpKept?: boolean;
  /** …and it is verified, so it can send. */
  smtpKeptVerified?: boolean;
  /** False while the server has no key to keep a mailbox's password or sign-in with (SIGNROOM_MAIL_KEY). */
  available?: boolean;
}

/** Shown to an owner while the server cannot keep a mailbox yet. It names the setting, never a value. */
export const NOT_SET_UP_SENTENCE =
  "Sending from your own mailbox is not set up yet: SIGNROOM_MAIL_KEY is missing in Vercel's environment variables. Until it is added, TaskCalendar keeps sending your emails.";

/** `POST email-connection/save`. For a password connection the server also signs in once to check it. */
export interface SaveReply { verified: boolean; verifiedAt?: string; error?: string; view?: EmailConnectionView }
/** `POST email-connection/verify`. */
export interface VerifyReply { verified: boolean; verifiedAt?: string; error?: string }
/** `POST email-connection/test`. */
export interface TestReply { ok: boolean; message?: string }
/** `POST email-connection/authorize`. */
export interface AuthorizeReply { url: string }
/** `POST email-connection/disconnect`. */
export interface DisconnectReply { ok: boolean }

export const PROVIDER_NAME: Record<SignInProvider, string> = { google: 'Google', microsoft: 'Microsoft' };

export const isSignIn = (way: unknown): way is SignInProvider => way === 'google' || way === 'microsoft';

// ---------------------------------------------------------------- the three ways

export const WAYS: ReadonlyArray<{ id: ConnectionWay; title: string; line: string }> = [
  {
    id: 'smtp',
    title: 'Email password',
    line: 'Works with most mailboxes. You enter your email address and its password or app password.',
  },
  {
    id: 'google',
    title: 'Google sign-in',
    line: 'For Gmail and Google Workspace. You sign in at Google, so no mailbox password is stored here.',
  },
  {
    id: 'microsoft',
    title: 'Microsoft 365 sign-in',
    line: 'For Outlook and Microsoft 365 work accounts. You sign in at Microsoft.',
  },
];

// ---------------------------------------------------------------- password connection: presets

export type SmtpProviderId = 'gmail' | 'outlook' | 'ionos' | 'yahoo' | 'zoho' | 'godaddy' | 'hostinger' | 'custom';
export interface Connection { host: string; port: MailboxPort; security: Security }

export const PORTS: readonly MailboxPort[] = [465, 587, 2525];

/** A save for a named provider always uses these, whatever the form holds. */
export const PRESETS: Record<Exclude<SmtpProviderId, 'custom'>, Connection> = {
  gmail: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
  outlook: { host: 'smtp.office365.com', port: 587, security: 'starttls' },
  ionos: { host: 'smtp.ionos.co.uk', port: 465, security: 'tls' },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, security: 'tls' },
  zoho: { host: 'smtp.zoho.eu', port: 465, security: 'tls' },
  godaddy: { host: 'smtpout.secureserver.net', port: 465, security: 'tls' },
  hostinger: { host: 'smtp.hostinger.com', port: 465, security: 'tls' },
};

export const SMTP_PROVIDERS: ReadonlyArray<{ id: SmtpProviderId; label: string }> = [
  { id: 'gmail', label: 'Gmail or Google Workspace' },
  { id: 'outlook', label: 'Outlook or Microsoft 365' },
  { id: 'ionos', label: 'IONOS' },
  { id: 'yahoo', label: 'Yahoo Mail' },
  { id: 'zoho', label: 'Zoho Mail' },
  { id: 'godaddy', label: 'GoDaddy' },
  { id: 'hostinger', label: 'Hostinger' },
  { id: 'custom', label: 'Another provider' },
];

export const SECURITY_LABEL: Record<Security, string> = { tls: 'SSL/TLS', starttls: 'STARTTLS' };

const isSmtpProvider = (v: unknown): v is SmtpProviderId => SMTP_PROVIDERS.some((p) => p.id === v);
const isPort = (v: unknown): v is MailboxPort => PORTS.includes(v as MailboxPort);
const isSecurity = (v: unknown): v is Security => v === 'tls' || v === 'starttls';

/** The usual security for a port: 465 is encrypted from the start, the others upgrade. */
export const securityForPort = (port: MailboxPort): Security => (port === 465 ? 'tls' : 'starttls');

// ---------------------------------------------------------------- sentences

/** Every refusal of a save, in the server's own words. */
export const MESSAGES = {
  provider: 'Choose your email provider.',
  email: 'Enter a valid email address.',
  username: 'Enter your username (254 characters at most).',
  password: 'Enter your password.',
  passwordLong: 'That password is too long.',
  passwordLineBreak: "A password can't contain line breaks.",
  host: "Enter your provider's SMTP server, like smtp.example.com.",
  port: 'Choose port 465, 587 or 2525.',
  security: 'Choose SSL/TLS or STARTTLS.',
  clientId: 'Enter the client ID from your provider.',
  tenant: 'Enter a valid Microsoft tenant ID or domain.',
  secretLong: 'That client secret is too long.',
} as const;

export const NOT_CHECKED_MESSAGE = 'The mailbox could not be checked.';
export const SIGN_IN_PAGE_MESSAGE = 'The sign-in page could not be opened. Please try again.';
export const ARRIVED_MESSAGE = 'You are signed in. One step left: send a test email and enter the code from it.';
export const ARRIVAL_FAILED_MESSAGE =
  'The sign-in was not completed. It may have expired or been cancelled, or you signed in with a different address '
  + 'than the one saved here. Check the app details and try again.';

// ---------------------------------------------------------------- password connection: the form

export interface SmtpForm {
  /** Empty until a provider is picked. */
  provider: SmtpProviderId | '';
  email: string;
  host: string;
  port: MailboxPort;
  security: Security;
  /** Empty means "sign in with the email address". */
  username: string;
  password: string;
}

/** One plain address: no lists, no display names. */
const EMAIL_PATTERN = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
/** A lower-case DNS name with a letters-only last label: no IP addresses, no single-label names. */
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Names that only mean something on a private network. */
const RESERVED_SUFFIX = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid|example|arpa)$/;
const CONTROL = /\p{Cc}/u;

const validEmail = (email: string) => email.length <= 254 && EMAIL_PATTERN.test(email) && !CONTROL.test(email);

/** A typed server name as the server stores it: trimmed, lower-case, without trailing dots. */
function tidyHost(raw: string): string {
  const host = raw.trim().toLowerCase();
  let end = host.length;
  while (end > 0 && host[end - 1] === '.') end--;
  return host.slice(0, end);
}

/** The form as first shown: what is saved, and never a password. */
export function smtpFormOf(view: EmailConnectionView): SmtpForm {
  const email = view.configured ? view.email ?? '' : '';
  if (!view.configured || view.provider !== 'smtp') {
    return { provider: '', email, host: '', port: 587, security: 'starttls', username: '', password: '' };
  }
  const port = isPort(view.port) ? view.port : 587;
  return {
    provider: isSmtpProvider(view.preset) ? view.preset : 'custom',
    email,
    host: view.host ?? '',
    port,
    security: isSecurity(view.security) ? view.security : securityForPort(port),
    username: view.username && view.username !== email ? view.username : '',
    password: '',
  };
}

/** Where the form's mailbox is reached: the preset for a named provider, else what was typed. */
export function connectionOf(form: SmtpForm): Connection {
  if (form.provider && form.provider !== 'custom') return { ...PRESETS[form.provider] };
  return { host: tidyHost(form.host), port: form.port, security: form.security };
}

const signInName = (form: SmtpForm) => form.username.trim() || form.email.trim();

/**
 * Whether leaving the password empty keeps the saved one. The server only
 * reuses it for the same server and the same username, so a saved password can
 * never be sent somewhere else.
 */
export function keepsPassword(form: SmtpForm, view: EmailConnectionView): boolean {
  if (!view.configured || view.provider !== 'smtp') return false;
  const next = connectionOf(form);
  return next.host === view.host && next.port === view.port && next.security === view.security
    && signInName(form) === (view.username || view.email || '');
}

/** What stops the form from being saved, as one sentence, or null. Checked in the server's order. */
export function smtpProblem(form: SmtpForm, view: EmailConnectionView): string | null {
  if (!form.provider) return MESSAGES.provider;
  if (!validEmail(form.email.trim())) return MESSAGES.email;
  const username = signInName(form);
  if (username.length > 254 || CONTROL.test(username)) return MESSAGES.username;
  if (form.provider === 'custom') {
    const host = tidyHost(form.host);
    if (host.length > 253 || !HOSTNAME_PATTERN.test(host) || RESERVED_SUFFIX.test(host)) return MESSAGES.host;
    if (!isPort(form.port)) return MESSAGES.port;
    if (!isSecurity(form.security)) return MESSAGES.security;
  }
  if (/[\r\n\0]/.test(form.password)) return MESSAGES.passwordLineBreak;
  if (form.password.length > 256) return MESSAGES.passwordLong;
  if (!form.password && !keepsPassword(form, view)) return MESSAGES.password;
  return null;
}

/** `POST email-connection/save` for a password connection. An empty password keeps the saved one. */
export function smtpBody(form: SmtpForm) {
  return {
    provider: form.provider,
    email: form.email.trim(),
    ...connectionOf(form),
    username: form.username.trim(),
    password: form.password,
  };
}

/** Whether the form no longer matches the saved password connection (so checking it would check something else). */
export function smtpDirty(form: SmtpForm, view: EmailConnectionView): boolean {
  if (!view.configured || view.provider !== 'smtp') return false;
  return form.password !== '' || form.email.trim() !== (view.email ?? '') || !keepsPassword(form, view);
}

// ---------------------------------------------------------------- Google or Microsoft sign-in: the app details

export interface AppForm {
  provider: SignInProvider;
  email: string;
  clientId: string;
  clientSecret: string;
  /** Microsoft only. */
  tenant: string;
}

const DEFAULT_TENANT = 'organizations';
const TENANT_PATTERN = /^[a-zA-Z0-9.-]+$/;

const tenantOf = (form: AppForm) => (form.provider === 'microsoft' ? form.tenant.trim() || DEFAULT_TENANT : '');

function validTenant(tenant: string): boolean {
  return tenant.length <= 100 && TENANT_PATTERN.test(tenant)
    && !tenant.includes('..') && !tenant.startsWith('.') && !tenant.endsWith('.');
}

/** The form as first shown: the saved app when it is this provider's, and never a secret. */
export function appFormOf(view: EmailConnectionView, provider: SignInProvider): AppForm {
  const same = view.configured && view.provider === provider;
  return {
    provider,
    email: view.configured ? view.email ?? '' : '',
    clientId: same ? view.clientId ?? '' : '',
    clientSecret: '',
    tenant: (same && view.tenant) || DEFAULT_TENANT,
  };
}

export function appProblem(form: AppForm): string | null {
  if (!validEmail(form.email.trim())) return MESSAGES.email;
  if (form.clientSecret.length > 4096) return MESSAGES.secretLong;
  if (form.provider === 'microsoft' && !validTenant(tenantOf(form))) return MESSAGES.tenant;
  if (!form.clientId.trim()) return MESSAGES.clientId;
  return null;
}

/** `POST email-connection/save` for Google or Microsoft. An empty client secret keeps the saved one. */
export function appBody(form: AppForm) {
  return {
    provider: form.provider,
    email: form.email.trim(),
    clientId: form.clientId.trim(),
    clientSecret: form.clientSecret,
    tenant: tenantOf(form),
  };
}

/** Whether leaving the client secret empty keeps the saved one: only for the very same app. */
export function keepsClientSecret(form: AppForm, view: EmailConnectionView): boolean {
  return !!view.configured && view.provider === form.provider && !!view.hasClientSecret
    && form.email.trim() === (view.email ?? '') && form.clientId.trim() === (view.clientId ?? '')
    && (form.provider !== 'microsoft' || tenantOf(form) === (view.tenant || DEFAULT_TENANT));
}

/** The code from the test email: six digits. */
export const cleanCode = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6);
export const isCode = (code: string): boolean => /^\d{6}$/.test(code);

// ---------------------------------------------------------------- the state, in one glance

export type ConnectionState = 'platform' | 'live' | 'pending' | 'reconnect';

export interface ConnectionSummary {
  state: ConnectionState;
  /** Who emails come from now: "TaskCalendar" or the connected address. */
  sender: string;
  pill: { tone: 'success' | 'warning' | 'neutral'; label: string };
  detail: string;
}

const WAY_PHRASE: Record<ConnectionWay, string> = {
  smtp: 'a password',
  google: 'Google sign-in',
  microsoft: 'Microsoft 365 sign-in',
};

/**
 * A sign-in that was verified and has since lapsed. The server shows it as
 * "configured" that still carries the date it was verified.
 */
export function needsReconnect(view: EmailConnectionView): boolean {
  if (!view.configured || !isSignIn(view.provider)) return false;
  return (view.status as string) === 'reconnect' || (view.status === 'configured' && !!view.verifiedAt);
}

export function summaryOf(view: EmailConnectionView): ConnectionSummary {
  const email = view.email ?? '';
  if (!view.configured) {
    return {
      state: 'platform',
      sender: 'TaskCalendar',
      pill: { tone: 'neutral', label: 'Default' },
      detail: "TaskCalendar sends your agreement and invoice emails on your company's behalf. Replies go to your reply-to address.",
    };
  }
  if (view.status === 'verified') {
    return {
      state: 'live',
      sender: email,
      pill: { tone: 'success', label: 'Verified' },
      detail: `Agreement and invoice emails are sent from this address, connected with ${WAY_PHRASE[view.provider]}.`,
    };
  }
  if (needsReconnect(view)) {
    return {
      state: 'reconnect',
      sender: email,
      pill: { tone: 'warning', label: 'Reconnect needed' },
      detail: `Sign in with ${PROVIDER_NAME[view.provider as SignInProvider]} again. Until you do, emails cannot be sent from this address.`,
    };
  }
  const detail = !isSignIn(view.provider)
    ? `${email} is saved but not verified yet.`
    : view.status === 'authenticated'
      ? `${email} is signed in. Send a test email and enter its code to finish.`
      : `${email} is saved. Sign in with ${PROVIDER_NAME[view.provider]} to continue.`;
  return {
    state: 'pending',
    sender: view.smtpKept && view.smtpKeptVerified ? 'Your mailbox' : 'TaskCalendar',
    pill: { tone: 'warning', label: 'Not verified' },
    detail,
  };
}

/** What happens to the password connection stored behind a Google or Microsoft one, or null when there is none. */
export function keptMailboxSentence(view: EmailConnectionView): string | null {
  if (!view.configured || !isSignIn(view.provider) || !view.smtpKept) return null;
  const holdsRoute = view.status === 'verified' || !!view.verifiedAt;
  if (holdsRoute) {
    return view.smtpKeptVerified
      ? 'The mailbox you connected with a password is kept, and is used again if you disconnect this sign-in.'
      : 'The mailbox you connected with a password is kept but not verified, so it is not used if you disconnect this sign-in.';
  }
  return view.smtpKeptVerified
    ? 'Until this sign-in is verified, emails keep going through the mailbox you connected with a password.'
    : 'The mailbox you connected with a password is kept but not verified, so emails are sent by TaskCalendar until a connection is verified.';
}

/** When the connection was last checked or tested, as the server's timestamp, or null. */
export function lastCheckOf(view: EmailConnectionView): string | null {
  const times = [view.verifiedAt, view.lastTestAt].filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)));
  if (times.length === 0) return null;
  return times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

/** A timestamp as a short local date and time. */
export function whenText(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------------------------------------------------------- one step at a time

export type Stage = 'choose' | 'smtp' | 'app' | 'signin' | 'test' | 'code' | 'done';
/** What the owner asked to change: pick another way, or edit one way's details. Null follows the saved state. */
export type Editing = 'choose' | ConnectionWay | null;

export function stageOf(view: EmailConnectionView, editing: Editing, codeSent: boolean): Stage {
  if (editing === 'choose') return 'choose';
  if (editing) return editing === 'smtp' ? 'smtp' : 'app';
  if (!view.configured) return 'choose';
  if (view.status === 'verified') return 'done';
  if (!isSignIn(view.provider)) return 'smtp';
  if (view.status === 'authenticated') return codeSent ? 'code' : 'test';
  return 'signin';
}

/** "Step 3 of 5". The total is unknown until a way is chosen. */
export function stepOf(stage: Stage, way: ConnectionWay | null): { n: number; of: number | null } {
  if (stage === 'choose' || !way) return { n: 1, of: null };
  if (way === 'smtp') return { n: 2, of: 2 };
  const order: Stage[] = ['choose', 'app', 'signin', 'test', 'code'];
  return { n: Math.max(order.indexOf(stage), 1) + 1, of: 5 };
}

// ---------------------------------------------------------------- disconnecting

const keptOf = (view: EmailConnectionView): 'verified' | 'unverified' | null =>
  view.configured && isSignIn(view.provider) && view.smtpKept ? (view.smtpKeptVerified ? 'verified' : 'unverified') : null;

export function disconnectQuestion(view: EmailConnectionView): { title: string; description: string; confirmLabel: string } {
  const kept = keptOf(view);
  const after = kept === 'verified'
    ? 'Emails will go through the mailbox you connected with a password again.'
    : 'Agreement and invoice emails will be sent by TaskCalendar again.';
  const removed = isSignIn(view.provider)
    ? `The saved ${PROVIDER_NAME[view.provider]} sign-in and app details are deleted.`
    : 'The saved mailbox password is deleted.';
  return {
    title: view.email ? `Disconnect ${view.email}?` : 'Disconnect this mailbox?',
    description: `${after} ${removed}`,
    confirmLabel: 'Disconnect',
  };
}

/** What to say once the connection in `view` has been disconnected. */
export function disconnectedSentence(view: EmailConnectionView): string {
  const kept = keptOf(view);
  if (kept === 'verified') return 'Sign-in removed. Emails go through the mailbox you connected with a password again.';
  if (kept === 'unverified') {
    return 'Sign-in removed. Emails are sent by TaskCalendar until the mailbox you connected with a password is verified.';
  }
  return 'Mailbox disconnected. Emails are sent by TaskCalendar again, with your reply-to address.';
}

// ---------------------------------------------------------------- coming back from the provider

/** `?emailConnection=` as the provider's redirect leaves it. */
export const arrivalOf = (value: string | null): 'connected' | 'error' | null =>
  value === 'connected' || value === 'error' ? value : null;

/** The provider's sign-in address, only when it is a secure web address. */
export function safeSignInUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- refusals

/** The server's own sentence for a failed call, or a plain one when it sent none. */
export const sentenceOf = (error: unknown, fallback = 'Something went wrong. Please try again.'): string =>
  (error instanceof Error && error.message ? error.message : fallback);

/** The HTTP status a failed call carries, or null. */
export function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}
