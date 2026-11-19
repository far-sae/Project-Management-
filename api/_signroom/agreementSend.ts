import { randomUUID } from "node:crypto";
import type { SignedInUser } from "./context.js";
import { AppError } from "./errors.js";
import { openAgreement, parseFields, publicAgreement, withEvent, writeAgreement } from "./agreements.js";
import { finalPdf, validateDrawing } from "./agreementPdf.js";
import { newSecret, sha } from "./billing.js";
import { brandingOf } from "./branding.js";
import { mailReady, queueMail } from "./jobs.js";
import type { MailDeps } from "./mail.js";
import { acceptSignature } from "./signing.js";
import type { StoredAgreement } from "./store.js";
import { CONSENT, type Agreement, type Participant, type Workspace } from "./shared/types.js";
import { email, text } from "./validate.js";
import { runJobs } from "./worker.js";
import { minutes, refuseVerdict, spend as realSpend, UNAVAILABLE_MESSAGE } from "./host/rateLimit.js";
import { siteOrigin } from "./host/admin.js";

type Body = Record<string, unknown>;

/** SR rate("send:<workspace>", 100 a day) and rate("resend:<agreement>", 5 an hour), through sr_attempts. */
export const AGREEMENT_SEND_TOOL = "signroom-send";
export const RESEND_TOOL = "signroom-resend";

/** Invitation links last 7 days; only sha256(raw) is stored. */
const TOKEN_MS = 7 * 86_400_000;
const AWAITING = "Awaiting signatures";

