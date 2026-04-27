-- Optional PIN for locked tasks: SHA-256 hex stored; collaborators unlock in-app to edit.

alter table if exists public.tasks
  add column if not exists lock_pin_hash text null;

comment on column public.tasks.lock_pin_hash is
  'SHA-256 hex of PIN + task id (see app hashLockPin). When set with is_locked, collaborators can unlock in-session to edit.';
