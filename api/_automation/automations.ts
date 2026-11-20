import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import { randomUUID } from "node:crypto";
import { currentWorkspace, rulesOf, type Ctx, type SignedInUser } from "./context.js";
import type { AutoDeps } from "./deps.js";
import { testChain, type TestStep } from "./dryRun.js";
import { NOT_FOUND_MESSAGE, STALE_MESSAGE } from "./messages.js";
import type { Automation, AutomationDraft, AutomationStep, TestResult } from "./shared/types.js";
import type { AutoStore, StoredAgent } from "./store.js";
import { automationDraft, automationInput, isDraftBody, revisionOf } from "./validate.js";

/**
 * Automations (chains of agents): listing, saving one from the assistant's
 * draft or from the chain editor, turning it on and pausing it, and testing
 * it on a lead. Only an Owner changes anything; a Member may look.
 */

export const NO_STEPS_MESSAGE = "Add at least one step before turning this on.";
export const GONE_AGENT_MESSAGE = "One of the steps uses an agent that no longer exists. Choose another agent for it.";

async function automationOf(store: AutoStore, ctx: Ctx, id: string): Promise<Automation> {
  const a = isUuid(id) ? await store.getAutomation(ctx.workspaceId, id) : null;
  if (!a) throw new AppError(NOT_FOUND_MESSAGE, 404);
  return a;
}

export async function listAutomations(deps: AutoDeps, user: SignedInUser): Promise<Automation[]> {
  const ctx = await currentWorkspace(deps.store, user);
  return deps.store.listAutomations(ctx.workspaceId);
}

export async function getAutomation(deps: AutoDeps, user: SignedInUser, id: string): Promise<Automation> {
  const ctx = await currentWorkspace(deps.store, user);
  return automationOf(deps.store, ctx, id);
}

/** Every step's agent must be one of the workspace's own, and not archived. */
async function refuseGoneAgents(store: AutoStore, workspaceId: string, steps: AutomationStep[]): Promise<void> {
  const mine = new Set((await store.listAgents(workspaceId)).map((a) => a.id));
  if (steps.some((s) => !mine.has(s.agentId))) throw new AppError(GONE_AGENT_MESSAGE);
}

/**
 * A draft's steps as saved steps, in the order they came. A step whose agent
 * has the id of one of the workspace's agents reuses that agent (and saves a
 * changed name, job, rights or "ask first" to it); any other step gets a new
 * agent.
 */
async function saveDraftAgents(store: AutoStore, workspaceId: string, draft: AutomationDraft): Promise<AutomationStep[]> {
  const mine = new Map<string, StoredAgent>((await store.listAgents(workspaceId)).map((a) => [a.id, a]));
  const steps: AutomationStep[] = [];
  for (const s of draft.steps) {
    const { id, ...input } = s.agent;
    const known = id ? mine.get(id) : undefined;
    let agentId: string;
    if (known) {
      const same = known.name === input.name && known.job === input.job && known.askFirst === input.askFirst && [...known.rights].sort().join() === [...input.rights].sort().join();
      if (!same) await store.updateAgent(workspaceId, known.id, null, input);
      agentId = known.id;
    } else {
      const made = await store.insertAgent({ workspaceId, kind: "custom", ...input });
      mine.set(made.id, made);
      agentId = made.id;
    }
    steps.push({ id: randomUUID(), agentId, starts: s.starts });
  }
  return steps;
}

/** Saves the assistant's draft as a new automation, not turned on. Creates the draft's new agents. */
export async function createAutomation(deps: AutoDeps, user: SignedInUser, body: Record<string, unknown>): Promise<Automation> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  const draft = automationDraft(body);
  await rulesOf(store, ctx.workspaceId);
  const steps = await saveDraftAgents(store, ctx.workspaceId, draft);
  return store.insertAutomation({ workspaceId: ctx.workspaceId, name: draft.name, status: "draft", trigger: draft.trigger, steps });
}

/** Saves an edited chain: either a draft (steps carry their agents) or a saved chain (steps name agents by id). */
export async function patchAutomation(deps: AutoDeps, user: SignedInUser, id: string, body: Record<string, unknown>): Promise<Automation> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  const current = await automationOf(store, ctx, id);
  const revision = revisionOf(body);
  if (current.revision !== revision) throw new AppError(STALE_MESSAGE, 409);
  let patch: Pick<Automation, "name" | "trigger" | "steps">;
  if (isDraftBody(body)) {
    const draft = automationDraft(body);
    patch = { name: draft.name, trigger: draft.trigger, steps: await saveDraftAgents(store, ctx.workspaceId, draft) };
  } else {
    patch = automationInput(body);
    await refuseGoneAgents(store, ctx.workspaceId, patch.steps);
  }
  const saved = await store.updateAutomation(ctx.workspaceId, id, revision, patch);
  if (!saved) throw new AppError(STALE_MESSAGE, 409);
  return saved;
}

/** Turning on needs at least one step and no missing or archived agent. Pausing needs nothing. */
export async function setStatus(deps: AutoDeps, user: SignedInUser, id: string, status: "on" | "paused"): Promise<Automation> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  const current = await automationOf(store, ctx, id);
  if (status === "on") {
    await rulesOf(store, ctx.workspaceId);
    if (current.steps.length === 0) throw new AppError(NO_STEPS_MESSAGE);
    await refuseGoneAgents(store, ctx.workspaceId, current.steps);
  }
  const saved = await store.updateAutomation(ctx.workspaceId, id, null, { status });
  if (!saved) throw new AppError(NOT_FOUND_MESSAGE, 404);
  return saved;
}

/** Runs the steps that would start straight away on a lead (the newest one when none is named), changing and sending nothing. */
export async function testAutomation(deps: AutoDeps, user: SignedInUser, id: string, body: Record<string, unknown>): Promise<TestResult> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  const current = await automationOf(store, ctx, id);
  const agents = new Map((await store.listAgents(ctx.workspaceId)).map((a) => [a.id, a]));
  const steps: TestStep[] = current.steps.map((s) => {
    const agent = agents.get(s.agentId);
    if (!agent) throw new AppError(GONE_AGENT_MESSAGE);
    return { agent, starts: s.starts };
  });
  return testChain(deps, ctx, steps, body);
}

/** The same test for a draft that is not saved yet: its agents are used as the draft describes them. */
export async function testDraft(deps: AutoDeps, user: SignedInUser, body: Record<string, unknown>): Promise<TestResult> {
  const ctx = await currentWorkspace(deps.store, user, { owner: true });
  const draft = automationDraft(body.draft);
  // A step that reuses one of the workspace's agents keeps that agent's kind; a new one is a custom agent.
  const kinds = new Map((await deps.store.listAgents(ctx.workspaceId)).map((a) => [a.id, a.kind]));
  const steps: TestStep[] = draft.steps.map((s) => ({ agent: { ...s.agent, kind: (s.agent.id && kinds.get(s.agent.id)) || "custom" }, starts: s.starts }));
  return testChain(deps, ctx, steps, body);
}

/** One agent on one lead: what it would decide and do. */
export async function testAgent(deps: AutoDeps, user: SignedInUser, id: string, body: Record<string, unknown>): Promise<TestResult> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  const agent = isUuid(id) ? await store.getAgent(ctx.workspaceId, id) : null;
  if (!agent || agent.archived) throw new AppError(NOT_FOUND_MESSAGE, 404);
  return testChain(deps, ctx, [{ agent, starts: { type: "after_previous" } }], body, { single: true });
}
