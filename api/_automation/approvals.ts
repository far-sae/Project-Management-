import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import { hasBlank } from "./actions.js";
import { currentWorkspace, refuseUnlessMayDecide, type Ctx, type SignedInUser } from "./context.js";
import type { AutoDeps } from "./deps.js";
import { BUSY_MESSAGE, deliverEmail, envFor, isOver, performItem, settle, stopRun, withRun } from "./engine.js";
import { ALREADY_DECIDED_MESSAGE, NOT_FOUND_MESSAGE, NOT_SET_UP_MESSAGE, RUN_OVER_MESSAGE, SWITCHED_OFF_MESSAGE } from "./messages.js";
import { kick } from "./runs.js";
import { LIMITS } from "./shared/types.js";
import type { Approval } from "./shared/types.js";
import type { AgentAction, AutoStore, Lead, StoredApproval } from "./store.js";
import { clean, oneLine } from "./validate.js";
import { approvalView, approvalViews } from "./views.js";

/**
 * Approvals: the actions that wait for a person. Approving carries the action
 * out, once, and lets the run go on; rejecting stops the run. An Owner may
 * decide any of them, a Member only those for a lead (or deal) they own.
 *
 * "At most once" rests on one conditional update: the approval moves from
 * `pending` to `working` for exactly one caller, whoever else pressed the
 * button at the same moment is told it was already decided.
 */

export const EMAIL_EDIT_MESSAGE = `An email needs a subject of up to ${LIMITS.emailSubject} characters and a message of 20 to ${LIMITS.emailBody} characters.`;
export const EMAIL_BLANK_MESSAGE = "The email still has a blank to fill in. Replace it, then approve.";

/** Pending approvals, oldest first. */
export async function listApprovals(deps: AutoDeps, user: SignedInUser): Promise<Approval[]> {
  const ctx = await currentWorkspace(deps.store, user);
  return approvalViews(deps.store, ctx, await deps.store.listApprovals(ctx.workspaceId, { states: ["pending"] }));
}

async function open(store: AutoStore, ctx: Ctx, id: string): Promise<{ approval: StoredApproval; lead: Lead | null }> {
  const approval = isUuid(id) ? await store.getApproval(ctx.workspaceId, id) : null;
  if (!approval) throw new AppError(NOT_FOUND_MESSAGE, 404);
  const lead = await store.getLead(ctx.workspaceId, approval.contactId);
  await refuseUnlessMayDecide(store, ctx, lead, approval.dealId);
  if (approval.state !== "pending") throw new AppError(ALREADY_DECIDED_MESSAGE, 409);
  return { approval, lead };
}

/** The email as the person edited it. Only the subject and the message can change; never where it goes. */
function editedEmail(action: Extract<AgentAction, { type: "send_email" }>, body: Record<string, unknown>): AgentAction {
  if (typeof body.subject !== "string" && typeof body.body !== "string") return action;
  const subject = typeof body.subject === "string" ? oneLine(body.subject, LIMITS.emailSubject + 1) : action.subject;
  const text = typeof body.body === "string" ? clean(body.body, LIMITS.emailBody + 1) : action.body;
  if (!subject || subject.length > LIMITS.emailSubject || text.length < 20 || text.length > LIMITS.emailBody) throw new AppError(EMAIL_EDIT_MESSAGE);
  if (hasBlank(subject) || hasBlank(text)) throw new AppError(EMAIL_BLANK_MESSAGE);
  return { type: "send_email", subject, body: text };
}

async function nameOf(store: AutoStore, ctx: Ctx): Promise<string> {
  const me = (await store.orgPeople(ctx.organizationId)).find((p) => p.userId === ctx.userId);
  return me?.name || me?.email || "a person";
}

/** What to answer when the run could not be held: it has ended, or someone is working on it this moment. */
async function refuseUnheld(store: AutoStore, ctx: Ctx, runId: string): Promise<never> {
  const run = await store.getRun(ctx.workspaceId, runId);
  throw new AppError(!run || isOver(run) ? RUN_OVER_MESSAGE : BUSY_MESSAGE, 409);
}

