-- 117_client_tasks_polymorphic_relations.sql
--
-- Adds polymorphic relation columns to client_tasks so a Task can be
-- linked to any of {lead | contact | client | deal} the same way
-- meetings and calls already are. Without this, tasks created from
-- a Lead drawer or an orphan Contact (no parent account) couldn't be
-- linked back to the source record — the Open/Closed Activities
-- sections looked broken because there was nothing to filter on.
--
-- New columns:
--   related_to_type — 'lead' | 'contact' | 'client' | 'deal' | null
--   related_to_id   — uuid of the related entity
--   lead_id         — convenience FK-style column for Lead links so the
--                     filter doesn't have to JOIN on (type='lead'
--                     AND related_to_id=…). Mirrors how client_id /
--                     deal_id work today.
--
-- All three are NULLABLE; existing rows stay valid. Service-layer
-- drift recovery (already in place from migration 115) strips these
-- on insert if the deployed DB hasn't run this migration yet.

set search_path = public;

alter table public.client_tasks
  add column if not exists related_to_type text,
  add column if not exists related_to_id   uuid,
  add column if not exists lead_id         uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_tasks_related_to_type_check'
  ) then
    alter table public.client_tasks
      add constraint client_tasks_related_to_type_check
      check (related_to_type is null
        or related_to_type in ('lead','contact','client','deal','account'));
  end if;
end $$;

-- Targeted indexes for the per-record "Open Activities" filter — same
-- shape as the meetings/calls indexes we ship in 115.
create index if not exists idx_client_tasks_lead
  on public.client_tasks (lead_id)
  where lead_id is not null;
create index if not exists idx_client_tasks_related
  on public.client_tasks (related_to_type, related_to_id)
  where related_to_type is not null;

-- Backfill: client_id rows get related_to_type='client' so a query that
-- only knows about the polymorphic columns still finds them. Existing
-- queries that read client_id directly are unaffected.
update public.client_tasks
   set related_to_type = 'client', related_to_id = client_id
 where client_id is not null and related_to_type is null;

update public.client_tasks
   set related_to_type = 'deal', related_to_id = deal_id
 where deal_id is not null and related_to_type is null;


-- ---------------------------------------------------------------------------
-- meetings + calls: add lead_id too so leads get the same convenience
-- column tasks now have. Polymorphic related_to fields on these tables
-- already exist (migration 115); lead_id is just the indexed shortcut.
-- ---------------------------------------------------------------------------
alter table public.meetings
  add column if not exists lead_id uuid;
alter table public.calls
  add column if not exists lead_id uuid;

create index if not exists idx_meetings_lead
  on public.meetings (lead_id) where lead_id is not null;
create index if not exists idx_calls_lead
  on public.calls (lead_id) where lead_id is not null;
