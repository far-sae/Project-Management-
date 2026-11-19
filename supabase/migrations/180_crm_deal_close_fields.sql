-- ============================================================================
-- 180 — CRM: when a deal was closed and, if lost, why.
--
-- Safe to run more than once; only adds two columns. The app works without
-- it (it simply does not save the close date or the lost reason).
-- ============================================================================

alter table public.crm_deals
  add column if not exists closed_at   timestamptz,
  add column if not exists lost_reason text;

comment on column public.crm_deals.closed_at   is 'When the deal was marked won or lost.';
comment on column public.crm_deals.lost_reason is 'Why the deal was lost (free text).';

-- Deals that were already closed get their last-change time as the close date.
update public.crm_deals
   set closed_at = updated_at
 where closed_at is null
   and status in ('won', 'lost');

notify pgrst, 'reload schema';
