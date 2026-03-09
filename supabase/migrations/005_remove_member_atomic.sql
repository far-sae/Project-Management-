-- Atomic helper to remove a project member from the members JSONB array.
-- Called from the remove-member Edge Function to avoid read/modify/write races.

create or replace function public.remove_project_member(
  p_project_id uuid,
  p_member_user_id text
) returns void
language sql
as $$
update projects p
set
  members = (
    select coalesce(jsonb_agg(m), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) as m
    where (m->>'userId') is distinct from p_member_user_id
      and (m->>'user_id') is distinct from p_member_user_id
  ),
  stats = jsonb_set(
    coalesce(p.stats, '{}'::jsonb),
    '{membersCount}',
    to_jsonb(
      (
        select count(*)
        from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) as m
        where (m->>'userId') is distinct from p_member_user_id
          and (m->>'user_id') is distinct from p_member_user_id
      )
    ),
    true
  ),
  updated_at = now()
where p.project_id = p_project_id;
$$;

