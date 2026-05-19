-- 086_clients_category.sql
-- Adds a top-level `category` text column to clients. Useful for grouping
-- ("Enterprise" / "SMB" / "NGO" / "Reseller" / …) without forcing users to
-- pick from a fixed enum. Stays nullable so existing rows are valid.

alter table public.clients
  add column if not exists category text;

-- Helpful index so "filter by category" stays fast as the table grows.
create index if not exists clients_org_category_idx
  on public.clients(organization_id, category)
  where category is not null;
