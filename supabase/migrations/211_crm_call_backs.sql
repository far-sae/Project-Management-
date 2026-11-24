-- Calls: when a lead calls back.
--
-- Until now the calling numbers only called out. Somebody who rang one of them
-- back reached nothing. An organisation can now say who takes those calls: a
-- short list of people and their phone numbers (anywhere in the world), rung
-- one after the other. When the first does not answer within the ring time
-- (12 seconds unless changed), the next one is rung. A call nobody took is
-- written down as missed.
--
-- What this file adds:
--   crm_call_forwarding    one row for each organisation: whether call-backs
--                          are on, the people to ring in order, how long each
--                          phone rings, and whether a person must press a key
--                          to take the call (so a phone's voicemail cannot)
--   crm_calls.direction    'out' for a call we placed, 'in' for a call back
--   crm_calls.answered_by  the name of the person who took a call back
--
-- Who can read it: nobody from the browser, like crm_calls itself. The table
-- has row level security on and no policy, so only the server (the service
-- role) reads and writes it, for an owner or admin who asks.
--
-- Safe to run more than once. It changes nothing when the calls table
-- (188_crm_calls.sql) has not been made yet.

set search_path = public;

do $do$
begin
  if to_regclass('public.crm_calls') is null then
    raise notice 'crm_calls is not there yet: run 188_crm_calls.sql first, then this file again.';
    return;
  end if;

  execute $q$
    create table if not exists public.crm_call_forwarding (
      organization_id uuid primary key references public.organizations(organization_id) on delete cascade,
      enabled boolean not null default false,
      -- [{"name": "Priya", "number": "+919812345678"}, ...] in the order they are rung.
      people jsonb not null default '[]'::jsonb check (jsonb_typeof(people) = 'array'),
      ring_seconds integer not null default 12 check (ring_seconds between 5 and 60),
      screen boolean not null default true,
      updated_by uuid,
      updated_at timestamptz not null default now()
    )
  $q$;
  execute 'alter table public.crm_call_forwarding enable row level security';
  execute 'revoke all on public.crm_call_forwarding from public, anon, authenticated';
  execute 'grant all on public.crm_call_forwarding to service_role';

  execute $q$alter table public.crm_calls add column if not exists direction text not null default 'out'$q$;
  execute 'alter table public.crm_calls add column if not exists answered_by text';
  if not exists (select 1 from pg_constraint where conname = 'crm_calls_direction_check') then
    execute $q$alter table public.crm_calls add constraint crm_calls_direction_check check (direction in ('out', 'in'))$q$;
  end if;
  -- "Whose lead is calling?" is answered from the last call placed to that number.
  execute 'create index if not exists idx_crm_calls_to_number on public.crm_calls(to_number, created_at desc)';
end
$do$;
