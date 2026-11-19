import { AppError, StoreError } from "./errors.js";
import { setupSentence } from "./setupMessages.js";
import { expireIfDue, withEvent } from "./agreements.js";
import { invite, linkOriginOf } from "./agreementSend.js";
import { finalise } from "./finishing.js";
import { sendMail, type MailDeps, type Route } from "./mail.js";
import { retentionDelete } from "./retention.js";
import {
  appendEvent,
  backoffSeconds,
  COMPLETION_REQUEUES,
  CRON_LIMIT,
  decryptPayload,
  enqueue,
  FAILED_JOB_MESSAGE,
  HELD_DELIVERY_MESSAGE,
  HELD_MESSAGE,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  queueMail,
  RUN_BUDGET_MS,
  type MailPayload,
} from "./jobs.js";
import type { StoredAgreement } from "./store.js";
import type { Job } from "./shared/types.js";

/**
 * Port of SR lib/v2/worker.ts runJobs(): claims one job at a time under a lease
 * and settles it. A handler returns the ids of follow-up jobs to run in the same pass.
 */
export type Handler = (d: MailDeps, job: Job) => Promise<string[] | void>;

const nowMs = (d: MailDeps) => (d.now ? d.now() : new Date()).getTime();
const errorTag = (e: unknown) => (e instanceof AppError ? e.status : e instanceof Error ? e.name : "error");

/** Agreement states in which invitations, reminders and completion links are no longer sent (SR worker.ts). */
const STOPPED = ["Cancelled", "Expired", "Declined"];
const STOPPABLE = ["invite", "reminder", "completion"];

/**
 * A held agreement email leaves its delivery row failed with
 * HELD_DELIVERY_MESSAGE, so the sender sees "Delivery: failed". The row the
 * live attempt wrote is found by its job id; when the run died before writing
 * one, a failed row is added. Bookkeeping failures are logged, never thrown.
 */
async function holdDelivery(d: MailDeps, job: Job, mail: MailPayload, route?: Route): Promise<void> {
  if (!job.agreementId) return;
  try {
    if (await d.store.holdJobDelivery(job.id, HELD_DELIVERY_MESSAGE)) return;
    await d.store.insertDelivery({
      workspaceId: job.workspaceId,
      ...(job.agreementId ? { agreementId: job.agreementId } : {}),
      ...(job.participantId ? { participantId: job.participantId } : {}),
      jobId: job.id,
      recipient: mail.to,
      subject: mail.subject,
      purpose: job.purpose,
      ...(route ? { route } : {}),
      status: "failed",
      error: HELD_DELIVERY_MESSAGE,
    });
  } catch (e) {
    console.error("[signroom] held delivery failed", errorTag(e));
  }
}

/** Ruling B2: an unclear live outcome is failed for review and never sent again. */
async function hold(d: MailDeps, job: Job, why: string | number, mail: MailPayload, route?: Route): Promise<void> {
  console.error("[signroom] job failed", job.kind, why);
  await d.store.updateJob(job.id, { status: "failed", manualReview: true, error: HELD_MESSAGE });
  await holdDelivery(d, job, mail, route);
  if (job.agreementId)
    await appendEvent(d.store, job.workspaceId, job.agreementId, "Background processing delayed", "system", {
      jobId: job.id,
      kind: job.kind,
      attempt: job.attempts,
    });
}

/** Not sent. When the last run died mid-send, its delivery row must not stay "sending". */
async function suppress(d: MailDeps, job: Job): Promise<void> {
  await d.store.updateJob(job.id, { status: "suppressed", payload: "" });
  if (job.liveAttemptedAt)
    try {
      await d.store.holdJobDelivery(job.id, HELD_DELIVERY_MESSAGE);
    } catch (e) {
      console.error("[signroom] held delivery failed", errorTag(e));
    }
}

