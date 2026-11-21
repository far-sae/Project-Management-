import { supabase } from '../config';

/** Shown when the switch has no place in the database yet. */
export const OWN_ONLY_NOT_SET_UP_MESSAGE =
  'This setting is not set up yet: run supabase/migrations/198_crm_own_records_only.sql in the Supabase SQL editor.';

type DbError = { code?: string; message?: string };
const missing = (error: DbError): boolean => error.code === '42P01' || error.code === 'PGRST205';

/** Whether members of this workspace see only their own leads and deals. False until somebody switches it on. */
export async function getOwnOnly(workspaceId: string): Promise<boolean> {
  const { data, error } = await supabase.from('crm_visibility').select('own_only').eq('workspace_id', workspaceId).maybeSingle();
  if (error) throw new Error(missing(error) ? OWN_ONLY_NOT_SET_UP_MESSAGE : error.message || 'The setting could not be read.');
  return (data as { own_only?: unknown } | null)?.own_only === true;
}

/** Switches it on or off for a workspace. The database lets only the owner and admins do it. */
export async function setOwnOnly(organizationId: string, workspaceId: string, ownOnly: boolean): Promise<void> {
  const { error } = await supabase
    .from('crm_visibility')
    .upsert({ workspace_id: workspaceId, organization_id: organizationId, own_only: ownOnly, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' });
  if (error) throw new Error(missing(error) ? OWN_ONLY_NOT_SET_UP_MESSAGE : error.message || 'The setting could not be saved.');
}
