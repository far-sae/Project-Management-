import { AppError } from "./errors.js";
import { withEvent } from "./agreements.js";
import { completionPdf, finalPdf } from "./agreementPdf.js";
import { invite, linkOriginOf, stableJson } from "./agreementSend.js";
import { EVIDENCE_README, evidenceZip, MANIFEST_STATEMENT, signManifest, type ManifestPayload } from "./evidence.js";
import { queueMail } from "./jobs.js";
import type { MailDeps } from "./mail.js";
import type { StoredAgreement } from "./store.js";
import type { Job, Participant, Workspace } from "./shared/types.js";

const errorTag = (e: unknown) => (e instanceof AppError ? e.status : e instanceof Error ? e.name : "error");
const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * Port of SR worker.ts finalise() (39–121). Builds and stores the final PDF,
 * the completion record, events.json, the signed manifest and the evidence
 * ZIP, then one compare-and-set from Finalising to Completed commits them
 * (Ruling B10: no staging files; blobs are content-addressed, so a retried run
 * lands equal bytes at the same path). Afterwards every participant gets a
 * completion link and the sender a notice; their job ids are the follow-ups.
 * Any throw is a processing error and the runner retries the job: before the
 * commit, and after it when a completion link or the notice could not be
 * queued. A rerun that finds the agreement Completed (that case, or a run that
 * died between the commit and the emails) re-issues the link to every
 * participant without a live one and queues the notice again (deduped).
 */
export async function finalise(d: MailDeps, job: Job): Promise<string[]> {
  const done = async (more: string[]) => {
    await d.store.updateJob(job.id, { status: "done", payload: "", error: "", manualReview: false });
    return more;
  };
  if (!job.agreementId) throw new Error("Finalisation state invalid");
  const a = await d.store.getAgreement(job.workspaceId, job.agreementId);
  if (!a) return done([]);
  if (a.status === "Completed") {
    const ws = await d.store.getWorkspace(a.workspaceId);
    if (!ws) throw new Error("Workspace missing");
    const t = (d.now ? d.now() : new Date()).getTime();
    const live = new Set(
      (await d.store.listSignTokens(a.id)).filter((x) => x.purpose === "complete" && !x.revoked && x.expires > t).map((x) => x.participantId),
    );
    return done(await completionMail(d, ws, a, (p) => !live.has(p.id)));
  }
  const frozen = a.frozen;
  const snapshot = a.finalSnapshot;
  if (a.status !== "Finalising" || !frozen || !snapshot?.length) throw new Error("Finalisation state invalid");
  if (a.participants.some((p) => p.role === "signer" && p.progress !== "signed")) throw new Error("Missing signatures");

  // Ruling B7: a key that no longer matches its recorded public key throws here, and the agreement stays Finalising.
  const key = d.evidenceKey;
  if (!key) throw new AppError("Evidence key missing", 503);
  await d.store.registerEvidenceKey(key.keyId, key.publicKeyPem);
  const ws = await d.store.getWorkspace(a.workspaceId);
  if (!ws) throw new Error("Workspace missing");

  const put = (bytes: Uint8Array) => d.store.putBlob(a.workspaceId, bytes);
  const load = (w: string, h: string) => d.store.getBlob(w, h);
  const source = await d.store.getBlob(a.workspaceId, frozen.sourceHash);
  const final = await finalPdf(a, source, false);
  const finalHash = await put(final);
  const completion = await completionPdf(a, frozen.sourceHash, finalHash, load);
  const completionHash = await put(completion);
  // Ruling B9: jsonb does not keep key order, so the snapshot is written with sorted keys.
  const events = utf8(stableJson(snapshot));
  const eventsHash = await put(events);
  const completedAt = snapshot[snapshot.length - 1].at;
  const payload: ManifestPayload = {
    schema: "signroom-evidence-v1",
    keyId: key.keyId,
    agreementId: a.id,
    sourceHash: frozen.sourceHash,
    ...(a.senderSignedHash ? { senderSignedHash: a.senderSignedHash } : {}),
    finalHash,
    completionHash,
    eventsHash,
    consent: frozen.consent,
    completedAt,
    statement: MANIFEST_STATEMENT,
  };
  const manifest = utf8(JSON.stringify(signManifest(payload, key), null, 2));
  const manifestHash = await put(manifest);

  // Ruling B11: the export is built once, here, with a fixed time, so the same agreement always gives the same ZIP.
  const files: Record<string, Uint8Array> = {
    "source.pdf": source,
    "final.pdf": final,
    "completion.pdf": completion,
    "events.json": events,
    "manifest.json": manifest,
    "public-key.pem": utf8(key.publicKeyPem),
    "README.txt": utf8(EVIDENCE_README),
  };
  if (a.senderSignedHash) files["sender-signed.pdf"] = await d.store.getBlob(a.workspaceId, a.senderSignedHash);
  const exportHash = await put(evidenceZip(files, new Date(completedAt)));

  const artifacts = {
    source: frozen.sourceHash,
    ...(a.senderSignedHash ? { senderSigned: a.senderSignedHash } : {}),
    final: finalHash,
    completion: completionHash,
    events: eventsHash,
    manifest: manifestHash,
    export: exportHash,
  };
  const completed = await commit(d, a, artifacts, { sourceHash: frozen.sourceHash, finalHash, completionHash, manifestHash });
  if (!completed) return done([]);
  return done(await completionMail(d, ws, completed, () => true));
}