/** Port of SR worker.ts 202–363 without the sandbox branches. */
const mailHandler: Handler = async (d, job) => {
  // Retention deletion empties the payloads of its agreement's jobs: nothing is left to send.
  if (!job.payload) return suppress(d, job);
  if (!d.jobKey) throw new AppError("Job key missing", 503);
  const p = decryptPayload(d.jobKey, job.payload) as MailPayload;

  const a = job.agreementId ? await d.store.getAgreement(job.workspaceId, job.agreementId) : null;
  const t = p.tokenId ? await d.store.getSignToken(p.tokenId) : null;
  if ((a && STOPPED.includes(a.status) && STOPPABLE.includes(job.purpose)) || (t && (t.revoked || t.expires < nowMs(d)))) return suppress(d, job);

  // Claimed with a recorded live attempt: the last run died mid-send.
  if (job.liveAttemptedAt) return hold(d, job, "held", p);

  const ws = await d.store.getWorkspace(job.workspaceId);
  if (!ws) throw new Error("Workspace missing");

  let live = false;
  let route: Route | undefined;
  try {
    ({ route } = await sendMail(
      d,
      ws,
      { to: p.to, subject: p.subject, text: p.text, purpose: job.purpose, agreementId: job.agreementId, participantId: job.participantId, jobId: job.id },
      {
        sending: async (chosen) => {
          live = true;
          route = chosen;
          // False means another runner already holds the live attempt.
          if (!(await d.store.markLiveAttempt(job.id))) throw new Error("Live attempt already recorded");
        },
      },
    ));
  } catch (e) {
    // A refusal before `sending` is definite: the runner retries it.
    if (!live) throw e;
    return hold(d, job, errorTag(e), p, route);
  }

  await d.store.updateJob(job.id, { status: "done", payload: "", error: "", manualReview: false });
  if (job.agreementId)
    await appendEvent(d.store, job.workspaceId, job.agreementId, "Email accepted by provider", "system", {
      purpose: job.purpose,
      recipientId: job.participantId,
      route,
    });
};

/** Finalise and delete jobs settle themselves; a throw is a processing error (backoff, then failed). */
const HANDLERS: Partial<Record<Job["kind"], Handler>> = {
  mail: mailHandler,
  finalise: (d, job) => finalise(d, job),
  delete: (d, job) => retentionDelete(d, job),
};

/**
 * A definite refusal or a processing error: back in the queue after the
 * backoff, or failed after MAX_ATTEMPTS. Settling never throws.
 */
async function retryLater(d: MailDeps, job: Job, e: unknown): Promise<void> {
  console.error("[signroom] job failed", job.kind, errorTag(e));
  try {
    if (job.attempts < MAX_ATTEMPTS)
      await d.store.updateJob(job.id, { status: "queued", available: nowMs(d) + backoffSeconds(job.attempts) * 1000 });
    else await d.store.updateJob(job.id, { status: "failed", error: FAILED_JOB_MESSAGE });
  } catch (updateErr) {
    // The lease runs out and the next run claims it again.
    console.error("[signroom] job failed", job.kind, errorTag(updateErr));
  }
  // A job maintenance queued again after it failed (attempt 6 on) is logged only:
  // the agreement's events are signed evidence, and an hourly retry must not fill them.
  if (job.agreementId && job.attempts <= MAX_ATTEMPTS)
    await appendEvent(d.store, job.workspaceId, job.agreementId, "Background processing delayed", "system", {
      jobId: job.id,
      kind: job.kind,
      attempt: job.attempts,
    });
}

async function runOne(d: MailDeps, job: Job): Promise<string[]> {
  try {
    const handler = HANDLERS[job.kind];
    if (!handler) throw new Error("Unknown job kind");
    const more = await handler(d, job);
    return Array.isArray(more) ? more : [];
  } catch (e) {
    await retryLater(d, job, e);
    return [];
  }
}

/**
 * Claims and runs jobs one at a time until none is due, `limit` (CRON_LIMIT by
 * default) have been claimed, or `budgetMs` (RUN_BUDGET_MS) has passed. With `ids` (an
 * inline run) only those jobs, and the follow-ups they return, are claimed.
 */
