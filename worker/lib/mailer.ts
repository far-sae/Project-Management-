// Nodemailer wrapper. Worker-only — SMTP speaks raw TCP, which a browser
// cannot, so this file never appears in the app bundle.
//
// Ported from the reference project's src/server/mailer.ts. The error
// classification that lived alongside it there is in src/lib/email/smtpErrors.ts
// here instead, because it is pure and the browser wants it too; this file
// keeps only the part that needs a socket.

import nodemailer, { type Transporter } from 'nodemailer';

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
    // Without these a single unresponsive mail server holds the cycle open
    // indefinitely, and the rows it claimed sit in 'sending' the whole time.
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}
