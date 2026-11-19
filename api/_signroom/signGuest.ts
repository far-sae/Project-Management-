import { randomInt, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";
import { ARTIFACT_NAMES, ARTIFACT_URL_SECONDS, artifactLink, expireIfDue, withEvent, writeAgreement } from "./agreements.js";
import { validateDrawing } from "./agreementPdf.js";
import { activate, afterJobs, invite, linkOriginOf } from "./agreementSend.js";
import { newSecret, sha } from "./billing.js";
import { brandingOf } from "./branding.js";
import { enqueue, queueMail } from "./jobs.js";
import { sendMail, type MailDeps } from "./mail.js";
import { acceptSignature } from "./signing.js";
import type { AgreementPatch, Store, StoredAgreement } from "./store.js";
import type { Participant, SignSession, SignToken } from "./shared/types.js";
import { isUuid } from "./validate.js";
import { runJobs } from "./worker.js";
import { refuseVerdict, spend as realSpend } from "./host/rateLimit.js";

/**
 * Port of SR lib/v2/guest.ts: an invited recipient, who is not signed in,
 * opens their link, confirms a 6-digit code sent to the invited address, and
 * gets a 30-minute session (the sr_sign cookie) to view, sign or decline, or,
 * once complete, to download. Codes follow part 1's billing guest (Ruling B5);
 * the live token is the participant's current link and the agreement's status
 * is checked on every call (Ruling B3).
 */

export const SIGN_SESSION_MS = 30 * 60000;
export const CODE_LIFE_MS = 10 * 60000;
export const CODE_GAP_MS = 60000;
export const MAX_SENDS = 3;
export const SEND_WINDOW_MS = 3600000;
export const MAX_ATTEMPTS = 5;
/** Counter races are retried; this many lost races in a row means heavy abuse, so refuse. */
export const RETRIES = 12;
/** SR rate("recover:<email>", 3 an hour), through sr_attempts. */
export const RECOVER_TOOL = "signroom-recover";

const AWAITING = "Awaiting signatures";
/** Lost compare-and-sets on the agreement before giving up. */
const WRITE_TRIES = 3;

const GONE = "This link is expired or has been replaced. Ask the sender to resend it, or recover completion access.";
const NO_SESSION = "Verify your invited email to continue.";
const REVOKED = "This access session was revoked. Verify the latest invitation.";
const LIMIT = "Code expired or attempt limit reached. Request a new code.";
const CHANGED = "Signing state changed.";
const DOWNLOAD_ONLY = "This invitation provides download access only.";
const TOO_MANY = "Too many requests. Please try again later.";
const RECOVER_MESSAGE = "If this address is authorised, a new completion invitation will be emailed to it.";

export type SignGuestAction = "intro" | "code" | "verify" | "recover" | "document" | "sign" | "decline";
type Body = Record<string, unknown>;
type Opened = { t: SignToken; a: StoredAgreement; p: Participant };

const errorTag = (e: unknown) => (e instanceof AppError ? e.status : e instanceof Error ? e.name : "error");
const sameDigest = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sourceOf = (a: StoredAgreement) => a.senderSignedHash || a.frozen?.sourceHash || "";
const ownFields = (a: StoredAgreement, id: string) =>
  (a.frozen?.fields ?? []).filter((f) => f.participantId === id).sort((x, y) => x.page - y.page || x.y - y.y || x.x - y.x);
/** Sequential signing: only the first signer who has not signed may act. */
const notYourTurn = (a: StoredAgreement, p: Participant) =>
  a.sequential && a.participants.find((x) => x.role === "signer" && x.progress !== "signed")?.id !== p.id;

/** SR guest.ts findInvitation (20–52), with Ruling B3: no version comparison, status always checked after expiry. */
export async function findInvitation(store: Store, access: string | undefined): Promise<Opened> {
  const t = await store.findSignToken(sha(String(access || "")));
  if (!t || t.revoked || t.expires < Date.now()) throw new AppError(GONE, 410);
  const found = await store.getAgreement(t.workspaceId, t.agreementId);
  if (!found || !found.frozen || !found.participants.some((p) => p.id === t.participantId))
    throw new AppError("This invitation has been replaced.", 410);
  const a = await expireIfDue(store, found);
  const p = a.participants.find((x) => x.id === t.participantId)!;
  if (t.purpose === "sign") {
    if (a.status !== AWAITING)
      throw new AppError(
        a.status === "Completed" ? "This agreement is complete. Open your completion invitation." : "This agreement is no longer available for signing.",
        410,
      );
    if (p.role !== "signer") throw new AppError("Copy recipients cannot sign.", 403);
    if (notYourTurn(a, p)) throw new AppError("It is not your turn to sign.", 403);
  } else if (a.status !== "Completed") throw new AppError("Completion files are not ready.", 409);
  return { t, a, p };
}

/** SR guest.ts guestSession (53–89), with Ruling B3: the session's token must still be live; status always checked. */
export async function signSession(store: Store, raw: string | undefined): Promise<Opened & { s: SignSession }> {
  const s = await store.findSignSession(sha(raw || ""));
  if (!s || s.expires <= Date.now()) throw new AppError(NO_SESSION, 401);
  const t = await store.getSignToken(s.tokenId);
  if (!t || t.revoked || t.expires < Date.now() || t.id !== s.tokenId) throw new AppError(REVOKED, 403);
  const found = await store.getAgreement(s.workspaceId, s.agreementId);
  if (!found || !found.frozen || !found.participants.some((p) => p.id === s.participantId))
    throw new AppError("This session has been replaced.", 403);
  const a = await expireIfDue(store, found);
  const p = a.participants.find((x) => x.id === s.participantId)!;
  if (s.purpose === "sign") {
    if (a.status !== AWAITING) throw new AppError("Signing access is no longer available.", 403);
    if (notYourTurn(a, p)) throw new AppError("It is not your turn to sign.", 403);
  } else if (a.status !== "Completed") throw new AppError("Completion files are not ready.", 403);
  return { s, t, a, p };
}

/**
 * Re-reads and compare-and-sets the patch `change` builds, up to WRITE_TRIES
 * times. `change` returns null when the fresh row needs nothing written.
 */
async function retryWrite(store: Store, first: StoredAgreement, change: (a: StoredAgreement) => AgreementPatch | null): Promise<StoredAgreement> {
  let a = first;
  for (let n = 0; n < WRITE_TRIES; n++) {
    const patch = change(a);
    if (!patch) return a;
    const out = await store.updateAgreement(a.workspaceId, a.id, a.rowVersion, patch);
    if (out) return out;
    const fresh = await store.getAgreement(a.workspaceId, a.id);
    if (!fresh) break;
    a = fresh;
  }
  throw new AppError(CHANGED, 409);
}

const withProgress = (a: StoredAgreement, id: string, patch: Partial<Participant>) =>
  a.participants.map((x) => (x.id === id ? { ...x, ...patch } : x));

/** SR 116–145 with part 1's compare-and-set on the code counters. The code is emailed directly (Ruling B1), never stored. */
async function sendCode(d: MailDeps, body: Body): Promise<{ json: Record<string, unknown> }> {
  const { store } = d;
  for (let n = 0; n < RETRIES; n++) {
    const { t, a, p } = await findInvitation(store, body.access as string | undefined);
    const now = Date.now();
    if (t.codeSent && t.codeSent > now - CODE_GAP_MS) throw new AppError("Please wait one minute before requesting another code.", 429);
    const fresh = !t.codeWindowStart || t.codeWindowStart + SEND_WINDOW_MS <= now;
    const sends = fresh ? 0 : t.codeSends;
    if (sends >= MAX_SENDS) throw new AppError("Too many attempts on this link. Ask the sender to resend.", 429);
    const ws = await store.getWorkspace(a.workspaceId);
    if (!ws) throw new AppError(GONE, 410);

    const code = String(randomInt(100000, 1000000));
    // Racing requests cannot both be counted as the same send.
    const won = await store.updateSignTokenIf(
      t.id,
      { attempts: t.attempts, codeSends: t.codeSends },
      {
        codeDigest: sha(code),
        codeSent: now,
        codeExpires: now + CODE_LIFE_MS,
        attempts: 0,
        codeSends: sends + 1,
        codeWindowStart: fresh ? now : t.codeWindowStart,
      },
    );
    if (!won) continue;
    try {
      await sendMail(d, ws, {
        to: t.email,
        subject: "Your TaskCalendar verification code",
        text: `Your code is ${code}. It expires in 10 minutes. This verifies email access, not legal identity.`,
        purpose: "otp",
        agreementId: a.id,
        participantId: p.id,
      });
    } catch (e) {
      // Nothing was delivered: the stored code must not stay usable, and the visitor may retry at once.
      await store.updateSignToken(t.id, { codeExpires: 0, codeSent: 0 });
      throw e;
    }
    return { json: { ok: true } };
  }
  throw new AppError(TOO_MANY, 429);
}

/**
 * SR 146–183 with part 1's counted compare. The code is then used up by a
 * compare-and-set on the counters as this call left them: any other verify or
 * send in between changes them, so of two simultaneous correct verifies only
 * one clears the code and gets a session (the other goes round and finds it
 * used). The evidence follows.
 */
async function verifyCode(d: MailDeps, body: Body): Promise<{ json: Record<string, unknown>; session: { raw: string; expires: number } }> {
  const { store } = d;
  for (let n = 0; n < RETRIES; n++) {
    const { t, a, p } = await findInvitation(store, body.access as string | undefined);
    if (!t.codeDigest || !t.codeExpires || t.codeExpires < Date.now() || t.attempts >= MAX_ATTEMPTS) throw new AppError(LIMIT, 403);
    // The attempt is counted before the code is compared, and only one of several racing calls wins each count.
    const counted = await store.updateSignTokenIf(t.id, { attempts: t.attempts, codeSends: t.codeSends }, { attempts: t.attempts + 1 });
    if (!counted) continue;
    if (!sameDigest(t.codeDigest, sha(String(body.code || "")))) throw new AppError("That verification code is incorrect.", 403);
    const used = await store.updateSignTokenIf(
      t.id,
      { attempts: t.attempts + 1, codeSends: t.codeSends },
      { codeDigest: "", codeExpires: 0 },
    );
    if (!used) continue;

    if (t.purpose === "sign")
      await retryWrite(store, a, (cur) => {
        const q = cur.participants.find((x) => x.id === p.id);
        if (!q || cur.status !== AWAITING) return null;
        return {
          // A signer who already signed keeps that progress; the verification is still recorded.
          participants: q.progress === "signed" ? cur.participants : withProgress(cur, q.id, { progress: "verified", verification: "email access verified" }),
          events: withEvent(cur, "Recipient email access verified", q.email, { recipientId: q.id, method: "email access verified" }).events,
        };
      });
    const raw = newSecret();
    const expires = Date.now() + SIGN_SESSION_MS;
    await store.insertSignSession({
      digest: sha(raw),
      tokenId: t.id,
      workspaceId: a.workspaceId,
      agreementId: a.id,
      participantId: p.id,
      purpose: t.purpose,
      version: t.version,
      expires,
    });
    return { json: { ok: true }, session: { raw, expires } };
  }
  throw new AppError(LIMIT, 403);
}

/**
 * SR 96–111 (Ruling B17): a fresh completion link, which revokes the old ones.
 * The answer never says whether the address is known. The link is built on the
 * agreement's link_origin (Ruling B6), never on this unauthenticated request's
 * Origin or Referer, which a caller can forge.
 */
async function recover(d: MailDeps, body: Body): Promise<{ json: Record<string, unknown> }> {
  const email = String(body.email || "")
    .toLowerCase()
    .trim();
  refuseVerdict(await (d.spend ?? realSpend)(d.sb, RECOVER_TOOL, "recover:" + sha(email), 3, 60), () => TOO_MANY);
  const a = isUuid(body.agreementId) ? await d.store.getAgreementById(body.agreementId) : null;
  const p = a?.status === "Completed" ? a.participants.find((x) => x.email === email) : undefined;
  if (a && p) {
    const ws = await d.store.getWorkspace(a.workspaceId);
    if (ws) {
      const r = await invite(d, ws, a, p, linkOriginOf(a), "complete");
      await afterJobs(d, a, r.jobId ? [r.jobId] : []);
    }
  }
  return { json: { ok: true, message: RECOVER_MESSAGE } };
}

/** SR 187–221: the document as the recipient sees it; the first view after verification is recorded once. */
async function documentView(d: MailDeps, s: SignSession, first: StoredAgreement, p: Participant): Promise<{ json: Record<string, unknown> }> {
  let a = first;
  if (s.purpose === "sign" && p.progress === "verified")
    a = await retryWrite(d.store, a, (cur) => {
      const q = cur.participants.find((x) => x.id === p.id);
      if (!q || q.progress !== "verified" || cur.status !== AWAITING) return null;
      return {
        participants: withProgress(cur, q.id, { progress: "viewed" }),
        events: withEvent(cur, "Document viewed by verified recipient", q.email, { recipientId: q.id, sourceHash: sourceOf(cur) }).events,
      };
    });
  const ws = await d.store.getWorkspace(a.workspaceId);
  const me = a.participants.find((x) => x.id === p.id) ?? p;
  return {
    json: {
      id: a.id,
      title: a.title,
      status: a.status,
      sender: ws?.name ?? "",
      logo: ws ? brandingOf(ws).logo : undefined,
      name: me.name,
      email: me.email,
      purpose: s.purpose,
      fields: s.purpose === "sign" ? ownFields(a, me.id) : [],
      pages: a.pages,
      consent: a.frozen?.consent,
      content: a.sourceKind === "authored" ? a.content : "",
      sourceHash: sourceOf(a),
      othersPending: a.participants.filter((x) => x.role === "signer" && x.progress !== "signed").length,
      artifacts: s.purpose === "complete" ? Object.keys(a.artifacts || {}) : [],
    },
  };
}

/** The session, its link checked against the posted one (SR 184–186), and signing rights (SR 222–223). */
async function signer(d: MailDeps, raw: string | undefined, body: Body): Promise<Opened & { s: SignSession }> {
  const o = await signSession(d.store, raw);
  if (body.access && o.t.digest !== sha(String(body.access))) throw new AppError("Verify this invitation to continue.", 403);
  if (o.s.purpose !== "sign" || o.p.role !== "signer") throw new AppError(DOWNLOAD_ONLY, 403);
  return o;
}

/**
 * SR 224–307 as up to WRITE_TRIES compare-and-sets, each on a freshly read
 * session and row. The last signature moves the agreement to Finalising with
 * its snapshot; then the links are revoked and finishing runs inline.
 */
async function sign(d: MailDeps, raw: string | undefined, body: Body): Promise<{ json: Record<string, unknown> }> {
  const { store } = d;
  let drawingChecked = false;
  for (let n = 0; n < WRITE_TRIES; n++) {
    const { t, a, p } = await signer(d, raw, body);
    // Ruling B3: the live token is the participant's current link, so its version carries forward.
    const current = { ...a, participants: withProgress(a, p.id, { version: Math.max(p.version, t.version) }) };
    const { participant, detail } = acceptSignature(current, p.id, body, new Date().toISOString());
    if (!drawingChecked) {
      // SR route.ts 297: bytes that are not a usable PNG are refused before acceptance.
      await validateDrawing(body.drawing);
      drawingChecked = true;
    }
    const participants = a.participants.map((x) => (x.id === p.id ? participant : x));
    const pending = participants.filter((x) => x.role === "signer" && x.progress !== "signed");
    let next = withEvent(a, "Signature accepted", p.email, detail);
    const patch: AgreementPatch = { participants };
    if (!pending.length) {
      next = withEvent(next, "All signers finished; finalisation queued", "system");
      patch.status = "Finalising";
      patch.finalSnapshot = structuredClone(next.events);
    }
    patch.events = next.events;
    const out = await store.updateAgreement(a.workspaceId, a.id, a.rowVersion, patch);
    if (!out) continue;

    // The signature has committed: what follows never changes the answer.
    try {
      if (!pending.length) {
        await store.revokeSignTokens(a.id);
        const job = await enqueue(d, {
          workspaceId: a.workspaceId,
          agreementId: a.id,
          kind: "finalise",
          purpose: "finalise",
          dedupe: "finalise:" + a.id,
          payload: "",
        });
        await runJobs(d, { ids: [job.id] });
      } else {
        const ws = await store.getWorkspace(a.workspaceId);
        if (ws) {
          const act = await activate(d, ws, out, linkOriginOf(out));
          await afterJobs(d, act.a, act.jobIds);
        }
      }
    } catch (e) {
      // Finishing is picked up by maintain; a next signer left "waiting" is invited by Resend.
      console.error("[signroom] after signing failed", errorTag(e));
    }
    return { json: { ok: true, pending: pending.length } };
  }
  throw new AppError(CHANGED, 409);
}

/** SR 308–323: one compare-and-set to Declined, then every link is revoked and the sender told. */
async function decline(d: MailDeps, raw: string | undefined, body: Body): Promise<{ json: Record<string, unknown> }> {
  const { a, p } = await signer(d, raw, body);
  const out = await writeAgreement(
    d.store,
    a,
    {
      status: "Declined",
      participants: withProgress(a, p.id, { progress: "declined" }),
      events: withEvent(a, "Recipient declined", p.email, { reason: String(body.reason || "").slice(0, 1000), recipientId: p.id }).events,
    },
    CHANGED,
  );
  // The decline has committed: what follows never changes the answer.
  try {
    await d.store.revokeSignTokens(a.id);
  } catch (e) {
    console.error("[signroom] after declining failed", errorTag(e));
  }
  const jobIds: string[] = [];
  const to = out.frozen?.sender?.email;
  if (to)
    try {
      const job = await queueMail(d, {
        workspaceId: a.workspaceId,
        agreementId: a.id,
        to,
        subject: `Declined: ${a.title}`,
        text: `${p.name} declined. Reason: ${String(body.reason || "Not provided").slice(0, 1000)}. The sender can see this reason.`,
        purpose: "notice",
        dedupe: `notice:declined:${a.id}`,
      });
      jobIds.push(job.id);
    } catch (e) {
      // The decline stands without its notice.
      console.error("[signroom] decline notice failed", errorTag(e));
    }
  try {
    await afterJobs(d, out, jobIds);
  } catch (e) {
    console.error("[signroom] after declining failed", errorTag(e));
  }
  return { json: { ok: true } };
}

/**
 * Port of SR guest.ts guestAction (90–325). `raw` is the sr_sign cookie.
 * `origin` (the request's) is part of the route contract but builds no link:
 * every link a guest action makes uses the agreement's link_origin (Ruling B6).
 */
export async function agreementGuestAction(
  d: MailDeps,
  action: SignGuestAction,
  body: Body,
  raw: string | undefined,
  _origin: string,
): Promise<{ json: Record<string, unknown>; session?: { raw: string; expires: number } }> {
  if (action === "recover") return recover(d, body);
  if (action === "intro") {
    const { t } = await findInvitation(d.store, body.access as string | undefined);
    return { json: { ok: true, purpose: t.purpose } };
  }
  if (action === "code") return sendCode(d, body);
  if (action === "verify") return verifyCode(d, body);
  if (action === "document") {
    const { s, t, a, p } = await signSession(d.store, raw);
    if (body.access && t.digest !== sha(String(body.access))) throw new AppError("Verify this invitation to continue.", 403);
    return documentView(d, s, a, p);
  }
  if (action === "sign") return sign(d, raw, body);
  if (action === "decline") return decline(d, raw, body);
  throw new AppError("Unknown signing action.");
}

/**
 * SR route.ts 748–757 as a link: a signing session sees the source only; a
 * completion session also the final PDF and completion record. A 60-second
 * signed Storage URL with the download name, so a large PDF never passes
 * through the function.
 */
export async function agreementGuestArtifactUrl(d: MailDeps, raw: string | undefined, kind: string): Promise<{ url: string; filename: string }> {
  const { s, a } = await signSession(d.store, raw);
  if (s.purpose !== "complete" && kind !== "source") throw new AppError("This access is limited to the source document.", 403);
  return artifactLink(d.store, a, kind, true);
}

/** SR route.ts 758–763: the evidence ZIP built at finishing (Ruling B11), as a signed link. */
export async function agreementGuestExport(d: MailDeps, raw: string | undefined): Promise<{ url: string; filename: string }> {
  const { s, a } = await signSession(d.store, raw);
  if (s.purpose !== "complete") throw new AppError("Completion access required.", 403);
  const hash = a.artifacts?.export;
  if (!hash) throw new AppError("Evidence export becomes available after completion.", 409);
  const filename = ARTIFACT_NAMES.export.replace(/\.zip$/, `-${a.id}.zip`);
  return { url: await d.store.signedBlobUrl(a.workspaceId, hash, ARTIFACT_URL_SECONDS, filename), filename };
}
