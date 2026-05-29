import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import {
  Lead,
  CreateLeadInput,
  UpdateLeadInput,
  ConvertLeadInput,
  ConvertLeadResult,
  createLead as createSvc,
  updateLead as updateSvc,
  deleteLead as deleteSvc,
  convertLead as convertSvc,
  subscribeToLeads,
} from "@/services/supabase/leads";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

/**
 * Workspace-scoped leads hook. Mirrors useClients exactly so the rest of the
 * app is consistent: { leads, allLeads, loading, create, update, remove, ... }.
 */
export const useLeads = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin, isViewer } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const {
    selectedId: selectedWorkspaceId,
    selected: selectedWorkspace,
    workspaces,
    DEFAULT_WORKSPACE_ID,
    isAll,
    isUnassigned,
  } = useSelectedWorkspace();

  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setAllLeads([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToLeads(orgId, (next) => {
      setAllLeads(next);
      setLoading(false);
    });
  }, [orgId]);

  // Workspace filter (same shape as useClients).
  const leads = useMemo(() => {
    if (isAll) return allLeads;
    if (isUnassigned) return [];
    if (!selectedWorkspaceId) return allLeads;
    return allLeads.filter((l) => l.workspaceId === selectedWorkspaceId);
  }, [allLeads, selectedWorkspaceId, isAll, isUnassigned]);

  const activeWorkspaceId = useMemo(() => {
    if (!isAll && !isUnassigned && selectedWorkspaceId) return selectedWorkspaceId;
    if (DEFAULT_WORKSPACE_ID && DEFAULT_WORKSPACE_ID !== "__default__") {
      return DEFAULT_WORKSPACE_ID;
    }
    return workspaces[0]?.workspaceId ?? null;
  }, [isAll, isUnassigned, selectedWorkspaceId, DEFAULT_WORKSPACE_ID, workspaces]);

  const create = useCallback(
    async (input: CreateLeadInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      const workspaceId = input.workspaceId ?? activeWorkspaceId ?? undefined;
      return createSvc(orgId, user.userId, user.displayName, {
        ...input,
        workspaceId,
      });
    },
    [orgId, user, activeWorkspaceId],
  );

  const update = useCallback(
    async (leadId: string, input: UpdateLeadInput) => {
      if (!orgId) throw new Error("No organization");
      return updateSvc(orgId, leadId, input);
    },
    [orgId],
  );

  const remove = useCallback(
    async (leadId: string) => {
      if (!orgId) throw new Error("No organization");
      await deleteSvc(orgId, leadId);
      setAllLeads((prev) => prev.filter((l) => l.leadId !== leadId));
    },
    [orgId],
  );

  const convert = useCallback(
    async (lead: Lead, input: ConvertLeadInput): Promise<ConvertLeadResult> => {
      if (!orgId || !user) throw new Error("Not signed in");
      return convertSvc(orgId, user.userId, user.displayName, lead, input);
    },
    [orgId, user],
  );

  return {
    organizationId: orgId,
    workspaceId: activeWorkspaceId,
    selectedWorkspace,
    isAllWorkspaces: isAll,
    isUnassignedWorkspace: isUnassigned,
    allLeads,
    leads,
    loading,
    create,
    update,
    remove,
    convert,
    isOwner,
    isAdmin,
    canCreate: Boolean(orgId?.startsWith("local-") || (organization && !isViewer)),
    canManage: isOwner || isAdmin,
  };
};
