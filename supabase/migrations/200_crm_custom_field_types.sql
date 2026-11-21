-- Leads: custom fields with a type.
--
-- A custom field on a lead was a name and a line of text. A workspace can now
-- say what kind of thing a field is: text, a number, a date, or one of a list
-- of choices. The lead form then shows the right kind of box and checks what is
-- typed. The values themselves stay where they were (crm_contacts.custom_fields),
-- so nothing that is already written changes.
--
-- One table is added, with the CRM's own access rule: people who can open the
-- workspace's CRM read it, and everybody but viewers can change it.
--
-- Safe to run more than once.

create table if not exists public.crm_field_defs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  kind text not null default 'text' check (kind in ('text', 'number', 'date', 'choice')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  created_at timestamptz not null default now()
);

-- One field of a name per workspace, whatever the capitals.
create unique index if not exists crm_field_defs_name on public.crm_field_defs (workspace_id, lower(btrim(name)));

alter table public.crm_field_defs enable row level security;
revoke all on public.crm_field_defs from anon, authenticated;
grant select, insert, update, delete on public.crm_field_defs to authenticated;
grant all on public.crm_field_defs to service_role;

drop policy if exists "crm_field_defs_read" on public.crm_field_defs;
create policy "crm_field_defs_read" on public.crm_field_defs
  for select to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id));

drop policy if exists "crm_field_defs_write" on public.crm_field_defs;
create policy "crm_field_defs_write" on public.crm_field_defs
  for all to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id))
  with check (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';
