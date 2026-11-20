import { AppError } from "../_signroom/errors.js";
import { runInBackground } from "../_signroom/host/background.js";
import { isUuid } from "../_signroom/validate.js";
import { currentWorkspace, refuseUnlessMayDecide, type Ctx, type SignedInUser } from "./context.js";
import { nowOf, type AutoDeps } from "./deps.js";
import { envFor, isOver, stopRun } from "./engine.js";
import { markReplied } from "./events.js";
import { NOT_FOUND_MESSAGE, NOT_SET_UP_MESSAGE, RUN_OVER_MESSAGE } from "./messages.js";
import { runDue } from "./runner.js";
import type { Run, RunStatus, RunSummary } from "./shared/types.js";
import type { AutoStore, StoredRun } from "./store.js";
import { clean } from "./validate.js";
import { runSummary, runView } from "./views.js";

/**
 * Runs: the list, one run's full record, stopping one, and telling it the
 * lead replied. Anyone in the workspace may read; stopping and "replied" are
 * for an Owner or the person who owns the lead.
 */

export const RUNS_MAX = 100;
const STATUSES: RunStatus[] = ["running", "waiting", "needs_approval", "finished", "stopped", "failed"];
/** "Process now" runs at most this often per workspace. */
export const NUDGE_GAP_MS = 60_000;

/** Carries this workspace's due work on after the reply has gone; never throws. */
export function kick(deps: AutoDeps, workspaceId: string): void {
  const work = runDue(deps, { workspaceId }).catch((e) => {
    console.error("[automation] background pass failed", e instanceof Error ? e.name : "unknown");
  });
  if (deps.keepAlive) deps.keepAlive(work);
  else runInBackground(() => work);
}

async function runOf(store: AutoStore, ctx: Ctx, id: string): Promise<StoredRun> {
  const run = isUuid(id) ? await store.getRun(ctx.workspaceId, id) : null;
  if (!run) throw new AppError(NOT_FOUND_MESSAGE, 404);
  return run;
}

/** Newest first, at most 100; narrowed by ?status, ?contactId and ?dealId. */
export async function listRuns(deps: AutoDeps, user: SignedInUser, query: Record<string, string>): Promise<RunSummary[]> {
  const ctx = await currentWorkspace(deps.store, user);
  const status = STATUSES.find((s) => s === query.status);
  // An id that is not one can name no run: the answer is an empty list, not an error.
  if ((query.contactId && !isUuid(query.contactId)) || (query.dealId && !isUuid(query.dealId)) || (query.status && !status)) return [];
  const asked = Number.parseInt(query.limit ?? "", 10);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, RUNS_MAX) : 50;
  const runs = await deps.store.listRuns(ctx.workspaceId, { ...(status ? { status } : {}), ...(query.contactId ? { contactId: query.contactId } : {}), ...(query.dealId ? { dealId: query.dealId } : {}), limit });
  return runs.map(runSummary);
}

export async function getRun(deps: AutoDeps, user: SignedInUser, id: string): Promise<Run> {
  const ctx = await currentWorkspace(deps.store, user);
  return runView(deps.store, ctx, await runOf(deps.store, ctx, id));
}

/** Stops a run. Everything of it that was still waiting is cancelled, so nothing more is sent. A run that has ended is returned as it is. */
export async function stop(deps: AutoDeps, user: SignedInUser, id: string): Promise<Run> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user);
  const run = await runOf(store, ctx, id);
  await refuseUnlessMayDecide(store, ctx, await store.getLead(ctx.workspaceId, run.contactId), run.dealId);
  if (!isOver(run)) {
    const env = await envFor(deps, ctx.workspaceId);
    if (!env) throw new AppError(NOT_SET_UP_MESSAGE, 409);
    await stopRun(env, run, `Stopped at step ${Math.min(run.position + 1, run.steps.length)} by a person.`);
  }
  return runView(store, ctx, await runOf(store, ctx, id));
}

/** A person says the lead replied: it is logged on the lead and the lead's runs wake up. */
export async function replied(deps: AutoDeps, user: SignedInUser, id: string, body: Record<string, unknown>): Promise<Run> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user);
  const run = await runOf(store, ctx, id);
  const lead = await store.getLead(ctx.workspaceId, run.contactId);
  await refuseUnlessMayDecide(store, ctx, lead, run.dealId);
  if (typeof body.positive !== "boolean") throw new AppError("Say whether the reply was positive.");
  if (isOver(run) || !lead) throw new AppError(RUN_OVER_MESSAGE, 409);
  const note = clean(body.note, 1000);
  const at = nowOf(deps).toISOString();
  // On the lead's timeline, by the person who logged it. Marked as the automation's own, so the
  // CRM trigger does not report it back as a second, unlabelled reply.
  await store.logActivity(lead, {
    type: "note",
    description: `The lead replied (${body.positive ? "positive" : "not interested"})${note ? `: ${note}` : "."}`,
    contactId: lead.id,
    companyId: lead.companyId,
    dealId: null,
    metadata: { automation: true, reply: true, positive: body.positive, runId: run.id },
    userId: ctx.userId,
  });
  await markReplied(store, ctx.workspaceId, lead.id, { positive: body.positive, note, at });
  kick(deps, ctx.workspaceId);
  return runView(store, ctx, await runOf(store, ctx, id));
}

/** "Process now": this workspace's waiting events and due runs, after the reply has gone. At most once a minute. */
export async function nudge(deps: AutoDeps, user: SignedInUser): Promise<{ ok: true }> {
  const ctx = await currentWorkspace(deps.store, user);
  if (await deps.store.takeNudge(ctx.workspaceId, nowOf(deps).toISOString(), NUDGE_GAP_MS)) kick(deps, ctx.workspaceId);
  return { ok: true };
}
