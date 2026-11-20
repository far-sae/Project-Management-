import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import { CHOOSE_WORKSPACE_MESSAGE, NOT_SET_UP_MESSAGE, NOT_YOUR_LEAD_MESSAGE, OWNER_ONLY_MESSAGE } from "./messages.js";
import type { Access, AutoStore, Lead, StoredRules } from "./store.js";

/**
 * Who is asking and where: the workspace of a request, checked on every
 * request, and what the person may do there.
 */

/** The signed-in account on a request; workspaceId is the X-Workspace-Id header. */
export type SignedInUser = { id: string; email: string; workspaceId?: string };

export type Ctx = Omit<Access, "role"> & { userId: string; role: "Owner" | "Member"; orgRole: Access["role"] };

/**
 * The workspace this request acts in. The header is required and is a
 * TaskCalendar workspace id; the caller must be an active member of the
 * organisation that owns it. An organisation owner or admin is an "Owner", a
 * member is a "Member"; a viewer, an outsider, a missing or malformed id and
 * an unknown workspace are all 403 "Choose a workspace.". With { owner: true }
 * a Member is refused.
 */
export async function currentWorkspace(store: AutoStore, user: SignedInUser, opts: { owner?: boolean } = {}): Promise<Ctx> {
  const access = isUuid(user.workspaceId) ? await store.workspaceAccess(user.workspaceId, user.id) : null;
  if (!access || access.role === "viewer") throw new AppError(CHOOSE_WORKSPACE_MESSAGE, 403);
  const role: "Owner" | "Member" = access.role === "owner" || access.role === "admin" ? "Owner" : "Member";
  if (opts.owner && role !== "Owner") throw new AppError(OWNER_ONLY_MESSAGE, 403);
  return { ...access, orgRole: access.role, role, userId: user.id };
}

/** The workspace's rules, or 409 when "Set up automation" has not been pressed yet. */
export async function rulesOf(store: AutoStore, workspaceId: string): Promise<StoredRules> {
  const rules = await store.getRules(workspaceId);
  if (!rules) throw new AppError(NOT_SET_UP_MESSAGE, 409);
  return rules;
}

/**
 * True when the person may decide for this lead: an Owner always, a Member
 * only for a lead (or a deal of that lead) they own.
 */
export async function mayDecide(store: AutoStore, ctx: Ctx, lead: Pick<Lead, "id" | "ownerId"> | null, dealId: string | null): Promise<boolean> {
  if (ctx.role === "Owner") return true;
  if (lead?.ownerId && lead.ownerId === ctx.userId) return true;
  if (dealId) {
    const deal = await store.getDeal(ctx.workspaceId, dealId);
    if (deal && deal.ownerId === ctx.userId) return true;
  }
  // A deal opened for the lead since (by a person, or by a later step) counts as well.
  return lead ? (await store.dealsOfLead(ctx.workspaceId, lead.id)).some((d) => d.ownerId === ctx.userId) : false;
}

export async function refuseUnlessMayDecide(store: AutoStore, ctx: Ctx, lead: Pick<Lead, "id" | "ownerId"> | null, dealId: string | null): Promise<void> {
  if (!(await mayDecide(store, ctx, lead, dealId))) throw new AppError(NOT_YOUR_LEAD_MESSAGE, 403);
}
