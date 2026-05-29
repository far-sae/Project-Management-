-- 103_clients_zoho_account_fields.sql
-- Bring clients (accounts) up to parity with Zoho's Create Account form so
-- the form can mirror what reps coming from Zoho expect to see. Optional
-- columns only — existing rows stay valid.

alter table public.clients
  add column if not exists account_site     text,
  add column if not exists parent_client_id uuid references public.clients(client_id) on delete set null,
  add column if not exists account_number   text,
  add column if not exists ticker_symbol    text,
  add column if not exists ownership        text,
  add column if not exists sic_code         text;

-- Helpful for the "Member Accounts" related list on the parent account
-- (the children that point at it as their parent). Without this index a
-- 10k-row tenant would table-scan to fetch a single parent's children.
create index if not exists idx_clients_parent_client_id
  on public.clients (parent_client_id)
  where parent_client_id is not null;

-- Allowed Account Type / Ownership / Industry values — kept loose (text)
-- rather than ENUM-typed so we can extend the picker without a migration.
-- Validation happens client-side via the form options; this comment is the
-- contract for anyone reading the schema.
--
--   account_type: customer | prospect | partner | vendor | other
--   ownership   : Public | Private | Subsidiary | Government | Other
--   sic_code    : 4-digit SIC industry code (US), stored verbatim
