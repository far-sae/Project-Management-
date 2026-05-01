-- Tighten member self clock-out: RLS policy members_clock_out_own_open still
-- allowed any column change on the open row. This trigger blocks non-owners from
-- mutating identity/timing fields except clock-out + notes (+ generated duration
-- and updated_at from the existing updated_at trigger).

create or replace function public.enforce_clock_out_only_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Organization owner edits are unrestricted (separate RLS policy).
  if public.is_org_owner(new.organization_id) then
    return new;
  end if;

  -- Only constrain the "still open" member row path; closed rows use other policies.
  if old.clocked_out_at is not null then
    return new;
  end if;

  if old.user_id is distinct from auth.uid() then
    return new;
  end if;

  if (old.organization_id is distinct from new.organization_id)
     or (old.user_id is distinct from new.user_id)
     or (old.user_name is distinct from new.user_name)
     or (old.project_id is distinct from new.project_id)
     or (old.project_name is distinct from new.project_name)
     or (old.clocked_in_at is distinct from new.clocked_in_at)
     or (old.entry_id is distinct from new.entry_id)
     or (old.created_at is distinct from new.created_at)
     or (old.edited_by is distinct from new.edited_by)
     or (old.edited_at is distinct from new.edited_at)
  then
    raise exception 'Members may only clock out (set clocked_out_at) and adjust notes on an open entry'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_clock_out_only_update on public.time_entries;
create trigger enforce_clock_out_only_update
  before update on public.time_entries
  for each row
  execute function public.enforce_clock_out_only_update();
