import { supabase } from '../config';
import type { CrmNote, CreateNoteInput } from '@/types/crmHub';
import { tryLogActivity } from './activities';
import { applyWorkspaceFilter } from './workspaceFilter';

interface NoteRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  user_id: string | null;
  body: string;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  created_at: string;
  updated_at: string;
}

const mapNote = (r: NoteRow): CrmNote => ({
  id: r.id,
  organizationId: r.organization_id,
  workspaceId: r.workspace_id ?? null,
  userId: r.user_id,
  body: r.body,
  contactId: r.contact_id,
  companyId: r.company_id,
  dealId: r.deal_id,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

interface ListOptions {
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export const listNotes = async (
  organizationId: string,
  opts: ListOptions & { workspaceId?: string | null } = {},
): Promise<CrmNote[]> => {
  let q = supabase
    .from('crm_notes')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (opts.contactId) q = q.eq('contact_id', opts.contactId);
  if (opts.companyId) q = q.eq('company_id', opts.companyId);
  if (opts.dealId) q = q.eq('deal_id', opts.dealId);
  q = applyWorkspaceFilter(q, opts.workspaceId);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapNote);
};

export const createNote = async (input: CreateNoteInput, userId: string | null): Promise<CrmNote> => {
  const { data, error } = await supabase
    .from('crm_notes')
    .insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId ?? null,
      user_id: userId,
      body: input.body,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      deal_id: input.dealId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  const note = mapNote(data);
  // Also emit a `note` activity so the timeline shows it.
  tryLogActivity(
    {
      organizationId: note.organizationId,
      workspaceId: note.workspaceId,
      type: 'note',
      description: note.body.length > 240 ? `${note.body.slice(0, 240)}…` : note.body,
      contactId: note.contactId,
      companyId: note.companyId,
      dealId: note.dealId,
    },
    userId,
  );
  return note;
};

export const updateNote = async (id: string, body: string): Promise<CrmNote> => {
  const { data, error } = await supabase
    .from('crm_notes')
    .update({ body })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapNote(data);
};

export const deleteNote = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_notes').delete().eq('id', id);
  if (error) throw error;
};

/** An earlier version of a note: the words it had before a change. */
export interface CrmNoteVersion {
  id: string;
  noteId: string;
  body: string;
  /** When those words were written. */
  writtenAt: Date | null;
  /** When they were replaced. */
  changedAt: Date;
  changedBy: string | null;
}

export const NOTE_HISTORY_NOT_SET_UP_MESSAGE = 'The history of notes is not set up yet. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.';

/** The earlier versions of one note, the latest change first. */
export const listNoteHistory = async (noteId: string): Promise<CrmNoteVersion[]> => {
  const { data, error } = await supabase
    .from('crm_note_history')
    .select('id, note_id, body, written_at, changed_at, changed_by')
    .eq('note_id', noteId)
    .order('changed_at', { ascending: false });
  if (error) {
    // The table is not there: the SQL has not been run yet.
    if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '')) throw new Error(NOTE_HISTORY_NOT_SET_UP_MESSAGE);
    throw error;
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), noteId: String(r.note_id), body: String(r.body ?? ''),
    writtenAt: r.written_at ? new Date(String(r.written_at)) : null,
    changedAt: new Date(String(r.changed_at)), changedBy: r.changed_by ? String(r.changed_by) : null,
  }));
};
