-- 062_lead_forms.sql
-- Lead-capture forms: per-pipeline definitions, public submissions, rate limits.

create table if not exists public.lead_forms (
  form_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  pipeline_id uuid not null
    references public.pipelines(pipeline_id) on delete restrict,
  slug text not null,
  title text not null,
  description text,
  fields jsonb not null,
  thank_you_message text not null default 'Thanks — we got it.',
  redirect_url text,
  turnstile_enabled boolean not null default true,
  rate_limit_per_minute int not null default 10,
  rate_limit_per_hour int not null default 100,
  status text not null default 'active'
    check (status in ('active','paused','archived')),
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organization_id, slug)
);

create unique index if not exists ux_lead_forms_global_slug
  on public.lead_forms(slug);

create table if not exists public.form_submissions (
  submission_id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.lead_forms(form_id) on delete cascade,
  organization_id uuid not null,
  form_slug text not null,
  form_title text not null,
  client_id uuid references public.clients(client_id) on delete set null,
  deal_id   uuid references public.deals(deal_id)   on delete set null,
  raw_payload jsonb not null,
  ip_hash text,
  user_agent text,
  turnstile_token_verified boolean not null default false,
  honeypot_tripped boolean not null default false,
  rejected_reason text,
  created_at timestamptz not null default now()
);

create index if not exists form_submissions_org_idx
  on public.form_submissions(organization_id, created_at desc);
create index if not exists form_submissions_form_idx
  on public.form_submissions(form_id, created_at desc);

create table if not exists public.form_submission_rate_limits (
  form_id uuid not null,
  ip_hash text not null,
  bucket_started_at timestamptz not null,
  window_seconds int not null,
  count int not null default 1,
  primary key (form_id, ip_hash, bucket_started_at, window_seconds)
);

-- Daily-rotating salt for ip_hash. Single row; service-role-only access.
create table if not exists public.crm_secrets (
  key text primary key,
  value text not null,
  rotated_at timestamptz not null default now()
);

insert into public.crm_secrets (key, value)
-- 32 random bytes via two concatenated gen_random_uuid() calls. Built-in to
-- Postgres 13+ and resolvable without a schema qualifier, unlike
-- pgcrypto.gen_random_bytes() which lives in the `extensions` schema on
-- Supabase and isn't on the migration search_path.
values (
  'turnstile_daily_salt',
  encode(
    decode(replace(gen_random_uuid()::text, '-', ''), 'hex') ||
    decode(replace(gen_random_uuid()::text, '-', ''), 'hex'),
    'base64'
  )
)
on conflict (key) do nothing;

alter table public.lead_forms enable row level security;
alter table public.form_submissions enable row level security;
-- form_submission_rate_limits has NO RLS; only the Edge Function reads/writes.

drop policy if exists "lead_forms read for org members" on public.lead_forms;
create policy "lead_forms read for org members"
  on public.lead_forms for select
  using (public.is_org_member(organization_id));

drop policy if exists "lead_forms admin write" on public.lead_forms;
create policy "lead_forms admin write" on public.lead_forms
  for all using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists "form_submissions read for org members" on public.form_submissions;
create policy "form_submissions read for org members"
  on public.form_submissions for select
  using (public.is_org_member(organization_id));

-- Inserts to form_submissions happen via SECURITY DEFINER Edge Function only;
-- no write policy by design.
