/**
 * The own-mailbox settings: provider presets, the rules a save must pass, and
 * when a saved password may be kept. Pure (no Node or browser-only imports):
 * used by api/_signroom/emailConnection.ts, and safe for the settings screen to
 * import directly, so there is one copy of the presets and messages.
 */
export const PROVIDER_IDS = ["gmail", "outlook", "ionos", "yahoo", "zoho", "godaddy", "hostinger", "custom"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type Security = "tls" | "starttls";
export type MailboxPort = 465 | 587 | 2525;
export const PORTS: readonly MailboxPort[] = [465, 587, 2525];
export type Connection = { host: string; port: MailboxPort; security: Security };

/** The spec's preset table. A save for a preset always uses these, whatever the request says. */
export const PRESETS: Record<Exclude<ProviderId, "custom">, Connection> = {
  gmail: { host: "smtp.gmail.com", port: 465, security: "tls" },
  outlook: { host: "smtp.office365.com", port: 587, security: "starttls" },
  ionos: { host: "smtp.ionos.co.uk", port: 465, security: "tls" },
  yahoo: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
  zoho: { host: "smtp.zoho.eu", port: 465, security: "tls" },
  godaddy: { host: "smtpout.secureserver.net", port: 465, security: "tls" },
  hostinger: { host: "smtp.hostinger.com", port: 465, security: "tls" },
};

/**
 * One plain address (no lists, no display names). Matches the migrations' CHECKs.
 */
export const EMAIL_PATTERN = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
/** A lower-case DNS name with a letters-only top-level label: no IP literals, no single-label names. */
export const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Names that only mean something on a private network. */
export const RESERVED_SUFFIX = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid|example|arpa)$/;

/** Every refusal of a save, word for word the same in the browser's form. */
export const MAILBOX_MESSAGES = {
  provider: "Choose your email provider.",
  email: "Enter a valid email address.",
  username: "Enter your username (254 characters at most).",
  password: "Enter your password.",
  passwordLong: "That password is too long.",
  passwordLineBreak: "A password can't contain line breaks.",
  host: "Enter your provider's SMTP server, like smtp.example.com.",
  port: "Choose port 465, 587 or 2525.",
  security: "Choose SSL/TLS or STARTTLS.",
} as const;

/** A request the user can fix: answered 400 with its message. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export type MailboxConfig = Connection & { provider: ProviderId; username: string; fromEmail: string };
/** password null: none was typed, so keep the saved one (if passwordReusable allows it). */
export type SaveInput = MailboxConfig & { password: string | null };

export function validHostname(host: string): boolean {
  return host.length <= 253 && HOSTNAME_PATTERN.test(host) && !RESERVED_SUFFIX.test(host);
}

/**
 * A typed server name as it is checked and stored: trimmed, lower-case, without
 * the trailing dot(s) of a fully-qualified name (sr_mailboxes.host's CHECK is
 * ^[a-z0-9.-]+$). A loop, not /\.+$/, so a long run of dots cannot backtrack.
 */
function normaliseHost(raw: unknown): string {
  const host = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  let end = host.length;
  while (end > 0 && host[end - 1] === ".") end--;
  return host.slice(0, end);
}

const isProvider = (v: unknown): v is ProviderId => typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);

/** How Google and Yahoo display an app password; the spaces are not part of it. */
const APP_PASSWORD_GROUPS = /^[a-z]{4}( [a-z]{4}){3}$/i;

function readPassword(raw: unknown, provider: ProviderId): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new InputError(MAILBOX_MESSAGES.password);
  if (/[\r\n\0]/.test(raw)) throw new InputError(MAILBOX_MESSAGES.passwordLineBreak);
  if (raw.length > 256) throw new InputError(MAILBOX_MESSAGES.passwordLong);
  if ((provider === "gmail" || provider === "yahoo") && APP_PASSWORD_GROUPS.test(raw.trim())) return raw.replace(/\s+/g, "");
  return raw;
}

/** The save request as settings to store. Presets are forced; custom servers must look public. Throws InputError. */
export function parseSaveInput(body: unknown): SaveInput {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  if (!isProvider(b.provider)) throw new InputError(MAILBOX_MESSAGES.provider);
  const provider = b.provider;
  const fromEmail = typeof b.email === "string" ? b.email.trim() : "";
  // \p{Cc}: control characters EMAIL_PATTERN's \s lets through (BEL, ESC, DEL, NEL) never reach the From header.
  if (fromEmail.length > 254 || !EMAIL_PATTERN.test(fromEmail) || /\p{Cc}/u.test(fromEmail)) throw new InputError(MAILBOX_MESSAGES.email);
  const typedUser = typeof b.username === "string" ? b.username.trim() : "";
  const username = typedUser || fromEmail;
  if (username.length > 254 || /\p{Cc}/u.test(username)) throw new InputError(MAILBOX_MESSAGES.username);

  let connection: Connection;
  if (provider === "custom") {
    const host = normaliseHost(b.host);
    if (!validHostname(host)) throw new InputError(MAILBOX_MESSAGES.host);
    const port = Number(b.port) as MailboxPort;
    if (!PORTS.includes(port)) throw new InputError(MAILBOX_MESSAGES.port);
    if (b.security !== "tls" && b.security !== "starttls") throw new InputError(MAILBOX_MESSAGES.security);
    connection = { host, port, security: b.security };
  } else {
    connection = { ...PRESETS[provider] };
  }
  return { provider, ...connection, username, fromEmail, password: readPassword(b.password, provider) };
}

/**
 * A save without a password may keep the stored one only if it would still go
 * to the same server as the same user: otherwise a stolen session could send
 * the saved password to a server of its choosing.
 */
export function passwordReusable(next: Connection & { username: string }, stored: Connection & { username: string }): boolean {
  return next.host === stored.host && next.port === stored.port && next.security === stored.security && next.username === stored.username;
}
