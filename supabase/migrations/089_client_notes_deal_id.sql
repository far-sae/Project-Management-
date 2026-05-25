-- 089_client_notes_deal_id.sql
-- Adds an optional `deal_id` column to client_notes so a note can be scoped
-- to a specific deal in addition to (or instead of) the existing client_id.
--
-- Existing client-scoped notes keep working — deal_id is nullable. The deal
-- detail drawer in the UI uses this column to keep its activity feed tight
-- to that deal instead of the whole client.

alter table public.client_notes
  add column if not exists deal_id uuid references public.deals(deal_id) on delete cascade;

-- Partial index so "load notes for this deal" stays a single index seek even
-- on orgs with tens of thousands of notes.
create index if not exists client_notes_deal_idx
  on public.client_notes(deal_id, occurred_at desc)
  where deal_id is not null;
