-- Additive migration: FK to auth.users + updated_at trigger for databases
-- that applied an older 010_user_capacity.sql without these constraints.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_capacity_user_id_fkey'
      and conrelid = 'public.user_capacity'::regclass
  ) then
    alter table public.user_capacity
      add constraint user_capacity_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end $$;

create or replace function public.user_capacity_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_capacity_set_updated_at on public.user_capacity;
create trigger user_capacity_set_updated_at
  before update on public.user_capacity
  for each row
  execute function public.user_capacity_set_updated_at();
