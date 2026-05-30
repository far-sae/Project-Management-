-- 113_meet_for_crm.sql
-- Google Meet links only existed on the project `tasks` table (migration
-- 057). The user reasonably wants the same workflow for CRM:
--   • Per-deal / per-account "meeting" notes carry their own Meet link.
--   • CRM follow-up tasks (client_tasks) can spin up a Meet link tied to
--     their due_at, exactly like project tasks do.
-- Add the columns here so the rest of the integration can stamp them.

alter table public.client_notes
  add column if not exists google_meet_link text,
  add column if not exists google_event_id  text;

alter table public.client_tasks
  add column if not exists google_meet_link text,
  add column if not exists google_event_id  text;

-- Per-deal "meeting at this URL on this date" — used by the new CRM
-- meet-create edge function so the link survives even when the note is
-- deleted (some reps prefer the link on the deal itself for a
-- standing meeting).
alter table public.deals
  add column if not exists google_meet_link text,
  add column if not exists google_event_id  text;

create index if not exists idx_client_notes_meet
  on public.client_notes (google_event_id)
  where google_event_id is not null;

create index if not exists idx_client_tasks_meet
  on public.client_tasks (google_event_id)
  where google_event_id is not null;
