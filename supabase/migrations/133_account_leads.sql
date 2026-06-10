alter table public.leads
  add column if not exists account_id uuid references public.clients(client_id) on delete set null,
  add column if not exists category   text;
create index if not exists idx_leads_account on public.leads (account_id) where account_id is not null;

alter table public.clients
  add column if not exists lead_categories text[] not null default '{}';