function sortKeys(v: unknown): unknown {
  if (v && typeof v === "object" && typeof (v as { toJSON?: unknown }).toJSON === "function") v = (v as { toJSON: () => unknown }).toJSON();
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/**
 * JSON with object keys sorted recursively, arrays in order and no whitespace
 * (Ruling A8). jsonb does not keep key order, so a hash over this can be
 * recomputed from the stored row. 3B's manifest uses it too.
 */
export function stableJson(v: unknown): string {
  return JSON.stringify(sortKeys(v)) ?? "null";
}

const nowOf = (d: MailDeps) => (d.now ? d.now() : new Date());
const errorTag = (e: unknown) => (e instanceof AppError ? e.status : e instanceof Error ? e.name : "error");

/**
 * Links made by background work (reminders, completion) use the origin the
 * agreement was sent from (Ruling B6); an agreement with none uses the site's
 * own address (PUBLIC_SITE_URL).
 */
export function linkOriginOf(a: Agreement): string {
  if (a.linkOrigin) return a.linkOrigin;
  const site = siteOrigin();
  if (!site) throw new AppError(UNAVAILABLE_MESSAGE, 503);
  return site;
}

/**
 * Port of SR outbox.ts invitation() (96–144): issues a link and queues its
 * email as a job (Ruling B1). Unless it is a completion, the agreement is
 * re-read first: a cancel can land mid-send, and then nothing is issued. With
 * `rotate` (the default) the participant's earlier links of the same purpose
 * are revoked and the version moves on. It never throws (Ruling A5): on any
 * failure the new link is revoked and `jobId` is null; a sign invitation is
 * still "invited", so "Resend invitations" reaches the recipient.
 */
export async function invite(
  d: MailDeps,
  ws: Workspace,
  a: Agreement,
  p: Participant,
  origin: string,
  purpose: "invite" | "reminder" | "complete",
  opts: { rotate?: boolean } = {},
): Promise<{ participant: Participant; jobId: string | null }> {
  const complete = purpose === "complete";
  const tokenPurpose = complete ? "complete" : "sign";
  const rotate = opts.rotate !== false;
  const version = rotate ? p.version + 1 : Math.max(1, p.version);
  const participant: Participant = complete
    ? p
    : purpose === "reminder" && !rotate
      ? { ...p, version }
      : { ...p, version, progress: "invited" };
  let tokenId: string | null = null;
  try {
    if (!complete) {
      const cur = await d.store.getAgreement(a.workspaceId, a.id);
      if (!cur || cur.status !== AWAITING) return { participant: p, jobId: null };
    }
    if (rotate) await d.store.revokeSignTokens(a.id, p.id, tokenPurpose);
    const raw = newSecret();
    const token = await d.store.insertSignToken({
      digest: sha(raw),
      purpose: tokenPurpose,
      workspaceId: a.workspaceId,
      agreementId: a.id,
      participantId: p.id,
      email: p.email,
      version,
      expires: nowOf(d).getTime() + TOKEN_MS,
      revoked: false,
    });
    tokenId = token.id;
    const link = origin.replace(/\/+$/, "") + "/sign#access=" + raw;
    const job = await queueMail(d, {
      workspaceId: a.workspaceId,
      agreementId: a.id,
      participantId: p.id,
      tokenId: token.id,
      to: p.email,
      subject: complete ? `Completed: ${a.title}` : a.subject || "Please sign: " + a.title,
      text: complete
        ? "Your agreement is complete. Verify email access to download the signed PDF, completion record and evidence export.\n" + link
        : (a.message || "Please review and sign this agreement.") + "\n" + link,
      purpose: complete ? "completion" : purpose,
      dedupe: `${tokenPurpose}:${a.id}:${p.id}:${token.id}`,
    });
    return { participant, jobId: job.id };
  } catch (e) {
    // The status or error name only: the link, the address and the name stay out of the log.
    console.error("[signroom] invitation failed", errorTag(e));
    if (tokenId)
      try {
        await d.store.updateSignToken(tokenId, { revoked: true });
      } catch (revokeErr) {
        console.error("[signroom] invitation revoke failed", errorTag(revokeErr));
      }
    return { participant, jobId: null };
  }
}

/**
 * Runs the request's own jobs inline, then re-reads the row (the jobs append
 * their evidence). The request's own work has committed by now, so a failed
 * run is logged and never fails it; the jobs stay queued for the next run.
 */
export async function afterJobs(d: MailDeps, a: StoredAgreement, jobIds: string[]): Promise<StoredAgreement> {
  try {
    if (jobIds.length) await runJobs(d, { ids: jobIds });
  } catch (e) {
    console.error("[signroom] jobs run failed", e instanceof Error ? e.name : "error");
  }
  // Best effort: the row as the run left it, otherwise the committed row.
  try {
    return (await d.store.getAgreement(a.workspaceId, a.id)) ?? a;
  } catch (e) {
    console.error("[signroom] jobs run failed", e instanceof Error ? e.name : "error");
    return a;
  }
}

/**
 * Writes the invited participants (and, for resend, an event) onto the row. On
 * a lost compare-and-set it re-reads: an agreement no longer awaiting
 * signatures (cancelled meanwhile) has every link revoked and is returned as it
 * now is; otherwise the participant changes are applied to the fresh row once more.
 */
async function writeInvited(d: MailDeps, a: StoredAgreement, invited: Participant[], event?: { type: string; actor: string }): Promise<StoredAgreement> {
  let cur = a;
  for (let attempt = 0; attempt < 2; attempt++) {
    const participants = cur.participants.map((p) => {
      const n = invited.find((x) => x.id === p.id);
      return n ? { ...p, version: n.version, progress: n.progress } : p;
    });
    const out = await d.store.updateAgreement(cur.workspaceId, cur.id, cur.rowVersion, {
      participants,
      ...(event ? { events: withEvent(cur, event.type, event.actor).events } : {}),
    });
    if (out) return out;
    const fresh = await d.store.getAgreement(cur.workspaceId, cur.id);
    if (!fresh || fresh.status !== AWAITING) {
      await d.store.revokeSignTokens(a.id);
      return fresh ?? cur;
    }
    cur = fresh;
  }
  return cur;
}

/**
 * SR outbox.ts activate(): invites the signers who are due (the first pending
 * one when sequential, otherwise all), unless the sender must sign first.
 */
export async function activate(
  d: MailDeps,
  ws: Workspace,
  a: StoredAgreement,
  origin: string,
): Promise<{ a: StoredAgreement; jobIds: string[] }> {
  const invited: Participant[] = [];
  const jobIds: string[] = [];
  for (const p of dueSigners(a)) {
    if (p.progress !== "waiting") continue;
    const r = await invite(d, ws, a, p, origin, "invite");
    // An unchanged participant: the agreement stopped awaiting signatures mid-send.
    if (r.participant !== p) invited.push(r.participant);
    if (r.jobId) jobIds.push(r.jobId);
  }
  if (!invited.length) return { a, jobIds };
  return { a: await writeInvited(d, a, invited), jobIds };
}

/** Port of SR service.ts agreementAction "send" (781–875): SR's checks, the freeze, then the invitations. */
export async function sendAgreement(d: MailDeps, user: SignedInUser, id: string, b: Body, origin: string): Promise<Agreement> {
  const { store } = d;
  const { ctx, a } = await openAgreement(store, user, id, "send");
  // Rulings A5 and B18: with no way to send email or to finish, refuse before anything is frozen.
  if (!mailReady(d)) throw new AppError(UNAVAILABLE_MESSAGE, 503);

  if (a.sendKey && a.sendKey === b.idempotencyKey) return publicAgreement(a);
  if (a.status !== "Draft") throw new AppError("This agreement has already been sent.", 409);
  if (ctx.workspace.suspended) throw new AppError("Sending is suspended for this workspace.", 403);
  if (Number(b.revision) !== a.revision) throw new AppError("The draft changed. Review it again.", 409);
  if (!b.eligible || b.specialRequirements)
    throw new AppError(
      "This release supports ordinary commercial agreements only. Documents requiring deeds, witnessing or special formalities cannot be sent.",
    );
  if (!a.documentHash || !a.pages.length) throw new AppError("Prepare and review the PDF first.");
  const logo = brandingOf(ctx.workspace).logo;
  if (logo && a.branding?.logo !== logo)
    throw new AppError("Rebuild or re-upload the draft PDF to apply the current company logo before sending.");
  const signers = a.participants.filter((p) => p.role === "signer");
  if (!signers.length || a.participants.length > 12) throw new AppError("Add at least one signer.");
  for (const p of a.participants) {
    if (!p.name) throw new AppError("Every recipient needs a name.");
    email(p.email);
  }
  if (new Set(a.participants.map((p) => p.email)).size !== a.participants.length)
    throw new AppError("Use unique email addresses for recipients.");
  parseFields(a.fields, signers, a.pages);
  for (const p of signers)
    if (!a.fields.some((f) => f.participantId === p.id && f.kind === "signature" && f.required))
      throw new AppError(`Add a required signature field for ${p.name}.`);
  if (a.deadline && new Date(a.deadline + "T23:59:59Z").getTime() < Date.now()) throw new AppError("Choose a future deadline.");
  if (/\{\{[^}]+\}\}/.test(a.content)) throw new AppError("Resolve all template placeholders.");
  // Sign-first is open only to the draft's sender (signFirst checks senderId), so anyone else sending it would leave nobody able to sign first.
  if (a.senderFirst && user.id !== a.senderId) throw new AppError("Only the person who created this draft can sign it first.", 409);
  if (a.senderFirst && (signers.length < 2 || signers[0].email !== user.email))
    throw new AppError("Sign-first requires you as the first signer and at least one other signer.");

  refuseVerdict(
    await (d.spend ?? realSpend)(d.sb, AGREEMENT_SEND_TOOL, "workspace:" + ctx.workspace.id, 100, 1440),
    () => "You can send up to 100 agreements a day. Try again tomorrow.",
  );

  const sentAt = nowOf(d).toISOString();
  const frozen = {
    sourceHash: a.documentHash,
    branding: a.branding,
    sender: {
      // Ruling A10: accounts have no name, so the workspace's From name, otherwise the email's local part.
      name: ctx.workspace.senderName || user.email.split("@")[0],
      email: user.email,
      workspaceName: ctx.workspace.name,
    },
    consent: CONSENT,
    revision: a.revision,
    participants: structuredClone(a.participants),
    fields: structuredClone(a.fields),
    settings: {
      sequential: a.sequential,
      deadline: a.deadline,
      reminderDays: a.reminderDays,
      subject: a.subject,
      message: a.message,
    },
  };
  // Ruling A8: over sorted keys, so anyone can recompute it from the stored jsonb.
  const snapshotHash = sha(stableJson(frozen));
  const out = await store.updateAgreement(a.workspaceId, a.id, a.rowVersion, {
    status: AWAITING,
    sentAt,
    lastReminderAt: sentAt,
    sendKey: text(b.idempotencyKey, 100) || randomUUID(),
    senderReleasePending: !!a.senderFirst,
    linkOrigin: origin,
    frozen: { ...frozen, snapshotHash },
    events: withEvent(a, a.senderFirst ? "Agreement frozen for sender-first signing" : "Agreement frozen and sent", user.email, {
      sourceHash: a.documentHash,
      brandingHash: sha(stableJson(a.branding ?? {})),
      snapshotHash,
      consentVersion: CONSENT.version,
    }).events,
  });
  if (!out) {
    // Another request moved the row first. If it was this same send (a double click), its result is the answer.
    const fresh = await store.getAgreement(a.workspaceId, a.id);
    if (fresh?.sendKey && fresh.sendKey === b.idempotencyKey) return publicAgreement(fresh);
    throw new AppError("The draft changed. Review it again.", 409);
  }
  const act = await activate(d, ctx.workspace, out, origin);
  return publicAgreement(await afterJobs(d, act.a, act.jobIds));
}

