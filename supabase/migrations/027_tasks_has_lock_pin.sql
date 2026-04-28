-- Expose has_lock_pin on tasks so clients know a PIN is configured without selecting lock_pin_hash.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tasks'
      and column_name = 'has_lock_pin'
  ) then
    alter table public.tasks
      add column has_lock_pin boolean
      generated always as (
        coalesce(is_locked, false)
        and coalesce(btrim(lock_pin_hash), '') <> ''
      ) stored;
    comment on column public.tasks.has_lock_pin is
      'True when the task is locked and a non-empty PIN hash exists; use instead of reading lock_pin_hash in the client.';
  end if;
end $$;
