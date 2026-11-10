-- One-time clean-up for the bug fixed in migration 173.
--
-- Before 173, accepting a PROJECT invitation as "admin" also made the person
-- an admin of the whole ORGANIZATION (every project, team settings...).
-- Project admins should only control their own project, so anyone whose
-- organization admin role came from such an invitation goes back to an
-- ordinary organization member. Their project roles are not touched — they
-- stay admins of the projects they were invited to.
--
-- Not affected: the organization owner, and anyone with no accepted
-- project-admin invitation (i.e. people deliberately made organization
-- admins). Organization owners can promote someone back on the Team page.

set search_path = public;

with demote as (
  select o.organization_id, m->>'userId' as user_id
  from public.organizations o
  cross join lateral jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
  where m->>'role' = 'admin'
    and coalesce(m->>'userId', '') <> o.owner_id::text
    and exists (
      select 1 from public.invitations i
      where i.organization_id = o.organization_id
        and i.project_id is not null
        and i.role = 'admin'
        and i.status = 'accepted'
        and lower(trim(i.email)) = lower(trim(coalesce(m->>'email', '')))
    )
)
update public.organizations o
  set members = (
        select jsonb_agg(
                 case
                   when exists (
                     select 1 from demote d
                     where d.organization_id = o.organization_id
                       and d.user_id = m->>'userId'
                   )
                   then m || jsonb_build_object('role', 'member')
                   else m
                 end
                 order by ord
               )
        from jsonb_array_elements(o.members) with ordinality as e(m, ord)
      ),
      updated_at = now()
  where o.organization_id in (select organization_id from demote);
