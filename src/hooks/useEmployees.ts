import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  EmployeeProfile,
  UpsertEmployeeProfileInput,
  deleteEmployeeProfile,
  subscribeToEmployees,
  upsertEmployeeProfile,
} from "@/services/supabase/employees";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

export const useEmployees = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [profiles, setProfiles] = useState<EmployeeProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToEmployees(orgId, (next) => {
      setProfiles(next);
      setLoading(false);
    });
  }, [orgId]);

  const profilesByUserId = useMemo(() => {
    const map = new Map<string, EmployeeProfile>();
    profiles.forEach((p) => map.set(p.userId, p));
    return map;
  }, [profiles]);

  const upsert = useCallback(
    async (input: UpsertEmployeeProfileInput) => {
      if (!orgId) throw new Error("No organization");
      if (!isOwner) {
        throw new Error("Only the organization owner can edit employee profiles.");
      }
      return upsertEmployeeProfile(orgId, input);
    },
    [orgId, isOwner],
  );

  const remove = useCallback(
    async (userId: string) => {
      if (!orgId) return;
      if (!isOwner) {
        throw new Error("Only the organization owner can delete employee profiles.");
      }
      await deleteEmployeeProfile(orgId, userId);
      // Drop locally so the UI reflects the delete immediately. The realtime
      // subscription will eventually fire and reconcile, but we don't make the
      // user sit on stale state in the meantime.
      setProfiles((prev) => prev.filter((p) => p.userId !== userId));
    },
    [orgId, isOwner],
  );

  return {
    organizationId: orgId,
    profiles,
    profilesByUserId,
    loading,
    upsert,
    remove,
    isOwner,
    isAdmin,
    canManage: isOwner,
    canView: isOwner || isAdmin,
  };
};
