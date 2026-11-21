/**
 * The web forms of a workspace (crm_lead_forms, migration 192): read and
 * changed from the CRM by the people who can use that workspace's CRM. The
 * public side (showing and sending a form) goes through /api/lead-form.
 */
import { supabase } from '../config';

export interface LeadForm {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  askPhone: boolean;
  askCompany: boolean;
  askMessage: boolean;
  heading: string;
  intro: string;
  buttonLabel: string;
  thankYou: string;
  source: string;
  ownerId: string | null;
  createdAt: Date;
}

export type LeadFormInput = Pick<
  LeadForm,
  'name' | 'enabled' | 'askPhone' | 'askCompany' | 'askMessage' | 'heading' | 'intro' | 'buttonLabel' | 'thankYou' | 'source' | 'ownerId'
>;

export const NEW_LEAD_FORM: LeadFormInput = {
  name: 'Contact form',
  enabled: true,
  askPhone: true,
  askCompany: true,
  askMessage: true,
  heading: 'Get in touch',
  intro: '',
  buttonLabel: 'Send',
  thankYou: 'Thank you. We will be in touch soon.',
  source: 'Website form',
  ownerId: null,
};

export const FORMS_NOT_SET_UP_MESSAGE = 'Web forms are not set up yet: run supabase/migrations/192_crm_lead_forms.sql in the Supabase SQL editor.';

type Row = Record<string, unknown>;

const formFrom = (r: Row): LeadForm => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  workspaceId: String(r.workspace_id),
  name: String(r.name ?? ''),
  enabled: r.enabled === true,
  askPhone: r.ask_phone !== false,
  askCompany: r.ask_company !== false,
  askMessage: r.ask_message !== false,
  heading: String(r.heading ?? ''),
  intro: String(r.intro ?? ''),
  buttonLabel: String(r.button_label ?? 'Send'),
  thankYou: String(r.thank_you ?? ''),
  source: String(r.source ?? 'Website form'),
  ownerId: typeof r.owner_id === 'string' ? r.owner_id : null,
  createdAt: new Date(String(r.created_at)),
});

const rowOf = (input: LeadFormInput): Row => ({
  name: input.name.trim(),
  enabled: input.enabled,
  ask_phone: input.askPhone,
  ask_company: input.askCompany,
  ask_message: input.askMessage,
  heading: input.heading.trim(),
  intro: input.intro.trim(),
  button_label: input.buttonLabel.trim() || 'Send',
  thank_you: input.thankYou.trim() || NEW_LEAD_FORM.thankYou,
  source: input.source.trim() || NEW_LEAD_FORM.source,
  owner_id: input.ownerId || null,
});

/** The database's own words for "that table is not there" become the sentence that says what to run. */
const friendly = (error: { code?: string; message?: string }): Error => {
  const missing = error.code === '42P01' || error.code === 'PGRST205' || /crm_lead_forms/.test(error.message ?? '') && /does not exist|schema cache/.test(error.message ?? '');
  return new Error(missing ? FORMS_NOT_SET_UP_MESSAGE : error.message || 'The form could not be saved.');
};

export const listLeadForms = async (workspaceId: string): Promise<LeadForm[]> => {
  const { data, error } = await supabase.from('crm_lead_forms').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: true });
  if (error) throw friendly(error);
  return ((data ?? []) as Row[]).map(formFrom);
};

export const createLeadForm = async (organizationId: string, workspaceId: string, input: LeadFormInput, userId: string | null): Promise<LeadForm> => {
  const { data, error } = await supabase
    .from('crm_lead_forms')
    .insert({ ...rowOf(input), organization_id: organizationId, workspace_id: workspaceId, created_by: userId })
    .select()
    .single();
  if (error) throw friendly(error);
  return formFrom(data as Row);
};

export const updateLeadForm = async (id: string, input: LeadFormInput): Promise<LeadForm> => {
  const { data, error } = await supabase.from('crm_lead_forms').update({ ...rowOf(input), updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw friendly(error);
  return formFrom(data as Row);
};

export const deleteLeadForm = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_lead_forms').delete().eq('id', id);
  if (error) throw friendly(error);
};
