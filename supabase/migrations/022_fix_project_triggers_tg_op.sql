-- Fix TG_OP comparisons: PL/pgSQL sets TG_OP to uppercase ('INSERT', 'UPDATE').
-- Earlier migrations used lowercase literals so branches never ran on some deployments.

create or replace function public.projects_touch_lock_version()
returns trigger
language plpgsql
as $fn$
begin
  if TG_OP = 'INSERT' then
    if new.lock_pin_hash is not null and btrim(new.lock_pin_hash) <> '' then
      new.lock_pin_version := greatest(coalesce(new.lock_pin_version, 0), 1);
    end if;
    return new;
  end if;
  if TG_OP = 'UPDATE' then
    if old.lock_pin_hash is distinct from new.lock_pin_hash then
      new.lock_pin_version := coalesce(old.lock_pin_version, 0) + 1;
    end if;
  end if;
  return new;
end;
$fn$;

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
