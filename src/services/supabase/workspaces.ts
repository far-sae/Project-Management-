import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface Workspace {
  workspaceId: string;
  name: string;
  organizationId: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkspaceInput {
  name: string;
  organizationId: string;
  isDefault?: boolean;
}

export interface UpdateWorkspaceInput {
  name?: string;
}

export const createWorkspace = async (
  input: CreateWorkspaceInput,
): Promise<Workspace> => {
  const now = new Date().toISOString();
  const workspaceId = crypto.randomUUID();

  const workspace = {
    workspace_id: workspaceId,
    name: input.name,
    organization_id: input.organizationId,
    is_default: input.isDefault || false,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("workspaces")
    .insert(workspace)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create workspace:", error);
    throw error;
  }

  return {
    workspaceId: data.workspace_id,
    name: data.name,
    organizationId: data.organization_id,
    isDefault: data.is_default,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
};

export const getWorkspace = async (
  workspaceId: string,
): Promise<Workspace | null> => {
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    workspaceId: data.workspace_id,
    name: data.name,
    organizationId: data.organization_id,
    isDefault: data.is_default,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
};

export const getOrganizationWorkspaces = async (
  organizationId: string,
): Promise<Workspace[]> => {
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("Failed to get workspaces:", error);
    return [];
  }

  return (data || []).map((workspace) => ({
    workspaceId: workspace.workspace_id,
    name: workspace.name,
    organizationId: workspace.organization_id,
    isDefault: workspace.is_default,
    createdAt: new Date(workspace.created_at),
    updatedAt: new Date(workspace.updated_at),
  }));
};

export const updateWorkspace = async (
  workspaceId: string,
  input: UpdateWorkspaceInput,
): Promise<void> => {
  const updateData: any = {
    updated_at: new Date().toISOString(),
  };

  if (input.name) updateData.name = input.name;

  const { error } = await supabase
    .from("workspaces")
    .update(updateData)
    .eq("workspace_id", workspaceId);

  if (error) {
    logger.error("Failed to update workspace:", error);
    throw error;
  }
};

export const deleteWorkspace = async (workspaceId: string): Promise<void> => {
  const { error } = await supabase
    .from("workspaces")
    .delete()
    .eq("workspace_id", workspaceId);

  if (error) {
    logger.error("Failed to delete workspace:", error);
    throw error;
  }
};

export const subscribeToWorkspaces = (
  organizationId: string,
  callback: (workspaces: Workspace[]) => void,
) => {
  // Initial fetch
  getOrganizationWorkspaces(organizationId).then(callback);

  // Generate unique channel name
  const channelName = `workspaces-${organizationId}-${Math.random().toString(36).substr(2, 9)}`;

  // Subscribe to changes
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "workspaces",
      },
      (payload: any) => {
        // For DELETE, we can't check org_id reliably, so just refresh
        if (payload.eventType === "DELETE") {
          getOrganizationWorkspaces(organizationId).then(callback);
          return;
        }

        // For INSERT/UPDATE, check org_id
        const orgId = payload.new?.organization_id;
        if (orgId === organizationId) {
          getOrganizationWorkspaces(organizationId).then(callback);
        }
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};
