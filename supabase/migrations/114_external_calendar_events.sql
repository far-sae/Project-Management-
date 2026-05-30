-- 114_external_calendar_events.sql
-- Caches the user's Google Calendar events so the in-app Calendar can
-- show meetings + invites that landed via Gmail (Google sends every
-- accepted/declined invite into the user's Calendar; we mirror those
-- here so the rep doesn't have to flip tabs). Per-user, scoped to a
-- date window the sync function controls.
--
-- The local row is identified by (user_id, google_event_id). Re-syncs
-- upsert so a single event never duplicates if the rep refreshes
-- multiple times. RLS gates reads to the owning user; writes go via
-- the service role from the sync edge function.

create table if not exists public.external_calendar_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  organization_id   uuid not null,
  provider          text not null default 'google',
  google_event_id   text not null,
  calendar_id       text not null default 'primary',
  summary           text,
  description       text,
  location          text,
  meet_link         text,
  html_link         text,
  status            text,           -- confirmed | tentative | cancelled
  start_at          timestamptz,    -- timed events
  end_at            timestamptz,
  start_date        date,           -- all-day events
  end_date          date,
  organizer_email   text,
  organizer_name    text,
  attendees         jsonb not null default '[]'::jsonb,
  /** True when the rep is the organizer (their own meeting). False for
   *  invites coming from outside. UI uses this to render a subtle
   *  "invited by X" hint vs an "owned" event. */
  is_organizer      boolean not null default false,
  raw               jsonb,          -- full Calendar API payload for debug
  last_synced_at    timestamptz not null default now(),
  unique (user_id, google_event_id)
);

create index if not exists idx_ext_cal_user_time
  on public.external_calendar_events (user_id, start_at desc);

create index if not exists idx_ext_cal_user_org
  on public.external_calendar_events (user_id, organization_id);

alter table public.external_calendar_events enable row level security;
grant select on table public.external_calendar_events to authenticated;

drop policy if exists "external_calendar_events_owner_read" on public.external_calendar_events;
create policy "external_calendar_events_owner_read"
  on public.external_calendar_events for select to authenticated
  using (user_id = auth.uid());

-- No INSERT/UPDATE policies — writes are service-role only via the
-- sync-google-calendar edge function.
