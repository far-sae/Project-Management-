import { judge, read, whatOf } from "./actions.js";
import { AiError, askStructured, lookUpWeb, type AiTag } from "./ai.js";
import { deliverEmail, performItem, settle } from "./engine.js";
import type { Env } from "./execute.js";
import { leadName, loadLeadContext, type LeadContext } from "./leadContext.js";
import { ownersOf, AUTOMATION_PAGE, tell } from "./notify.js";
import { agentMessage, agentSystem, LOOKUP_SYSTEM, lookupQuestion, type AgentBrief } from "./prompts.js";
import { StepOutputSchema, StepReplySchema } from "./schemas.js";
import type { PlanItem, StoredAgent, StoredApproval, StoredRun, StoredStep } from "./store.js";
import { clean } from "./validate.js";

/**
 * One agent step: the AI call that decides, and then the carrying out of what
 * it proposed. The same thinking is used by the dry-run test, which stops
 * before anything is carried out.
 */

/** The deadlines of the two calls of a step; together they stay well inside the function's 300 seconds. */
export const STEP_DEADLINE_MS = 120_000;
export const LOOKUP_DEADLINE_MS = 75_000;
export const STEP_MAX_TOKENS = 8000;
export const LOOKUP_MAX_TOKENS = 4000;

/** Raised when the lead a run is about no longer exists. */
export class LeadGone extends Error {
  constructor() {
    super("lead gone");
    this.name = "LeadGone";
  }
}

export type Thought = { decided: string; outcome: "continue" | "stop"; handoff: string; plan: PlanItem[] };

const today = (now: Date, zone: string): string => {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now).replace(/,/g, "");
  } catch {
    return now.toISOString().slice(0, 10);
  }
};

/**
 * The AI part of a step. When the workspace allows it and the agent has the
 * right, the company is looked up on the web first, in a call of its own; its
 * findings are handed to the agent as one more block of information. A
 * look-up that fails does not fail the step: the agent works without it.
 */
export async function think(env: Env, ctx: LeadContext, agent: AgentBrief, input: { received: string; handoff: string }, tag: AiTag): Promise<Thought> {
  const ai = { store: env.deps.store, claude: env.deps.claude };
  if (!ai.claude) throw new AiError("off");

  let webFindings: string | null = null;
  const question = env.rules.webResearch && agent.rights.includes("look_up_web") ? lookupQuestion(ctx.lead, ctx.company) : null;
  if (question) {
    try {
      webFindings = await lookUpWeb(ai, { tag: { ...tag, feature: tag.feature === "test" ? "test" : "web" }, system: LOOKUP_SYSTEM, question, maxTokens: LOOKUP_MAX_TOKENS, deadlineMs: LOOKUP_DEADLINE_MS });
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      webFindings = "The web look-up could not be made this time.";
    }
  }

  const zone = env.rules.sendWindow.timeZone;
  const output = await askStructured(ai, {
    tag,
    system: agentSystem(agent, ctx.workspace.name, env.rules.autonomy),
    messages: [
      {
        role: "user",
        content: agentMessage({
          today: today(env.now, zone),
          timeZone: zone,
          workspaceName: ctx.workspace.name,
          ownerName: ctx.owner?.name ?? null,
          lead: ctx.lead,
          company: ctx.company,
          deal: ctx.deal,
          stages: ctx.stages,
          timeline: ctx.timeline,
          emailsSent: ctx.emailsSent,
          emailsPerLead: env.rules.emailsPerLead,
          received: input.received,
          handoff: input.handoff,
          webFindings,
        }),
      },
    ],
    schema: StepOutputSchema,
    accept: StepReplySchema,
    effort: "low",
    maxTokens: STEP_MAX_TOKENS,
    deadlineMs: STEP_DEADLINE_MS,
  });

  const actions = (output.actions as unknown[]).slice(0, 12).flatMap((raw) => {
    const action = read(raw);
    return action ? [action] : [];
  });
  const plan = judge(actions, {
    rights: agent.rights,
    askFirst: agent.askFirst,
    autonomy: env.rules.autonomy,
    emailsPerLead: env.rules.emailsPerLead,
    emailsCounted: ctx.emailsSent,
    lead: ctx.lead,
    deal: ctx.deal,
    stages: ctx.stages,
    agentMayAddTasks: env.rules.project.agentMayAddTasks,
  });
  const names = { lead: leadName(ctx.lead), deal: ctx.deal?.name ?? null };
  let emailNumber = ctx.emailsSent;
  for (const item of plan) {
    if (item.action.type === "send_email") emailNumber += 1;
    item.what = whatOf(item.action, { ...names, deal: item.action.type === "create_deal" ? null : names.deal, emailNumber });
  }
  return { decided: clean(output.decided, 600).replace(/\s+/g, " ") || "No conclusion was given.", outcome: output.outcome, handoff: clean(output.handoff, 2000), plan };
}

