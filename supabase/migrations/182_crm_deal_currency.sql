-- 182 — CRM: a deal can be in its own currency.
--
-- Safe to run more than once; only adds one column. The app works without
-- it (every deal is then in the company currency, as before).
-- ============================================================================

alter table public.crm_deals
  add column if not exists currency text;

comment on column public.crm_deals.currency is
  'ISO code of the currency the deal value is in (e.g. USD). Null means the company currency.';

notify pgrst, 'reload schema';
