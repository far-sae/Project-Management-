-- Fix client_tasks completion trigger for DBs that already applied 045:
--  • Fire on INSERT OR UPDATE (INSERT with status = 'done' now stamps done_*)
--  • Populate done_by_name from public.user_profiles when stamping done_by
--  • SECURITY DEFINER so profile lookup succeeds under typical RLS

create or replace function public.client_tasks_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  nm text;
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if new.status = 'done' then
      if new.done_at is null then new.done_at := now(); end if;
      uid := coalesce(new.done_by, auth.uid());
      if new.done_by is null then new.done_by := uid; end if;
      if new.done_by_name is null and uid is not null then
        select coalesce(nullif(trim(display_name), ''), nullif(trim(email::text), ''))
          into nm
          from public.user_profiles
          where id = uid
          limit 1;
        new.done_by_name := coalesce(nullif(trim(nm), ''), 'User');
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status = 'done' and old.status is distinct from 'done' then
      if new.done_at is null then new.done_at := now(); end if;
      uid := coalesce(new.done_by, auth.uid());
      if new.done_by is null then new.done_by := uid; end if;
      if new.done_by_name is null and uid is not null then
        select coalesce(nullif(trim(display_name), ''), nullif(trim(email::text), ''))
          into nm
          from public.user_profiles
          where id = uid
          limit 1;
        new.done_by_name := coalesce(nullif(trim(nm), ''), 'User');
      end if;
    elsif new.status is distinct from 'done' and old.status = 'done' then
      new.done_at := null;
      new.done_by := null;
      new.done_by_name := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists client_tasks_set_updated_at on public.client_tasks;
create trigger client_tasks_set_updated_at
  before insert or update on public.client_tasks
  for each row execute function public.client_tasks_set_updated_at();
