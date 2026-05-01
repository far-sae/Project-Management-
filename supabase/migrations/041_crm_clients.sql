-- CRM: Clients (accounts), contacts, notes/activity log, file attachments
--
-- Salesforce-style client data management for the org. Clients are the
-- companies/customers the org works with; contacts are the people at those
-- clients; notes capture the activity timeline (calls, meetings, emails);
-- attachments store uploaded documents (contracts, briefs, IDs, …).
--
-- Permission model — mirrors HR / payroll / expenses:
--   * any org member can VIEW client data (so reps can see who they're working
--     with) — all read policies use is_org_member
--   * only OWNER + ADMIN can create / edit / delete (mutations)
--   * anon role is explicitly denied
--
-- Relies on helpers from migration 036:
--   public.is_org_owner(uuid), public.is_org_member(uuid),
--   public.is_org_admin_or_owner(uuid)

-- ---------------------------------------------------------------------------
-- clients (the "Account" object)
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  client_id           uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  name                text not null,
  legal_name          text,
  industry            text,
  type                text not null default 'customer',     -- customer | prospect | partner | vendor | other
  status              text not null default 'active',       -- active | inactive | archived
  website             text,
  email               text,
  phone               text,
  -- Address fields kept flat; if we need structured lookups later we can move
  -- to PostGIS or a JSONB column without a breaking change.
  address_line1       text,
  address_line2       text,
  city                text,
  state               text,
  postal_code         text,
  country             text,
  annual_revenue      numeric(16,2),
  employee_count      integer,
  rating              text,                                  -- hot | warm | cold
  source              text,                                  -- referral | web | event | …
  description         text,
  tags                text[] not null default '{}',
  -- Owner is the rep/AE inside our org who manages this client. Stored as
  -- (uuid, name) so the UI keeps showing the name even if the owner is
  -- removed from the org.
  account_owner_id    uuid,
  account_owner_name  text,
  -- Custom fields — every Salesforce-style CRM needs to let admins extend
  -- the schema without a migration. Keep small (validated client-side).
  custom_fields       jsonb not null default '{}'::jsonb,
  created_by          uuid,
  created_by_name     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  check (type in ('customer','prospect','partner','vendor','other')),
  check (status in ('active','inactive','archived')),
  -- Light email validation; UI does richer checks. Mainly a sanity guard
  -- against junk like "n/a" leaking from CSV imports.
  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  check (annual_revenue is null or annual_revenue >= 0),
  check (employee_count is null or employee_count >= 0)
);

-- Most queries are "all clients in my org, sorted by name or recently updated".
-- Composite index covers both sort orders cheaply.
create index if not exists idx_clients_org_name
  on public.clients (organization_id, name);
create index if not exists idx_clients_org_updated
  on public.clients (organization_id, updated_at desc);
create index if not exists idx_clients_org_status
  on public.clients (organization_id, status);
-- Tag filter ("Show me all clients tagged 'enterprise'") — gin index for arrays.
create index if not exists idx_clients_tags_gin
  on public.clients using gin (tags);

alter table public.clients enable row level security;

grant select on table public.clients to anon;
grant select, insert, update, delete on table public.clients to authenticated;

drop policy if exists "anon_no_clients"           on public.clients;
drop policy if exists "members_view_clients"      on public.clients;
drop policy if exists "owner_admin_insert_clients" on public.clients;
drop policy if exists "owner_admin_update_clients" on public.clients;
drop policy if exists "owner_admin_delete_clients" on public.clients;

create policy "anon_no_clients"
  on public.clients for select to anon using (false);

create policy "members_view_clients"
  on public.clients for select to authenticated
  using (public.is_org_member(organization_id));

create policy "owner_admin_insert_clients"
  on public.clients for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

create policy "owner_admin_update_clients"
  on public.clients for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

create policy "owner_admin_delete_clients"
  on public.clients for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.clients_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.clients_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.clients;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- client_contacts (people at a client)
-- ---------------------------------------------------------------------------
create table if not exists public.client_contacts (
  contact_id        uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(client_id) on delete cascade,
  organization_id   uuid not null,
  first_name        text,
  last_name         text,
  -- Postgres requires IMMUTABLE expressions for STORED generated columns;
  -- concat_ws + trim are marked STABLE which fails with 42P17. Use the text
  -- || operator and a CASE expression instead — both are IMMUTABLE.
  full_name         text generated always as (
    case
      when nullif(first_name, '') is null and nullif(last_name, '') is null then null
      when nullif(first_name, '') is null then last_name
      when nullif(last_name,  '') is null then first_name
      else first_name || ' ' || last_name
    end
  ) stored,
  title             text,
  department        text,
  email             text,
  phone             text,
  mobile            text,
  is_primary        boolean not null default false,
  notes             text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- A contact must have at least a name OR an email — guards against blank
  -- rows imported from a CSV.
  check (
    coalesce(nullif(first_name, ''), nullif(last_name, ''), nullif(email, '')) is not null
  )
);

create index if not exists idx_client_contacts_client on public.client_contacts (client_id);
create index if not exists idx_client_contacts_org    on public.client_contacts (organization_id);
-- Common case: one primary contact per client. Partial unique index makes
-- "set this contact as primary" a clean upsert pattern.
create unique index if not exists ux_client_contacts_primary
  on public.client_contacts (client_id) where is_primary;

