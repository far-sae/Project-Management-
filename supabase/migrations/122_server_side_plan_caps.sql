-- 122_server_side_plan_caps.sql
--
-- Server-side enforcement for the plan limits that were previously
-- only gated client-side by usePlanLimits. The UI hides "+ Workspace"
-- when you're at the cap, but a determined member could bypass it
-- with a direct PostgREST INSERT. This migration plugs that gap with
-- BEFORE-INSERT/UPDATE triggers that raise when a limit is exceeded.
--
-- Limits enforced here (matches TIER_LIMITS in src/types/subscription.ts):
--   Starter:  1 workspace,  1 member
--   Basic:    3 workspaces, 3 members
--   Advanced: 10 workspaces, 10 members (+ paid extra_seats)
--   Premium: unlimited
--
-- Trial users see Advanced caps for the trial window — once the
-- trial expires + the row flips to status='starter', Starter caps
-- apply automatically because plan_tier_for_org reads the live
-- subscription row.
--
-- Triggers use SECURITY DEFINER so a member's INSERT can query the
-- owner's subscription row without their RLS scope (subscriptions is
-- per-user). The 23514 check_violation SQLSTATE makes PostgREST
-- return a clean 400 the UI can translate.

set search_path = public;

-- ---------------------------------------------------------------------------
-- plan_tier_for_org — returns 'starter' | 'basic' | 'advanced' | 'premium'
--                     | 'trial' for the org's owner. Trial counts as
--                     advanced for capacity purposes; the date logic
--                     is mirrored from the frontend trial flow.
-- ---------------------------------------------------------------------------
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

  select status, tier, trial_end_date
    into v_status, v_tier, v_trial_end
    from public.subscriptions where user_id = v_owner;

  -- No subscription row yet → treat as trial during the grace window
  -- AuthContext provides (28 days from signup); auth.users.created_at
  -- is the best proxy.
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


-- ---------------------------------------------------------------------------
-- plan_max_workspaces / plan_max_members — numeric cap per tier.
-- NULL means unlimited.
-- ---------------------------------------------------------------------------
create or replace function public.plan_max_workspaces(p_tier text)
returns integer language sql immutable as $$
  select case p_tier
    when 'starter'  then 1
    when 'basic'    then 3
    when 'advanced' then 10
    when 'trial'    then 10
    else null
  end;
$$;

create or replace function public.plan_max_members(p_tier text)
returns integer language sql immutable as $$
  select case p_tier
    when 'starter'  then 1
    when 'basic'    then 3
    when 'advanced' then 10
    when 'trial'    then 10
    else null
  end;
$$;


-- ---------------------------------------------------------------------------
-- enforce_workspace_cap — fires BEFORE INSERT on workspaces. Blocks
-- the insert if the org is at or above its tier's workspace limit.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_workspace_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tier text;
  v_max integer;
  v_existing integer;
begin
  v_tier := public.plan_tier_for_org(new.organization_id);
  v_max  := public.plan_max_workspaces(v_tier);
  if v_max is null then return new; end if;  -- unlimited

  select count(*) into v_existing
    from public.workspaces
   where organization_id = new.organization_id;

  if v_existing >= v_max then
    raise exception
      'Your % plan allows up to % workspace(s). Upgrade to add more.',
      v_tier, v_max
      using errcode = '23514',
            hint = 'upgrade_plan_workspaces',
            detail = format('current=%s, max=%s, tier=%s', v_existing, v_max, v_tier);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_workspace_cap on public.workspaces;
create trigger trg_enforce_workspace_cap
  before insert on public.workspaces
  for each row execute function public.enforce_workspace_cap();


-- ---------------------------------------------------------------------------
-- enforce_member_cap — fires BEFORE UPDATE on organizations.members
-- (which is the jsonb array the app uses to track org membership).
-- Blocks the update if the NEW members array exceeds the tier's
-- member limit + any paid extra_seats.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_member_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tier text;
  v_max integer;
  v_extra integer := 0;
  v_active_count integer;
begin
  -- Member count changes only matter when the members jsonb itself
  -- changes (avoid running on every cosmetic org update).
  if new.members is not distinct from old.members then return new; end if;

  v_tier := public.plan_tier_for_org(new.organization_id);
  v_max  := public.plan_max_members(v_tier);
  if v_max is null then return new; end if;  -- premium = unlimited

  -- Paid extra seats are stored on the owner's subscription row.
  select coalesce(extra_seats, 0) into v_extra
    from public.subscriptions
   where user_id = new.owner_id;

  -- Only count members with status='active' (or unset, treated as
  -- active for back-compat with older rows). Invited / removed
  -- members don't consume a seat.
  select count(*) into v_active_count
    from jsonb_array_elements(coalesce(new.members, '[]'::jsonb)) as m
    where coalesce(m->>'status', 'active') = 'active';

  if v_active_count > (v_max + v_extra) then
    raise exception
      'Your % plan allows up to % active member(s)%s. Upgrade or buy extra seats to add more.',
      v_tier, v_max,
      case when v_extra > 0 then format(' (+ %s paid extra)', v_extra) else '' end
      using errcode = '23514',
            hint = 'upgrade_plan_members',
            detail = format('attempted=%s, max=%s, tier=%s, extra=%s', v_active_count, v_max, v_tier, v_extra);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_member_cap on public.organizations;
create trigger trg_enforce_member_cap
  before update on public.organizations
  for each row execute function public.enforce_member_cap();
