import { supabase } from './config';
import type {
  SavedView,
  CreateSavedViewInput,
  UpdateSavedViewInput,
} from '@/types/savedView';
import { logger } from '@/lib/logger';

interface SavedViewRow {
  id: string;
  owner_id: string;
  organization_id: string | null;
  scope: 'my' | 'project' | 'org';
  project_id: string | null;
  name: string;
  filters: Record<string, unknown> | null;
  sort: Record<string, unknown> | null;
  density: string | null;
  created_at: string;
  updated_at: string;
}

const fromRow = (row: SavedViewRow): SavedView => ({
  id: row.id,
  ownerId: row.owner_id,
  organizationId: row.organization_id,
  scope: row.scope,
  projectId: row.project_id,
  name: row.name,
  filters: (row.filters as SavedView['filters']) ?? {},
  sort: (row.sort as SavedView['sort']) ?? {},
  density: (row.density as SavedView['density']) ?? null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

/** Fetch all saved views the current user can see (own + project + org). */
export const fetchSavedViews = async (params: {
  ownerId: string;
  organizationId?: string | null;
  projectId?: string | null;
}): Promise<SavedView[]> => {
  const { ownerId, organizationId, projectId } = params;
  try {
    let query = supabase.from('saved_views').select('*').order('updated_at', {
      ascending: false,
    });

    // Postgres OR clause: own scope OR project-scope match OR org-scope match.
    const orFilters: string[] = [`owner_id.eq.${ownerId}`];
    if (projectId) orFilters.push(`project_id.eq.${projectId}`);
    if (organizationId) {
      orFilters.push(`and(scope.eq.org,organization_id.eq.${organizationId})`);
    }
    query = query.or(orFilters.join(','));

    const { data, error } = await query;
    if (error) {
      logger.warn('fetchSavedViews failed (table may be missing):', error.message);
      return [];
    }
    return (data || []).map((row) => fromRow(row as SavedViewRow));
  } catch (e) {
    logger.warn('fetchSavedViews error:', e);
    return [];
  }
};

export const createSavedView = async (
  input: CreateSavedViewInput,
): Promise<SavedView | null> => {
  const payload = {
    owner_id: input.ownerId,
    organization_id: input.organizationId ?? null,
    scope: input.scope,
    project_id: input.projectId ?? null,
    name: input.name,
    filters: input.filters ?? {},
    sort: input.sort ?? {},
    density: input.density ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('saved_views')
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    logger.error('createSavedView failed:', error);
    return null;
  }
  return fromRow(data as SavedViewRow);
};

export const updateSavedView = async (
  id: string,
  patch: UpdateSavedViewInput,
): Promise<boolean> => {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.filters !== undefined) update.filters = patch.filters;
  if (patch.sort !== undefined) update.sort = patch.sort;
  if (patch.density !== undefined) update.density = patch.density;
  if (patch.scope !== undefined) update.scope = patch.scope;
  if (patch.projectId !== undefined) update.project_id = patch.projectId;
  const { error } = await supabase
    .from('saved_views')
    .update(update)
    .eq('id', id);
  if (error) {
    logger.error('updateSavedView failed:', error);
    return false;
  }
  return true;
};

export const deleteSavedView = async (id: string): Promise<boolean> => {
  const { error } = await supabase.from('saved_views').delete().eq('id', id);
  if (error) {
    logger.error('deleteSavedView failed:', error);
    return false;
  }
  return true;
};
