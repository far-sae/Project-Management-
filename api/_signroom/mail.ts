import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, StoreError } from "./errors.js";
import type { EmailOAuth, Store } from "./store.js";
import type { Delivery, Workspace } from "./shared/types.js";
import { brandingOf } from "./branding.js";
import type { ScanDeps } from "./virusScan.js";
import type { EvidenceKey } from "./evidence.js";
import type { SpendResult } from "./host/rateLimit.js";
import { UNAVAILABLE_MESSAGE } from "./host/rateLimit.js";
import { decryptPassword } from "./mailbox/crypto.js";
import { displayName, htmlOf } from "./mailbox/content.js";
import { isLoginFailure, mapSmtpError, scrubForLog } from "./mailbox/errors.js";
import type { Lookup } from "./mailbox/ssrf.js";
import type { MailboxRow } from "./mailbox/store.js";
import type { TransportFactory } from "./mailbox/transport.js";
import { MAILBOX_REFUSED_MESSAGE, MAILBOX_SEND_FAILED_MESSAGE, markUnreadable, openTransport, SERVER_UNREACHABLE_MESSAGE } from "./emailConnection.js";
import { refuseSendLimits } from "./mailLimits.js";
import { accessFor } from "./oauthConnection.js";
import { setupSentence } from "./setupMessages.js";
import { PROVIDER_UNCONFIRMED_MESSAGE, RECONNECT_MESSAGE, sendViaProvider } from "./workEmail.js";

export { displayName };
export { MAIL_DAY_LIMIT, MAIL_MINUTE_LIMIT, MAIL_NEW_DAY_LIMIT, MAIL_NEW_DAYS, MAIL_TOOL } from "./mailLimits.js";

/**
 * Sends one email for a workspace. Three ways out, tried in this order: the
 * workspace's verified Google or Microsoft connection, else its verified SMTP
 * mailbox, else the platform's own address through Resend over HTTPS
 * (RESEND_API_KEY, from the address in SIGNROOM_MAIL_FROM). The first two need
 * SIGNROOM_MAIL_KEY and the tables of migration 186; without either, every
 * email goes through Resend exactly as before. Every send writes an
 * sr_deliveries row (sending, then sent or failed).
 */
export type MailDeps = {
  store: Store;
  sb: SupabaseClient;
  fetch: typeof fetch;
  resendKey: string | undefined;
  /** The address platform mail goes from (mailFrom below); undefined when none can be worked out, and then nothing is sent through Resend. */
  from?: string;
  /** SIGNROOM_MAIL_KEY as 32 bytes (the workspace's own mailbox secrets), or null/undefined when it is not configured. */
  key?: Buffer | null;
  /** Opens the SMTP connection; nodemailer when omitted (tests pass a fake). */
  transport?: TransportFactory;
  /** Resolves an SMTP server's name; the system resolver when omitted (tests pass a fake). */
  lookup?: Lookup;
  /** sr_attempts limits; the real ones from host/rateLimit.ts when omitted (tests pass fakes). */
  spend?: (sb: SupabaseClient, tool: string, key: string, limit: number, windowMin: number) => Promise<SpendResult>;
  peek?: (sb: SupabaseClient, tool: string, key: string, limit: number, windowMin: number) => Promise<SpendResult>;
  now?: () => Date;
  /** Cloudmersive virus scan for letterhead and agreement PDF uploads; missing means the scan fails closed. */
  scan?: ScanDeps;
  /** SIGNROOM_JOB_KEY as 32 bytes (job payload encryption), or null when it is not configured. */
  jobKey?: Buffer | null;
  /** The active evidence signing key, or null when none is configured. */
  evidenceKey?: EvidenceKey | null;
};

export type Mail = {
  to: string;
  subject: string;
  text: string;
  purpose: string;
  invoiceId?: string;
  agreementId?: string;
  participantId?: string;
  /** The job sending it; recorded on the delivery row so a held job can mark that row failed. */
  jobId?: string;
};

/**
 * The value written to sr_deliveries.route for mail sent by the platform
 * through Resend. The name is the delivery log's own (the shared Delivery
 * type), kept so the screens and the database check agree; it means "sent by
 * the platform".
 */
