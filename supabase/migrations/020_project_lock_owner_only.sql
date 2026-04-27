-- Enforce at DB level: only the project owner may set or change is_locked / lock_pin_hash.
-- Matches app logic in updateProject(); blocks direct API/SQL attempts by non-owners.
-- NOTE: numbered 020 so this does not collide with 019_project_has_lock_pin_safe.sql.

create or replace function public.projects_enforce_lock_owner_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
begin
  if TG_OP = 'INSERT' then
    if new.is_locked is true
      or (new.lock_pin_hash is not null and btrim(new.lock_pin_hash) <> '') then
      if auth.uid() is null then
        raise exception 'Authentication required to set project lock or PIN.';
      end if;
      if (new.owner_id)::text is distinct from (auth.uid())::text then
        raise exception 'Only the project owner can set lock or PIN settings.';
      end if;
    end if;
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.is_locked is distinct from old.is_locked
      or new.lock_pin_hash is distinct from old.lock_pin_hash then
      if auth.uid() is null then
        raise exception 'Authentication required to change project lock or PIN.';
      end if;
      if (old.owner_id)::text is distinct from (auth.uid())::text then
        raise exception 'Only the project owner can change lock or PIN settings.';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$fn$;

comment on function public.projects_enforce_lock_owner_only() is
  'Rejects INSERT/UPDATE that set or change project PIN/lock unless auth.uid() is the row owner_id.';

drop trigger if exists projects_enforce_lock_owner_only_trg on public.projects;
create trigger projects_enforce_lock_owner_only_trg
before insert or update on public.projects
for each row
execute function public.projects_enforce_lock_owner_only();

comment on column public.projects.is_locked is
  'When true with lock_pin_hash, collaborators enter PIN each session. Only owner_id may change lock/PIN (trigger + app).';

comment on column public.projects.lock_pin_hash is
  'SHA-256 hash of PIN + project id. Only owner_id may set or change (trigger + app).';
