-- 108_client_contacts_custom_fields.sql
-- Add a custom_fields jsonb column to client_contacts so the new
-- "Keep extra columns" affordance in the contacts CSV importer has a
-- place to land arbitrary key/value pairs (mirrors clients.custom_fields
-- and leads.custom_fields).

alter table public.client_contacts
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- GIN index lets us search by custom key/value later without a full scan.
create index if not exists idx_client_contacts_custom_fields
  on public.client_contacts using gin (custom_fields);
