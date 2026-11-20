import { AppError } from "../_signroom/errors.js";
import { didLines, lower, whatOf } from "./actions.js";
import { nowOf, type AutoDeps } from "./deps.js";
import { sendLeadEmail } from "./email.js";
import { carryOut, Skip, type Env } from "./execute.js";
import { ownersOf, runPage, tell } from "./notify.js";
import { windowLabel } from "./sendWindow.js";
import type { AutoStore, PlanItem, RunPatch, StoredApproval, StoredRun, StoredStep } from "./store.js";

/**
 * The moving parts every way into a run shares (the scheduled runner, an
 * approval, "replied", "stop"): holding a run while it is worked on, carrying
 * out one action of a step, sending or queueing an email, and deciding what a
 * step and its run look like once an action is over.
 */

/** A run is held this long by whoever works on it: longer than the function can live. */
export const RUN_LEASE_MS = 6 * 60_000;
/** An email that cannot go out yet (a sending limit, no mail route) is tried again after this long ... */
export const EMAIL_RETRY_MS = 15 * 60_000;
/** ... until it is this old, and then given up. */
export const EMAIL_GIVE_UP_MS = 24 * 60 * 60_000;

export const BUSY_MESSAGE = "This run is being worked on right now. Try again in a moment.";

export const isOver = (run: Pick<StoredRun, "status">): boolean => run.status === "finished" || run.status === "stopped" || run.status === "failed";

/** The workspace, its rules and the time, for one piece of work. null when the workspace or its rules are gone. */
export async function envFor(deps: AutoDeps, workspaceId: string): Promise<Env | null> {
  const [workspace, rules] = await Promise.all([deps.store.workspaceInfo(workspaceId), deps.store.getRules(workspaceId)]);
  return workspace && rules ? { deps, workspace, rules, now: nowOf(deps) } : null;
}

/**
 * Runs `work` while holding the run, so nobody else changes it meanwhile.
 * null when someone else holds it or it has ended. The hold is given back
 * afterwards whatever happened.
 */
