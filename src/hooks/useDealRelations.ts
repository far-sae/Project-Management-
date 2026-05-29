import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  CreateDealCompetitorInput,
  CreateDealContactRoleInput,
  DealCompetitor,
  DealContactRole,
  DealStageHistoryEntry,
  UpdateDealCompetitorInput,
  UpdateDealContactRoleInput,
  createDealCompetitor,
  createDealContactRole,
  deleteDealCompetitor,
  deleteDealContactRole,
  subscribeToDealCompetitors,
  subscribeToDealContactRoles,
  subscribeToDealStageHistory,
  updateDealCompetitor,
  updateDealContactRole,
} from "@/services/supabase/dealRelations";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

/**
 * Loads + manages the three "Related List" entities for a single deal:
 * competitors, contact roles, and stage history. Each subscribes
 * independently so the detail page re-renders only the section that changed.
 */
export const useDealRelations = (dealId: string | null) => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin, isViewer } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [competitors, setCompetitors] = useState<DealCompetitor[]>([]);
  const [contactRoles, setContactRoles] = useState<DealContactRole[]>([]);
  const [stageHistory, setStageHistory] = useState<DealStageHistoryEntry[]>([]);

  useEffect(() => {
    if (!orgId || !dealId) {
      setCompetitors([]);
      setContactRoles([]);
      setStageHistory([]);
      return;
    }
    const offC = subscribeToDealCompetitors(orgId, dealId, setCompetitors);
    const offR = subscribeToDealContactRoles(orgId, dealId, setContactRoles);
    const offH = subscribeToDealStageHistory(orgId, dealId, setStageHistory);
    return () => { offC(); offR(); offH(); };
  }, [orgId, dealId]);

  const addCompetitor = useCallback(
    async (input: CreateDealCompetitorInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      const next = await createDealCompetitor(orgId, user.userId, user.displayName, input);
      setCompetitors((prev) => [...prev, next]);
      return next;
    },
    [orgId, user],
  );
  const patchCompetitor = useCallback(
    async (competitorId: string, input: UpdateDealCompetitorInput) => {
      if (!orgId) throw new Error("No organization");
      const next = await updateDealCompetitor(orgId, competitorId, input);
      setCompetitors((prev) => prev.map((c) => (c.competitorId === competitorId ? next : c)));
      return next;
    },
    [orgId],
  );
  const removeCompetitor = useCallback(
    async (competitorId: string) => {
      if (!orgId) return;
      await deleteDealCompetitor(orgId, competitorId);
      setCompetitors((prev) => prev.filter((c) => c.competitorId !== competitorId));
    },
    [orgId],
  );

  const addContactRole = useCallback(
    async (input: CreateDealContactRoleInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      const next = await createDealContactRole(orgId, user.userId, user.displayName, input);
      setContactRoles((prev) => [...prev, next]);
      return next;
    },
    [orgId, user],
  );
  const patchContactRole = useCallback(
    async (roleId: string, input: UpdateDealContactRoleInput) => {
      if (!orgId) throw new Error("No organization");
      const next = await updateDealContactRole(orgId, roleId, input);
      setContactRoles((prev) => prev.map((r) => (r.roleId === roleId ? next : r)));
      return next;
    },
    [orgId],
  );
  const removeContactRole = useCallback(
    async (roleId: string) => {
      if (!orgId) return;
      await deleteDealContactRole(orgId, roleId);
      setContactRoles((prev) => prev.filter((r) => r.roleId !== roleId));
    },
    [orgId],
  );

  return {
    competitors,
    contactRoles,
    stageHistory,
    addCompetitor, patchCompetitor, removeCompetitor,
    addContactRole, patchContactRole, removeContactRole,
    canManage: Boolean(orgId && !orgId.startsWith("local-") ? !isViewer : true),
    isOwner,
    isAdmin,
  };
};
