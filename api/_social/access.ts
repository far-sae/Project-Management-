/**
 * Who may do the things on the social media pages that used to be for the
 * owner and admins only: connect and disconnect accounts, keep an account's
 * key, and change and run the autopilot.
 *
 * The owner and admins always may. A member may when an owner or admin gave
 * them social media at the level "manage" (table org_member_access, see
 * 213_member_access.sql). A viewer never may, and neither does somebody who is
 * no longer an active member, whatever rows were left behind.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

/** The person's place in the organisation, or null when they have none (or are no longer active). */
export function roleIn(org: { owner_id?: unknown; members?: unknown } | null, userId: string): OrgRole | null {
  if (!org || !userId) return null;
  if (org.owner_id === userId) return "owner";
  const members = Array.isArray(org.members) ? (org.members as Array<Record<string, unknown>>) : [];
  const mine = members.find((m) => String(m?.userId ?? m?.user_id ?? "") === userId);
  if (!mine) return null;
  if (typeof mine.status === "string" && mine.status !== "active") return null;
  const role = String(mine.role);
  return role === "owner" || role === "admin" || role === "member" || role === "viewer" ? role : null;
}

/** Whether a role, with the level of social media the person was given (if any), may manage social media. */
export const managesSocial = (role: OrgRole | null, given: string | null): boolean =>
  role === "owner" || role === "admin" || (role === "member" && given === "manage");

/** The same question asked of the database, on the service key. Any failure is a no. */
export async function mayManageSocial(db: SupabaseClient, organizationId: string, userId: string): Promise<boolean> {
  if (!organizationId || !userId) return false;
  const { data: org } = await db.from("organizations").select("owner_id, members").eq("organization_id", organizationId).maybeSingle();
  const role = roleIn(org, userId);
  if (role !== "member") return managesSocial(role, null);
  // Before 213_member_access.sql is run the table is not there: the answer is then no, as it was before.
  const { data: row, error } = await db.from("org_member_access").select("level")
    .eq("organization_id", organizationId).eq("user_id", userId).eq("area", "social").maybeSingle();
  return managesSocial(role, error || !row ? null : String(row.level));
}
