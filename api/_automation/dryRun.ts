import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import { lower } from "./actions.js";
import { AiError, aiAppError } from "./ai.js";
import { rulesOf, type Ctx } from "./context.js";
import { nowOf, type AutoDeps } from "./deps.js";
import type { Env } from "./execute.js";
import { leadName, loadLeadContext } from "./leadContext.js";
import { AI_OFF_MESSAGE, NO_LEAD_MESSAGE } from "./messages.js";
import type { AgentBrief } from "./prompts.js";
import type { StepStart, TestResult } from "./shared/types.js";
import type { PlanItem } from "./store.js";
import { think } from "./step.js";

/**
 * Trying a chain on one lead without doing anything: each agent thinks about
 * the lead as it stands, the server decides what it would do with each
 * proposed action, and that is written down. Nothing is changed in the CRM,
 * no approval is made, no email is sent. The AI calls are real and are
 * counted in the workspace's usage.
 *
 * The test runs the steps that would start straight away, one after the
 * other, and stops at the first step that waits for something (a reply, some
 * days, a won deal) or that would end the run.
 */

/** AI calls one person's tests may make in an hour (a test of a chain makes one or two per step). */
export const TEST_CALLS_PER_HOUR = 60;
export const TEST_LIMIT_MESSAGE = "You have run a lot of tests this hour. Try again in a little while.";
/** A test stops starting new steps after this long, to answer inside the function's 300 seconds. */
export const TEST_BUDGET_MS = 140_000;
export const LEAD_NOT_FOUND_MESSAGE = "That lead is not in this workspace.";

export type TestStep = { agent: AgentBrief & { id: string | null }; starts: StepStart };

function waitNote(n: number, starts: StepStart): string {
  if (starts.type === "no_reply_days") return `Step ${n} waits ${starts.days} day${starts.days === 1 ? "" : "s"} for a reply.`;
  if (starts.type === "on_reply") return `Step ${n} starts when the lead replies.`;
  return `Step ${n} starts when the deal is won.`;
}

function wouldDo(plan: PlanItem[]): string[] {
  return plan.map((item) => {
    const what = item.what ?? "";
    if (item.verdict === "drop") return `Would not ${lower(what)}: ${item.why ?? "it makes no sense here"}.`;
    return item.verdict === "ask" ? `${what} (after a person approves)` : what;
  });
}

export async function testChain(deps: AutoDeps, ctx: Ctx, steps: TestStep[], body: Record<string, unknown>, opts: { single?: boolean } = {}): Promise<TestResult> {
  const { store } = deps;
  const ws = ctx.workspaceId;
  const rules = await rulesOf(store, ws);
  if (!deps.claude) throw new AppError(AI_OFF_MESSAGE, 503);

  const contactId = body.contactId;
  if (contactId !== undefined && contactId !== null && !isUuid(contactId)) throw new AppError(LEAD_NOT_FOUND_MESSAGE, 404);
  const picked = typeof contactId === "string" ? await store.getLead(ws, contactId) : await store.newestLead(ws);
  if (!picked) throw new AppError(typeof contactId === "string" ? LEAD_NOT_FOUND_MESSAGE : NO_LEAD_MESSAGE, typeof contactId === "string" ? 404 : 400);

  const now = nowOf(deps);
  const since = new Date(now.getTime() - 60 * 60_000).toISOString();
  if ((await store.countUsage(ws, { feature: "test", userId: ctx.userId, since })) >= TEST_CALLS_PER_HOUR) throw new AppError(TEST_LIMIT_MESSAGE, 429);

  const env: Env = { deps, workspace: { workspaceId: ws, name: ctx.name, organizationId: ctx.organizationId, timeZone: ctx.timeZone }, rules, now };
  const lead = await loadLeadContext(store, env.workspace, picked.id, null);
  if (!lead) throw new AppError(LEAD_NOT_FOUND_MESSAGE, 404);

  const out: TestResult = { leadName: leadName(lead.lead), steps: [], note: null };
  const started = Date.now();
  let received = opts.single ? "A test on this lead as it stands now." : `New lead: ${[leadName(lead.lead), lead.lead.jobTitle, lead.company?.name].map((s) => (s ?? "").trim()).filter(Boolean).join(", ")}`;
  let handoff = "";

  for (const [i, step] of steps.entries()) {
    const n = i + 1;
    if (step.starts.type !== "after_previous" && !opts.single) {
      out.note = waitNote(n, step.starts);
      break;
    }
    if (Date.now() - started > TEST_BUDGET_MS) {
      out.note = `The test stopped before step ${n} to answer in time. Test the later agents one by one.`;
      break;
    }
    let thought;
    try {
      thought = await think(env, lead, step.agent, { received, handoff }, { workspaceId: ws, feature: "test", agentId: step.agent.id, userId: ctx.userId });
    } catch (e) {
      if (e instanceof AiError) throw aiAppError(e);
      throw e;
    }
    out.steps.push({
      n,
      agentName: step.agent.name,
      received,
      decided: thought.decided,
      wouldDo: wouldDo(thought.plan),
      needsApproval: thought.plan.some((p) => p.verdict === "ask"),
      stopsChain: thought.outcome === "stop",
    });
    if (thought.outcome === "stop") {
      if (n < steps.length) out.note = `Step ${n} would end the run here.`;
      break;
    }
    handoff = thought.handoff;
    received = thought.handoff || "The result of the step before.";
  }
  return out;
}
