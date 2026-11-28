-- 218_clock_runs_24_hours.sql
-- The clock runs until the person clocks out.
--
-- Before this, a shift was closed for the person after 9 hours (migrations
-- 087 and 177), so nobody could be on the clock for a long day or a night
-- shift, and the app also clocked people out when they closed the tab (that
-- part is removed in the app itself).
--
-- Now a shift is closed for the person only when nobody clocked out for a
-- whole day (24 hours): that is a forgotten clock, not a shift. The job still
-- runs every 5 minutes.
--
-- Safe to run more than once.

create or replace function public.close_stale_time_entries(
  p_cutoff_hours int default 24
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
  'Closes a time entry nobody clocked out of for the cutoff (default 24 hours): clocked_out_at becomes clocked_in_at + cutoff and auto_closed = true. Runs every 5 minutes.';

grant execute on function public.close_stale_time_entries(int) to authenticated;

-- The job that runs it: same name and rhythm as before, now with 24 hours.
-- Without pg_cron there is no job to change, and nothing closes a shift.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
      from cron.job
      where jobname in ('close_stale_time_entries_hourly', 'close-stale-time-entries');

    perform cron.schedule(
      'close-stale-time-entries',
      '*/5 * * * *',
      $cron$ select public.close_stale_time_entries(24); $cron$
    );
  end if;
end $$;
