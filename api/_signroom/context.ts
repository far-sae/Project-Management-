import { AppError } from "./errors.js";
import type { Store } from "./store.js";
import type { Workspace } from "./shared/types.js";
import { isUuid } from "./validate.js";

/** A workspace the user does not belong to (or no longer does), or none chosen. */
export const CHOOSE_WORKSPACE_MESSAGE = "Choose a workspace.";

/** The signed-in account on a request; workspaceId is the X-Signroom-Workspace header: a TaskCalendar workspace id. */
export type SignedInUser = { id: string; email: string; workspaceId?: string };

/** A person's role in a TaskCalendar organisation (organizations.members[].role). */
export type OrgRole = "owner" | "admin" | "member" | "viewer";

const RANK: Record<OrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

/**
 * The person's role in an organisation row, or null when they are not an
 * active member of it. As the app itself reads it: the organisation's owner_id
 * is an owner; otherwise an entry of the members list with their userId whose
 * status is "active" (an entry with no status counts as active). "invited" and
 * "removed" entries never count. With several active entries the highest role
 * wins. Anything malformed is no role.
 */
export function orgRoleOf(org: { owner_id?: unknown; members?: unknown }, userId: string): OrgRole | null {
  if (!userId) return null;
  if (typeof org.owner_id === "string" && org.owner_id === userId) return "owner";
  if (!Array.isArray(org.members)) return null;
  let best: OrgRole | null = null;
  for (const m of org.members) {
    if (!m || typeof m !== "object") continue;
    const e = m as { userId?: unknown; role?: unknown; status?: unknown };
    if (e.userId !== userId) continue;
    if (e.status !== undefined && e.status !== null && e.status !== "active") continue;
    if (e.role !== "owner" && e.role !== "admin" && e.role !== "member" && e.role !== "viewer") continue;
    if (!best || RANK[e.role] > RANK[best]) best = e.role;
  }
  return best;
}

/**
 * The workspace this request acts in. `workspaceId` (the X-Signroom-Workspace
 * header) is required and is a TaskCalendar workspace id. On every request the
 * caller must be an active member of the organisation that owns that
 * workspace: an organisation owner or admin is a Signroom "Owner", a member is
 * a "Member"; a viewer, an outsider, a missing or malformed id and an unknown
 * workspace are all 403 "Choose a workspace.". The Signroom row for the
 * workspace (same id) is created on first use, only after that check passed.
 * With { owner: true } a Member is refused (403).
 */
export async function currentWorkspace<U extends { id: string; email: string; workspaceId?: string }>(
  store: Store,
  user: U,
  opts: { owner?: boolean } = {},
): Promise<{ workspace: Workspace; role: "Owner" | "Member"; user: U }> {
  const access = isUuid(user.workspaceId) ? await store.workspaceAccess(user.workspaceId, user.id) : null;
  if (!access || access.role === "viewer") throw new AppError(CHOOSE_WORKSPACE_MESSAGE, 403);
  const role: "Owner" | "Member" = access.role === "owner" || access.role === "admin" ? "Owner" : "Member";
  if (opts.owner && role !== "Owner") throw new AppError("Only the workspace owner can do that.", 403);
  const workspace = await store.ensureWorkspace(access.workspaceId, access.name, user.id);
  return { workspace, role, user };
}
