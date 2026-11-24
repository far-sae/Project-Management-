import { AppError } from "./errors.js";
import { ARTIFACT_URL_SECONDS, openAgreement, publicAgreement, withEvent, writeAgreement } from "./agreements.js";
import { SWEEP_AFTER_MS } from "./agreementDocument.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import { decryptPayload, encryptPayload } from "./jobs.js";
import type { MailDeps } from "./mail.js";
import type { Store } from "./store.js";
import type { Agreement, Job } from "./shared/types.js";

/**
 * Evidence export and controlled retention deletion: SR route.ts exportAgreement
 * (898–940), service.ts agreementAction "delete" (1024–1043) and the delete job
 * of worker.ts (371–451), without disk. Deletion is irreversible, so the
 * database has the last word (Ruling B12): sr_agreements_guard refuses the
 * delete unless the date has passed, there is no legal hold and the agreement
 * is not being signed, and a blob goes only when nothing else refers to it.
 */

const NOT_READY = "Evidence export becomes available after completion.";
const now = () => new Date().toISOString();

/**
 * Ruling B13: a POST that records the export and returns a 60 s signed link to
 * the ZIP built at finishing (Ruling B11), so the ZIP never passes through the
 * function. SR's GET built the ZIP and wrote on read.
 */
export async function exportEvidence(store: Store, user: SignedInUser, id: string): Promise<{ url: string; filename: string; agreement: Agreement }> {
  const { a } = await openAgreement(store, user, id, "export");
  const hash = a.artifacts?.export;
  if (a.status !== "Completed" || !hash) throw new AppError(NOT_READY, 409);
  const out = await writeAgreement(store, a, {
    exportedAt: now(),
    events: withEvent(a, "Authorised evidence export downloaded", user.email).events,
  });
  const filename = `signroom-evidence-${a.id}.zip`;
  const url = await store.signedBlobUrl(a.workspaceId, hash, ARTIFACT_URL_SECONDS, filename);
  return { url, filename, agreement: publicAgreement(out) };
}

/** SR service.ts "delete": owner only, after export, never on hold or mid-signing; the date honours the workspace's retention. */
export async function scheduleDeletion(store: Store, user: SignedInUser, id: string): Promise<Agreement> {
  const { a } = await openAgreement(store, user, id, "delete");
  const { workspace } = await currentWorkspace(store, user, { owner: true });
  if (a.legalHold) throw new AppError("Release the documented legal hold before scheduling deletion.", 409);
  if (!a.exportedAt) throw new AppError("Export the agreement before scheduling deletion.");
  if (["Awaiting signatures", "Finalising"].includes(a.status)) throw new AppError("Cancel or complete this agreement first.");
  const earliest = new Date(a.completedAt || a.updated).getTime() + workspace.retentionDays * 86400000;
  const deletionAt = new Date(Math.max(Date.now(), earliest)).toISOString();
  return publicAgreement(
    await writeAgreement(store, a, {
      deletionAt,
      events: withEvent(a, "Retention deletion scheduled", user.email, { deletionAt }).events,
    }),
  );
}

export const DELETE_HOLD_MESSAGE = "Release the documented legal hold before deleting this agreement.";
export const DELETE_SIGNING_MESSAGE = "Cancel or complete this agreement first.";

/**
 * Deletes an agreement now, with its stored files. The owner asked for it,
 * as for invoices, and only the owner may: a signed agreement is evidence, and
 * whether it may go is theirs to answer for. It does not wait for an export or
 * for the retention time, which is what scheduleDeletion is for.
 *
 * Two things are never deleted this way, and the database refuses them too:
 * an agreement people are signing right now, and one under a legal hold.
 */
