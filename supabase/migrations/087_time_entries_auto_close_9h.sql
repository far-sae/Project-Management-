-- 087_time_entries_auto_close_9h.sql
-- Tightens the stale-entry sweep: an open time entry now auto-closes at
-- 9 hours (was 16). Reasoning: an 8-hour shift + 1-hour grace covers
-- people who forget to clock out at end of day without inflating
-- timesheets when someone leaves a laptop awake overnight.
--
-- We re-create the function with a new default and re-schedule the
-- pg_cron job (if pg_cron is installed) to pass 9.

create or replace function public.close_stale_time_entries(
  p_cutoff_hours int default 9
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
  'Closes any time entry left open longer than the cutoff (default 9h, was 16h pre-2026-05). Sets clocked_out_at to clocked_in_at + cutoff and flags auto_closed = true. Runs hourly via pg_cron.';

grant execute on function public.close_stale_time_entries(int) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'close_stale_time_entries_hourly';

    perform cron.schedule(
      'close_stale_time_entries_hourly',
      '17 * * * *',
      $cron$ select public.close_stale_time_entries(9); $cron$
    );
  end if;
end $$;