/** Port of SR service.ts agreementAction "cancel" (927–955): the write and the revocation first, then the notices. */
export async function cancelAgreement(d: MailDeps, user: SignedInUser, id: string, b: Body): Promise<Agreement> {
  const { a } = await openAgreement(d.store, user, id, "cancel");
  if (a.status !== AWAITING) throw new AppError("Only an agreement awaiting signatures can be cancelled.", 409);
  const reason = text(b.reason, 1000);
  if (!reason) throw new AppError("Give a cancellation reason.");
  const out = await writeAgreement(d.store, a, {
    status: "Cancelled",
    events: withEvent(a, "Agreement cancelled", user.email, { reason }).events,
  });
  await d.store.revokeSignTokens(a.id);
  const jobIds: string[] = [];
  for (const p of a.participants.filter((p) => p.role === "signer" && (!a.senderReleasePending || p.email === user.email))) {
    try {
      const job = await queueMail(d, {
        workspaceId: a.workspaceId,
        agreementId: a.id,
        participantId: p.id,
        to: p.email,
        subject: `Cancelled: ${a.title}`,
        text: `The sender cancelled this agreement. Reason: ${reason}`,
        purpose: "notice",
        dedupe: `cancel:${a.id}:${p.id}`,
      });
      jobIds.push(job.id);
    } catch (e) {
      // The cancellation stands without its notice.
      console.error("[signroom] cancel notice failed", errorTag(e));
    }
  }
  return publicAgreement(await afterJobs(d, out, jobIds));
}

