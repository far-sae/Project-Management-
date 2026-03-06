import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  createWorkspace,
  subscribeToWorkspaces,
  getOrganizationWorkspaces,
  updateWorkspace,
  deleteWorkspace,
} from "@/services/supabase/workspaces";
import {
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from "@/types/workspace";

// ✅ Static import — fixes dynamic/static conflict warning
import { checkWorkspaceLimit } from "@/services/supabase/database";

export const useWorkspaces = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const subscriptionRef = useRef<(() => void) | null>(null);

  const orgId = (
    organization?.organizationId ||
    user?.organizationId ||
    user?.userId ||
    ""
  ).replace("local-", "");

  const DEFAULT_WORKSPACE_ID = useMemo(() => {
    const defaultWs = workspaces.find((w) => w.isDefault);
    if (defaultWs) return defaultWs.workspaceId;
    if (workspaces.length > 0) return workspaces[0].workspaceId;
    return "__default__";
  }, [workspaces]);

  useEffect(() => {
    // console.log("🔄 useWorkspaces effect running:", { orgId });

    if (!orgId) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }

    if (subscriptionRef.current) {
      // console.log("⏭️ Already subscribed to workspaces, skipping");
      return;
    }

    setLoading(true);
    const unsub = subscribeToWorkspaces(orgId, (list) => {
      // console.log("✅ Workspaces updated via subscription:", list.length);
      setWorkspaces(list);
      setLoading(false);
    });

    subscriptionRef.current = unsub;

    return () => {
      // console.log("❌ Unsubscribing from workspaces");
      if (subscriptionRef.current) {
        subscriptionRef.current();
        subscriptionRef.current = null;
      }
    };
  }, [orgId]);

  const addWorkspace = useCallback(
    async (input: CreateWorkspaceInput): Promise<Workspace | null> => {
      if (!orgId || !user) return null;

      // ✅ Check workspace limit before creating
      const limitCheck = await checkWorkspaceLimit(user.userId, orgId);
      if (!limitCheck.allowed) {
        throw new Error(limitCheck.message);
      }

      return await createWorkspace({
        ...input,
        organizationId: orgId,
      });
    },
    [orgId, user],
  );

  const editWorkspace = useCallback(
    async (workspaceId: string, input: UpdateWorkspaceInput): Promise<void> => {
      if (!orgId) return;
      await updateWorkspace(workspaceId, input);
    },
    [orgId],
  );

  const removeWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      if (!orgId) return;
      await deleteWorkspace(workspaceId);
    },
    [orgId],
  );

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const list = await getOrganizationWorkspaces(orgId);
    setWorkspaces(list);
    setLoading(false);
  }, [orgId]);

  return {
    workspaces,
    loading,
    addWorkspace,
    editWorkspace,
    removeWorkspace,
    refresh,
    orgId,
    DEFAULT_WORKSPACE_ID,
  };
};
