import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "./errors.js";
import type { Store } from "./store.js";
import type { Delivery, Workspace } from "./shared/types.js";
import { brandingOf } from "./branding.js";
import type { ScanDeps } from "./virusScan.js";
import type { EvidenceKey } from "./evidence.js";
import type { SpendResult } from "./host/rateLimit.js";
import { peek as realPeek, refuseVerdict, spend as realSpend, UNAVAILABLE_MESSAGE, workspaceLimitKey } from "./host/rateLimit.js";

/**
 * Sends one email for a workspace. There is one sending route: Resend over
 * HTTPS (RESEND_API_KEY), from the address in SIGNROOM_MAIL_FROM. Every send
 * writes an sr_deliveries row (sending, then sent or failed).
 */
export type MailDeps = {
  store: Store;
  sb: SupabaseClient;
  fetch: typeof fetch;
  resendKey: string | undefined;
  /** The address mail goes from (mailFrom below); undefined when none can be worked out, and then nothing is sent. */
  from?: string;
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
 * The value written to sr_deliveries.route for this server's one route. The
 * name is the delivery log's own (the shared Delivery type), kept so the
 * screens and the database check agree; it means "sent by the platform".
 */
export const ROUTE = "securovix" as const satisfies NonNullable<Delivery["route"]>;
export type Route = typeof ROUTE;

export const PRODUCT_NAME = "TaskCalendar";
export const SEND_FAILED_MESSAGE = "We couldn't send this email. Please try again in a few minutes.";
const RESEND_TIMEOUT_MS = 20_000;

const ADDRESS = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;

/**
 * The address mail goes from: SIGNROOM_MAIL_FROM (a plain address, or
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

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const NAME_STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"<>\\]/gu;

/** The sender's display name: the company name with control characters, quotes and brackets removed, at most 80 characters. */
export function displayName(company: string): string {
  const cleaned = company.replace(NAME_STRIP, " ").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, 80).join("").trim() || "Your supplier";
}

const htmlOf = (text: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111">${escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>")}</div>`;

const senderName = (ws: Workspace) => displayName(ws.senderName || brandingOf(ws).companyName);

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

// Sending limits, per workspace: every email goes from the platform's own address.
export const MAIL_TOOL = "signroom-mail";
export const MAIL_MINUTE_LIMIT = 20;
export const MAIL_DAY_LIMIT = 300;
/** A workspace that first used Signroom under this many days ago may send only MAIL_NEW_DAY_LIMIT a day. */
export const MAIL_NEW_DAYS = 7;
export const MAIL_NEW_DAY_LIMIT = 100;

/** Created under 7 days ago, or of unknown age (so the stricter limit applies). */
function isNewWorkspace(created: string | undefined, now: Date): boolean {
  const t = created ? Date.parse(created) : NaN;
  return !Number.isFinite(t) || now.getTime() - t < MAIL_NEW_DAYS * 86_400_000;
}

/** Peek the day, then spend the minute; a refusal sends nothing and writes no delivery row. */
async function refuseSendLimits(d: MailDeps, ws: Workspace): Promise<void> {
  const key = workspaceLimitKey(ws.id);
  const fresh = isNewWorkspace(ws.created, d.now ? d.now() : new Date());
  const dayLimit = fresh ? MAIL_NEW_DAY_LIMIT : MAIL_DAY_LIMIT;
  refuseVerdict(
    await (d.peek ?? realPeek)(d.sb, MAIL_TOOL, key, dayLimit, 24 * 60),
    () =>
      fresh
        ? `New workspaces can send ${MAIL_NEW_DAY_LIMIT} emails a day for their first week. Try again tomorrow.`
        : `You can send up to ${MAIL_DAY_LIMIT} emails a day. Try again tomorrow.`,
  );
  refuseVerdict(
    await (d.spend ?? realSpend)(d.sb, MAIL_TOOL, key, MAIL_MINUTE_LIMIT, 1),
    () => `You can send up to ${MAIL_MINUTE_LIMIT} emails a minute. Try again in a minute.`,
  );
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
 * An agreement email refused before sending (a limit, or no route at all) is
 * still a failed delivery row, so the sender sees "Delivery: failed" and can
 * resend. Invoice emails keep their rule: a refusal writes no row. The error is
 * the refusal's own sentence, which names no address or link.
 */
async function recordRefusal(deps: MailDeps, ws: Workspace, mail: Mail, e: unknown): Promise<void> {
  try {
    await deps.store.insertDelivery({
      workspaceId: ws.id,
      agreementId: mail.agreementId,
      ...(mail.participantId ? { participantId: mail.participantId } : {}),
      recipient: mail.to,
      subject: mail.subject,
      purpose: mail.purpose,
      route: ROUTE,
      status: "failed",
      error: e instanceof AppError ? e.message : SEND_FAILED_MESSAGE,
    });
  } catch (insertErr) {
    console.error("[signroom-mail] could not record the refusal", insertErr instanceof Error ? insertErr.name : "error");
  }
}

/** Email can go out at all: the Resend key and a from address. */
export const canSend = (d: Pick<MailDeps, "resendKey" | "from">): boolean => !!d.resendKey && !!d.from;

/**
 * `hooks.sending` runs after the limit checks and before the delivery row and
 * the send: the job runner stamps its live attempt there. If it throws, nothing
 * is sent and the error propagates. Every refusal before the hook is definite
 * (nothing was sent); a failure after it is unclear, and the job runner holds
 * such a job for review and never sends it again.
 */
export async function sendMail(
  deps: MailDeps,
  ws: Workspace,
  mail: Mail,
  hooks: { sending?: (route: Route) => Promise<void> } = {},
): Promise<{ route: Route }> {
  const from = deps.from;
  try {
    if (!deps.resendKey || !from) throw new AppError(UNAVAILABLE_MESSAGE, 503);
    await refuseSendLimits(deps, ws);
  } catch (e) {
    if (mail.agreementId) await recordRefusal(deps, ws, mail, e);
    throw e;
  }
  if (hooks.sending) await hooks.sending(ROUTE);

  const delivery = await deps.store.insertDelivery({
    workspaceId: ws.id,
    ...(mail.invoiceId ? { invoiceId: mail.invoiceId } : {}),
    ...(mail.agreementId ? { agreementId: mail.agreementId } : {}),
    ...(mail.participantId ? { participantId: mail.participantId } : {}),
    ...(mail.jobId ? { jobId: mail.jobId } : {}),
    recipient: mail.to,
    subject: mail.subject,
    purpose: mail.purpose,
    route: ROUTE,
    status: "sending",
  });
  try {
    await viaResend(deps, ws, mail, from, delivery.id);
  } catch (e) {
    await finish(deps.store, delivery.id, "failed", e instanceof AppError ? e.message : SEND_FAILED_MESSAGE);
    throw e;
  }
  await finish(deps.store, delivery.id, "sent");
  return { route: ROUTE };
}