export async function deleteAgreementNow(store: Store, user: SignedInUser, id: string): Promise<{ deleted: true; title: string }> {
  await currentWorkspace(store, user, { owner: true });
  const { a } = await openAgreement(store, user, id, "delete");
  if (a.legalHold) throw new AppError(DELETE_HOLD_MESSAGE, 409);
  if (["Awaiting signatures", "Finalising"].includes(a.status)) throw new AppError(DELETE_SIGNING_MESSAGE, 409);

  const hashes = [
    ...new Set([a.documentHash, a.senderSignedHash, a.frozen?.sourceHash, ...Object.values(a.artifacts ?? {})].filter((h): h is string => !!h)),
  ];
  // The database lets an agreement go only once its deletion date has come.
  // The owner says it has: a minute ago, so that two clocks a little apart agree.
  const due = await writeAgreement(store, a, {
    deletionAt: new Date(Date.now() - 60_000).toISOString(),
    events: withEvent(a, "Deleted by the owner", user.email).events,
  });
  if (!(await store.deleteAgreement(due.workspaceId, due.id))) {
    // Refused after all (it changed in between): the date is taken back, so nothing deletes it later by itself.
    await store.updateAgreement(due.workspaceId, due.id, due.rowVersion, { deletionAt: "" }).catch(() => null);
    throw new AppError("The agreement could not be deleted. Reload it and try again.", 409);
  }
  // Its stored files go too, each one unless something else still uses the same file.
  for (const hash of hashes) {
    try {
      if (!(await store.blobInUse(due.workspaceId, hash))) await store.removeBlob(due.workspaceId, hash);
    } catch {
      console.error("[signroom] a file of a deleted agreement could not be removed");
    }
  }
  return { deleted: true, title: a.title };
}

/** What a delete job keeps, encrypted, between deleting the row and removing its blobs. */
type Pending = { hashes: string[]; workspaceId: string; agreementId: string };

function jobKey(d: MailDeps): Buffer {
  if (!d.jobKey) throw new AppError("Job key missing", 503);
  return d.jobKey;
}

/**
 * The delete job (SR worker.ts 371–451). The row goes first, by the guarded
 * database delete; its blob hashes are kept in the job's encrypted payload so
 * a run that dies before the blobs are gone resumes from them. A blob still
 * used by anything else in the workspace stays. A throw is a processing error
 * (the runner retries it).
 */
export async function retentionDelete(d: MailDeps, job: Job): Promise<void> {
  const a = job.agreementId ? await d.store.getAgreement(job.workspaceId, job.agreementId) : null;
  let pending: Pending;
  if (!a && job.payload) pending = decryptPayload(jobKey(d), job.payload) as Pending;
  else {
    if (!a || a.legalHold || !a.deletionAt || Date.parse(a.deletionAt) > Date.now()) {
      await d.store.updateJob(job.id, { status: "suppressed", payload: "" });
      return;
    }
    const hashes = [
      ...new Set([a.documentHash, a.senderSignedHash, a.frozen?.sourceHash, ...Object.values(a.artifacts ?? {})].filter((h): h is string => !!h)),
    ];
    pending = { hashes, workspaceId: a.workspaceId, agreementId: a.id };
    await d.store.updateJob(job.id, { payload: encryptPayload(jobKey(d), pending) });
    await d.store.clearJobPayloads(a.id, job.id);
    // Leftover quarantine uploads (tickets never finished) would outlive their
    // cascaded sr_uploads rows. A deletable agreement finished at least a day
    // ago, so all of its tickets are past the sweep age.
    await d.store.sweepUploads(a.workspaceId, new Date(Date.now() - SWEEP_AFTER_MS).toISOString());
    if (!(await d.store.deleteAgreement(a.workspaceId, a.id))) {
      await d.store.updateJob(job.id, { status: "suppressed", payload: "" });
      return;
    }
  }
  for (const hash of pending.hashes) if (!(await d.store.blobInUse(pending.workspaceId, hash))) await d.store.removeBlob(pending.workspaceId, hash);
  await d.store.updateJob(job.id, { status: "done", payload: "", error: "" });
}
