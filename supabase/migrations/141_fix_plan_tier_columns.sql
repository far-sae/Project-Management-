-- 141_fix_plan_tier_columns.sql
--
-- Fix: closing a deal to won (which now creates a delivery workspace, mig 140)
-- failed with
--   42703 column "tier" does not exist
--
-- The workspace-cap trigger (mig 122) calls plan_tier_for_org, which read
-- `tier` and `trial_end_date` from public.subscriptions. But that table stores
-- the plan in `plan` and the trial end in `trial_ends_at` (see the app's
-- SubscriptionContext insert: { status, plan, trial_starts_at, trial_ends_at,
-- extra_seats }). So plan_tier_for_org has been broken for ANY workspace insert
-- since 122 — the won-handoff is just the first path to exercise it.
--
-- This redefines plan_tier_for_org against the real columns. plan_max_* and the
-- triggers are unchanged.

create or replace function public.plan_tier_for_org(p_organization_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
declare
  v_owner uuid;
  v_status text;
  v_tier text;
  v_trial_end timestamptz;
begin
  select owner_id into v_owner
    from public.organizations where organization_id = p_organization_id;
  if v_owner is null then return 'starter'; end if;

  -- Real subscriptions columns: status, plan, trial_ends_at.
  select status, plan, trial_ends_at
    into v_status, v_tier, v_trial_end
    from public.subscriptions where user_id = v_owner;

  -- No subscription row yet → treat as trial (the app provisions a 28-day
  -- trial for the holder; members inherit it).
  if v_status is null then
    return 'trial';
  end if;

  if v_status = 'trial' or (v_trial_end is not null and v_trial_end > now()) then
    return 'trial';
  end if;
  if v_status = 'active' and v_tier is not null then
    return v_tier;
  end if;
  return 'starter';
end;
$$;

grant execute on function public.plan_tier_for_org(uuid) to authenticated;
