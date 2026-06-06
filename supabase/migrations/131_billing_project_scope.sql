-- Billing: scope invoices / bills / recurring schedules to a project (optional).
-- workspace_id already exists on all three. Re-runnable.
alter table public.invoices          add column if not exists project_id uuid references public.projects(project_id) on delete set null;
alter table public.bills             add column if not exists project_id uuid references public.projects(project_id) on delete set null;
alter table public.invoice_schedules add column if not exists project_id uuid references public.projects(project_id) on delete set null;

create index if not exists idx_invoices_project          on public.invoices (project_id)          where project_id is not null;
create index if not exists idx_bills_project             on public.bills (project_id)             where project_id is not null;
create index if not exists idx_invoice_schedules_project on public.invoice_schedules (project_id) where project_id is not null;
