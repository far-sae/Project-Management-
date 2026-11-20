import { AppError } from "../_signroom/errors.js";
import { waitsForPerson } from "./actions.js";
import { mainAutomation } from "./agents.js";
import { currentWorkspace, type Ctx, type SignedInUser } from "./context.js";
import { centsOf, monthStart } from "./cost.js";
import { DEFAULT_AGENTS, DEFAULT_AUTOMATION_NAME, DEFAULT_TRIGGER, defaultChain, defaultRules } from "./defaults.js";
import { nowOf, type AutoDeps } from "./deps.js";
import { allowedActions } from "./prompts.js";
import { AGENT_KINDS } from "./shared/types.js";
import type { AgentKind, Automation, ChainStep, Overview, ProposedAction } from "./shared/types.js";
import type { StoredAgent, StoredRules } from "./store.js";
import { approvalViews, runSummary } from "./views.js";

/**
 * The overview screen in one reply, and "Set up automation", which gives a
 * workspace its rules, its six agents and its first chain.
 */

const WEEK_MS = 7 * 86_400_000;
/** How many waiting approvals and latest runs the overview carries. */
export const OVERVIEW_APPROVALS = 20;
export const OVERVIEW_RUNS = 6;

/** One line on what an agent does: the fixed line for a starting agent whose job was left alone in spirit, else the first sentence of its job. */
export function doesOf(agent: Pick<StoredAgent, "kind" | "job">): string {
  const fixed = AGENT_KINDS.find((k) => k.kind === agent.kind);
  if (fixed) return fixed.does;
  const first = agent.job.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return first.length > 160 ? `${first.slice(0, 159).trimEnd()}…` : first;
}

/**
 * What each starting agent usually does. Its rights may allow more (the right
 * to change deals covers marking one won), but the overview's "Needs
 * approval" badge goes by what its job has it do. A custom agent is judged by
 * everything its rights allow.
 */
const USUAL: Partial<Record<AgentKind, ProposedAction["type"][]>> = {
  researcher: ["add_note"],
  qualifier: ["set_lead_status", "add_note"],
  writer: ["send_email"],
  chaser: ["create_follow_up", "send_email"],
  deal_keeper: ["create_deal", "move_deal", "mark_deal", "set_lead_status", "add_note"],
  project_starter: ["create_project", "notify_owner"],
};

/** True when at least one of the agent's usual actions waits for a person under the rules. */
export function asksUnder(agent: Pick<StoredAgent, "kind" | "rights" | "askFirst">, rules: Pick<StoredRules, "autonomy">): boolean {
  const allowed = allowedActions(agent.rights);
  const usual = USUAL[agent.kind];
  return allowed.filter((type) => !usual || usual.includes(type)).some((type) => waitsForPerson(type, rules.autonomy, agent.askFirst));
}

export function chainOf(automation: Automation | null, agents: StoredAgent[], rules: StoredRules): ChainStep[] {
  if (!automation) return [];
  return automation.steps.flatMap((s, i) => {
    const agent = agents.find((a) => a.id === s.agentId);
    return agent ? [{ n: i + 1, agentId: agent.id, agentName: agent.name, does: doesOf(agent), starts: s.starts, asks: asksUnder(agent, rules) }] : [];
  });
}

const EMPTY_STATS: Overview["stats"] = { automationsOn: 0, automationsPaused: 0, runsThisWeek: 0, finishedThisWeek: 0, stoppedThisWeek: 0, waitingApprovals: 0, oldestApproval: null, spentCents: 0, budgetCents: 0 };

async function overviewFor(deps: AutoDeps, ctx: Ctx): Promise<Overview> {
  const { store } = deps;
  const ws = ctx.workspaceId;
  const rules = await store.getRules(ws);
  if (!rules) return { setUp: false, enabled: false, role: ctx.role, stats: EMPTY_STATS, automation: null, chain: [], approvals: [], latestRuns: [] };
  const now = nowOf(deps);
  const [automations, agents, week, pending, spent] = await Promise.all([
    store.listAutomations(ws),
    store.listAgents(ws, true),
    store.listRuns(ws, { since: new Date(now.getTime() - WEEK_MS).toISOString(), limit: 1000 }),
    store.listApprovals(ws, { states: ["pending"] }),
    store.spentMicroUsd(ws, monthStart(now)),
  ]);
  const main = mainAutomation(automations);
  return {
    setUp: true,
    enabled: rules.enabled,
    role: ctx.role,
    stats: {
      automationsOn: automations.filter((a) => a.status === "on").length,
      automationsPaused: automations.filter((a) => a.status === "paused").length,
      runsThisWeek: week.length,
      finishedThisWeek: week.filter((r) => r.status === "finished").length,
      // A run a person stopped and a run that failed both ended without getting there.
      stoppedThisWeek: week.filter((r) => r.status === "stopped" || r.status === "failed").length,
      waitingApprovals: pending.length,
      oldestApproval: pending[0]?.created ?? null,
      spentCents: centsOf(spent),
      budgetCents: rules.monthlyBudgetCents,
    },
    automation: main ? { id: main.id, name: main.name, status: main.status } : null,
    chain: chainOf(main, agents, rules),
    approvals: await approvalViews(store, ctx, pending.slice(0, OVERVIEW_APPROVALS)),
    latestRuns: (await store.listRuns(ws, { limit: OVERVIEW_RUNS })).map(runSummary),
  };
}

export async function getOverview(deps: AutoDeps, user: SignedInUser): Promise<Overview> {
  return overviewFor(deps, await currentWorkspace(deps.store, user));
}

/**
 * "Set up automation": the rules row (switched on, asking before anything
 * leaves or closes), the six agents and one automation, "New lead to
 * project", not turned on. Safe to repeat: what is already there is left as
 * it is, and pressing it twice at once makes nothing twice.
 */
export async function setUp(deps: AutoDeps, user: SignedInUser): Promise<Overview> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  const ws = ctx.workspaceId;
  await store.insertRules({ ...defaultRules(ws, ctx.timeZone), organizationId: ctx.organizationId });
  const agents: StoredAgent[] = [];
  for (const a of DEFAULT_AGENTS) {
    const agent = await store.ensureDefaultAgent({ workspaceId: ws, kind: a.kind, name: a.name, job: a.job, rights: [...a.rights], askFirst: false });
    // One that was archived before comes back: the chain below would otherwise point at an agent nobody can see.
    agents.push(agent.archived ? ((await store.updateAgent(ws, agent.id, null, { archived: false })) ?? agent) : agent);
  }
  if ((await store.listAutomations(ws)).length === 0) {
    try {
      await store.insertAutomation({ workspaceId: ws, name: DEFAULT_AUTOMATION_NAME, status: "draft", trigger: DEFAULT_TRIGGER, steps: defaultChain(agents.map((a) => a.id)) });
    } catch (e) {
      // The name is taken: a parallel first press made it a moment ago.
      if (!(e instanceof AppError && e.status === 409)) throw e;
    }
  }
  return overviewFor(deps, ctx);
}
