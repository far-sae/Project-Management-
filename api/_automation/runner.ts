import { AiError } from "./ai.js";
import { centsOf, monthKey, monthStart } from "./cost.js";
import { nowOf, type AutoDeps } from "./deps.js";
import { deliverEmail, endRun, envFor, failRun, finishRun, isOver, RUN_LEASE_MS, settle, stopRun } from "./engine.js";
import { handleEvent } from "./events.js";
import type { Env } from "./execute.js";
import { leadName, pickDeal } from "./leadContext.js";
import { AUTOMATION_PAGE, ownersOf, tell } from "./notify.js";
import { LeadGone, workStep } from "./step.js";
import type { AutomationStep } from "./shared/types.js";
import type { StoredRun } from "./store.js";

/**
 * The background runner. One pass does three things, in this order: reads
 * what happened in the CRM (auto_events) and starts or wakes runs, sends the
 * approved emails whose send window has opened, and walks every run that is
 * due along its chain until it has to wait.
 *
 * Each event, queued email and run is claimed before it is worked on, so two
 * passes at the same moment never do the same work.
 */

/** A step that fails is tried again on the next pass; after this many failures the run is marked failed. */
export const MAX_ATTEMPTS = 3;
/** How many events, emails and runs one pass takes at most. */
export const PASS_LIMIT = 50;
/** A pass stops taking new work after this long, to end well inside the function's 300 seconds. */
export const PASS_BUDGET_MS = 200_000;
const EVENT_LEASE_MS = 5 * 60_000;
const EVENT_ATTEMPTS = 5;
/** A run whose workspace has automation switched off, or no AI key, is looked at again after this long. */
const RECHECK_MS = 15 * 60_000;

export const BUDGET_WAIT = "The AI budget for this month is used up. The agents carry on next month, or as soon as the limit is raised.";
export const FAILED_REASON = "The step could not be completed after three tries.";

const day = 86_400_000;