export async function runJobs(d: MailDeps, opts: { ids?: string[]; limit?: number; budgetMs?: number } = {}): Promise<{ processed: number }> {
  const started = Date.now();
  const limit = opts.limit ?? CRON_LIMIT;
  const budget = opts.budgetMs ?? RUN_BUDGET_MS;
  const ids = opts.ids ? [...opts.ids] : undefined;
  let processed = 0;
  while (processed < limit && Date.now() - started < budget) {
    if (ids && ids.length === 0) break;
    const [job] = await d.store.claimJobs(1, LEASE_SECONDS, ids);
    if (!job) break;
    processed++;
    const more = await runOne(d, job);
    if (ids) ids.push(...more.filter((id) => !ids.includes(id)));
  }
  return { processed };
}

/** At most this many agreements per list, per run (SR maintain walked them all). */
export const MAINTENANCE_LIMIT = 200;
const DAY_MS = 86_400_000;
const EXPIRY_NOTICE = "Expiry notification queued";

/**
 * The "Expiry notification queued" event, written once: re-read, skip when it
 * is already there, compare-and-set (up to 3 tries), so overlapping runs never
 * write it twice. A final loss is logged; the next run tries again (the
 * notice itself is deduped).
 */
async function expiryEventOnce(d: MailDeps, row: StoredAgreement): Promise<void> {
  for (let n = 0; n < 3; n++) {
    const a = await d.store.getAgreement(row.workspaceId, row.id);
    if (!a || a.events.some((e) => e.type === EXPIRY_NOTICE)) return;
    if (await d.store.updateAgreement(a.workspaceId, a.id, a.rowVersion, { events: withEvent(a, EXPIRY_NOTICE, "system").events })) return;
  }
  console.error("[signroom] event append failed", EXPIRY_NOTICE);
}

/**
 * SR maintain, one agreement from listDueAgreements: expiry (and the sender's
 * notice, once), else an automatic reminder. The reminder is claimed by one
 * compare-and-set of lastReminderAt with its event; a lost write (another run,
 * or any other change) skips the agreement until the next run. Reminders
 * reissue the link without revoking the old one or moving the version.
 */
async function remindOrExpire(d: MailDeps, row: StoredAgreement): Promise<void> {
  const a = await expireIfDue(d.store, row);
  if (a.status === "Expired") {
    if (a.events.some((e) => e.type === EXPIRY_NOTICE)) return;
    // Ruling B20: the notice goes to the sender address frozen at send.
    const to = a.frozen?.sender?.email;
    if (to)
      await queueMail(d, {
        workspaceId: a.workspaceId,
        agreementId: a.id,
        to,
        subject: `Expired: ${a.title}`,
        text: "The signing deadline has passed. Remaining signing access was revoked.",
        purpose: "notice",
        dedupe: `notice:expired:${a.id}`,
      });
    await expiryEventOnce(d, a);
    return;
  }
  if (a.status !== "Awaiting signatures" || a.senderReleasePending || !(a.reminderDays > 0)) return;
  if (!(Date.now() - new Date(a.lastReminderAt || a.sentAt || "").getTime() > a.reminderDays * DAY_MS)) return;
  const out = await d.store.updateAgreement(a.workspaceId, a.id, a.rowVersion, {
    lastReminderAt: new Date().toISOString(),
    events: withEvent(a, "Automatic reminders queued", "system").events,
  });
  if (!out) return;
  const ws = await d.store.getWorkspace(out.workspaceId);
  if (!ws) return;
  const origin = linkOriginOf(out);
  for (const p of out.participants.filter((p) => p.role === "signer" && !["signed", "waiting"].includes(p.progress)))
    await invite(d, ws, out, p, origin, "reminder", { rotate: false });
}

/**
 * Retention (SR maintain): the delete job, once. A job suppressed earlier (a
 * legal hold since released, or a date moved) is queued again: the dedupe key
 * is unique across every status, so a second job could never be added.
 */
async function enqueueDeletion(d: MailDeps, a: StoredAgreement): Promise<void> {
  const job = await enqueue(d, { workspaceId: a.workspaceId, agreementId: a.id, kind: "delete", purpose: "retention", dedupe: "delete:" + a.id, payload: "" });
  // Only while it is still suppressed (another run may have moved it); its attempts start again.
  if (job.status === "suppressed") await d.store.requeueJob(job.id, "suppressed", { resetAttempts: true });
}

/**
 * A Finalising agreement with no finalise job to run it (the enqueue after the
 * Finalising write failed) gets one. A failed one, listed once its wait has
 * passed (sr_finalising_stranded), is queued again for one more attempt.
 */
