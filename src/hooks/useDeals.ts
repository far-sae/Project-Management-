import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  CreateDealInput,
  Deal,
  DealStage,
  PipelineAnalytics,
  UpdateDealInput,
  computeAnalytics,
  createDeal as createDealSvc,
  deleteDeal as deleteDealSvc,
  subscribeToDeals,
  updateDeal as updateDealSvc,
} from "@/services/supabase/deals";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

export const useDeals = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setDeals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToDeals(orgId, (next) => {
      setDeals(next);
      setLoading(false);
    });
  }, [orgId]);

  const dealsByStage = useMemo(() => {
    const map = new Map<DealStage, Deal[]>();
    deals.forEach((d) => {
      const list = map.get(d.stage) ?? [];
      list.push(d);
      map.set(d.stage, list);
    });
    map.forEach((list) =>
      list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
    );
    return map;
  }, [deals]);

  const analytics: PipelineAnalytics = useMemo(
    () => computeAnalytics(deals),
    [deals],
  );

  const create = useCallback(
    async (input: CreateDealInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      // Optimistically prepend so the new deal shows immediately while
      // realtime catches up.
      const created = await createDealSvc(
        orgId,
        user.userId,
        user.displayName,
        input,
      );
      setDeals((prev) => [created, ...prev]);
      return created;
    },
    [orgId, user],
  );

  const update = useCallback(
    async (dealId: string, input: UpdateDealInput) => {
      if (!orgId) throw new Error("No organization");
      const updated = await updateDealSvc(orgId, dealId, input);
      setDeals((prev) =>
        prev.map((d) => (d.dealId === dealId ? updated : d)),
      );
      return updated;
    },
    [orgId],
  );

  const remove = useCallback(
    async (dealId: string) => {
      if (!orgId) return;
      await deleteDealSvc(orgId, dealId);
      setDeals((prev) => prev.filter((d) => d.dealId !== dealId));
    },
    [orgId],
  );

  return {
    organizationId: orgId,
    deals,
    dealsByStage,
    analytics,
    loading,
    create,
    update,
    remove,
    isOwner,
    isAdmin,
    canManage: isOwner || isAdmin,
  };
};