/**
 * The signers activate() would invite now: the first pending one when
 * sequential, otherwise every pending one; none while the sender must sign
 * first.
 */
function dueSigners(a: Agreement): Participant[] {
  if (a.senderReleasePending) return [];
  const pending = a.participants.filter((p) => p.role === "signer" && p.progress !== "signed");
  return a.sequential ? pending.slice(0, 1) : pending;
}

/**
 * Port of SR service.ts agreementAction "resend" (956–975): fresh links for
 * every signer already invited. A due signer still "waiting" is invited too:
 * activate() runs after the committing write (a signature, send or release)
 * and only logs a failure, which would otherwise leave the next signer with no
 * link and nothing to reach them.
 */
export async function resendInvitations(d: MailDeps, user: SignedInUser, id: string, origin: string): Promise<Agreement> {
  const { ctx, a } = await openAgreement(d.store, user, id, "resend");
  if (a.senderReleasePending)
    throw new AppError("Use the sign-first workflow and explicitly release the document before sending invitations.", 409);
  if (a.status !== AWAITING) throw new AppError("This agreement is not awaiting signatures.", 409);
  // As for send (Rulings A5 and B18): refuse before any live link is revoked.
  if (!mailReady(d)) throw new AppError(UNAVAILABLE_MESSAGE, 503);
  refuseVerdict(
    await (d.spend ?? realSpend)(d.sb, RESEND_TOOL, "agreement:" + a.id, 5, 60),
    (m) => `Invitations for this agreement have been resent 5 times this hour. Try again in ${minutes(m)}.`,
  );
  const invited: Participant[] = [];
  const jobIds: string[] = [];
  const due = dueSigners(a).map((p) => p.id);
  for (const p of a.participants.filter((p) => p.role === "signer" && p.progress !== "signed")) {
    const stranded = p.progress === "waiting";
    if (stranded && !due.includes(p.id)) continue;
    const r = await invite(d, ctx.workspace, a, p, origin, stranded ? "invite" : "reminder");
    if (r.participant !== p) invited.push(r.participant);
    if (r.jobId) jobIds.push(r.jobId);
  }
  const out = await writeInvited(d, a, invited, { type: "Invitations resent; previous links and sessions revoked", actor: user.email });
  return publicAgreement(await afterJobs(d, out, jobIds));
}

