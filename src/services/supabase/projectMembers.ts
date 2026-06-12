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
