-- Project-level PIN: members must enter PIN in the app to open the project (client-side guard; hash only in DB).
alter table if exists public.projects
  add column if not exists is_locked boolean not null default false;

alter table if exists public.projects
  add column if not exists lock_pin_hash text null;

comment on column public.projects.is_locked is 'When true and lock_pin_hash is set, the UI requires PIN to view the project (owner/org admin can bypass).';
comment on column public.projects.lock_pin_hash is 'SHA-256 client hash of PIN + project id; not the raw PIN.';
