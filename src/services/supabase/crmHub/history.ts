import { supabase } from '../config';
import type { ChangeRow, HistoryKind, TrashItem } from '@/lib/crmHistory';

/** Shown when the bin and the change log are not in the database yet. */
export const HISTORY_NOT_SET_UP_MESSAGE =
  'The recycle bin and the change log are not set up yet: run supabase/migrations/197_crm_recycle_bin_and_changes.sql in the Supabase SQL editor.';

export const HISTORY_LIMIT = 200;

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string };

const missing = (error: DbError): boolean => error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42883';
const fail = (error: DbError, fallback: string): Error => new Error(missing(error) ? HISTORY_NOT_SET_UP_MESSAGE : error.message || fallback);
const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** What is in the bin for a workspace, newest first. Only the owner and admins get an answer; others get an empty list. */
export async function listTrash(organizationId: string, workspaceId: string | null): Promise<TrashItem[]> {
  let q = supabase
    .from('crm_trash')
    .select('id, kind, record_id, name, deleted_by, deleted_at, children')
    .eq('organization_id', organizationId)
    .order('deleted_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (workspaceId) q = q.eq('workspace_id', workspaceId);
  const { data, error } = await q;
  if (error) throw fail(error, 'The recycle bin could not be loaded.');
  return ((data ?? []) as Row[]).map((r) => {
    const children = (r.children ?? {}) as Row;
    return {
      id: String(r.id),
      kind: r.kind as HistoryKind,
      recordId: String(r.record_id),
      name: String(r.name ?? ''),
      deletedBy: typeof r.deleted_by === 'string' ? r.deleted_by : null,
      deletedAt: new Date(String(r.deleted_at)),
      notes: count(children.notes),
      timeline: count(children.activities),
    };
  });
}

/** Puts one thing from the bin back. Returns the id of the restored record. */
export async function restoreFromTrash(trashId: string): Promise<string> {
  const { data, error } = await supabase.rpc('crm_restore', { p_trash: trashId });
  if (error) throw fail(error, 'It could not be restored.');
  return String(data);
}

/** The latest changes to leads, companies and deals of a workspace, newest first. */
export async function listChanges(organizationId: string, workspaceId: string | null): Promise<ChangeRow[]> {
  let q = supabase
    .from('crm_changes')
    .select('id, kind, record_id, name, changes, changed_by, changed_at')
    .eq('organization_id', organizationId)
    .order('changed_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (workspaceId) q = q.eq('workspace_id', workspaceId);
  const { data, error } = await q;
  if (error) throw fail(error, 'The change log could not be loaded.');
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    kind: r.kind as HistoryKind,
    recordId: String(r.record_id),
    name: String(r.name ?? ''),
    changes: (r.changes && typeof r.changes === 'object' ? r.changes : {}) as ChangeRow['changes'],
    changedBy: typeof r.changed_by === 'string' ? r.changed_by : null,
    changedAt: new Date(String(r.changed_at)),
  }));
}
