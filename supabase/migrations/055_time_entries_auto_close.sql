-- Auto-close stale time entries
--
-- Adds an `auto_closed` flag so we can distinguish entries the user stopped
-- manually from ones the system closed (logout, tab close, or the safety
-- sweep). The sweep function closes any entry left open for more than a
-- configurable cutoff (default 16h) so a forgotten timer doesn't keep
-- racking up payroll hours indefinitely.
--
-- The function is SECURITY DEFINER so a scheduled job can call it without
-- needing per-user auth. Owners/admins can still call it from the app via
-- the same RLS-bypassing path.

alter table public.time_entries
  add column if not exists auto_closed boolean not null default false;

comment on column public.time_entries.auto_closed is
  'True when the entry was closed automatically (logout, tab close, or stale-entry sweep) rather than by the user clicking Clock out.';

create or replace function public.close_stale_time_entries(
  p_cutoff_hours int default 16
)
returns table (entry_id uuid, organization_id uuid, user_id uuid, hours_open numeric)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return query
  update public.time_entries t
     set clocked_out_at = t.clocked_in_at + make_interval(hours => p_cutoff_hours),
         auto_closed    = true,
         updated_at     = now()
   where t.clocked_out_at is null
     and t.clocked_in_at < now() - make_interval(hours => p_cutoff_hours)
   returning
     t.entry_id,
     t.organization_id,
     t.user_id,
     round(extract(epoch from (now() - t.clocked_in_at)) / 3600.0, 2) as hours_open;
end;
$$;

comment on function public.close_stale_time_entries(int) is
  'Closes any time entry left open longer than the cutoff (default 16h) by setting clocked_out_at to clocked_in_at + cutoff and flagging auto_closed = true. Returns the rows it touched. Intended to run hourly via pg_cron or a Supabase scheduled function.';

grant execute on function public.close_stale_time_entries(int) to authenticated;

-- pg_cron schedule (idempotent). Only attempts the schedule if pg_cron is
-- installed in the database — Supabase Pro projects have it by default,
-- but free-tier projects don't and the schedule call would error out.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Drop any prior schedule with the same job name so re-running is safe.
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'close_stale_time_entries_hourly';

    perform cron.schedule(
      'close_stale_time_entries_hourly',
      '17 * * * *',  -- 17 minutes past every hour
      $cron$ select public.close_stale_time_entries(16); $cron$
    );
  end if;
end $$;