async function requeueFinalise(d: MailDeps, a: StoredAgreement): Promise<void> {
  const job = await enqueue(d, { workspaceId: a.workspaceId, agreementId: a.id, kind: "finalise", purpose: "finalise", dedupe: "finalise:" + a.id, payload: "" });
  // Only while it is still failed. Its attempts are kept: each requeue is one more try, and the wait doubles.
  if (job.status === "failed") await d.store.requeueJob(job.id, "failed");
}

/**
 * A completion email refused before sending (a send limit; a held one is
 * never listed) failed after its quick tries. Listed by
 * sr_completion_mail_refused a day after each failure, it is queued again with
 * its attempts kept, so each requeue is one more try (a refusal fails it at
 * once) and it stops after COMPLETION_REQUEUES.
 */
async function requeueCompletion(d: MailDeps, job: Job): Promise<void> {
  if (job.attempts >= MAX_ATTEMPTS + COMPLETION_REQUEUES) return;
  await d.store.requeueJob(job.id, "failed");
}

/** One list, row by row, until RUN_BUDGET_MS from `started`. A failure is logged by status or name only and the run goes on. */
async function each<T>(started: number, list: () => Promise<T[]>, work: (row: T) => Promise<void>): Promise<void> {
  let rows: T[];
  try {
    rows = await list();
  } catch (e) {
    console.error("[signroom] maintenance failed", errorTag(e));
    return;
  }
  for (const row of rows) {
    if (Date.now() - started >= RUN_BUDGET_MS) return;
    try {
      await work(row);
    } catch (e) {
      console.error("[signroom] maintenance failed", errorTag(e));
    }
  }
}

/**
 * Port of SR worker.ts maintain() (122–184) over bounded lists: deadlines and
 * reminders, retention deletion, finishing that has no job and completion
 * emails refused by a send limit (once a day, up to 7 times); then sign
 * sessions expired over a day ago and jobs settled over 30 days ago are
 * removed. Emails are queued here and sent by the jobs run that follows.
 */
export async function maintain(d: MailDeps): Promise<void> {
  const started = Date.now();
  await each(started, () => d.store.listDueAgreements(MAINTENANCE_LIMIT), (a) => remindOrExpire(d, a));
  await each(started, () => d.store.listDeletionsDue(MAINTENANCE_LIMIT), (a) => enqueueDeletion(d, a));
  await each(started, () => d.store.listStrandedFinalising(MAINTENANCE_LIMIT), (a) => requeueFinalise(d, a));
  await each(started, () => d.store.listRefusedCompletionMail(MAINTENANCE_LIMIT), (j) => requeueCompletion(d, j));
  try {
    await d.store.deleteSignSessions(Date.now() - DAY_MS);
    await d.store.purgeJobs(new Date(Date.now() - 30 * DAY_MS).toISOString());
  } catch (e) {
    console.error("[signroom] maintenance failed", errorTag(e));
  }
  // Pending Google and Microsoft sign-ins past their ten minutes. Only where own mailboxes are
  // switched on (the mail key), and quietly while migration 186, which adds the table, is not run.
  if (d.key) {
    try {
      await d.store.purgeOAuthStates(Date.now());
    } catch (e) {
      if (!(e instanceof StoreError && setupSentence(e.message))) console.error("[signroom] maintenance failed", errorTag(e));
    }
  }
}

/**
 * The scheduled run (ops/run, called by Vercel's cron every 5 minutes): maintain, then the due jobs, both inside
 * one RUN_BUDGET_MS (Ruling B15). A failed claim is logged by name and ends the
 * run; the jobs stay queued for the next one.
 */
export async function runOps(d: MailDeps): Promise<{ processed: number }> {
  const started = Date.now();
  try {
    await maintain(d);
  } catch (e) {
    console.error("[signroom] maintenance failed", errorTag(e));
  }
  try {
    return await runJobs(d, { budgetMs: Math.max(0, RUN_BUDGET_MS - (Date.now() - started)) });
  } catch (e) {
    console.error("[signroom] jobs run failed", e instanceof Error ? e.name : "error");
    return { processed: 0 };
  }
}