export async function withRun<T>(env: Env, runId: string, work: (run: StoredRun) => Promise<T>): Promise<T | null> {
  const { store } = env.deps;
  const run = await store.claimRun(runId, env.now.toISOString(), RUN_LEASE_MS);
  if (!run || run.workspaceId !== env.workspace.workspaceId) return null;
  try {
    return await work(run);
  } finally {
    try {
      await store.updateRun(run.workspaceId, run.id, { lockedUntil: null });
    } catch (e) {
      console.error("[automation] run not released", e instanceof Error ? e.name : "unknown");
    }
  }
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const savePlan = (store: AutoStore, step: StoredStep, plan: PlanItem[]): Promise<StoredStep> => store.updateStep(step.workspaceId, step.id, { plan });

/**
 * Carries out one action of a step that is not an email, and writes down what
 * happened. An action that no longer makes sense on a fresh look at the
 * record is dropped with the reason. Any other failure is thrown, with the
 * action left as it was so it can be tried again.
 */
export async function performItem(env: Env, run: StoredRun, step: StoredStep, index: number): Promise<{ run: StoredRun; step: StoredStep }> {
  const { store } = env.deps;
  const plan = structuredClone(step.plan);
  const item = plan[index];
  if (item.action.type === "send_email" || item.action.type === "unknown") throw new Error("not an action that is performed here");
  let current = run;
  try {
    const done = await carryOut(env, run, step.agentName, item.action, item.memo ?? {}, async (memo) => {
      item.memo = { ...item.memo, ...memo };
      await savePlan(store, step, plan);
    });
    item.state = "done";
    item.line = done.line;
    if (done.run) current = await store.updateRun(run.workspaceId, run.id, done.run);
  } catch (e) {
    if (!(e instanceof Skip)) throw e;
    item.verdict = "drop";
    item.why = e.why;
    item.state = "done";
  }
  return { run: current, step: await savePlan(store, step, plan) };
}

/**
 * Sends the email of one plan item, or queues it for the send window. The
 * approval row must already be in the `working` state: that claim is what
 * makes an email go out at most once.
 *
 * `whenNotNow` says what to do when nothing could be sent this time (a
 * sending limit, no mail route): "retry" queues it to be tried again;
 * "refuse" puts the approval back for the person and tells them why.
 */
export async function deliverEmail(env: Env, run: StoredRun, step: StoredStep, approval: StoredApproval, whenNotNow: "retry" | "refuse"): Promise<{ run: StoredRun; step: StoredStep }> {
  const { store } = env.deps;
  const ws = run.workspaceId;
  const plan = structuredClone(step.plan);
  const item = plan[approval.planIndex];
  const action = approval.action;
  if (!item || action.type !== "send_email") throw new Error("not an email");
  const subject = `“${action.subject}”`;
  let current = run;

  const outcome = await sendLeadEmail(env, run, step.agentName, action);
  if (outcome.kind === "sent") {
    await store.moveApproval(ws, approval.id, "working", { state: "done", error: null });
    Object.assign(item, { state: "done", line: outcome.line, wait: undefined });
    current = await store.updateRun(ws, run.id, { emailsSent: run.emailsSent + 1 });
  } else if (outcome.kind === "queued") {
    await store.moveApproval(ws, approval.id, "working", { state: "queued", dueAt: outcome.dueAt });
    Object.assign(item, { state: "waiting", wait: "window", line: `The email ${subject} is ready and goes out when the send window opens (${windowLabel(env.rules.sendWindow, new Date(outcome.dueAt))})` });
  } else if (outcome.kind === "refused") {
    await store.moveApproval(ws, approval.id, "working", { state: "failed", error: outcome.why });
    Object.assign(item, { verdict: "drop", why: outcome.why, state: "done", wait: undefined });
  } else if (outcome.kind === "later") {
    if (whenNotNow === "refuse") {
      await store.moveApproval(ws, approval.id, "working", { state: "pending", decidedBy: null, decidedByName: null, decidedAt: null, error: outcome.why });
      throw new AppError(`The email could not be sent just now: ${outcome.why.replace(/\.$/, "")}.`, 503);
    }
    if (env.now.getTime() - Date.parse(approval.created) > EMAIL_GIVE_UP_MS) {
      await store.moveApproval(ws, approval.id, "working", { state: "failed", error: outcome.why });
      Object.assign(item, { state: "failed", wait: undefined, line: `Could not send the email ${subject}: ${outcome.why}` });
    } else {
      await store.moveApproval(ws, approval.id, "working", { state: "queued", dueAt: new Date(env.now.getTime() + EMAIL_RETRY_MS).toISOString(), error: outcome.why });
      Object.assign(item, { state: "waiting", wait: "window", line: `The email ${subject} could not be sent yet (${outcome.why}); it will be tried again` });
    }
  } else {
    await store.moveApproval(ws, approval.id, "working", { state: "failed", error: "sending failed part-way" });
    Object.assign(item, { state: "failed", wait: undefined, line: `The email ${subject} may not have been delivered: sending failed part-way` });
  }
  return { run: current, step: await savePlan(store, step, plan) };
}

/** Ends a run for good. Never changes one that has already ended. */
export async function endRun(env: Env, run: StoredRun, status: "finished" | "stopped" | "failed", result: string, more: RunPatch = {}): Promise<StoredRun> {
  if (isOver(run)) return run;
  return env.deps.store.updateRun(run.workspaceId, run.id, { ...more, status, result: cut(result, 300), finished: env.now.toISOString(), wakeAt: null, waitingOn: null, waitingFor: null });
}

/** A run that cannot go on: it is marked failed with a plain reason and the owners are told. */
export async function failRun(env: Env, run: StoredRun, reason: string): Promise<StoredRun> {
  const out = await endRun(env, run, "failed", reason, { lastError: cut(reason, 300) });
  const people = await env.deps.store.orgPeople(env.workspace.organizationId);
  await tell(env.deps.store, ownersOf(people), { title: "An automation run failed", message: `${run.subject}: ${cut(reason, 200)}`, link: runPage(run.id) });
  return out;
}

/**
 * Stops a run because a person said so (or changed the lead so that it should
 * not go on). Everything of the run that was still waiting, approvals and
 * queued emails alike, is cancelled first, so a stopped run never sends.
 */
export async function stopRun(env: Env, run: StoredRun, result: string, reason = "The run was stopped."): Promise<StoredRun> {
  const { store } = env.deps;
  if (isOver(run)) return run;
  const out = await endRun(env, run, "stopped", result);
  const open = await store.listApprovals(run.workspaceId, { runId: run.id, states: ["pending", "queued"] });
  const cancelled = new Map<string, number[]>();
  for (const a of open) {
    const moved = await store.moveApproval(run.workspaceId, a.id, a.state, { state: "rejected", reason });
    if (moved) cancelled.set(a.stepId, [...(cancelled.get(a.stepId) ?? []), a.planIndex]);
  }
  for (const [stepId, indexes] of cancelled) {
    const step = await store.getStep(run.workspaceId, stepId);
    if (!step) continue;
    const plan = step.plan.map((item, i) => (indexes.includes(i) ? { ...item, state: "rejected" as const, wait: undefined, line: "Not carried out: the run was stopped" } : item));
    await store.updateStep(run.workspaceId, stepId, { plan, status: "rejected" });
  }
  return out;
}

/** The run's result once its last step is over. */
function lastWords(run: StoredRun, step: StoredStep): string {
  if (run.result) return run.result;
  const did = step.plan.filter((i) => i.state === "done" && i.verdict !== "drop" && i.line).map((i) => i.line as string);
  return did[did.length - 1] ?? (step.decided || "Finished");
}

/**
 * Looks at a step after one of its actions is over and puts the step and its
 * run in the state that follows: failed, waiting for a person, waiting for
 * the send window, ended by the agent, or on to the next step. It moves the
 * run on only while the run is still at this step, so settling twice is safe.
 */
export async function settle(env: Env, run: StoredRun, step: StoredStep): Promise<StoredRun> {
  const { store } = env.deps;
  const ws = run.workspaceId;
  if (isOver(run) || run.position !== step.n - 1) return run;
  const plan = step.plan;

  const failed = plan.find((i) => i.state === "failed");
  if (failed) {
    await store.updateStep(ws, step.id, { status: "failed" });
    return failRun(env, run, `Failed at step ${step.n}: ${failed.line ?? "an action could not be carried out"}.`);
  }
  if (plan.some((i) => i.state === "todo")) return run;

  const forPerson = plan.find((i) => i.state === "waiting" && i.wait !== "window");
  if (forPerson) {
    if (step.status !== "waiting_approval") await store.updateStep(ws, step.id, { status: "waiting_approval" });
    const what = forPerson.what ?? whatOf(forPerson.action, { lead: run.subject, deal: null, emailNumber: 1 });
    return store.updateRun(ws, run.id, { status: "needs_approval", waitingOn: null, wakeAt: null, waitingFor: `A person to approve: ${lower(what)}.` });
  }
  if (step.status !== "done") await store.updateStep(ws, step.id, { status: "done" });
  const forWindow = plan.find((i) => i.state === "waiting" && i.wait === "window");
  if (forWindow) return store.updateRun(ws, run.id, { status: "waiting", waitingOn: "send_window", wakeAt: null, waitingFor: `${forWindow.line ?? "The send window to open"}.` });

  const at = env.now.toISOString();
  if (step.outcome === "stop") return endRun(env, run, "finished", step.decided || "The agent ended the run.", { position: step.n, stepDoneAt: at });
  const moved: RunPatch = { position: step.n, handoff: step.handoff, stepDoneAt: at, attempts: 0, lastError: null };
  if (step.n >= run.steps.length) return finishRun(env, run, lastWords(run, step), moved);
  return store.updateRun(ws, run.id, { ...moved, status: "running", wakeAt: at, waitingOn: null, waitingFor: null });
}

/** The run reached the end of its chain. When it made a project, the people concerned are told. */
export async function finishRun(env: Env, run: StoredRun, result: string, more: RunPatch = {}): Promise<StoredRun> {
  const out = await endRun(env, run, "finished", result, more);
  if (out.projectId) {
    const { store } = env.deps;
    const [people, lead] = await Promise.all([store.orgPeople(env.workspace.organizationId), store.getLead(run.workspaceId, run.contactId)]);
    await tell(store, [...ownersOf(people), lead?.ownerId], { title: "Project created", message: `${run.subject}: ${out.result}`, link: runPage(run.id), projectId: out.projectId });
  }
  return out;
}

/** The lines of a step's record, for the run page. */
export const stepDid = (step: StoredStep, run: Pick<StoredRun, "subject">): string[] => didLines(step.plan, { lead: run.subject, deal: null });
