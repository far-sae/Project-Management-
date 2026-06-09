-- migration 132: add CRM source link columns to tasks
-- Enables deal-won PM handoff (source_deal_id) and CRM activity surfacing (source_client_id).
-- Re-runnable: all statements use IF NOT EXISTS.

alter table public.tasks
  add column if not exists source_deal_id   uuid references public.deals(deal_id)   on delete set null,
  add column if not exists source_client_id uuid references public.clients(client_id) on delete set null;

create index if not exists idx_tasks_source_deal   on public.tasks (source_deal_id)   where source_deal_id   is not null;
create index if not exists idx_tasks_source_client on public.tasks (source_client_id) where source_client_id is not null;
