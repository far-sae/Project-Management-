import { supabase } from '../config';
import { VIEW_NAME_LIMIT, tidyViewState, type LeadViewState, type SavedView } from '@/lib/crmSavedViews';

/** Shown when a view is shared and the database has no place for it yet. */
export const SHARED_VIEWS_NOT_SET_UP_MESSAGE =
  'Sharing views is not set up yet: run supabase/migrations/202_crm_shared_views.sql in the Supabase SQL editor.';

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string };
const missing = (error: DbError): boolean => error.code === '42P01' || error.code === 'PGRST205';

const viewFrom = (r: Row): SavedView => ({
  id: String(r.id),
  name: String(r.name ?? '').slice(0, VIEW_NAME_LIMIT),
  state: tidyViewState(r.state),
  shared: true,
});

/**
 * The views the team shares in this workspace, oldest first. While the table
 * is not there yet the answer is "none": each person still has their own views.
 */
export async function listSharedViews(workspaceId: string): Promise<SavedView[]> {
  const { data, error } = await supabase.from('crm_saved_views').select('id, name, state').eq('workspace_id', workspaceId).order('created_at', { ascending: true });
  if (error) {
    if (missing(error)) return [];
    throw new Error(error.message || 'The shared views could not be loaded.');
  }
  return ((data ?? []) as Row[]).map(viewFrom);
}

export async function createSharedView(organizationId: string, workspaceId: string, name: string, state: LeadViewState): Promise<SavedView> {
  const { data, error } = await supabase
    .from('crm_saved_views')
    .insert({ organization_id: organizationId, workspace_id: workspaceId, name: name.trim().slice(0, VIEW_NAME_LIMIT), state: { ...state, search: state.search.trim() } })
    .select('id, name, state')
    .single();
  if (error) {
    if (missing(error)) throw new Error(SHARED_VIEWS_NOT_SET_UP_MESSAGE);
    if (error.code === '23505') throw new Error('The team has a view with this name already. Choose another name.');
    throw new Error(error.message || 'The view could not be shared.');
  }
  return viewFrom(data as Row);
}

/** Removes a shared view. The database lets the person who made it, the owner and admins do this. */
export async function deleteSharedView(id: string): Promise<void> {
  const { data, error } = await supabase.from('crm_saved_views').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message || 'The view could not be removed.');
  // Nothing removed and no error: the database's rule left it alone.
  if (((data ?? []) as Row[]).length === 0) throw new Error('Only the person who shared this view, the owner or an admin can remove it.');
}
