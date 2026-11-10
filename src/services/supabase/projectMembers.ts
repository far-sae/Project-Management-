// src/services/supabase/projectMembers.ts
//
// Direct project-membership management for the Team page. Adding an existing
// org member to a project (or changing their per-project role) goes through
// the owner/admin-gated `upsert_project_member` RPC (migration 136), mirroring
// how accept_invitation / remove-member own member writes server-side.

import { supabase } from './config';

export type ProjectRole = 'admin' | 'member' | 'viewer';

/** Add an existing org member to a project, or update their project role. */
export const upsertProjectMember = async (
  projectId: string,
  organizationId: string,
  userId: string,
  role: ProjectRole,
): Promise<void> => {
  const { data, error } = await supabase.rpc('upsert_project_member', {
    p_project_id: projectId,
    p_organization_id: organizationId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw new Error(error.message || 'Failed to update project member');
  const result = data as { ok?: boolean; error?: string } | null;
  if (!result?.ok) throw new Error(result?.error || 'Failed to update project member');
};

async function edgeErrorMessage(error: unknown): Promise<string> {
  const e = error as { message?: string; context?: unknown } | null;
  const ctx = e?.context;
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as { error?: string; message?: string };
      if (body?.error || body?.message) return String(body.error || body.message);
    } catch {
      /* not JSON */
    }
  }
  return e?.message || 'Unknown error';
}

/**
 * Move someone who was added to the wrong project into the right one:
 * add them to the target project with the same role first, then remove them
 * from the source (optionally unassigning their tasks there). If adding
 * fails nothing changes; if only the removal fails they end up in both and
 * the error says so.
 */
export const moveProjectMember = async (input: {
  fromProjectId: string;
  toProjectId: string;
  organizationId: string;
  userId: string;
  email: string;
  role: ProjectRole;
  unassignTasks: boolean;
}): Promise<void> => {
  await upsertProjectMember(input.toProjectId, input.organizationId, input.userId, input.role);

  const { error } = await supabase.functions.invoke('remove-member', {
    body: {
      projectId: input.fromProjectId,
      memberUserId: input.userId,
      memberEmail: input.email,
      unassignTasks: input.unassignTasks,
    },
  });
  if (error) {
    throw new Error(
      `They were added to the new project, but couldn't be removed from the old one: ${await edgeErrorMessage(error)}`,
    );
  }
};
