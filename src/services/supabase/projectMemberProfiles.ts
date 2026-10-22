import { logger } from '@/lib/logger';
import { supabase } from './config';

export interface ProjectMemberProfile {
  userId: string;
  displayName: string;
  email: string;
  photoURL: string;
}

/**
 * Resolve the safe public profile fields for members of a project the current
 * user can access. The RPC performs one project-scoped lookup so profile RLS
 * cannot turn valid teammate names into the legacy "Member" placeholder.
 */
export const getProjectMemberProfiles = async (
  projectId: string,
): Promise<ProjectMemberProfile[]> => {
  const { data, error } = await supabase.rpc('get_project_member_profiles', {
    p_project_id: projectId,
  });

  if (error) {
    logger.warn('Could not resolve project member profiles:', error.message);
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const userId = String(row.user_id ?? '').trim();
    if (!userId) return [];
    return [{
      userId,
      displayName: String(row.display_name ?? '').trim(),
      email: String(row.email ?? '').trim(),
      photoURL: String(row.photo_url ?? '').trim(),
    }];
  });
};
