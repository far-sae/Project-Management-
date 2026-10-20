import { supabase } from '../config';
import type { CrmTag } from '@/types/crmHub';

interface TagRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at: string;
}

const mapTag = (r: TagRow): CrmTag => ({
  id: r.id,
  organizationId: r.organization_id,
  workspaceId: r.workspace_id,
  name: r.name,
  color: r.color,
  createdAt: new Date(r.created_at),
});

export const listTags = async (organizationId: string, workspaceId: string): Promise<CrmTag[]> => {
  const { data, error } = await supabase
    .from('crm_tags')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapTag);
};

export const createTag = async (
  organizationId: string,
  workspaceId: string,
  name: string,
  color = '#f97316',
): Promise<CrmTag> => {
  const { data, error } = await supabase
    .from('crm_tags')
    .insert({ organization_id: organizationId, workspace_id: workspaceId, name, color })
    .select()
    .single();
  if (error) throw error;
  return mapTag(data);
};

export const updateTag = async (id: string, patch: { name?: string; color?: string }): Promise<CrmTag> => {
  const { data, error } = await supabase
    .from('crm_tags')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapTag(data);
};

export const deleteTag = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_tags').delete().eq('id', id);
  if (error) throw error;
};

// ─── Contact <-> Tag associations ────────────────────────────────────
export const listContactTagIds = async (contactId: string): Promise<string[]> => {
  const { data, error } = await supabase
    .from('crm_contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId);
  if (error) throw error;
  return (data ?? []).map((r) => r.tag_id as string);
};

/** Map every contact_id in the org to its list of tag_ids. Single round-trip
 *  so the list page can render tag pills without an N+1 lookup. */
export const listContactTagsMap = async (organizationId: string, workspaceId: string): Promise<Map<string, string[]>> => {
  const { data, error } = await supabase
    .from('crm_contact_tags')
    .select('contact_id, tag_id, crm_contacts!inner(organization_id)')
    .eq('crm_contacts.organization_id', organizationId)
    .eq('crm_contacts.workspace_id', workspaceId);
  if (error) throw error;
  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const cid = (row as { contact_id: string }).contact_id;
    const tid = (row as { tag_id: string }).tag_id;
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid)!.push(tid);
  }
  return map;
};

export const attachTagToContact = async (contactId: string, tagId: string): Promise<void> => {
  const { error } = await supabase
    .from('crm_contact_tags')
    .insert({ contact_id: contactId, tag_id: tagId });
  if (error && error.code !== '23505') throw error; // 23505 = already tagged; ignore
};

export const detachTagFromContact = async (contactId: string, tagId: string): Promise<void> => {
  const { error } = await supabase
    .from('crm_contact_tags')
    .delete()
    .eq('contact_id', contactId)
    .eq('tag_id', tagId);
  if (error) throw error;
};
