import type { ProviderId } from "./settings.js";

/**
 * nodemailer's errors as plain sentences. Raw server text never reaches the
 * user or sr_mailboxes.last_error: the handler stores and returns `message`
 * only, and logs scrubForLog() (password removed, 300 characters).
 *
 * nodemailer overwrites a TLS error's own code with its stage ("ESOCKET",
 * "ETLS"), so certificate problems are recognised by their message. The same
 * goes for a TCP failure on the socket transport.ts opens: a refused or
 * unroutable connection arrives as ESOCKET (or wrapped in ETLS on 465) with
 * "connect ECONNREFUSED ..." in its message, or with the system code on `cause`.
 */
export type SmtpFailureKind = "auth" | "blocked" | "unreachable" | "certificate" | "insecure" | "rejected" | "unknown";
export type SmtpFailure = { kind: SmtpFailureKind; message: string };

export const WRONG_PASSWORD_MESSAGE = "Your email or password wasn't accepted. Check them and try again.";
export const APP_PASSWORD_MESSAGES: Partial<Record<ProviderId, string>> = {
  gmail: "Gmail didn't accept that password. Use a 16-letter app password (Google Account → Security → App passwords), not your normal password.",
  yahoo: "Yahoo didn't accept that password. Use an app password (Yahoo Account Security → Generate app password), not your normal password.",
  outlook: "Microsoft 365 didn't accept the sign-in. Check the password, and ask your Microsoft 365 admin to allow SMTP sending for this mailbox.",
};
export const APP_PASSWORD_NEEDED_MESSAGE = "Your provider needs an app password here, not your normal password. Create one in your email account's security settings.";
export const BLOCKED_MESSAGE = "Your email provider blocked this sign-in. Sign in to your mailbox on the web, check for a security alert, then try again.";
export const OUTLOOK_BLOCKED_MESSAGE = "Microsoft 365 has SMTP sending turned off for this mailbox. Your Microsoft 365 admin must allow SMTP sending for it.";
export const UNREACHABLE_MESSAGE = "We couldn't reach the email server. Check the server name and port, then try again.";
export const CERTIFICATE_MESSAGE = "The email server's security certificate isn't valid, so we didn't send your password.";
export const INSECURE_MESSAGE = "The email server didn't offer a secure connection, so we didn't send your password.";
export const REJECTED_MESSAGE = "Your mailbox refused to send this message. Check the address and try again.";
export const UNKNOWN_MESSAGE = "The email server refused the connection. Check your settings and try again.";

type ErrLike = { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown; cause?: unknown };

const CERTIFICATE = /certificate|self[- ]signed|altnames|unable to (verify|get local issuer)|CERT_/i;
const BLOCKED = /SmtpClientAuthentication is disabled|basic authentication is disabled|web ?browser|WebLoginRequired|5\.7\.14|account (is )?(locked|disabled|suspended)/i;
const APP_PASSWORD = /application-specific password|app password|5\.7\.9/i;
const UNREACHABLE_CODES = ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"];
/** The system's TCP failure codes, as Node writes them into a message ("connect ECONNREFUSED 203.0.113.1:465"). */
const CONNECT_FAILURE = /\b(ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT)\b/;

/**
 * text: everything the error says, the server's reply included. ownText: only
 * what Node and nodemailer wrote (the error's and its cause's message), never the
 * server's reply: a server can put "ECONNREFUSED" in its own text, and that must
 * not make a refusal read as "couldn't reach the server".
 */
function parts(err: unknown): { code: string; causeCode: string; status: number; text: string; ownText: string } {
  const e = (err && typeof err === "object" ? err : {}) as ErrLike;
  const cause = (e.cause && typeof e.cause === "object" ? e.cause : {}) as ErrLike;
  const message = typeof e.message === "string" ? e.message : "";
  const causeMessage = typeof cause.message === "string" ? cause.message : "";
  return {
    code: typeof e.code === "string" ? e.code : "",
    causeCode: typeof cause.code === "string" ? cause.code : "",
    status: typeof e.responseCode === "number" ? e.responseCode : 0,
    text: `${message} ${typeof e.response === "string" ? e.response : ""} ${causeMessage}`,
    ownText: `${message} ${causeMessage}`,
  };
}

