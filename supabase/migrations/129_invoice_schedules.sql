-- Billing Phase 4: recurring invoice schedules. The crm-run-automations worker
-- scans due schedules each tick and creates an invoice from the template.
-- Re-runnable.

create table if not exists public.invoice_schedules (
  schedule_id       uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  client_id         uuid not null references public.clients(client_id) on delete cascade,
  workspace_id      uuid,

  title             text,
  currency          text not null default 'USD',
  tax_rate          numeric(6,3) not null default 0,   -- percent, e.g. 8 = 8%
  discount          numeric(14,2) not null default 0,  -- flat, applied before tax
  line_items        jsonb not null default '[]'::jsonb,
  notes             text,
  terms             text,

  frequency         text not null default 'monthly',
  due_days          integer not null default 14,       -- due_at = issued_at + due_days
  next_run_date     date not null,
  enabled           boolean not null default true,

  last_invoice_id   uuid,
  last_run_at       timestamptz,

  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (frequency in ('weekly','monthly','quarterly','yearly'))
);

create index if not exists idx_invoice_schedules_org
  on public.invoice_schedules (organization_id, enabled, next_run_date);
create index if not exists idx_invoice_schedules_due
  on public.invoice_schedules (next_run_date) where enabled;

alter table public.invoice_schedules enable row level security;

drop policy if exists "anon_no_invoice_schedules" on public.invoice_schedules;
create policy "anon_no_invoice_schedules"
  on public.invoice_schedules for select to anon using (false);

drop policy if exists "members_view_invoice_schedules" on public.invoice_schedules;
create policy "members_view_invoice_schedules"
  on public.invoice_schedules for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "admins_insert_invoice_schedules" on public.invoice_schedules;
create policy "admins_insert_invoice_schedules"
  on public.invoice_schedules for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "admins_update_invoice_schedules" on public.invoice_schedules;
create policy "admins_update_invoice_schedules"
  on public.invoice_schedules for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "admins_delete_invoice_schedules" on public.invoice_schedules;
create policy "admins_delete_invoice_schedules"
  on public.invoice_schedules for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));
