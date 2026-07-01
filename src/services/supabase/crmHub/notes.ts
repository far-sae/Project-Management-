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
