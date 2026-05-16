-- 061_dup_detection_indexes.sql
-- Hard-block duplicate clients/contacts via partial unique indexes on normalized
-- keys. Admin override via 'dup_override' tag in clients.tags.

create or replace function public.normalize_email(e text) returns text
language sql immutable as $$
  select case
    when e is null then null
    when btrim(lower(e)) = '' then null
    else regexp_replace(btrim(lower(e)), '\+[^@]*(?=@)', '')
  end;
$$;

create or replace function public.normalize_company_name(n text) returns text
language sql immutable as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(lower(coalesce(n,'')),
        '\m(inc|llc|ltd|gmbh|s\.a\.|pty|co|corp|corporation)\.?\M', '', 'g'),
      '\s+', ' ', 'g'
    )), ''
  );
$$;

-- Note: partial unique indexes on FUNCTIONS require the function to be IMMUTABLE.
-- Both above are declared IMMUTABLE.

-- Clean any existing pre-migration duplicates before creating the index, or the
-- migration will fail. The cleanup tags the older duplicate with dup_override so
-- it gets skipped by the index.
update public.clients c
set tags = array_append(coalesce(tags,'{}'), 'dup_override')
where exists (
  select 1 from public.clients c2
  where c2.organization_id = c.organization_id
    and c2.client_id <> c.client_id
    and public.normalize_email(c2.email) = public.normalize_email(c.email)
    and c.email is not null
    and c.created_at < c2.created_at
);

create unique index if not exists ux_clients_email_per_org
  on public.clients(organization_id, public.normalize_email(email))
  where email is not null
    and not ('dup_override' = any(tags));

-- Pre-deduplicate name+country collisions the same way.
update public.clients c
set tags = array_append(coalesce(tags,'{}'), 'dup_override')
where exists (
  select 1 from public.clients c2
  where c2.organization_id = c.organization_id
    and c2.client_id <> c.client_id
    and public.normalize_company_name(c2.name) = public.normalize_company_name(c.name)
    and coalesce(c2.country,'') = coalesce(c.country,'')
    and c.created_at < c2.created_at
);

create unique index if not exists ux_clients_name_country_per_org
  on public.clients(
    organization_id,
    public.normalize_company_name(name),
    coalesce(country,'')
  )
  where not ('dup_override' = any(tags));

create unique index if not exists ux_client_contacts_email_per_org
  on public.client_contacts(organization_id, public.normalize_email(email))
  where email is not null;

create table if not exists public.client_dup_overrides (
  override_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null references public.clients(client_id) on delete cascade,
  matched_existing_id uuid not null references public.clients(client_id) on delete cascade,
  overridden_by uuid,
  reason text,
  created_at timestamptz default now()
);

create index if not exists client_dup_overrides_org_idx
  on public.client_dup_overrides(organization_id, created_at desc);

alter table public.client_dup_overrides enable row level security;
drop policy if exists "dup overrides read for org members" on public.client_dup_overrides;
create policy "dup overrides read for org members"
  on public.client_dup_overrides for select
  using (public.is_org_member(organization_id));
