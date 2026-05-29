import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import {
  ClientCategory,
  CreateClientCategoryInput,
  UpdateClientCategoryInput,
  createClientCategory as createSvc,
  updateClientCategory as updateSvc,
  deleteClientCategory as deleteSvc,
  subscribeToClientCategories,
} from "@/services/supabase/clientCategories";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

/**
 * Workspace-scoped categories hook. Categories carry their own workspace_id
 * (they're administrative records — they aren't account rows), so workspace
 * filtering happens on the category itself, not via the client list.
 */
export const useClientCategories = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin, isViewer } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const {
    selectedId: selectedWorkspaceId,
    workspaces,
    DEFAULT_WORKSPACE_ID,
    isAll, isUnassigned,
  } = useSelectedWorkspace();

  const [allCategories, setAllCategories] = useState<ClientCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setAllCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToClientCategories(orgId, (next) => {
      setAllCategories(next);
      setLoading(false);
    });
  }, [orgId]);

  // Pick the active workspace the same way useClients does so create()
  // always lands the new category in a sensible spot even from the
  // "All workspaces" view.
  const activeWorkspaceId = useMemo(() => {
    if (!isAll && !isUnassigned && selectedWorkspaceId) return selectedWorkspaceId;
    if (DEFAULT_WORKSPACE_ID && DEFAULT_WORKSPACE_ID !== "__default__") {
      return DEFAULT_WORKSPACE_ID;
    }
    return workspaces[0]?.workspaceId ?? null;
  }, [isAll, isUnassigned, selectedWorkspaceId, DEFAULT_WORKSPACE_ID, workspaces]);

  // Filter to the active workspace. "All workspaces" shows the whole list
  // (matches how accounts/leads behave on All).
  const categories = useMemo(() => {
    if (isAll) return allCategories;
    if (isUnassigned) return [];
    if (!selectedWorkspaceId) return allCategories;
    return allCategories.filter((c) => c.workspaceId === selectedWorkspaceId);
  }, [allCategories, selectedWorkspaceId, isAll, isUnassigned]);

  const create = useCallback(
    async (input: CreateClientCategoryInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      const workspaceId = input.workspaceId ?? activeWorkspaceId ?? undefined;
      if (!workspaceId) throw new Error("Pick a workspace first");
      return createSvc(orgId, user.userId, user.displayName, {
        ...input,
        workspaceId,
      });
    },
    [orgId, user, activeWorkspaceId],
  );

  const update = useCallback(
    async (categoryId: string, input: UpdateClientCategoryInput) => {
      if (!orgId) throw new Error("No organization");
      return updateSvc(orgId, categoryId, input);
    },
    [orgId],
  );

  const remove = useCallback(
    async (categoryId: string) => {
      if (!orgId) throw new Error("No organization");
      await deleteSvc(orgId, categoryId);
      setAllCategories((prev) => prev.filter((c) => c.categoryId !== categoryId));
    },
    [orgId],
  );

  return {
    organizationId: orgId,
    workspaceId: activeWorkspaceId,
    isAllWorkspaces: isAll,
    categories,
    allCategories,
    loading,
    create,
    update,
    remove,
    isOwner,
    isAdmin,
    canManage: Boolean(
      orgId && !orgId.startsWith("local-") && !isViewer,
    ),
  };
};