/**
 * A completion link for each chosen participant and the sender's notice
 * (deduped by `notice:completed:<id>`, so queueing it again is safe). The job
 * ids are returned as follow-ups. If any link or the notice could not be
 * queued it throws, after trying them all, so the runner retries the finalise
 * job and the rerun re-issues what is missing.
 */
async function completionMail(d: MailDeps, ws: Workspace, a: StoredAgreement, chosen: (p: Participant) => boolean): Promise<string[]> {
  const more: string[] = [];
  let missed = false;
  const origin = linkOriginOf(a);
  for (const p of a.participants.filter(chosen)) {
    const r = await invite(d, ws, a, p, origin, "complete");
    if (r.jobId) more.push(r.jobId);
    else missed = true;
  }
  // Ruling B20: the notice goes to the sender address frozen at send.
  const to = a.frozen?.sender?.email;
  if (to)
    try {
      const notice = await queueMail(d, {
        workspaceId: a.workspaceId,
        agreementId: a.id,
        to,
        subject: `Completed: ${a.title}`,
        text: "The signed agreement, completion record and application-level evidence export are ready in the workspace.",
        purpose: "notice",
        dedupe: `notice:completed:${a.id}`,
      });
      more.push(notice.id);
    } catch (e) {
      console.error("[signroom] completion notice failed", errorTag(e));
      missed = true;
    }
  // The links already queued are sent by the every-minute run.
  if (missed) throw new Error("Completion emails not queued");
  return more;
}

/**
 * The commit: Finalising to Completed with the artifacts and SR's event. On a
 * lost write it re-reads: Completed means another run finished (null),
 * Finalising is tried once more, and anything else throws.
 */
async function commit(
  d: MailDeps,
  a: StoredAgreement,
  artifacts: Record<string, string>,
  detail: Record<string, unknown>,
): Promise<StoredAgreement | null> {
  let cur = a;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await d.store.updateAgreement(cur.workspaceId, cur.id, cur.rowVersion, {
      status: "Completed",
      completedAt: (d.now ? d.now() : new Date()).toISOString(),
      artifacts,
      events: withEvent(cur, "Completion artifacts persisted", "system", detail).events,
    });
    if (out) return out;
    const fresh = await d.store.getAgreement(cur.workspaceId, cur.id);
    if (fresh?.status === "Completed") return null;
    if (fresh?.status !== "Finalising") break;
    cur = fresh;
  }
  throw new Error("Finalisation state changed");
}
