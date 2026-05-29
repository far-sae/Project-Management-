-- 100_crm_leads.sql
-- Salesforce/Zoho-style Leads module. A lead is a prospect who has shown
-- interest but isn't yet a customer. Leads carry their own contact identity
-- (first/last name) AND inline company info; on "convert" they spawn an
-- account (clients), a contact (client_contacts), and optionally a deal.
--
-- Workspace-scoped per the same model as clients. Sequential lead numbers
-- (L-000001) via next_lead_number RPC so concurrent reps don't collide.

create table if not exists public.leads (
  lead_id          uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  workspace_id     uuid not null,
  lead_number      text not null,

  -- Identity
  salutation       text,
  first_name       text,
  last_name        text not null,
  title            text,

  -- Contact channels
  email            text,
  phone            text,
  mobile           text,
  fax              text,
  website          text,
  skype_id         text,
  twitter          text,
  linkedin_url     text,

  -- Company / lead-level firmographics (move to client on convert)
  company          text not null,
  industry         text,
  annual_revenue   numeric(14, 2),
  no_of_employees  integer,

  -- Address (inline; copied to client on convert)
  street           text,
  city             text,
  state            text,
  postal_code      text,
  country          text,

  -- Lifecycle
  lead_owner_id    uuid,
  lead_owner_name  text,
  lead_source      text,                 -- Advertisement | Cold Call | Web | ...
  lead_status      text not null default 'new',
  rating           text,                 -- Active | Acquired | Market Failed | ...
  email_opt_out    boolean not null default false,

  -- Conversion result (NULL until converted)
  converted_at         timestamptz,
  converted_to_client_id  uuid references public.clients(client_id) on delete set null,
  converted_to_contact_id uuid references public.client_contacts(contact_id) on delete set null,
  converted_to_deal_id    uuid references public.deals(deal_id) on delete set null,

  -- Misc
  description      text,
  tags             text[] not null default '{}',
  custom_fields    jsonb not null default '{}'::jsonb,
  image_url        text,

  -- Audit
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  check (lead_status in (
    'new',
    'attempted_to_contact',
    'contact_in_future',
    'contacted',
    'junk_lead',
    'lost_lead',
    'not_contacted',
    'pre_qualified',
    'not_qualified',
    'converted'
  ))
);

create unique index if not exists ux_leads_org_number
  on public.leads (organization_id, lower(lead_number));

create index if not exists idx_leads_org_workspace_status
  on public.leads (organization_id, workspace_id, lead_status, created_at desc);

create index if not exists idx_leads_owner
  on public.leads (lead_owner_id) where lead_owner_id is not null;

create index if not exists idx_leads_email
  on public.leads (organization_id, lower(email)) where email is not null;

alter table public.leads enable row level security;

grant select on table public.leads to anon;
grant select, insert, update, delete on table public.leads to authenticated;

drop policy if exists "anon_no_leads"              on public.leads;
drop policy if exists "members_view_leads"         on public.leads;
drop policy if exists "members_insert_leads"       on public.leads;
drop policy if exists "author_or_admin_update_leads" on public.leads;
drop policy if exists "author_or_admin_delete_leads" on public.leads;

create policy "anon_no_leads"
  on public.leads for select to anon using (false);

create policy "members_view_leads"
  on public.leads for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members_insert_leads"
  on public.leads for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (created_by = auth.uid() or created_by is null)
  );

create policy "author_or_admin_update_leads"
  on public.leads for update to authenticated
  using (
    public.is_org_member(organization_id)
    and (
      created_by = auth.uid()
      or lead_owner_id = auth.uid()
      or public.is_org_admin_or_owner(organization_id)
    )
  )
  with check (
    public.is_org_member(organization_id)
    and (
      created_by = auth.uid()
      or lead_owner_id = auth.uid()
      or public.is_org_admin_or_owner(organization_id)
    )
  );

create policy "author_or_admin_delete_leads"
  on public.leads for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and (
      created_by = auth.uid()
      or public.is_org_admin_or_owner(organization_id)
    )
  );

create or replace function public.leads_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.leads_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.leads;
exception when others then null;
end $$;

-- Per-org sequential lead number. Same pattern as next_quote_number.
create or replace function public.next_lead_number(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_seq integer;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  select coalesce(max(
           case when lead_number ~ '^L-\d+$'
             then substring(lead_number from '\d+')::integer
             else 0
           end), 0) + 1
    into v_seq
  from public.leads
  where organization_id = p_organization_id;
  return 'L-' || lpad(v_seq::text, 6, '0');
end;
$$;

grant execute on function public.next_lead_number(uuid) to authenticated;

-- Lead notes: parallel to client_notes but scoped to a lead. Kept separate
-- from client_notes because the existing table has NOT NULL client_id and
-- mutating that constraint would risk breaking existing RLS policies.
create table if not exists public.lead_notes (
  note_id          uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(lead_id) on delete cascade,
  organization_id  uuid not null,
  kind             text not null default 'note',  -- note | call | meeting | email | task
  subject          text,
  body             text,
  occurred_at      timestamptz not null default now(),
  author_id        uuid,
  author_name      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  check (kind in ('note','call','meeting','email','task'))
);

create index if not exists idx_lead_notes_lead_time
  on public.lead_notes (lead_id, occurred_at desc);
create index if not exists idx_lead_notes_org
  on public.lead_notes (organization_id);

alter table public.lead_notes enable row level security;
grant select on table public.lead_notes to anon;
grant select, insert, update, delete on table public.lead_notes to authenticated;

drop policy if exists "anon_no_lead_notes"          on public.lead_notes;
drop policy if exists "members_view_lead_notes"     on public.lead_notes;
drop policy if exists "members_insert_lead_notes"   on public.lead_notes;
drop policy if exists "author_or_admin_update_lead_notes" on public.lead_notes;
drop policy if exists "author_or_admin_delete_lead_notes" on public.lead_notes;

create policy "anon_no_lead_notes"
  on public.lead_notes for select to anon using (false);

create policy "members_view_lead_notes"
  on public.lead_notes for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members_insert_lead_notes"
  on public.lead_notes for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (author_id = auth.uid() or author_id is null)
  );

create policy "author_or_admin_update_lead_notes"
  on public.lead_notes for update to authenticated
  using (
    public.is_org_member(organization_id)
    and (author_id = auth.uid() or public.is_org_admin_or_owner(organization_id))
  )
  with check (
    public.is_org_member(organization_id)
    and (author_id = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create policy "author_or_admin_delete_lead_notes"
  on public.lead_notes for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and (author_id = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create or replace function public.lead_notes_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists lead_notes_set_updated_at on public.lead_notes;
create trigger lead_notes_set_updated_at
  before update on public.lead_notes
  for each row execute function public.lead_notes_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.lead_notes;
exception when others then null;
end $$;
