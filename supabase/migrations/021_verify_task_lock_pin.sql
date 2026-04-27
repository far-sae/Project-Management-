-- Server-side task PIN check; do not expose lock_pin_hash in API mappings.

create or replace function public.verify_task_lock_pin(p_task_id uuid, p_pin text)
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
    t.lock_pin_hash,
    (
      coalesce(t.is_locked, false) = false
      or t.created_by = auth.uid()
      or public.tasks_user_is_assignee(t.assignees)
      or public.tasks_user_is_project_owner(t.project_id)
    )
  into v_hash, v_allowed
  from public.tasks t
  where t.task_id = p_task_id;

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
    extensions.digest(btrim(p_pin) || e'\n' || p_task_id::text, 'sha256'),
    'hex'
  );
  return v_computed = v_hash;
end;
$fn$;

comment on function public.verify_task_lock_pin(uuid, text) is
  'Returns true if PIN matches stored hash; caller must be allowed to see the task.';

grant execute on function public.verify_task_lock_pin(uuid, text) to authenticated;
