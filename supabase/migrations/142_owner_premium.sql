-- 142_owner_premium.sql
--
-- One-off: put the PLATFORM OWNER (securovix@gmail.com) on premium so their
-- own org isn't capped by the freemium workspace/member limits (mig 122).
--
-- Why: after the 28-day trial expires the app flips the holder's subscription
-- to plan='starter' (1 workspace cap). The platform owner shouldn't be capped
-- on their own product — premium = unlimited workspaces & members
-- (plan_max_workspaces/plan_max_members return NULL for premium).
--
-- This does NOT change the caps for anyone else — it only upgrades this one
-- account's subscription row. Re-runnable (idempotent).

-- Upgrade the existing row if there is one.
update public.subscriptions s
set status = 'active',
    plan   = 'premium'
from auth.users u
where u.id = s.user_id
  and lower(u.email) = 'securovix@gmail.com';

-- If the owner has no subscription row yet, create a premium one. Only the
-- columns the app itself sets are touched, so this matches the table shape.
insert into public.subscriptions (user_id, status, plan, billing_cycle, cancel_at_period_end)
select u.id, 'active', 'premium', null, false
from auth.users u
where lower(u.email) = 'securovix@gmail.com'
  and not exists (
    select 1 from public.subscriptions s where s.user_id = u.id
  );
