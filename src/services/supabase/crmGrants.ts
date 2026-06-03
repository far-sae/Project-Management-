// src/services/supabase/crmGrants.ts
import { supabase } from "./config";

export type CrmModule = "deals" | "leads";
export type GrantLevel = "view" | "edit";
export interface GrantRow { user_id?: string; module: CrmModule; level: GrantLevel; }

export interface ModuleAccess {
  canView: (m: CrmModule) => boolean;
  canEdit: (m: CrmModule) => boolean;
}

/** Pure: derive view/edit booleans from the admin flag + the current user's
 *  grant rows. Owner/admin -> full access on everything. */
export const computeModuleAccess = (
  isAdminOrOwner: boolean,
  grants: Pick<GrantRow, "module" | "level">[],
): ModuleAccess => {
  const byModule = new Map<CrmModule, GrantLevel>();
  for (const g of grants) byModule.set(g.module, g.level);
  const canView = (m: CrmModule) => isAdminOrOwner || byModule.has(m);
  const canEdit = (m: CrmModule) => isAdminOrOwner || byModule.get(m) === "edit";
  return { canView, canEdit };
};

/** All grant rows in an org (for the Team matrix). */
export const listOrgGrants = async (orgId: string): Promise<GrantRow[]> => {
  const { data, error } = await supabase
    .from("crm_module_grants")
    .select("user_id, module, level")
    .eq("organization_id", orgId);
  if (error) throw error;
  return (data ?? []) as GrantRow[];
};

/** Set or clear a grant. level=null deletes the row (revoke / set to None). */
export const setModuleGrant = async (
  orgId: string, userId: string, module: CrmModule, level: GrantLevel | null,
): Promise<void> => {
  if (level === null) {
    const { error } = await supabase.from("crm_module_grants").delete()
      .eq("organization_id", orgId).eq("user_id", userId).eq("module", module);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("crm_module_grants")
    .upsert({ organization_id: orgId, user_id: userId, module, level, updated_at: new Date().toISOString() },
            { onConflict: "organization_id,user_id,module" });
  if (error) throw error;
};
