import { connect, isIP, type Socket } from "node:net";
import nodemailer, { type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { MailboxPort, Security } from "./settings.js";
import { isPublicAddress } from "./ssrf.js";
import { siteOrigin } from "../host/admin.js";

/**
 * The SMTP connection for one mailbox, over nodemailer. It goes to the address
 * ssrf.ts resolved and checked (`address`), never to a fresh DNS answer, while
 * TLS (implicit on 465, required STARTTLS on 587 and 2525) verifies the
 * certificate against the server's name (`host`). Logging is off (nodemailer's
 * debug output would include the AUTH exchange) and attachments can never be
 * read from a file path or URL.
 *
 * This file opens the TCP socket itself and hands it to nodemailer (its
 * getSocket hook), because nodemailer's close() does not close the connection
 * of a verify or send in progress: the deadline and close() destroy the socket,
 * so a send reported as failed cannot still be delivered, nor a verify still sign in.
 */
/**
 * The name this server gives in EHLO: the site's own host (PUBLIC_SITE_URL, or
 * Vercel's production domain), without a leading "www.". Undefined when
 * neither is known, and nodemailer then uses the machine's own name.
 */
export function ehloName(): string | undefined {
  const origin = siteOrigin();
  if (!origin) return undefined;
  const host = new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
  return host.includes(".") ? host : undefined;
}
export const CONNECTION_TIMEOUT_MS = 8_000;
export const GREETING_TIMEOUT_MS = 8_000;
export const SOCKET_TIMEOUT_MS = 15_000;
/**
 * The whole verify or send, after ssrf.ts's 3 s DNS_TIMEOUT_MS at most.
 */
export const DEADLINE_MS = 18_000;

export type MailboxConnection = { host: string; address: string; port: MailboxPort; security: Security; username: string; password: string };
export type OutgoingMail = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: "application/pdf" }[];
};
export type Transport = { verify(): Promise<void>; send(mail: OutgoingMail): Promise<void>; close(): void };
export type TransportFactory = (c: MailboxConnection) => Transport;

type SMTPTransportOptions = SMTPTransport.Options;

/** The part of nodemailer's transporter this file uses; tests pass a fake. */
export type Mailer = { verify(): Promise<unknown>; sendMail(message: SendMailOptions): Promise<unknown>; close(): void };
export type CreateMailer = (options: SMTPTransportOptions) => Mailer;

export function transportOptions(c: MailboxConnection): SMTPTransportOptions {
  const name = ehloName();
  return {
    host: c.address,
    port: c.port,
    secure: c.security === "tls",
    requireTLS: c.security === "starttls",
    servername: c.host,
    ...(name ? { name } : {}),
    auth: { user: c.username, pass: c.password },
    tls: { servername: c.host, rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    logger: false,
    debug: false,
    transactionLog: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** The deadline passed: errors.ts reads the code as "couldn't reach the server". */
export class DeadlineError extends Error {
  code = "ETIMEDOUT";
  constructor() {
    super("The email server took too long.");
    this.name = "DeadlineError";
  }
}

/** Opens the TCP connection to the checked address; tests point it at a local server. */
export type OpenSocket = (address: string, port: number) => Socket;
const openTcp: OpenSocket = (address, port) => connect({ host: address, port });

/** The transport was closed, or its deadline passed: it opens no more connections. */
const finished = () => Object.assign(new Error("The connection to the email server was closed."), { code: "ECONNECTION" });

/** Rejects with DeadlineError after `ms`, calling `onLate` first so the connection is torn down at once. */
function withDeadline<T>(work: Promise<T>, ms: number, onLate: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onLate();
      reject(new DeadlineError());
    }, ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * A Transport is finished once it is closed or its deadline passes, so use one
 * per verify or send. Throws if `address` is not a public IP literal: nodemailer
 * must never resolve a name itself (ssrf.ts does, first).
 */
export function makeTransportFactory(
  create: CreateMailer = (options) => nodemailer.createTransport(options),
  deadlineMs = DEADLINE_MS,
  openSocket: OpenSocket = openTcp,
): TransportFactory {
  return (c) => {
    if (isIP(c.address) === 0 || !isPublicAddress(c.address)) throw new Error("The email server's address was not checked as public.");
    const sockets = new Set<Socket>();
    let ended = false;
    const end = () => {
      ended = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    };
    const getSocket: SMTPTransportOptions["getSocket"] = (_options, callback) => {
      if (ended) return callback(finished());
      const socket = openSocket(c.address, c.port);
      sockets.add(socket);
      // nodemailer reports the connection's errors itself; this only stops a late one (after teardown) crashing the function.
      socket.on("error", () => undefined);
      socket.once("close", () => sockets.delete(socket));
      // Already connecting: nodemailer runs TLS over it (implicit on 465, after STARTTLS otherwise) with options.tls.
      callback(null, { connection: socket });
    };
    const mailer = create({ ...transportOptions(c), getSocket });
    const run = async (work: () => Promise<unknown>) => {
      if (ended) throw finished();
      await withDeadline(work(), deadlineMs, end);
    };
    return {
      verify: () => run(() => mailer.verify()),
      send: (m) => run(() => mailer.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments })),
      close: () => {
        end();
        try {
          mailer.close();
        } catch {
          // Already closed: nothing left to release.
        }
      },
    };
  };
}

export const nodemailerTransport: TransportFactory = makeTransportFactory();