export const ROUTE = "securovix" as const satisfies NonNullable<Delivery["route"]>;
/** sr_deliveries.route for mail sent from the workspace's own mailbox (SMTP, Google or Microsoft). */
export const MAILBOX_ROUTE = "mailbox" as const satisfies NonNullable<Delivery["route"]>;
export type Route = typeof ROUTE | typeof MAILBOX_ROUTE;

export const PRODUCT_NAME = "TaskCalendar";
export const SEND_FAILED_MESSAGE = "We couldn't send this email. Please try again in a few minutes.";
const RESEND_TIMEOUT_MS = 20_000;

const ADDRESS = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;

/**
 * The address platform mail goes from: SIGNROOM_MAIL_FROM (a plain address, or
 * "Name <address>", of which only the address is used), else documents@ the
 * site's own domain (PUBLIC_SITE_URL without a leading www.). Null when
 * neither gives a usable address.
 */
export function mailFrom(configured: string | undefined, siteOrigin: string | null): string | null {
  const raw = (configured ?? "").trim();
  if (raw) {
    const m = /<([^<>]+)>\s*$/.exec(raw);
    const address = (m ? m[1] : raw).trim().toLowerCase();
    return ADDRESS.test(address) && address.length <= 254 ? address : null;
  }
  if (!siteOrigin) return null;
  let host: string;
  try {
    host = new URL(siteOrigin).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const address = `documents@${host}`;
  return host.includes(".") && ADDRESS.test(address) ? address : null;
}

const senderName = (ws: Workspace) => displayName(ws.senderName || brandingOf(ws).companyName);

/**
 * The workspace's Google or Microsoft row. Before migration 186 is run its
 * table is not there: that reads as "no connection", so mail keeps going out
 * through Resend. Any other database failure is thrown.
 */
async function oauthRowOf(d: Pick<MailDeps, "store">, workspaceId: string): Promise<EmailOAuth | null> {
  try {
    return await d.store.getEmailOAuth(workspaceId);
  } catch (e) {
    if (e instanceof StoreError && setupSentence(e.message)) return null;
    throw e;
  }
}

/** The verified SMTP mailbox and its password, or null (the platform route). An unreadable password unverifies the row. */
export async function usableMailbox(d: MailDeps, workspaceId: string): Promise<{ row: MailboxRow; password: string } | null> {
  if (!d.key) return null;
  let row: MailboxRow | null;
  try {
    row = await d.store.getMailbox(workspaceId);
  } catch (e) {
    // A failed read (the table missing before migration 186 included) means "no usable mailbox": the platform route still works.
    console.error("[signroom-mail] could not read the mailbox", e instanceof Error ? e.name : "error");
    return null;
  }
  if (!row || !row.verified_at) return null;
  const password = decryptPassword(d.key, workspaceId, row.password_enc);
  if (password === null) {
    await markUnreadable(d.store, row);
    return null;
  }
  return { row, password };
}

/**
 * A Google or Microsoft row that is the route: verified, or verified once and
 * now refusing sends until it is reconnected. Only a verified row is ever
 * marked `reconnect`; a never-verified row whose renewal is refused goes back
 * to `configured` (oauthConnection.ts markReconnect), so it never blocks mail.
 */
export const isOAuthRoute = (c: EmailOAuth | null): c is EmailOAuth => !!c && (c.status === "verified" || c.status === "reconnect");

/**
 * The workspace's Google or Microsoft route and its access token, read or
 * renewed now, before the `sending` hook, so every refusal here is definite: a
 * `reconnect` row is a 409 with its own sentence (never a silent fallback to
 * another route), else accessFor's own refusals. Null when the row is not a route.
 */
async function oauthRoute(d: MailDeps, conn: EmailOAuth | null): Promise<{ conn: EmailOAuth; accessToken: string } | null> {
  if (!isOAuthRoute(conn)) return null;
  if (conn.status === "reconnect") throw new AppError(RECONNECT_MESSAGE, 409);
  return { conn, accessToken: await accessFor(d, conn) };
}

/**
 * The address the workspace's mail goes from when it is its own, with no
 * network and no decryption: a verified (or `reconnect`) Google or Microsoft
 * row's email, else a verified SMTP mailbox's; null when mail goes from the
 * platform. Always null without SIGNROOM_MAIL_KEY (nothing could be decrypted
 * to send with) and before migration 186.
 */
export async function deliveryAddress(d: Pick<MailDeps, "store" | "key">, workspaceId: string): Promise<string | null> {
  if (!d.key) return null;
  const conn = await oauthRowOf(d, workspaceId);
  if (isOAuthRoute(conn)) return conn.email;
  try {
    const row = await d.store.getMailbox(workspaceId);
    return row?.verified_at ? row.from_email : null;
  } catch (e) {
    console.error("[signroom-mail] could not read the mailbox", e instanceof Error ? e.name : "error");
    return null;
  }
}

/** The Gmail or Graph send, after the hook: any failure here is unclear and is never retried by the caller. */
async function viaProvider(d: MailDeps, ws: Workspace, mail: Mail, conn: EmailOAuth, accessToken: string, deliveryId: string): Promise<void> {
  try {
    await sendViaProvider(
      d.fetch,
      conn.provider,
      accessToken,
      { name: senderName(ws), address: conn.email },
      { to: mail.to, subject: mail.subject, text: mail.text, replyTo: ws.replyTo || conn.email },
      deliveryId,
    );
  } catch (e) {
    // A raw fetch error can carry the URL: only its name, or our status, is logged.
    console.error("[signroom-mail] provider send failed", e instanceof AppError ? e.status : e instanceof Error ? e.name : "error");
    if (e instanceof AppError) throw e;
    throw new AppError(PROVIDER_UNCONFIRMED_MESSAGE, 502);
  }
}

async function viaMailbox(d: MailDeps, ws: Workspace, mail: Mail, row: MailboxRow, password: string): Promise<void> {
  const open = await openTransport(d, row, password);
  if (open.ok === false) throw new AppError(SERVER_UNREACHABLE_MESSAGE, 502);
  try {
    await open.transport.send({
      from: { name: senderName(ws), address: row.from_email },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: htmlOf(mail.text),
      attachments: [],
    });
  } catch (e) {
    console.error("[signroom-mail] mailbox send failed", scrubForLog(e, password, row.username));
    const failure = mapSmtpError(e, row.provider);
    if (isLoginFailure(failure.kind)) {
      try {
        await d.store.markMailbox(row, { verified_at: null, last_error: failure.message });
      } catch (markErr) {
        console.error("[signroom-mail] could not record the refused password", markErr instanceof Error ? markErr.name : "error");
      }
      throw new AppError(MAILBOX_REFUSED_MESSAGE, 502);
    }
    throw new AppError(failure.kind === "unreachable" ? SERVER_UNREACHABLE_MESSAGE : MAILBOX_SEND_FAILED_MESSAGE, 502);
  } finally {
    open.transport.close();
  }
}

async function viaResend(d: MailDeps, ws: Workspace, mail: Mail, from: string, deliveryId: string): Promise<void> {
  let status = 0;
  try {
    const res = await d.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${d.resendKey}`, "Content-Type": "application/json", "Idempotency-Key": deliveryId },
      body: JSON.stringify({
        from: `"${senderName(ws)} via ${PRODUCT_NAME}" <${from}>`,
        to: [mail.to],
        ...(ws.replyTo ? { reply_to: ws.replyTo } : {}),
        subject: mail.subject,
        text: mail.text,
        html: htmlOf(mail.text),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    status = res.status;
    await res.text();
    if (res.ok) return;
  } catch (e) {
    // The server's own text can name the recipient: log only that it failed.
    console.error("[signroom-mail] Resend unreachable", e instanceof Error ? e.name : "error");
    throw new AppError(SEND_FAILED_MESSAGE, 502);
  }
  console.error("[signroom-mail] Resend refused", status);
  throw new AppError(SEND_FAILED_MESSAGE, 502);
}

/** Delivery bookkeeping after the outcome is known must never change that outcome. */
async function finish(store: Store, id: string, status: "sent" | "failed", error?: string): Promise<void> {
  try {
    await store.finishDelivery(id, status, error);
  } catch (e) {
    console.error("[signroom-mail] could not record the delivery", e instanceof Error ? e.name : "error");
  }
}

/**
 * An agreement email refused before sending (a limit, a connection that must
 * be reconnected, or no route at all) is still a failed delivery row, so the
 * sender sees "Delivery: failed" and can resend. Invoice emails keep their
 * rule: a refusal writes no row. The error is the refusal's own sentence,
 * which names no address or link.
 */
async function recordRefusal(deps: MailDeps, ws: Workspace, mail: Mail, route: Route, e: unknown): Promise<void> {
  try {
    await deps.store.insertDelivery({
      workspaceId: ws.id,
      agreementId: mail.agreementId,
      ...(mail.participantId ? { participantId: mail.participantId } : {}),
      recipient: mail.to,
      subject: mail.subject,
      purpose: mail.purpose,
      route,
      status: "failed",
      error: e instanceof AppError ? e.message : SEND_FAILED_MESSAGE,
    });
  } catch (insertErr) {
    console.error("[signroom-mail] could not record the refusal", insertErr instanceof Error ? insertErr.name : "error");
  }
}

/** Platform email can go out: the Resend key and a from address. (A workspace's own mailbox is a second way: deliveryAddress.) */
export const canSend = (d: Pick<MailDeps, "resendKey" | "from">): boolean => !!d.resendKey && !!d.from;

/**
 * `hooks.sending` runs after the route is chosen and the limit checks passed,
 * and before the delivery row and the send: the job runner stamps its live
 * attempt there. If it throws, nothing is sent and the error propagates. Every
 * refusal before the hook is definite (nothing was sent); a failure after it
 * is unclear, and the job runner holds such a job for review and never sends
 * it again. The workspace's sending limits are the same on every route.
 */
export async function sendMail(
  deps: MailDeps,
  ws: Workspace,
  mail: Mail,
  hooks: { sending?: (route: Route) => Promise<void> } = {},
): Promise<{ route: Route }> {
  const from = deps.from;
  let oauth: { conn: EmailOAuth; accessToken: string } | null = null;
  let mailbox: { row: MailboxRow; password: string } | null = null;
  let route: Route = ROUTE;
  try {
    // Without the mail key no own mailbox could be used: nothing is looked up, and the email goes out through Resend.
    if (deps.key) {
      const conn = await oauthRowOf(deps, ws.id);
      if (isOAuthRoute(conn)) route = MAILBOX_ROUTE;
      oauth = await oauthRoute(deps, conn);
      if (!oauth) {
        mailbox = await usableMailbox(deps, ws.id);
        if (mailbox) route = MAILBOX_ROUTE;
      }
    }
    if (route === ROUTE && (!deps.resendKey || !from)) throw new AppError(UNAVAILABLE_MESSAGE, 503);
    await refuseSendLimits(deps, ws);
  } catch (e) {
    if (mail.agreementId) await recordRefusal(deps, ws, mail, route, e);
    throw e;
  }
  if (hooks.sending) await hooks.sending(route);

  const delivery = await deps.store.insertDelivery({
    workspaceId: ws.id,
    ...(mail.invoiceId ? { invoiceId: mail.invoiceId } : {}),
    ...(mail.agreementId ? { agreementId: mail.agreementId } : {}),
    ...(mail.participantId ? { participantId: mail.participantId } : {}),
    ...(mail.jobId ? { jobId: mail.jobId } : {}),
    recipient: mail.to,
    subject: mail.subject,
    purpose: mail.purpose,
    route,
    status: "sending",
  });
  try {
    if (oauth) await viaProvider(deps, ws, mail, oauth.conn, oauth.accessToken, delivery.id);
    else if (mailbox) await viaMailbox(deps, ws, mail, mailbox.row, mailbox.password);
    else await viaResend(deps, ws, mail, from as string, delivery.id);
  } catch (e) {
    await finish(deps.store, delivery.id, "failed", e instanceof AppError ? e.message : SEND_FAILED_MESSAGE);
    throw e;
  }
  await finish(deps.store, delivery.id, "sent");
  return { route };
}
