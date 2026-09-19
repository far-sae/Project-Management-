// Nodemailer wrapper. Worker-only — SMTP speaks raw TCP, which a browser
// cannot, so this file never appears in the app bundle.
//
// Ported from the reference project's src/server/mailer.ts. The error
// classification that lived alongside it there is in src/lib/email/smtpErrors.ts
// here instead, because it is pure and the browser wants it too; this file
// keeps only the part that needs a socket.

import nodemailer, { type Transporter } from 'nodemailer';

import { PER_MAILBOX_SLICE } from '@/lib/email/mailboxPool';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export function createTransport(cfg: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    // true = implicit TLS (465). false = plain connect then STARTTLS (587),
    // which `requireTLS` makes mandatory rather than opportunistic.
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    // One connection per mailbox per cycle, which is what worker/README.md and
    // the deployment guide both describe. Unpooled, nodemailer opens a fresh
    // TCP, TLS and AUTH cycle for every single message — ten logins per
    // mailbox per cycle, which is itself a throttling and lockout trigger at
    // Google and Zoho, quite apart from the latency.
    pool: true,
    // Exactly one: the engine sends this mailbox's slice strictly in sequence,
    // with a pacing pause between messages, so a second socket would never
    // carry anything and would only double the logins.
    maxConnections: 1,
    // The most rows a single mailbox is ever handed in one pass
    // (selectMailboxes caps every slice at this), so one cycle is one login.
    // Past it nodemailer opens a fresh connection, which is the right
    // behaviour for a provider that caps messages per session.
    maxMessages: PER_MAILBOX_SLICE,
    // Without these a single unresponsive mail server holds the cycle open
    // indefinitely, and the rows it claimed sit in 'sending' the whole time.
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}
