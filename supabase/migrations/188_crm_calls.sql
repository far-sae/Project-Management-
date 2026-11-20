-- ============================================================================
-- 188: Calls placed from the CRM.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor; until
-- then the Call window says "run supabase/migrations/188_crm_calls.sql".
--
-- What it adds, in plain words:
--   * One table, crm_calls: one row for every call an owner or admin places
--     from a lead or a company. It keeps who called, which number was rung and
--     from which of your numbers, how the call ended, how long it lasted, the
--     phone provider's ids for the call and its recording, and the caller's
--     own outcome and note.
--   * Nothing is added to the existing CRM tables. A finished call also leaves
--     an ordinary "call" entry on the lead's or company's timeline
--     (crm_activities), written by the server.
--
-- Who can read it: nobody from the browser. The table has row level security
-- on and no policy, so only the server (the service role) reads and writes it.
-- Recordings stay with the phone provider and are fetched by the server for an
-- owner or admin who asks to hear one.
-- ============================================================================

create table if not exists public.crm_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  to_number text not null,
  from_number text not null,
  country text not null check (country in ('US', 'GB')),
  status text not null default 'starting'
    check (status in ('starting', 'ringing', 'completed', 'no_answer', 'busy', 'failed', 'canceled')),
  twilio_call_sid text,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  recording_sid text,
  recording_seconds integer not null default 0 check (recording_seconds >= 0),
  outcome text check (outcome is null or outcome in ('connected', 'no_answer', 'voicemail', 'busy', 'wrong_number')),
  note text not null default '',
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_calls_user_created on public.crm_calls(user_id, created_at desc);
create index if not exists idx_crm_calls_org_created on public.crm_calls(organization_id, created_at desc);
create index if not exists idx_crm_calls_contact on public.crm_calls(contact_id) where contact_id is not null;
create index if not exists idx_crm_calls_company on public.crm_calls(company_id) where company_id is not null;

alter table public.crm_calls enable row level security;

revoke all on public.crm_calls from public, anon, authenticated;
grant all on public.crm_calls to service_role;
