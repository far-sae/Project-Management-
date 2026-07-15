-- 148_crm_custom_fields.sql
--
-- Adds a jsonb `custom_fields` bag to leads (crm_contacts) and businesses
-- (crm_companies). The CSV import wizard uses this to store columns that
-- don't map to any predefined field — the user picks "Custom field" during
-- mapping and names the key, and each row's value gets stashed here as
-- `{ "<key>": "<value>" }`. The detail pages render whatever keys exist.

set search_path = public;

alter table public.crm_contacts
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.crm_companies
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;
