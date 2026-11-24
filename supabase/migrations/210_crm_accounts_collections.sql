-- Client accounts: the pieces a collections sheet needs, and the link to invoices.
--
-- A lead's Accounts tab keeps the services a client pays for (a monthly fee
-- or a one-time fee) and the payments received. This file adds what was
-- still missing to run it like a collections sheet:
--
--   crm_account_payments.billing_month   the month a payment pays for
--                                        ("2026-09"), which is not always the
--                                        month it arrived in. Empty: the month
--                                        of the payment date.
--   crm_account_payments.method          how it was paid (bank transfer, card, ...)
--   crm_account_payments.reference       the receipt or bank reference
--   crm_account_payments.source_payment_id  set when the payment came from an
--                                        invoice, so it is written only once
--   crm_client_accounts.due_day          the day of the month a monthly fee is due
--   crm_client_accounts.due_date         the date a one-time fee is due
--
-- And the link to invoices: an invoice made for one of these services
-- remembers the service and the month it bills (sr_invoices.crm_account_id,
-- sr_invoices.crm_billing_month). When a payment is recorded on that invoice,
-- the same payment is written on the service, so it is typed once and shows
-- in both places. That write can never be the reason a payment is not
-- recorded: when it fails, the invoice's payment still stands.
--
-- Safe to run more than once. Each part does nothing when the table it
-- belongs to has not been made yet.

set search_path = public;

do $do$
begin
  if to_regclass('public.crm_account_payments') is null or to_regclass('public.crm_client_accounts') is null then
    raise notice 'The client accounts tables are not there yet: run 166_workspace_accounts_and_project_access.sql first, then this file again.';
    return;
  end if;

  execute 'alter table public.crm_account_payments add column if not exists billing_month text';
  execute 'alter table public.crm_account_payments add column if not exists method text';
  execute 'alter table public.crm_account_payments add column if not exists reference text';
  execute 'alter table public.crm_account_payments add column if not exists source_payment_id uuid';
  execute 'alter table public.crm_client_accounts add column if not exists due_day integer';
  execute 'alter table public.crm_client_accounts add column if not exists due_date date';

  if not exists (select 1 from pg_constraint where conname = 'crm_account_payments_billing_month_check') then
    execute $q$alter table public.crm_account_payments add constraint crm_account_payments_billing_month_check
      check (billing_month is null or billing_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')$q$;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_client_accounts_due_day_check') then
    execute 'alter table public.crm_client_accounts add constraint crm_client_accounts_due_day_check check (due_day is null or due_day between 1 and 31)';
  end if;
  -- One payment of an invoice is written on a service once.
  execute 'create unique index if not exists crm_account_payments_source_idx on public.crm_account_payments(source_payment_id) where source_payment_id is not null';
end
$do$;

-- ── Invoices made for a service ────────────────────────────────────────────

do $do$
begin
  if to_regclass('public.sr_invoices') is null or to_regclass('public.sr_payments') is null or to_regclass('public.crm_client_accounts') is null then
    return;
  end if;
  execute 'alter table public.sr_invoices add column if not exists crm_account_id uuid';
  execute 'alter table public.sr_invoices add column if not exists crm_billing_month text';
  execute 'create index if not exists sr_invoices_crm_account_idx on public.sr_invoices(crm_account_id) where crm_account_id is not null';
end
$do$;

-- A payment recorded on an invoice that was made for a service is written on
-- that service too. Never raises.
create or replace function public.sr_payment_to_client_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j jsonb := to_jsonb(new);
  v_invoice jsonb;
  -- A plain record, not the table's own row type: this file can then be run before that table exists.
  v_account record;
  v_month text;
  v_number text;
begin
  begin
    select to_jsonb(i) into v_invoice from public.sr_invoices i where i.id = (j ->> 'invoice_id')::uuid;
    if v_invoice is null or (v_invoice ->> 'crm_account_id') is null then
      return null;
    end if;
    select a.id, a.organization_id, a.workspace_id into v_account from public.crm_client_accounts a where a.id = (v_invoice ->> 'crm_account_id')::uuid;
    if not found then
      return null;
    end if;
    v_month := v_invoice ->> 'crm_billing_month';
    if v_month is null or v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
      v_month := null;
    end if;
    v_number := coalesce(nullif(btrim(v_invoice ->> 'number'), ''), 'an invoice');
    insert into public.crm_account_payments
      (account_id, organization_id, workspace_id, paid_on, amount, notes, billing_month, method, reference, source_payment_id)
    values (
      v_account.id, v_account.organization_id, v_account.workspace_id,
      coalesce((j ->> 'paid_on')::date, current_date),
      round(((j ->> 'amount_minor')::numeric) / 100, 2),
      'Paid on invoice ' || v_number,
      v_month,
      nullif(btrim(coalesce(j ->> 'method', '')), ''),
      nullif(btrim(coalesce(j ->> 'receipt_number', j ->> 'reference', '')), ''),
      new.id
    )
    on conflict do nothing;
  exception when others then
    -- Writing it on the service must never be the reason a payment is not recorded.
    null;
  end;
  return null;
end;
$$;

revoke all on function public.sr_payment_to_client_account() from public, anon, authenticated;

do $do$
begin
  if to_regclass('public.sr_payments') is not null and to_regclass('public.crm_account_payments') is not null then
    drop trigger if exists trg_sr_payments_client_account on public.sr_payments;
    create trigger trg_sr_payments_client_account
      after insert on public.sr_payments
      for each row execute function public.sr_payment_to_client_account();
  end if;
end
$do$;

-- Tell the API about the new columns straight away.
notify pgrst, 'reload schema';
