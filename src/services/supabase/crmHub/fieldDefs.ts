import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../config';
import { FIELD_KINDS, type FieldDef, type FieldKind } from '@/lib/crmFieldTypes';

/** Shown when a typed field is added and the database has no place for it yet. */
export const FIELD_TYPES_NOT_SET_UP_MESSAGE =
  'Typed custom fields are not set up yet: run supabase/migrations/200_crm_custom_field_types.sql in the Supabase SQL editor.';

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string };
const missing = (error: DbError): boolean => error.code === '42P01' || error.code === 'PGRST205';

const defFrom = (r: Row): FieldDef => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  kind: (FIELD_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as FieldKind) : 'text',
  options: Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string') : [],
});

/**
 * The typed fields of a workspace, in the order they were made. While the
 * table is not there yet the answer is "none": every field is then plain text,
 * exactly as before, and nothing on the lead form breaks.
 */
export async function listFieldDefs(workspaceId: string): Promise<FieldDef[]> {
  const { data, error } = await supabase.from('crm_field_defs').select('id, name, kind, options').eq('workspace_id', workspaceId).order('created_at', { ascending: true });
  if (error) {
    if (missing(error)) return [];
    throw new Error(error.message || 'The custom fields could not be loaded.');
  }
  return ((data ?? []) as Row[]).map(defFrom);
}

export async function createFieldDef(organizationId: string, workspaceId: string, input: { name: string; kind: FieldKind; options: string[] }): Promise<FieldDef> {
  const { data, error } = await supabase
    .from('crm_field_defs')
    .insert({ organization_id: organizationId, workspace_id: workspaceId, name: input.name.trim(), kind: input.kind, options: input.kind === 'choice' ? input.options : [] })
    .select('id, name, kind, options')
    .single();
  if (error) {
    if (missing(error)) throw new Error(FIELD_TYPES_NOT_SET_UP_MESSAGE);
    if (error.code === '23505') throw new Error('There is a field with this name already.');
    throw new Error(error.message || 'The field could not be added.');
  }
  return defFrom(data as Row);
}

export async function deleteFieldDef(id: string): Promise<void> {
  const { error } = await supabase.from('crm_field_defs').delete().eq('id', id);
  if (error) throw new Error(missing(error) ? FIELD_TYPES_NOT_SET_UP_MESSAGE : error.message || 'The field could not be removed.');
}

/** The typed fields of a workspace for a form. Empty while loading or when they cannot be read: the form still works. */
export function useFieldDefs(workspaceId: string | null | undefined): { defs: FieldDef[]; reload: () => Promise<void> } {
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const reload = useCallback(async () => {
    if (!workspaceId) { setDefs([]); return; }
    try {
      setDefs(await listFieldDefs(workspaceId));
    } catch {
      setDefs([]);
    }
  }, [workspaceId]);
  useEffect(() => { void reload(); }, [reload]);
  return { defs, reload };
}
