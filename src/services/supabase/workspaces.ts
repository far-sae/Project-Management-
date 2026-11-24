import { supabase } from "./config";
import { logger } from "@/lib/logger";
import type { PageKey } from "@/lib/pageCatalog";
import { normalizeMenuPages } from "@/lib/workspaceScope";

export interface Workspace {
  workspaceId: string;
  name: string;
  organizationId: string;
  isDefault: boolean;
  menuPages: PageKey[] | null;
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
  menuPages?: PageKey[] | null;
}

/** Raw shape of a `workspaces` row as returned by PostgREST. */
export interface WorkspaceRow {
  workspace_id: string;
  name: string;
  organization_id: string;
  is_default: boolean;
  menu_pages?: unknown;
  created_at: string;
  updated_at: string;
}

export const mapWorkspaceRow = (row: WorkspaceRow): Workspace => ({
  workspaceId: row.workspace_id,
  name: row.name,
  organizationId: row.organization_id,
  isDefault: row.is_default,
  menuPages: normalizeMenuPages(row.menu_pages),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

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

  return mapWorkspaceRow(data as WorkspaceRow);
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

  return mapWorkspaceRow(data as WorkspaceRow);
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

  return ((data || []) as WorkspaceRow[]).map(mapWorkspaceRow);
};

export const updateWorkspace = async (
  workspaceId: string,
  input: UpdateWorkspaceInput,
): Promise<void> => {
  const updateData: any = {
    updated_at: new Date().toISOString(),
  };

  if (input.name) updateData.name = input.name;
  if (input.menuPages !== undefined) updateData.menu_pages = input.menuPages;

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

export const MERGE_WORKSPACE_NOT_SET_UP_MESSAGE =
  'Putting workspaces together is not set up yet: run supabase/migrations/204_merge_workspace.sql in the Supabase SQL editor.';

/**
 * Moves everything of one workspace into another and removes the first. The
 * database does it in one step: all of it, or nothing (it then says why, in a
 * sentence that is passed on as it is). Only the owner and admins may.
 */
export const mergeWorkspace = async (fromId: string, intoId: string): Promise<{ moved: number }> => {
  const { data, error } = await supabase.rpc("merge_workspace", { p_from: fromId, p_into: intoId });
  if (!error) return { moved: Number((data as { moved?: unknown } | null)?.moved) || 0 };
  // The function is not there until migration 204 has been run.
  const missing = error.code === "PGRST202" || error.code === "42883"
    || (/merge_workspace/.test(error.message ?? "") && /not find|does not exist|schema cache/i.test(error.message ?? ""));
  logger.error("Failed to merge workspaces:", error.code);
  throw new Error(missing ? MERGE_WORKSPACE_NOT_SET_UP_MESSAGE : error.message || "The workspaces could not be put together.");
};

export const DELETE_WORKSPACE_NOT_SET_UP_MESSAGE =
  'Deleting a workspace needs the newest database update: run supabase/crm_setup.sql in the Supabase SQL editor (run it again if you ran it before), then try again.';

/**
 * Deletes a workspace together with everything in it, or (confirm = false)
 * only counts what would go. Its legal records are counted apart and go only
 * when `documents` is true. The database does it in one step: all of it, or
 * nothing (it then says why, in a sentence that is passed on as it is). Only
 * the organisation's owner may.
 */
export const deleteWorkspaceWithData = async (
  workspaceId: string,
  confirm: boolean,
  /** Also delete the workspace's legal records (invoices, agreements, billing plans, agreement templates). */
  documents = false,
): Promise<{ deleted: boolean; counts: Record<string, number>; documents: Record<string, number> }> => {
  const { data, error } = await supabase.rpc("delete_workspace_with_data", { p_workspace: workspaceId, p_confirm: confirm, p_documents: documents });
  if (!error) {
    const answer = (data ?? {}) as { deleted?: unknown; counts?: unknown; documents?: unknown };
    const numbers = (value: unknown): Record<string, number> =>
      (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, number>) : {});
    return { deleted: answer.deleted === true, counts: numbers(answer.counts), documents: numbers(answer.documents) };
  }
  // The function is not there until migration 205 has been run.
  const missing = error.code === "PGRST202" || error.code === "42883"
    || (/delete_workspace_with_data/.test(error.message ?? "") && /not find|does not exist|schema cache/i.test(error.message ?? ""));
  logger.error("Failed to delete workspace with its data:", error.code);
  throw new Error(missing ? DELETE_WORKSPACE_NOT_SET_UP_MESSAGE : error.message || "The workspace could not be deleted.");
};
