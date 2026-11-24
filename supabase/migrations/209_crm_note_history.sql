-- CRM notes: the earlier versions of a note are kept.
--
-- A note on a lead, a company or a deal can be changed. Until now the old
-- words were gone the moment it was saved. From now on, each time a note's
-- text changes, the text it had before is kept in public.crm_note_history,
-- with who changed it and when. The note's page shows "History".
--
-- Who can read it: the same people who can read the note (the people of the
-- organisation). Nobody writes to it by hand: the database does, on the
-- change itself. The history goes with its note when the note is deleted.
--
-- Keeping the old words can never be the reason a note is not saved: when
-- that fails, the note is still changed.
--
-- Safe to run more than once.

create table if not exists public.crm_note_history (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.crm_notes (id) on delete cascade,
  organization_id uuid not null,
  workspace_id uuid,
  -- The words the note had before the change.
  body text not null,
  -- When those words were written (the note's own time before the change).
  written_at timestamptz,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists idx_crm_note_history_note on public.crm_note_history (note_id, changed_at desc);

alter table public.crm_note_history enable row level security;
revoke all on public.crm_note_history from public, anon, authenticated;
grant select on public.crm_note_history to authenticated;
grant all on public.crm_note_history to service_role;

drop policy if exists "crm_note_history_read" on public.crm_note_history;
create policy "crm_note_history_read" on public.crm_note_history
  for select to authenticated
  using (public.is_org_member(organization_id));

create or replace function public.crm_keep_note_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    if new.body is distinct from old.body then
      insert into public.crm_note_history (note_id, organization_id, workspace_id, body, written_at, changed_by)
      values (old.id, old.organization_id, old.workspace_id, old.body, old.updated_at, auth.uid());
    end if;
  exception when others then
    -- Keeping the old words must never be the reason a note is not saved.
    null;
  end;
  return new;
end;
$$;

revoke all on function public.crm_keep_note_version() from public, anon, authenticated;

drop trigger if exists trg_crm_notes_keep_version on public.crm_notes;
create trigger trg_crm_notes_keep_version
  before update on public.crm_notes
  for each row execute function public.crm_keep_note_version();

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';
