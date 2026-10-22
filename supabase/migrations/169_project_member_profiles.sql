-- Resolve real project-member names without opening user_profiles to every
-- authenticated user. Only callers who can access the requested project may
-- retrieve its members' basic identity fields.

create or replace function public.get_project_member_profiles(p_project_id uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  photo_url text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with accessible_project as (
    select p.project_id, p.owner_id, p.members
    from public.projects p
    where p.project_id = p_project_id
      and public.can_access_project(p.project_id)
  ),
  raw_members as (
    select
      p.owner_id as user_id,
      null::jsonb as member_json
    from accessible_project p

    union all

    select
      case
        when coalesce(m.value->>'userId', m.value->>'user_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then coalesce(m.value->>'userId', m.value->>'user_id')::uuid
        else null
      end as user_id,
      m.value as member_json
    from accessible_project p
    cross join lateral jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) m(value)
  ),
  members as (
    select distinct on (r.user_id)
      r.user_id,
      r.member_json
    from raw_members r
    where r.user_id is not null
    order by r.user_id, (r.member_json is null) desc
  ),
  identities as (
    select
      m.user_id,
      m.member_json,
      up.display_name as profile_name,
      up.email as profile_email,
      up.photo_url as profile_photo,
      au.email as auth_email,
      au.raw_user_meta_data
    from members m
    left join public.user_profiles up on up.id = m.user_id
    left join auth.users au on au.id = m.user_id
  ),
  normalized as (
    select
      i.*,
      coalesce(
        nullif(btrim(i.profile_email), ''),
        nullif(btrim(i.auth_email), ''),
        nullif(btrim(i.member_json->>'email'), ''),
        ''
      ) as resolved_email
    from identities i
  )
  select
    n.user_id,
    coalesce(
      case
        when lower(btrim(coalesce(n.profile_name, ''))) not in
          ('', 'admin', 'member', 'owner', 'unknown', 'user', 'viewer', 'you')
          and position('@' in coalesce(n.profile_name, '')) = 0
        then btrim(n.profile_name)
      end,
      case
        when lower(btrim(coalesce(n.raw_user_meta_data->>'full_name', ''))) not in
          ('', 'admin', 'member', 'owner', 'unknown', 'user', 'viewer', 'you')
        then btrim(n.raw_user_meta_data->>'full_name')
      end,
      case
        when lower(btrim(coalesce(n.raw_user_meta_data->>'name', ''))) not in
          ('', 'admin', 'member', 'owner', 'unknown', 'user', 'viewer', 'you')
        then btrim(n.raw_user_meta_data->>'name')
      end,
      case
        when lower(btrim(coalesce(n.member_json->>'displayName', n.member_json->>'display_name', ''))) not in
          ('', 'admin', 'member', 'owner', 'unknown', 'user', 'viewer', 'you')
        then btrim(coalesce(n.member_json->>'displayName', n.member_json->>'display_name'))
      end,
      nullif(split_part(n.resolved_email, '@', 1), ''),
      'Teammate ' || left(n.user_id::text, 6)
    ) as display_name,
    n.resolved_email as email,
    coalesce(
      nullif(btrim(n.profile_photo), ''),
      nullif(btrim(n.raw_user_meta_data->>'avatar_url'), ''),
      nullif(btrim(n.raw_user_meta_data->>'picture'), ''),
      nullif(btrim(coalesce(n.member_json->>'photoURL', n.member_json->>'photo_url')), ''),
      ''
    ) as photo_url
  from normalized n
  order by n.user_id;
$$;

revoke all on function public.get_project_member_profiles(uuid) from public;
grant execute on function public.get_project_member_profiles(uuid) to authenticated;

comment on function public.get_project_member_profiles(uuid) is
  'Returns basic identity fields only for members of a project the caller can access.';
