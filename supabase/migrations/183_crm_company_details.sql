-- More to say about a company, in line with what other CRMs keep on a company
-- record: what kind of company it is to you, the rest of its address, and its
-- LinkedIn page.
--
-- Every column is optional, so existing companies are untouched.
-- Safe to run more than once.

set search_path = public;

alter table public.crm_companies
  -- Prospect, Customer, Partner, Supplier, Reseller, Competitor or Other.
  add column if not exists type text,
  -- County / state / region. `address` stays the street, `city` and `country` as before.
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists linkedin_url text;

create index if not exists idx_crm_companies_type on public.crm_companies (organization_id, type);

notify pgrst, 'reload schema';