/**
 * Port of SR route.ts "sign-first" (623–702) as one write (Ruling A6): the
 * sender signs before anyone is invited. There is no guest link or session: the
 * account sign-in is the verification. The partial PDF is built and stored
 * first; then one compare-and-set writes the signature, the sender-signed hash
 * and the four events. Signing again returns the agreement as it is.
 */
export async function signFirst(d: MailDeps, user: SignedInUser, id: string, b: Body): Promise<Agreement> {
  await validateDrawing(b.drawing);
  const { a } = await openAgreement(d.store, user, id, "sign-first");
  if (a.senderId !== user.id || !a.senderFirst || !a.senderReleasePending || a.status !== AWAITING || !a.frozen)
    throw new AppError("This document is not waiting for your first signature.", 409);
  const p = a.participants.find((p) => p.role === "signer")!;
  if (p.email !== user.email) throw new AppError("Only the first named sender can sign here.", 403);
  if (p.progress === "signed") return publicAgreement(a);

  const signer: Participant = { ...p, version: Math.max(1, p.version), verification: "verified account session" };
  const verified = { ...a, participants: a.participants.map((x) => (x.id === p.id ? signer : x)) };
  const { participant, detail } = acceptSignature(verified, p.id, b, nowOf(d).toISOString());
  const participants = a.participants.map((x) => (x.id === p.id ? participant : x));
  const source = await d.store.getBlob(a.workspaceId, a.frozen.sourceHash);
  const hash = await d.store.putBlob(a.workspaceId, await finalPdf({ ...a, participants }, source, true));

  let e = withEvent(a, "Sender account verified for first signature", user.email, { recipientId: p.id });
  e = withEvent(e, "Document viewed by verified recipient", p.email, { recipientId: p.id, sourceHash: a.frozen.sourceHash });
  e = withEvent(e, "Signature accepted", p.email, detail);
  e = withEvent(e, "Sender-signed PDF persisted", user.email, { sourceHash: hash });
  return publicAgreement(
    await writeAgreement(d.store, a, { participants, senderSignedHash: hash, events: e.events }, "Signing state changed."),
  );
}

/** Port of SR route.ts "release-first" (703–732): the signed document goes to the other signers. */
export async function releaseFirst(d: MailDeps, user: SignedInUser, id: string, origin: string): Promise<Agreement> {
  const { ctx, a } = await openAgreement(d.store, user, id, "release-first");
  if (a.senderId !== user.id || !a.senderFirst || !a.senderReleasePending || !a.senderSignedHash || a.status !== AWAITING)
    throw new AppError("Sign the document first before sending it to the other company.", 409);
  // As for send and resend (Rulings A5 and B18): refuse before anything is released.
  if (!mailReady(d)) throw new AppError(UNAVAILABLE_MESSAGE, 503);
  const sentAt = nowOf(d).toISOString();
  const out = await writeAgreement(d.store, a, {
    senderReleasePending: false,
    sentAt,
    lastReminderAt: sentAt,
    events: withEvent(a, "Sender released signed document for counter-signature", user.email, { sourceHash: a.senderSignedHash }).events,
  });
  const act = await activate(d, ctx.workspace, out, origin);
  return publicAgreement(await afterJobs(d, act.a, act.jobIds));
}
