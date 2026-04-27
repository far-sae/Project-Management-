-- Server-side project PIN check (hash never returned to clients in API mapping).
-- lock_pin_version increments when lock_pin_hash changes so session unlock keys can invalidate.
-- NOTE: numbered 018 (not 017) so this does not collide with 017_notifications_delete_policy.sql in schema_migrations.

alter table if exists public.projects
  add column if not exists lock_pin_version integer not null default 0;

comment on column public.projects.lock_pin_version is 'Increments when lock_pin_hash changes; exposed to clients for session unlock scoping only.';

update public.projects
set lock_pin_version = greatest(lock_pin_version, 1)
where lock_pin_hash is not null
  and lock_pin_version = 0;

create or replace function public.projects_touch_lock_version()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'insert' then
    if new.lock_pin_hash is not null and btrim(new.lock_pin_hash) <> '' then
      new.lock_pin_version := greatest(coalesce(new.lock_pin_version, 0), 1);
    end if;
    return new;
  end if;
  if old.lock_pin_hash is distinct from new.lock_pin_hash then
    new.lock_pin_version := coalesce(old.lock_pin_version, 0) + 1;
  end if;
  return new;
end;
$fn$;

drop trigger if exists projects_touch_lock_version_trg on public.projects;
create trigger projects_touch_lock_version_trg
before insert or update on public.projects
for each row
execute function public.projects_touch_lock_version();

create extension if not exists pgcrypto with schema extensions;

create or replace function public.verify_project_lock_pin(p_project_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_hash text;
  v_allowed boolean;
  v_computed text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select
    p.lock_pin_hash,
    (
      (p.owner_id)::text = (auth.uid())::text
      or exists (
        select 1
        from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) m
        where coalesce(m->>'userId', m->>'user_id') = (auth.uid())::text
      )
    )
  into v_hash, v_allowed
  from public.projects p
  where p.project_id = p_project_id;

  if not found then
    return false;
  end if;

  if not coalesce(v_allowed, false) then
    return false;
  end if;

  if v_hash is null or length(btrim(p_pin)) = 0 then
    return false;
  end if;

  v_computed := encode(
    extensions.digest(btrim(p_pin) || e'\n' || p_project_id::text, 'sha256'),
    'hex'
  );
  return v_computed = v_hash;
end;
$fn$;

comment on function public.verify_project_lock_pin(uuid, text) is 'Returns true if PIN matches stored hash; only for project members/owner.';

grant execute on function public.verify_project_lock_pin(uuid, text) to authenticated;