function untilLabel(at: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(at).replace(/,/g, "");
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

type Gate = { go: string; seenReply?: boolean } | { skip: string; received: string } | { wait: Pick<StoredRun, "waitingOn" | "waitingFor" | "wakeAt"> };

/** Whether a step may start now, and what it is handed when it does. */
async function gate(env: Env, run: StoredRun, step: AutomationStep): Promise<Gate> {
  const { store } = env.deps;
  const lead = await store.getLead(run.workspaceId, run.contactId);
  if (!lead) throw new LeadGone();
  const who = leadName(lead);
  const unseenReply = !!run.repliedAt && (!run.replySeenAt || run.repliedAt > run.replySeenAt);
  const reply = `${run.replyPositive === true ? "A positive reply" : run.replyPositive === false ? "A negative reply" : "A reply or conversation"} from ${who} was logged${run.replyNote ? `: ${run.replyNote}` : "."}`;

  switch (step.starts.type) {
    case "after_previous": {
      if (run.position > 0) return { go: run.handoff || "The result of the step before." };
      const company = lead.companyId ? await store.getCompany(run.workspaceId, lead.companyId) : null;
      return { go: `New lead: ${[who, lead.jobTitle, company?.name].map((s) => (s ?? "").trim()).filter(Boolean).join(", ")}` };
    }
    case "no_reply_days": {
      if (unseenReply) return { skip: "The lead replied, so there was nothing to chase.", received: reply };
      const due = new Date(Date.parse(run.stepDoneAt ?? run.started) + step.starts.days * day);
      if (env.now < due) return { wait: { waitingOn: "time", wakeAt: due.toISOString(), waitingFor: `A reply from ${who}. With none by ${untilLabel(due, env.rules.sendWindow.timeZone)}, step ${run.position + 1} starts.` } };
      return { go: `No reply from ${who} after ${step.starts.days} day${step.starts.days === 1 ? "" : "s"}.` };
    }
    case "on_reply":
      if (unseenReply) return { go: reply, seenReply: true };
      return { wait: { waitingOn: "reply", wakeAt: null, waitingFor: `A reply from ${who}, or a call, email or meeting with them being logged.` } };
    case "on_deal_won": {
      const deal = await pickDeal(store, run.workspaceId, run.contactId, run.dealId);
      if (deal?.status === "won") return { go: `The won deal “${deal.name}”.` };
      return { wait: { waitingOn: "deal_won", wakeAt: null, waitingFor: deal ? `The deal “${deal.name}” to be marked won.` : `A deal for ${who} to be opened and won.` } };
    }
  }
}

/** True when the workspace has spent its month's AI budget. The owners are told once a month. */
async function overBudget(env: Env): Promise<boolean> {
  const { store } = env.deps;
  const spent = centsOf(await store.spentMicroUsd(env.workspace.workspaceId, monthStart(env.now)));
  if (spent < env.rules.monthlyBudgetCents) return false;
  if (await store.markBudgetNotified(env.workspace.workspaceId, monthKey(env.now))) {
    const people = await store.orgPeople(env.workspace.organizationId);
    await tell(store, ownersOf(people), { title: "AI budget reached", message: `The agents in ${env.workspace.name} have used this month's AI budget and are paused. They carry on next month, or as soon as you raise the limit in the workspace rules.`, link: `${AUTOMATION_PAGE}/rules` });
  }
  return true;
}

const nextMonth = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

/**
 * Walks a run that is held by the caller along its chain until it has to
 * wait, ends, or the time for this pass is up. A failure is counted against
 * the run; the third one marks it failed.
 */
export async function advance(env: Env, start: StoredRun, deadline: number): Promise<StoredRun> {
  const { store } = env.deps;
  let run = start;
  try {
    for (;;) {
      if (isOver(run) || run.status === "needs_approval") return run;
      if (run.position >= run.steps.length) return await finishRun(env, run, run.result || "Finished");
      const n = run.position + 1;
      const chainStep = run.steps[run.position];
      const begun = (await store.listSteps(run.workspaceId, run.id)).find((s) => s.n === n);

      if (begun && begun.status !== "working") {
        // The step is over or waits for a person or the send window: nothing to work, only to settle.
        const settled = await settle(env, run, begun);
        if (settled.position === run.position) return settled;
        run = settled;
        continue;
      }

      const agent = await store.getAgent(run.workspaceId, chainStep.agentId);
      if (!agent || agent.archived) return await failRun(env, run, `Step ${n} could not run: its agent no longer exists.`);

      let received = begun?.received ?? "";
      if (!begun) {
        const g = await gate(env, run, chainStep);
        if ("wait" in g) return await store.updateRun(run.workspaceId, run.id, { status: "waiting", ...g.wait });
        if ("skip" in g) {
          await store.insertStep({ workspaceId: run.workspaceId, runId: run.id, n, agentId: agent.id, agentName: agent.name, status: "skipped", received: g.received, decided: g.skip, outcome: "continue", handoff: run.handoff, plan: [], approvedBy: null });
          const at = env.now.toISOString();
          if (n >= run.steps.length) return await finishRun(env, run, run.result || g.skip, { position: n, stepDoneAt: at });
          run = await store.updateRun(run.workspaceId, run.id, { position: n, stepDoneAt: at, status: "running", wakeAt: at, waitingOn: null, waitingFor: null });
          continue;
        }
        if (agent.paused) return await store.updateRun(run.workspaceId, run.id, { status: "waiting", waitingOn: "agent", wakeAt: null, waitingFor: `${agent.name} is paused. Step ${n} starts when it is resumed.` });
        if (await overBudget(env)) return await store.updateRun(run.workspaceId, run.id, { status: "waiting", waitingOn: "budget", wakeAt: nextMonth(env.now), waitingFor: BUDGET_WAIT });
        if (Date.now() > deadline) return await store.updateRun(run.workspaceId, run.id, { status: "running", wakeAt: env.now.toISOString(), waitingOn: null, waitingFor: null });
        if (g.seenReply) run = await store.updateRun(run.workspaceId, run.id, { replySeenAt: run.repliedAt });
        received = g.go;
        if (run.status !== "running") run = await store.updateRun(run.workspaceId, run.id, { status: "running", waitingOn: null, waitingFor: null });
      }

      const after = await workStep(env, run, n, agent, received);
      if (after.position === run.position) return after;
      run = after;
    }
  } catch (e) {
    if (e instanceof LeadGone) return await endRun(env, run, "stopped", "Stopped: the lead no longer exists.");
    // The name only: an error's text can carry what the AI or a person wrote.
    console.error("[automation] step failed", e instanceof AiError ? e.kind : e instanceof Error ? e.name : "unknown");
    const attempts = run.attempts + 1;
    const fresh = await store.getRun(run.workspaceId, run.id);
    if (!fresh || isOver(fresh)) return fresh ?? run;
    if (attempts >= MAX_ATTEMPTS) return await failRun(env, { ...fresh, attempts }, `Failed at step ${fresh.position + 1}: ${FAILED_REASON}`);
    return await store.updateRun(run.workspaceId, run.id, { attempts, lastError: e instanceof AiError ? `ai ${e.kind}` : e instanceof Error ? e.name : "unknown", status: "running", wakeAt: env.now.toISOString() });
  }
}

export type PassResult = { events: number; emails: number; runs: number; ai: boolean };

/**
 * One pass over everything that is due: every workspace's, or one workspace's
 * when given ("process now"). Work of a workspace whose automation is
 * switched off is left where it is.
 */
export async function runDue(deps: AutoDeps, only?: { workspaceId: string }): Promise<PassResult> {
  const { store } = deps;
  const started = Date.now();
  const deadline = started + PASS_BUDGET_MS;
  const now = nowOf(deps);
  const at = now.toISOString();
  const ws = only?.workspaceId;
  const out: PassResult = { events: 0, emails: 0, runs: 0, ai: !!deps.claude };
  const envs = new Map<string, Env | null>();
  const env = async (workspaceId: string): Promise<Env | null> => {
    if (!envs.has(workspaceId)) envs.set(workspaceId, await envFor(deps, workspaceId));
    const e = envs.get(workspaceId) ?? null;
    return e && e.rules.enabled ? e : null;
  };

  // 1. What happened in the CRM.
  for (const open of await store.listOpenEvents(at, PASS_LIMIT, ws)) {
    if (Date.now() > deadline) break;
    const event = await store.claimEvent(open.id, at, EVENT_LEASE_MS);
    if (!event) continue;
    try {
      const e = await env(event.workspaceId);
      if (e && !event.own) await handleEvent(e, event);
      await store.finishEvent(event.id, at);
      out.events += 1;
    } catch (e) {
      console.error("[automation] event not handled", e instanceof Error ? e.name : "unknown");
      // It stays claimed until the lease runs out and is then tried again, a few times at most.
      if (event.attempts >= EVENT_ATTEMPTS) await store.finishEvent(event.id, at).catch(() => undefined);
    }
  }

  // 2. Emails whose send window has opened.
  for (const queued of await store.listQueuedDue(at, PASS_LIMIT, ws)) {
    if (Date.now() > deadline) break;
    const e = await env(queued.workspaceId);
    if (!e) continue;
    try {
      const held = await store.claimRun(queued.runId, at, RUN_LEASE_MS);
      if (!held) {
        // Someone is working the run this moment (it is tried again next pass), or the run has ended: then the email is never sent.
        const run = await store.getRun(queued.workspaceId, queued.runId);
        if (!run || isOver(run)) await store.moveApproval(queued.workspaceId, queued.id, "queued", { state: "rejected", reason: "The run had ended." });
        continue;
      }
      try {
        // The claim: only one pass moves a queued email to `working`, so it is sent at most once.
        const approval = await store.moveApproval(queued.workspaceId, queued.id, "queued", { state: "working" });
        const step = approval ? await store.getStep(queued.workspaceId, approval.stepId) : null;
        if (approval && step) {
          const done = await deliverEmail(e, held, step, approval, "retry");
          await settle(e, done.run, done.step);
          out.emails += 1;
        }
      } finally {
        await store.updateRun(queued.workspaceId, queued.runId, { lockedUntil: null });
      }
    } catch (err) {
      console.error("[automation] queued email not handled", err instanceof Error ? err.name : "unknown");
    }
  }

  // 3. Runs that are due.
  const seen = new Set<string>();
  for (let round = 0; round < 3 && Date.now() <= deadline; round++) {
    const due = (await store.listDueRuns(at, PASS_LIMIT, ws)).filter((r) => !seen.has(r.id));
    if (due.length === 0) break;
    for (const candidate of due) {
      seen.add(candidate.id);
      if (Date.now() > deadline) break;
      const e = await env(candidate.workspaceId);
      if (!e || !deps.claude) {
        // Switched off, or no AI key: leave the run as it is and look again later.
        await store.updateRun(candidate.workspaceId, candidate.id, { wakeAt: new Date(now.getTime() + RECHECK_MS).toISOString() }).catch(() => undefined);
        continue;
      }
      const run = await store.claimRun(candidate.id, at, RUN_LEASE_MS);
      if (!run) continue;
      try {
        await advance(e, run, deadline);
        out.runs += 1;
      } catch (err) {
        console.error("[automation] run not advanced", err instanceof Error ? err.name : "unknown");
      } finally {
        await store.updateRun(run.workspaceId, run.id, { lockedUntil: null }).catch(() => undefined);
      }
    }
  }

  // Old processed events are of no use to anyone.
  if (!ws) await store.purge(new Date(now.getTime() - 7 * day).toISOString()).catch(() => undefined);
  return out;
}

export { stopRun };