alter table public.client_contacts enable row level security;

grant select on table public.client_contacts to anon;
grant select, insert, update, delete on table public.client_contacts to authenticated;

drop policy if exists "anon_no_client_contacts"           on public.client_contacts;
drop policy if exists "members_view_client_contacts"      on public.client_contacts;
drop policy if exists "owner_admin_insert_client_contacts" on public.client_contacts;
drop policy if exists "owner_admin_update_client_contacts" on public.client_contacts;
drop policy if exists "owner_admin_delete_client_contacts" on public.client_contacts;

create policy "anon_no_client_contacts"
  on public.client_contacts for select to anon using (false);

create policy "members_view_client_contacts"
  on public.client_contacts for select to authenticated
  using (public.is_org_member(organization_id));

create policy "owner_admin_insert_client_contacts"
  on public.client_contacts for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

create policy "owner_admin_update_client_contacts"
  on public.client_contacts for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

create policy "owner_admin_delete_client_contacts"
  on public.client_contacts for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.client_contacts_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists client_contacts_set_updated_at on public.client_contacts;
create trigger client_contacts_set_updated_at
  before update on public.client_contacts
  for each row execute function public.client_contacts_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.client_contacts;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- client_notes (activity timeline: calls, meetings, emails, free-form notes)
-- ---------------------------------------------------------------------------
create table if not exists public.client_notes (
  note_id          uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(client_id) on delete cascade,
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

create index if not exists idx_client_notes_client_time
  on public.client_notes (client_id, occurred_at desc);
create index if not exists idx_client_notes_org
  on public.client_notes (organization_id);

alter table public.client_notes enable row level security;

grant select on table public.client_notes to anon;
grant select, insert, update, delete on table public.client_notes to authenticated;

drop policy if exists "anon_no_client_notes"          on public.client_notes;
drop policy if exists "members_view_client_notes"     on public.client_notes;
drop policy if exists "members_insert_client_notes"   on public.client_notes;
drop policy if exists "author_or_admin_update_notes"  on public.client_notes;
drop policy if exists "author_or_admin_delete_notes"  on public.client_notes;

create policy "anon_no_client_notes"
  on public.client_notes for select to anon using (false);

create policy "members_view_client_notes"
  on public.client_notes for select to authenticated
  using (public.is_org_member(organization_id));

-- Members can log their own activity (calls / notes); they cannot edit other
-- people's history.
create policy "members_insert_client_notes"
  on public.client_notes for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (author_id = auth.uid() or author_id is null)
  );

create policy "author_or_admin_update_notes"
  on public.client_notes for update to authenticated
  using (
    public.is_org_member(organization_id)
    and (author_id = auth.uid() or public.is_org_admin_or_owner(organization_id))
  )
  with check (
    public.is_org_member(organization_id)
    and (author_id = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create policy "author_or_admin_delete_notes"
  on public.client_notes for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and (author_id = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create or replace function public.client_notes_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists client_notes_set_updated_at on public.client_notes;
create trigger client_notes_set_updated_at
  before update on public.client_notes
  for each row execute function public.client_notes_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.client_notes;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- client_attachments (files uploaded against a client — contracts, briefs…)
-- The actual binary lives in Supabase Storage bucket "attachments" under
-- {organization_id}/clients/{client_id}/...; this table stores the metadata.
-- ---------------------------------------------------------------------------
create table if not exists public.client_attachments (
  attachment_id    uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(client_id) on delete cascade,
  organization_id  uuid not null,
  file_name        text not null,
  file_path        text not null,            -- storage object path (relative to bucket)
  file_url         text,                     -- public URL (cached)
  file_type        text,
  file_size        bigint,
  uploaded_by      uuid,
  uploaded_by_name text,
  created_at       timestamptz not null default now(),

  check (file_size is null or file_size >= 0)
);

create index if not exists idx_client_attachments_client
  on public.client_attachments (client_id, created_at desc);
create index if not exists idx_client_attachments_org
  on public.client_attachments (organization_id);

alter table public.client_attachments enable row level security;

grant select on table public.client_attachments to anon;
grant select, insert, update, delete on table public.client_attachments to authenticated;

drop policy if exists "anon_no_client_attachments"           on public.client_attachments;
drop policy if exists "members_view_client_attachments"      on public.client_attachments;
drop policy if exists "members_insert_client_attachments"    on public.client_attachments;
drop policy if exists "uploader_or_admin_delete_attachments" on public.client_attachments;

create policy "anon_no_client_attachments"
  on public.client_attachments for select to anon using (false);

create policy "members_view_client_attachments"
  on public.client_attachments for select to authenticated
  using (public.is_org_member(organization_id));

-- Any member can upload, but they own the row. Updates are blocked outright —
-- if you need to replace a file, delete and re-upload (audit-friendly).
create policy "members_insert_client_attachments"
  on public.client_attachments for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (uploaded_by = auth.uid() or uploaded_by is null)
  );

create policy "uploader_or_admin_delete_attachments"
  on public.client_attachments for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and (uploaded_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

do $$
begin
  alter publication supabase_realtime add table public.client_attachments;
exception when others then null;
end $$;
