import { AppError } from "../_signroom/errors.js";
import { currentWorkspace, rulesOf, type SignedInUser } from "./context.js";
import { monthStart } from "./cost.js";
import { nowOf, type AutoDeps } from "./deps.js";
import { NOT_SET_UP_MESSAGE, STALE_MESSAGE } from "./messages.js";
import type { PersonRow, WorkspaceRow, WorkspaceRules } from "./shared/types.js";
import { rulesInput } from "./validate.js";
import { rulesView } from "./views.js";

/**
 * The workspace's rules (how much the agents may do alone, the limits and the
 * project a won deal becomes), the table of the organisation's workspaces,
 * and the people who can lead a project.
 */

export const PROJECT_LEAD_MESSAGE = "Choose a project lead who is in this workspace's organisation.";

export async function getRules(deps: AutoDeps, user: SignedInUser): Promise<WorkspaceRules> {
  const ctx = await currentWorkspace(deps.store, user);
  return rulesView(await rulesOf(deps.store, ctx.workspaceId));
}

/** Owner only. A save must name the revision it was read at; a stale one is a 409. */
export async function saveRules(deps: AutoDeps, user: SignedInUser, body: Record<string, unknown>): Promise<WorkspaceRules> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user, { owner: true });
  const { revision, rules } = rulesInput(body);
  if (rules.project.lead !== "deal_owner") {
    const people = await store.orgPeople(ctx.organizationId);
    if (!people.some((p) => p.userId === rules.project.lead && p.role !== "viewer")) throw new AppError(PROJECT_LEAD_MESSAGE);
  }
  if (!(await store.getRules(ctx.workspaceId))) throw new AppError(NOT_SET_UP_MESSAGE, 409);
  const saved = await store.updateRules(ctx.workspaceId, revision, rules);
  if (!saved) throw new AppError(STALE_MESSAGE, 409);
  // A raised budget lets the runs that were waiting for it go on at the next pass.
  await store.wakeRuns(ctx.workspaceId, "budget", nowOf(deps).toISOString());
  return rulesView(saved);
}

/** "Each workspace runs on its own": the organisation's workspaces, for its owners and admins. A Member gets none. */
export async function listWorkspaces(deps: AutoDeps, user: SignedInUser): Promise<WorkspaceRow[]> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user);
  if (ctx.role !== "Owner") return [];
  const workspaces = await store.orgWorkspaces(ctx.organizationId);
  const rules = await store.listRules(workspaces.map((w) => w.workspaceId));
  const since = monthStart(nowOf(deps));
  const out: WorkspaceRow[] = [];
  for (const w of workspaces) {
    const r = rules.find((x) => x.workspaceId === w.workspaceId);
    out.push({ workspaceId: w.workspaceId, name: w.name, setUp: !!r, enabled: r?.enabled ?? false, autonomy: r?.autonomy ?? null, projectsThisMonth: r ? await store.projectsSince(w.workspaceId, since) : 0 });
  }
  return out;
}

/** The people who can be a project's lead: the organisation's active members, viewers left out. */
export async function listPeople(deps: AutoDeps, user: SignedInUser): Promise<PersonRow[]> {
  const ctx = await currentWorkspace(deps.store, user);
  return (await deps.store.orgPeople(ctx.organizationId)).filter((p) => p.role !== "viewer").map((p) => ({ userId: p.userId, name: p.name || p.email || "Unnamed" }));
}
