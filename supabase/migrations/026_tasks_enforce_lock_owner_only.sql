-- Only the task creator may set or change is_locked / lock_pin_hash (mirrors projects_enforce_lock_owner_only).

create or replace function public.tasks_enforce_lock_owner_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
begin
  if TG_OP = 'INSERT' then
    if coalesce(new.is_locked, false) is true
      or (new.lock_pin_hash is not null and btrim(new.lock_pin_hash) <> '') then
      if auth.uid() is null then
        raise exception 'Authentication required to set task lock or PIN.';
      end if;
      if (new.created_by)::text is distinct from (auth.uid())::text then
        raise exception 'Only the task creator can set lock or PIN settings.';
      end if;
    end if;
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.is_locked is distinct from old.is_locked
      or new.lock_pin_hash is distinct from old.lock_pin_hash then
      if auth.uid() is null then
        raise exception 'Authentication required to change task lock or PIN.';
      end if;
      if (new.created_by)::text is distinct from (auth.uid())::text then
        raise exception 'Only the task creator can change lock or PIN settings.';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$fn$;

comment on function public.tasks_enforce_lock_owner_only() is
  'Rejects INSERT/UPDATE that set or change task PIN/lock unless auth.uid() is the row created_by.';

drop trigger if exists tasks_enforce_lock_owner_only_trg on public.tasks;
create trigger tasks_enforce_lock_owner_only_trg
before insert or update on public.tasks
for each row
execute function public.tasks_enforce_lock_owner_only();
