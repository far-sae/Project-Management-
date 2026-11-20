import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import { currentWorkspace, type Ctx, type SignedInUser } from "./context.js";
import { monthStart } from "./cost.js";
import { nowOf, type AutoDeps } from "./deps.js";
import { NOT_FOUND_MESSAGE, STALE_MESSAGE } from "./messages.js";
import type { Agent, Automation } from "./shared/types.js";
import type { AutoStore, StoredAgent } from "./store.js";
import { agentInput, revisionOf } from "./validate.js";

/**
 * The agents of a workspace: listing them, making and editing one, pausing,
 * resuming and archiving. Only an Owner changes anything; a Member may look.
 */

/** The automation the screens show first: the first one that is on, else the first there is. */
export const mainAutomation = (list: Automation[]): Automation | null => list.find((a) => a.status === "on") ?? list[0] ?? null;

const withCount = (a: StoredAgent, counts: Record<string, number>): Agent => ({ ...a, runsThisMonth: counts[a.id] ?? 0 });

async function counts(deps: AutoDeps, workspaceId: string): Promise<Record<string, number>> {
  return deps.store.agentStepCounts(workspaceId, monthStart(nowOf(deps)));
}

/** The agent with this id in the caller's workspace, or a 404 (another workspace's agent included). */
export async function agentOf(store: AutoStore, ctx: Ctx, id: string): Promise<StoredAgent> {
  const agent = isUuid(id) ? await store.getAgent(ctx.workspaceId, id) : null;
  if (!agent || agent.archived) throw new AppError(NOT_FOUND_MESSAGE, 404);
  return agent;
}

/** Not archived, in the order of the main automation's chain, the others after (oldest first). */
export async function listAgents(deps: AutoDeps, user: SignedInUser): Promise<Agent[]> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user);
  const [agents, automations, n] = await Promise.all([store.listAgents(ctx.workspaceId), store.listAutomations(ctx.workspaceId), counts(deps, ctx.workspaceId)]);
  const order = (mainAutomation(automations)?.steps ?? []).map((s) => s.agentId);
  const place = (a: StoredAgent) => (order.includes(a.id) ? order.indexOf(a.id) : order.length);
  return agents
    .map((a, i) => ({ a, i }))
    .sort((x, y) => place(x.a) - place(y.a) || x.i - y.i)
    .map(({ a }) => withCount(a, n));
}

export async function createAgent(deps: AutoDeps, user: SignedInUser, body: Record<string, unknown>): Promise<Agent> {
  const ctx = await currentWorkspace(deps.store, user, { owner: true });
  const made = await deps.store.insertAgent({ workspaceId: ctx.workspaceId, kind: "custom", ...agentInput(body) });
  return withCount(made, {});
}

export async function patchAgent(deps: AutoDeps, user: SignedInUser, id: string, body: Record<string, unknown>): Promise<Agent> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  await agentOf(store, ctx, id);
  const saved = await store.updateAgent(ctx.workspaceId, id, revisionOf(body), agentInput(body));
  if (!saved) throw new AppError(STALE_MESSAGE, 409);
  return withCount(saved, await counts(deps, ctx.workspaceId));
}

/** Pause: a paused agent's step waits. Resume: the runs that were waiting for it go on. */
export async function setPaused(deps: AutoDeps, user: SignedInUser, id: string, paused: boolean): Promise<Agent> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  await agentOf(store, ctx, id);
  const saved = await store.updateAgent(ctx.workspaceId, id, null, { paused });
  if (!saved) throw new AppError(NOT_FOUND_MESSAGE, 404);
  if (!paused) await store.wakeRuns(ctx.workspaceId, "agent", nowOf(deps).toISOString());
  return withCount(saved, await counts(deps, ctx.workspaceId));
}

/** Archives the agent. Refused, naming the automation, while a chain still uses it. */
export async function archiveAgent(deps: AutoDeps, user: SignedInUser, id: string): Promise<{ ok: true }> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  await agentOf(store, ctx, id);
  const usedBy = (await store.listAutomations(ctx.workspaceId)).find((a) => a.steps.some((s) => s.agentId === id));
  if (usedBy) throw new AppError(`This agent is a step of the automation “${usedBy.name}”. Take it out of that chain first.`, 409);
  await store.updateAgent(ctx.workspaceId, id, null, { archived: true });
  return { ok: true };
}
