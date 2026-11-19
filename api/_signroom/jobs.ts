import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors.js";
import { withEvent } from "./agreements.js";
import { canSend, type MailDeps } from "./mail.js";
import type { Store } from "./store.js";
import type { Job, NewJob } from "./shared/types.js";
import { UNAVAILABLE_MESSAGE } from "./host/rateLimit.js";

/**
 * Port of SR lib/v2/outbox.ts enqueue()/queueMail() and the job constants of
 * lib/v2/worker.ts. Every agreement email is a job (Ruling B1); its payload is
 * encrypted with SIGNROOM_JOB_KEY and emptied once the job is settled.
 */

export const HELD_MESSAGE = "Live email outcome needs review. Check the Sent folder before any manual resend; automatic retry is disabled.";
export const FAILED_JOB_MESSAGE = "Processing failed after 5 attempts.";
/** A held email's delivery row: the sender sees "Delivery: failed" and checks before resending (Ruling B2). No address or link. */
export const HELD_DELIVERY_MESSAGE = "Held for review: this email may already have been delivered. Check with the recipient before resending.";

/** Longer than the function's maxDuration (300 s), so a live run never loses its lease (Ruling B15). */
export const LEASE_SECONDS = 360;
export const MAX_ATTEMPTS = 5;
/**
 * A completion email refused before sending (a send limit) ends failed after
 * MAX_ATTEMPTS quick tries; maintenance queues it again once a day, this many
 * times (sr_completion_mail_refused lists it while attempts < 12).
 */
export const COMPLETION_REQUEUES = 7;
/** A cron run claims at most this many jobs, and nothing new after RUN_BUDGET_MS. */
export const CRON_LIMIT = 50;
export const RUN_BUDGET_MS = 200_000;

/** Seconds before a refused job is tried again: 60, 120, 240 … capped at an hour (Ruling B2). */
export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 60 * 2 ** (attempts - 1));
}

/** SIGNROOM_JOB_KEY: the base64 decode when it is exactly 32 bytes, otherwise null (so nothing is queued). */
export function readJobKey(raw: string | undefined): Buffer | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const key = Buffer.from(s, "base64");
  return key.length === 32 ? key : null;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** SR security.ts encrypt(): AES-256-GCM, base64(iv(12) | tag(16) | ciphertext) over JSON.stringify(value). */
export function encryptPayload(key: Buffer, value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

/** SR security.ts decrypt(), then JSON.parse. A bad tag (or anything malformed) throws. */
export function decryptPayload(key: Buffer, data: string): unknown {
  const b = Buffer.from(data, "base64");
  if (b.length < IV_BYTES + TAG_BYTES) throw new Error("Payload too short");
  const c = createDecipheriv("aes-256-gcm", key, b.subarray(0, IV_BYTES));
  c.setAuthTag(b.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return JSON.parse(Buffer.concat([c.update(b.subarray(IV_BYTES + TAG_BYTES)), c.final()]).toString("utf8"));
}

/** SR outbox.ts enqueue(): a duplicate `dedupe` returns the job already queued. */
export function enqueue(d: MailDeps, job: NewJob): Promise<Job> {
  return d.store.insertJob(job);
}

/** What a mail job carries, encrypted. */
export type MailPayload = { to: string; subject: string; text: string; tokenId?: string };

/**
 * SR outbox.ts queueMail(): an agreement email as a job. The address, subject,
 * text (with its link) and token id are kept only encrypted. Dedupe keys must
 * name the agreement and the participant.
 */
export async function queueMail(
  d: MailDeps,
  m: {
    workspaceId: string;
    agreementId?: string;
    participantId?: string;
    tokenId?: string;
    to: string;
    subject: string;
    text: string;
    purpose: "invite" | "reminder" | "completion" | "notice";
    dedupe: string;
  },
): Promise<Job> {
  if (!d.jobKey) throw new AppError(UNAVAILABLE_MESSAGE, 503);
  const body: MailPayload = { to: m.to, subject: m.subject, text: m.text, tokenId: m.tokenId };
  return enqueue(d, {
    workspaceId: m.workspaceId,
    ...(m.agreementId ? { agreementId: m.agreementId } : {}),
    ...(m.participantId ? { participantId: m.participantId } : {}),
    kind: "mail",
    purpose: m.purpose,
    dedupe: m.dedupe,
    payload: encryptPayload(d.jobKey, body),
  });
}

const APPEND_TRIES = 3;

/**
 * SR evidence() from background work (Ruling B16): re-reads the agreement and
 * compare-and-sets the appended event, up to 3 times. A missing agreement is a
 * no-op. It never throws; a final loss is logged by the event's type only.
 */
export async function appendEvent(
  store: Store,
  workspaceId: string,
  agreementId: string,
  type: string,
  actor: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    for (let n = 0; n < APPEND_TRIES; n++) {
      const a = await store.getAgreement(workspaceId, agreementId);
      if (!a) return;
      if (await store.updateAgreement(workspaceId, agreementId, a.rowVersion, { events: withEvent(a, type, actor, detail).events })) return;
    }
  } catch {
    // Falls through to the log below; the cause can carry row data, so only the type is named.
  }
  console.error("[signroom] event append failed", type);
}

/**
 * Agreement emails can be sent and agreements finished: the sending route (the
 * Resend key and a from address), the job key and the evidence key (Ruling B18).
 */
export function mailReady(d: MailDeps): boolean {
  return !!d.jobKey && !!d.evidenceKey && canSend(d);
}
