-- 110_deals_probability_user_controlled.sql
-- The original trigger from migration 045 (deals_set_updated_at_and_close)
-- unconditionally snapped deals.probability to deal_default_probability()
-- on every stage change, overriding whatever value the app passed in.
-- That meant: rep edits deal A's probability to 80% to reflect a deeper
-- conversation, then later moves the stage from Lead → Qualified, and the
-- trigger silently resets probability back to 25%.
--
-- This migration replaces that trigger so probability is ONLY auto-set
-- when the app didn't supply one (i.e. a fresh row with probability = 0
-- on a non-zero-default stage). Explicit probabilities from the app
-- always win.

create or replace function public.deals_set_updated_at_and_close()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();

  -- Only auto-fill probability when the row genuinely has none (default 0)
  -- AND the new stage is not 'lost' (which legitimately has 0%). Once the
  -- app starts setting probability explicitly the trigger leaves it alone.
  if (tg_op = 'INSERT')
     and coalesce(new.probability, 0) = 0
     and lower(coalesce(new.stage, '')) <> 'lost' then
    new.probability := public.deal_default_probability(new.stage);
  end if;

  -- Track close metadata when entering won/lost.
  if new.stage in ('won','lost') then
    if new.closed_at is null then
      new.closed_at := now();
    end if;
    if new.closed_by is null then
      new.closed_by := auth.uid();
    end if;
    if new.actual_close_date is null then
      new.actual_close_date := current_date;
    end if;
  elsif tg_op = 'UPDATE' and old.stage in ('won','lost') and new.stage not in ('won','lost') then
    -- Reopened a closed deal — clear close metadata.
    new.closed_at := null;
    new.closed_by := null;
    new.actual_close_date := null;
    new.loss_reason := null;
  end if;

  return new;
end;
$$;
