import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
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
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setClients([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToClients(orgId, (next) => {
      setClients(next);
      setLoading(false);
    });
  }, [orgId]);

  const create = useCallback(
    async (input: CreateClientInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      return createClientSvc(orgId, user.userId, user.displayName, input);
    },
    [orgId, user],
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
      return deleteClientSvc(orgId, clientId);
    },
    [orgId],
  );

  return {
    organizationId: orgId,
    clients,
    loading,
    create,
    update,
    remove,
    isOwner,
    isAdmin,
    canManage: isOwner || isAdmin,
  };
};
