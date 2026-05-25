import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import {
  Client,
  CreateClientInput,
  UpdateClientInput,
  createClient as createClientSvc,
  updateClient as updateClientSvc,
  deleteClient as deleteClientSvc,
  subscribeToClients,
} from "@/services/supabase/clients";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

/**
 * Org-scoped clients with realtime updates. Mirrors the shape of useExpenses
 * so the rest of the app feels familiar: { items, loading, create, update,
 * remove, canManage }.
 */
export const useClients = () => {
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

  const [allClients, setAllClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setAllClients([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToClients(orgId, (next) => {
      setAllClients(next);
      setLoading(false);
    });
  }, [orgId]);

  // Clients are workspace-scoped: each workspace gets its own list. The
  // sidebar's "All workspaces" view still aggregates everything so users can
  // search across the org. "Unassigned" is a no-op for clients (every row has
  // a workspace post-092) and shows an empty list.
  const clients = useMemo(() => {
    if (isAll) return allClients;
    if (isUnassigned) return [];
    if (!selectedWorkspaceId) return allClients;
    return allClients.filter((c) => c.workspaceId === selectedWorkspaceId);
  }, [allClients, selectedWorkspaceId, isAll, isUnassigned]);

  // What workspace should a newly created client land in? Prefer the sidebar
  // selection; fall back to the org's default workspace if the sidebar is
  // showing "All" so create from any view still works.
  const activeWorkspaceId = useMemo(() => {
    if (!isAll && !isUnassigned && selectedWorkspaceId) return selectedWorkspaceId;
    if (DEFAULT_WORKSPACE_ID && DEFAULT_WORKSPACE_ID !== "__default__") {
      return DEFAULT_WORKSPACE_ID;
    }
    return workspaces[0]?.workspaceId ?? null;
  }, [isAll, isUnassigned, selectedWorkspaceId, DEFAULT_WORKSPACE_ID, workspaces]);

  const create = useCallback(
    async (input: CreateClientInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      const workspaceId = input.workspaceId ?? activeWorkspaceId ?? undefined;
      return createClientSvc(orgId, user.userId, user.displayName, {
        ...input,
        workspaceId,
      });
    },
    [orgId, user, activeWorkspaceId],
  );

  const update = useCallback(
    async (clientId: string, input: UpdateClientInput) => {
      if (!orgId) throw new Error("No organization");
      return updateClientSvc(orgId, clientId, input);
    },
    [orgId],
  );

  const remove = useCallback(
    async (clientId: string) => {
      if (!orgId) throw new Error("No organization");
      const result = await deleteClientSvc(orgId, clientId);
      // Drop locally so the row disappears immediately even if the realtime
      // subscription is delayed.
      setAllClients((prev) => prev.filter((c) => c.clientId !== clientId));
      return result;
    },
    [orgId],
  );

  return {
    organizationId: orgId,
    workspaceId: activeWorkspaceId,
    selectedWorkspace,
    isAllWorkspaces: isAll,
    isUnassignedWorkspace: isUnassigned,
    allClients,
    clients,
    loading,
    create,
    update,
    remove,
    isOwner,
    isAdmin,
    canCreate: Boolean(orgId?.startsWith("local-") || (organization && !isViewer)),
    canManage: isOwner || isAdmin,
  };
};
