-- 109_deals_custom_fields.sql
-- Add custom_fields jsonb to deals so the CSV importer's "Keep extra
-- columns" affordance lands anywhere it wouldn't otherwise fit, matching
-- the same shape on clients / leads / client_contacts.

alter table public.deals
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create index if not exists idx_deals_custom_fields
  on public.deals using gin (custom_fields);