export function mapSmtpError(err: unknown, provider: ProviderId): SmtpFailure {
  const { code, causeCode, status, text, ownText } = parts(err);
  if (CERTIFICATE.test(text)) return { kind: "certificate", message: CERTIFICATE_MESSAGE };
  if (code === "EAUTH" || status === 534 || status === 535) {
    if (BLOCKED.test(text)) return { kind: "blocked", message: provider === "outlook" ? OUTLOOK_BLOCKED_MESSAGE : BLOCKED_MESSAGE };
    const hint = APP_PASSWORD_MESSAGES[provider];
    if (APP_PASSWORD.test(text)) return { kind: "auth", message: hint ?? APP_PASSWORD_NEEDED_MESSAGE };
    return { kind: "auth", message: hint ?? WRONG_PASSWORD_MESSAGE };
  }
  // Before ETLS: a TLS start that failed because the TCP connection did is "unreachable", not "insecure".
  if (UNREACHABLE_CODES.includes(code) || UNREACHABLE_CODES.includes(causeCode) || CONNECT_FAILURE.test(ownText)) {
    return { kind: "unreachable", message: UNREACHABLE_MESSAGE };
  }
  if (code === "ETLS") return { kind: "insecure", message: INSECURE_MESSAGE };
  if (code === "EENVELOPE" || code === "EMESSAGE" || (status >= 550 && status <= 554)) return { kind: "rejected", message: REJECTED_MESSAGE };
  return { kind: "unknown", message: UNKNOWN_MESSAGE };
}

/** The sign-in itself failed: the saved settings no longer work, so the mailbox stops counting as verified. */
export function isLoginFailure(kind: SmtpFailureKind): boolean {
  return kind === "auth" || kind === "blocked";
}

const LOG_LIMIT = 300;
/** Shorter base64 fragments are left alone: they would match ordinary words, and hide almost nothing. */
const MIN_FRAGMENT = 4;

const b64 = (bytes: Buffer) => bytes.toString("base64");

/**
 * The base64 characters that depend only on `bytes`, for each of the three
 * positions (mod 3) it can start at inside a longer base64 run: the password
 * inside an AUTH PLAIN token, say, is encoded differently from the password alone.
 */
function base64Cores(bytes: Buffer): string[] {
  return [0, 1, 2].map((lead) => {
    const encoded = b64(Buffer.concat([Buffer.alloc(lead), bytes]));
    return encoded.slice(Math.ceil((lead * 8) / 6), Math.floor(((lead + bytes.length) * 8) / 6));
  });
}

/** Every form the sign-in can take on the wire or in nodemailer's text, longest first. */
function secretForms(secret: string, username: string): string[] {
  const forms = new Set<string>();
  if (secret) {
    const pass = Buffer.from(secret, "utf8");
    forms.add(secret);
    forms.add(b64(pass)); // AUTH LOGIN password line
    for (const core of base64Cores(pass)) if (core.length >= MIN_FRAGMENT) forms.add(core);
    if (username) forms.add(b64(Buffer.from(`\0${username}\0${secret}`, "utf8"))); // AUTH PLAIN token
  }
  if (username) forms.add(b64(Buffer.from(username, "utf8"))); // AUTH LOGIN username line
  return [...forms].filter(Boolean).sort((a, b) => b.length - a.length);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * One server-log line: code, response code and message, on one line, at most
 * 300 characters, with the password removed as typed, as base64 at any
 * alignment, and inside AUTH PLAIN / AUTH LOGIN tokens (base64 of the username
 * too, when given). The only form a mailbox failure may be logged in.
 */
export function scrubForLog(err: unknown, secret: string, username = ""): string {
  const e = (err && typeof err === "object" ? err : {}) as ErrLike;
  const fields = [e.code, e.responseCode, e.message].filter((v) => v !== undefined && v !== null && v !== "");
  let line = fields.length ? fields.map(String).join(" ") : String(err);
  const forms = secretForms(typeof secret === "string" ? secret : "", typeof username === "string" ? username : "");
  if (forms.length) line = line.replace(new RegExp(forms.map(escapeRegExp).join("|"), "g"), "[redacted]");
  return line.replace(/\p{Cc}+/gu, " ").slice(0, LOG_LIMIT);
}
