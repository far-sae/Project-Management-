-- 147_crm_contacts_category.sql
--
-- Adds a free-text `category` field to leads (crm_contacts). This is a
-- user-defined bucket separate from the enum `lifecycle_stage`. Distinct
-- values are surfaced in the UI as a filter + as suggestions during CSV
-- import, and users can type any new value they want.

set search_path = public;

alter table public.crm_contacts
  add column if not exists category text;

create index if not exists idx_crm_contacts_category on public.crm_contacts(organization_id, category);
