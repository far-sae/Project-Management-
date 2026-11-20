import { leadAddress } from "./actions.js";
import { mayDecide, type Ctx } from "./context.js";
import { centsOf } from "./cost.js";
import { isOver, stepDid } from "./engine.js";
import type { Approval, ProposedAction, Run, RunStep, RunSummary, WorkspaceRules } from "./shared/types.js";
import type { AutoStore, Lead, StoredApproval, StoredRules, StoredRun, StoredStep } from "./store.js";

/**
 * What the screens are sent: the stored rows turned into the shared shapes,
 * with what this caller may do worked out for them. Nothing server-only (a
 * claim, an error, a retry count) leaves through here.
 */

export function rulesView(r: StoredRules): WorkspaceRules {
  return {
    workspaceId: r.workspaceId,
    enabled: r.enabled,
    autonomy: r.autonomy,
    monthlyBudgetCents: r.monthlyBudgetCents,
    emailsPerLead: r.emailsPerLead,
    sendWindow: r.sendWindow,
    webResearch: r.webResearch,
    project: r.project,
    revision: r.revision,
    updated: r.updated,
  };
}

export function runSummary(run: StoredRun): RunSummary {
  return {
    id: run.id,
    automationId: run.automationId,
    automationName: run.automationName,
    contactId: run.contactId,
    dealId: run.dealId,
    projectId: run.projectId,
    subject: run.subject,
    status: run.status,
    result: run.result || resultSoFar(run),
    stepsDone: Math.min(run.position, run.steps.length),
    stepCount: run.steps.length,
    started: run.started,
    finished: run.finished,
    updated: run.updated,
  };
}

/** One line for a run that has not ended yet. */
function resultSoFar(run: StoredRun): string {
  const n = Math.min(run.position + 1, run.steps.length);
  if (run.status === "needs_approval") return `Stopped at step ${n}: waiting for approval`;
  if (run.status === "waiting") return `Waiting at step ${n}`;
  return `Working on step ${n}`;
}

/** The action as the shared list knows it: the server's two extras stay on the server. */
function sharedAction(a: StoredApproval["action"]): ProposedAction {
  if (a.type === "set_lead_status") return { type: "set_lead_status", status: a.status };
  if (a.type === "create_project") return { type: "create_project" };
  return a;
}

export function approvalView(a: StoredApproval, canDecide: boolean, lead: Pick<Lead, "email"> | null): Approval {
  return {
    id: a.id,
    runId: a.runId,
    agentName: a.agentName,
    what: a.what,
    about: a.about,
    action: sharedAction(a.action),
    status: a.state === "pending" ? "pending" : a.state === "rejected" ? "rejected" : "approved",
    created: a.created,
    canDecide: canDecide && a.state === "pending",
    stepN: a.stepN,
    to: a.actionType === "send_email" && lead ? leadAddress(lead) : null,
  };
}

/** Several approvals at once: each lead is read once. */
export async function approvalViews(store: AutoStore, ctx: Ctx, list: StoredApproval[]): Promise<Approval[]> {
  const leads = new Map<string, Lead | null>();
  const out: Approval[] = [];
  for (const a of list) {
    if (!leads.has(a.contactId)) leads.set(a.contactId, await store.getLead(ctx.workspaceId, a.contactId));
    const lead = leads.get(a.contactId) ?? null;
    out.push(approvalView(a, await mayDecide(store, ctx, lead, a.dealId), lead));
  }
  return out;
}

function stepView(step: StoredStep, run: StoredRun): RunStep | null {
  // A step that is being worked on (or will be tried again) has nothing to show yet.
  if (step.status === "working") return null;
  return { id: step.id, n: step.n, agentId: step.agentId, agentName: step.agentName, status: step.status, received: step.received, decided: step.decided, did: stepDid(step, run), approvedBy: step.approvedBy, when: step.updated };
}

export async function runView(store: AutoStore, ctx: Ctx, run: StoredRun): Promise<Run> {
  const ws = ctx.workspaceId;
  const [steps, approvals, cost, lead] = await Promise.all([store.listSteps(ws, run.id), store.listApprovals(ws, { runId: run.id }), store.runCostMicroUsd(ws, run.id), store.getLead(ws, run.contactId)]);
  const shown = steps.flatMap((s) => {
    const v = stepView(s, run);
    return v ? [v] : [];
  });
  const mine = !isOver(run) && (await mayDecide(store, ctx, lead, run.dealId));
  const retrying = steps.some((s) => s.status === "working") && run.attempts > 0;
  return {
    ...runSummary(run),
    steps: shown,
    waitingFor: isOver(run) ? null : (run.waitingFor ?? (retrying ? `Step ${run.position + 1} did not go through and will be tried again.` : null)),
    facts: {
      agentSteps: steps.filter((s) => s.status !== "skipped" && s.status !== "working").length,
      approvals: approvals.filter((a) => a.asked && a.decidedBy !== null && a.state !== "rejected" && a.state !== "pending").length,
      emailsSent: run.emailsSent,
      costCents: centsOf(cost),
    },
    canStop: mine,
    canReply: mine,
  };
}
