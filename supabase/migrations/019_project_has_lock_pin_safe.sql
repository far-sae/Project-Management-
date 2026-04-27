-- Expose has_lock_pin to clients so list/detail queries never need to select lock_pin_hash.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'has_lock_pin'
  ) then
    alter table public.projects
      add column has_lock_pin boolean
      generated always as (coalesce(btrim(lock_pin_hash), '') <> '') stored;
    comment on column public.projects.has_lock_pin is
      'True when a non-empty lock PIN hash is stored; use instead of reading lock_pin_hash in the client.';
  end if;
end $$;
