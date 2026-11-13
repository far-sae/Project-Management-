-- Reliable "Online / Last seen" for chat and team panels.
--
-- user_profiles is not readable for other people's rows (see migration 169),
-- so the client's direct `select id, last_seen_at` only ever returned the
-- caller's own row: chat headers showed "Offline" for teammates who were
-- online. These two definer functions keep profiles closed while exposing
-- just what the feature needs:
--
--   touch_last_seen()       — stamp the caller's own last_seen_at = now()
--   get_last_seen(user_ids) — last_seen_at for people the caller works with
--                             (same organization, or a project they can open)

create or replace function public.touch_last_seen()
returns void
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  update public.user_profiles
     set last_seen_at = now()
   where id = auth.uid();
$$;

revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

create or replace function public.get_last_seen(p_user_ids uuid[])
returns table (user_id uuid, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with me as (
    select auth.uid() as uid
  ),
  my_orgs as (
    select o.owner_id, o.members
      from public.organizations o, me
     where me.uid is not null
       and (
         o.owner_id = me.uid
         or exists (
           select 1
             from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
            where coalesce(m->>'userId', m->>'user_id', '') = me.uid::text
         )
       )
  ),
  -- Projects the caller can open that include any of the requested people
  -- (covers guests from another organization sharing a project).
  visible_projects as (
    select p.owner_id, p.members
      from public.projects p
     where (
             p.owner_id = any(p_user_ids)
             or exists (
               select 1
                 from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) m
                where coalesce(m->>'userId', m->>'user_id', '') = any(p_user_ids::text[])
             )
           )
       and public.can_access_project(p.project_id)
  ),
  people as (
    select owner_id::text as uid from my_orgs
    union
    select coalesce(m->>'userId', m->>'user_id')
      from my_orgs o, jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
    union
    select owner_id::text from visible_projects
    union
    select coalesce(m->>'userId', m->>'user_id')
      from visible_projects v, jsonb_array_elements(coalesce(v.members, '[]'::jsonb)) m
  )
  select up.id, up.last_seen_at
    from public.user_profiles up, me
   where up.id = any(p_user_ids[1:500])
     and (up.id = me.uid or up.id::text in (select uid from people where uid is not null));
$$;

revoke all on function public.get_last_seen(uuid[]) from public, anon;
grant execute on function public.get_last_seen(uuid[]) to authenticated;
