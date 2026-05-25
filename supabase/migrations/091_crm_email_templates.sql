-- 091_crm_email_templates.sql
-- Salesforce-style reusable email templates scoped per organization.
-- Templates carry a subject + body with simple {{client.field}} merge tokens
-- the client-side composer expands before opening a mailto: link.

create table if not exists public.crm_email_templates (
  template_id      uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  name             text not null,
  subject          text,
  body             text,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_crm_email_templates_org_updated
  on public.crm_email_templates (organization_id, updated_at desc);

create unique index if not exists ux_crm_email_templates_org_name
  on public.crm_email_templates (organization_id, lower(name));

alter table public.crm_email_templates enable row level security;

grant select on table public.crm_email_templates to anon;
grant select, insert, update, delete on table public.crm_email_templates to authenticated;

drop policy if exists "anon_no_email_templates"          on public.crm_email_templates;
drop policy if exists "members_view_email_templates"    on public.crm_email_templates;
drop policy if exists "members_insert_email_templates"  on public.crm_email_templates;
drop policy if exists "author_or_admin_update_email_templates" on public.crm_email_templates;
drop policy if exists "author_or_admin_delete_email_templates" on public.crm_email_templates;

create policy "anon_no_email_templates"
  on public.crm_email_templates for select to anon using (false);

create policy "members_view_email_templates"
  on public.crm_email_templates for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members_insert_email_templates"
  on public.crm_email_templates for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or created_by is null)
  );

create policy "author_or_admin_update_email_templates"
  on public.crm_email_templates for update to authenticated
  using (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  )
  with check (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create policy "author_or_admin_delete_email_templates"
  on public.crm_email_templates for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create or replace function public.crm_email_templates_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_email_templates_set_updated_at on public.crm_email_templates;
create trigger crm_email_templates_set_updated_at
  before update on public.crm_email_templates
  for each row execute function public.crm_email_templates_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.crm_email_templates;
exception when others then null;
end $$;
