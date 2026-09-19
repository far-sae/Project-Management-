// Nodemailer wrapper. Worker-only — SMTP speaks raw TCP, which a browser
// cannot, so this file never appears in the app bundle.
//
// Ported from the reference project's src/server/mailer.ts. The error
// classification that lived alongside it there is in src/lib/email/smtpErrors.ts
// here instead, because it is pure and the browser wants it too; this file
// keeps only the part that needs a socket.

import nodemailer, { type Transporter } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type Mail from 'nodemailer/lib/mailer';

import { PER_MAILBOX_SLICE } from '@/lib/email/mailboxPool';
import { MAX_JITTER_MS } from '@/lib/email/sendWindow';

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
    // The engine owns every retry. Left unset, the pool requeues a message
    // without limit whenever a connection closes under it — retries the
    // database never hears about, that spend no attempt and appear in no
    // count, running underneath the one place that is supposed to decide how
    // many times a row is tried.
    maxRequeues: 0,
    // These two bound the part of the conversation that happens before
    // anything is offered, which is where an unreachable host shows up.
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    // Socket INACTIVITY, and on a pooled connection that includes the pacing
    // pause between two messages. At 30 seconds — the old value — any jitter
    // longer than that killed the idle socket, so the next message opened a
    // fresh connection and logged in again: one login per message, which is
    // the whole of what pooling is here to avoid. It has to sit above the
    // longest pause an admin can legally configure, which is what
    // MAX_JITTER_MS is. A server that accepts a connection and then goes
    // silent mid-transaction now holds this mailbox for that long, which is
    // the price; the two timeouts above still bound the common case.
    socketTimeout: MAX_JITTER_MS + 60_000,
  });
}

/**
 * The exact bytes a message will be sent as.
 *
 * The engine hands the SAME buffer to SMTP and to the mailbox's Sent folder,
 * which is the whole point of this function existing: sending these exact
 * bytes and appending these exact bytes guarantees the copy in the mailbox is
 * byte-identical to what the recipient received — same Message-ID, same
 * headers, same MIME boundaries. Building it twice would not achieve that.
 * MailComposer draws a fresh Message-ID and fresh boundaries on every compile,
 * so a second build produces a DIFFERENT message that merely looks alike: the
 * customer's Sent folder would hold a message no recipient ever saw, and
 * anything that threads on the Message-ID the recipient is quoting would match
 * nothing in it.
 */
export function buildRaw(mail: Mail.Options): Promise<Buffer> {
  return new MailComposer(mail).compile().build();
}
