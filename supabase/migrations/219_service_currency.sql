-- 219_service_currency.sql
-- A client service can be in its own currency.
--
-- Until now every service of a lead (CRM → a lead → Accounts → Add service)
-- was in the company's one currency. A client who pays in dollars while the
-- company works in pounds could not be written down correctly.
--
-- `currency` is the three-letter code the service's amounts are in ("USD").
-- Empty means the company's own currency, so every service that exists today
-- stays exactly as it is. Payments on a service are in the service's
-- currency: nothing is converted, and the app never adds two currencies
-- together.
--
-- Safe to run more than once.

alter table public.crm_client_accounts
  add column if not exists currency text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_client_accounts_currency_code'
      and conrelid = 'public.crm_client_accounts'::regclass
  ) then
    alter table public.crm_client_accounts
      add constraint crm_client_accounts_currency_code
      check (currency is null or currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column public.crm_client_accounts.currency is
  'The currency the amounts of this service are in (ISO code, "USD"). Null: the organisation''s own currency.';

-- The API learns the new column at once (otherwise a save says the column is unknown for a minute).
notify pgrst, 'reload schema';