/**
 * Works one step of a run. The first time, the agent thinks and its plan is
 * written down before anything is carried out; if the work then breaks off,
 * the next try picks the written plan up where it stopped and the AI is not
 * asked again. Returns the run as it stands afterwards.
 */
export async function workStep(env: Env, run: StoredRun, n: number, agent: StoredAgent, received: string): Promise<StoredRun> {
  const { store } = env.deps;
  const ws = run.workspaceId;
  let step: StoredStep | undefined = (await store.listSteps(ws, run.id)).find((s) => s.n === n);

  if (!step) {
    const ctx = await loadLeadContext(store, env.workspace, run.contactId, run.dealId);
    if (!ctx) throw new LeadGone();
    const thought = await think(env, ctx, agent, { received, handoff: run.handoff }, { workspaceId: ws, feature: "step", runId: run.id, agentId: agent.id });
    step = await store.insertStep({ workspaceId: ws, runId: run.id, n, agentId: agent.id, agentName: agent.name, status: "working", received, approvedBy: null, ...thought });
  }
  let current = run;
  if (step.status === "working") ({ run: current, step } = await carryPlan(env, current, step));
  return settle(env, current, step);
}

/** Goes through a step's plan once: carries out what may be done now, and asks a person for the rest. */
async function carryPlan(env: Env, run: StoredRun, step: StoredStep): Promise<{ run: StoredRun; step: StoredStep }> {
  const { store } = env.deps;
  const ws = run.workspaceId;
  let current = run;
  let s = step;
  const asked: StoredApproval[] = [];
  // Rows a broken-off earlier try already made for this step: an action never gets a second one.
  const existing = (await store.listApprovals(ws, { runId: run.id })).filter((a) => a.stepId === step.id);
  const lead = await store.getLead(ws, run.contactId);
  if (!lead) throw new LeadGone();

  for (let i = 0; i < s.plan.length; i++) {
    const item = s.plan[i];
    if (item.state !== "todo" || item.action.type === "unknown") continue;
    const isEmail = item.action.type === "send_email";
    if (item.verdict === "now" && !isEmail) {
      ({ run: current, step: s } = await performItem(env, current, s, i));
      continue;
    }
    // An action that waits for a person, or an email (every email is kept in the ledger, asked for or not).
    const waits = item.verdict === "ask";
    const before = existing.find((a) => a.planIndex === i);
    const row =
      before ??
      (await store.insertApproval({
        workspaceId: ws,
        runId: run.id,
        stepId: s.id,
        stepN: s.n,
        planIndex: i,
        agentId: s.agentId,
        agentName: s.agentName,
        contactId: run.contactId,
        dealId: current.dealId,
        actionType: item.action.type,
        what: item.what ?? "",
        about: run.subject,
        action: item.action,
        state: waits ? "pending" : "working",
        asked: waits,
        dueAt: null,
      }));
    const plan = structuredClone(s.plan);
    plan[i] = { ...plan[i], state: "waiting", wait: waits ? "person" : "window", approvalId: row.id };
    if (before && before.state !== "pending" && before.state !== "queued") {
      // An earlier try got further than writing the row. An email that was being sent when it broke off
      // may or may not have gone out: it is never sent a second time.
      if (before.state === "working") await store.moveApproval(ws, before.id, "working", { state: "failed", error: "sending broke off" });
      plan[i] = before.state === "done" ? { ...plan[i], state: "done", wait: undefined, line: `Sent the email to ${leadName(lead)}` } : { ...plan[i], state: "failed", wait: undefined, line: "The email may not have been delivered: sending broke off" };
    }
    s = await store.updateStep(ws, s.id, { plan });
    if (before) continue;
    if (waits) asked.push(row);
    else ({ run: current, step: s } = await deliverEmail(env, current, s, row, "retry"));
  }

  if (asked.length > 0) {
    const people = await store.orgPeople(env.workspace.organizationId);
    const more = asked.length > 1 ? ` (and ${asked.length - 1} more)` : "";
    await tell(store, [...ownersOf(people), lead.ownerId], { title: "Approval needed", message: `${s.agentName} is waiting for your approval: ${asked[0].what}${more}. About ${run.subject}.`, link: AUTOMATION_PAGE, actorName: s.agentName });
  }
  return { run: current, step: s };
}
