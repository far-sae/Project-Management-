-- ============================================================================
-- 192: Web forms that create leads.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor; until
-- then the "Web form" window on the Leads page says
-- "run supabase/migrations/192_crm_lead_forms.sql".
--
-- What it adds, in plain words:
--   * crm_lead_forms: one row per form a workspace has made. It keeps the
--     form's name, whether it is switched on, which extra questions it asks
--     (phone, company, message), its wording (heading, introduction, button,
--     thank-you sentence), the source written on the leads it creates, and who
--     those leads are given to.
--   * crm_lead_form_submissions: one row each time somebody sends a form: which
--     form, when, the lead it became, and a one-way fingerprint of the sender's
--     network address. It is the form's history and what the spam limit counts.
--     The address itself is never stored.
--   * Nothing is added to the existing CRM tables. A lead from a form is an
--     ordinary lead.
--
-- Who can read what:
--   * crm_lead_forms follows the CRM's own rule: people who can use the CRM of
--     that workspace can read its forms, and everyone but viewers can change
--     them.
--   * crm_lead_form_submissions has row level security on and no policy: only
--     the server (the service role) reads and writes it.
--   * The public never reads either table. A visitor's browser talks to the
--     server only, which hands out a form's wording and nothing else.
-- ============================================================================

create table if not exists public.crm_lead_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  enabled boolean not null default true,
  ask_phone boolean not null default true,
  ask_company boolean not null default true,
  ask_message boolean not null default true,
  heading text not null default '' check (char_length(heading) <= 160),
  intro text not null default '' check (char_length(intro) <= 600),
  button_label text not null default 'Send' check (char_length(button_label) between 1 and 40),
  thank_you text not null default 'Thank you. We will be in touch soon.' check (char_length(thank_you) between 1 and 400),
  source text not null default 'Website form' check (char_length(source) between 1 and 80),
  owner_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_lead_forms_workspace on public.crm_lead_forms(workspace_id, created_at desc);

create table if not exists public.crm_lead_form_submissions (
  id bigint generated always as identity primary key,
  form_id uuid not null references public.crm_lead_forms(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  sender_hash text not null,
  -- 'lead' a new lead was added; 'again' the email already belonged to a lead; 'refused' it was not accepted
  result text not null default 'lead' check (result in ('lead', 'again', 'refused')),
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_lead_form_submissions_form on public.crm_lead_form_submissions(form_id, created_at desc);
create index if not exists idx_crm_lead_form_submissions_sender on public.crm_lead_form_submissions(sender_hash, created_at desc);

alter table public.crm_lead_forms enable row level security;
alter table public.crm_lead_form_submissions enable row level security;

grant select, insert, update, delete on public.crm_lead_forms to authenticated;
grant all on public.crm_lead_forms to service_role;
revoke all on public.crm_lead_forms from public, anon;

revoke all on public.crm_lead_form_submissions from public, anon, authenticated;
grant all on public.crm_lead_form_submissions to service_role;

drop policy if exists "crm_lead_forms_workspace_select" on public.crm_lead_forms;
create policy "crm_lead_forms_workspace_select" on public.crm_lead_forms
  for select to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id));

drop policy if exists "crm_lead_forms_workspace_write" on public.crm_lead_forms;
create policy "crm_lead_forms_workspace_write" on public.crm_lead_forms
  for all to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id))
  with check (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));
