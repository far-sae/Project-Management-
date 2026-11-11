-- 1. Lifetime Premium for securovix@gmail.com.
--    Team members ride on their organization owner's subscription
--    (SubscriptionContext uses the org owner's row), so this covers everyone
--    in every workspace this account owns. Premium = unlimited projects,
--    members, workspaces and storage. No Stripe subscription is attached, so
--    the Stripe webhook will never overwrite it.
--
-- 2. Auto clock-out: shifts open longer than 9 hours were closed by an hourly
--    job (clock-out recorded at exactly clock-in + 9 h). Run it every 5
--    minutes so nobody still shows as "on the clock" for up to an hour after.

set search_path = public;

insert into public.subscriptions (user_id, status, plan, current_period_start, current_period_end,
                                  cancel_at_period_end, trial_ends_at, created_at, updated_at)
select u.id, 'active', 'premium', now(), '2099-12-31T23:59:59Z', false, null, now(), now()
from auth.users u
where lower(u.email) = 'securovix@gmail.com'
on conflict (user_id) do update
  set status = 'active',
      plan = 'premium',
      current_period_start = now(),
      current_period_end = '2099-12-31T23:59:59Z',
      cancel_at_period_end = false,
      trial_ends_at = null,
      updated_at = now();

select cron.unschedule(jobid) from cron.job
  where jobname in ('close_stale_time_entries_hourly', 'close-stale-time-entries');

select cron.schedule(
  'close-stale-time-entries',
  '*/5 * * * *',
  $$select public.close_stale_time_entries(9);$$
);