export async function approve(deps: AutoDeps, user: SignedInUser, id: string, body: Record<string, unknown>): Promise<Approval> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user);
  const { approval, lead } = await open(store, ctx, id);
  const ws = ctx.workspaceId;
  const env = await envFor(deps, ws);
  if (!env) throw new AppError(NOT_SET_UP_MESSAGE, 409);
  if (!env.rules.enabled) throw new AppError(SWITCHED_OFF_MESSAGE, 409);
  const action = approval.action.type === "send_email" ? editedEmail(approval.action, body) : approval.action;
  const by = await nameOf(store, ctx);

  const done = await withRun(env, approval.runId, async (run) => {
    // The claim. Only one caller ever gets past this line for one approval.
    const mine = await store.moveApproval(ws, id, "pending", { state: "working", action, decidedBy: ctx.userId, decidedByName: by, decidedAt: env.now.toISOString(), error: null });
    if (!mine) throw new AppError(ALREADY_DECIDED_MESSAGE, 409);
    let step = await store.getStep(ws, mine.stepId);
    if (!step) throw new AppError(NOT_FOUND_MESSAGE, 404);
    const plan = structuredClone(step.plan);
    plan[mine.planIndex] = { ...plan[mine.planIndex], action };
    step = await store.updateStep(ws, step.id, { plan, approvedBy: by });

    let current = run;
    if (mine.action.type === "send_email") {
      // Sent now, or queued for the send window. If nothing could be sent, the approval goes back to pending and the person is told why.
      ({ run: current, step } = await deliverEmail(env, current, step, mine, "refuse"));
    } else {
      try {
        ({ run: current, step } = await performItem(env, current, step, mine.planIndex));
      } catch (e) {
        await store.moveApproval(ws, id, "working", { state: "pending", decidedBy: null, decidedByName: null, decidedAt: null });
        throw e;
      }
      await store.moveApproval(ws, id, "working", { state: "done" });
    }
    await settle(env, current, step);
    return true;
  });
  if (!done) await refuseUnheld(store, ctx, approval.runId);

  // The run goes on in the background; the answer does not wait for the next agent.
  kick(deps, ws);
  const fresh = (await store.getApproval(ws, id)) ?? approval;
  return approvalView(fresh, true, lead);
}

export async function reject(deps: AutoDeps, user: SignedInUser, id: string, body: Record<string, unknown>): Promise<Approval> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user);
  const { approval, lead } = await open(store, ctx, id);
  const ws = ctx.workspaceId;
  const env = await envFor(deps, ws);
  if (!env) throw new AppError(NOT_SET_UP_MESSAGE, 409);
  const reason = oneLine(body.reason, 300);
  const by = await nameOf(store, ctx);

  const done = await withRun(env, approval.runId, async (run) => {
    const mine = await store.moveApproval(ws, id, "pending", { state: "rejected", decidedBy: ctx.userId, decidedByName: by, decidedAt: env.now.toISOString(), reason: reason || null });
    if (!mine) throw new AppError(ALREADY_DECIDED_MESSAGE, 409);
    const step = await store.getStep(ws, mine.stepId);
    if (step) {
      const plan = structuredClone(step.plan);
      plan[mine.planIndex] = { ...plan[mine.planIndex], state: "rejected", wait: undefined, line: `Not approved by ${by}${reason ? `: ${reason}` : ""}` };
      await store.updateStep(ws, step.id, { plan, status: "rejected" });
    }
    // The run stops here; whatever else of it was waiting is cancelled with it.
    await stopRun(env, run, `Stopped at step ${mine.stepN}: not approved`, "Another action of this run was not approved.");
    return true;
  });
  if (!done) await refuseUnheld(store, ctx, approval.runId);
  const fresh = (await store.getApproval(ws, id)) ?? approval;
  return approvalView(fresh, true, lead);
}
