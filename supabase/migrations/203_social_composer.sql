-- Post to every platform from one place.
--
-- One press in the composer makes one row in social_content for each account
-- the post goes to. This file adds what those rows need:
--   post_group_id  the rows of one press belong together
--   options        what that platform needs (a YouTube title, who can see a TikTok, ...)
--   media          the picture or video of the post, uploaded once
-- and a public place to keep the uploaded file, because Instagram, Facebook
-- and the other platforms fetch it by its address.
--
-- Safe to run more than once. It changes nothing when the social tables
-- (167_workspace_social_marketing.sql) have not been made yet.

set search_path = public;

do $$
begin
  if to_regclass('public.social_content') is null then
    raise notice 'social_content is not there yet: run 167_workspace_social_marketing.sql first, then this file again.';
    return;
  end if;

  execute 'alter table public.social_content add column if not exists post_group_id uuid';
  execute $col$alter table public.social_content add column if not exists options jsonb not null default '{}'::jsonb$col$;
  execute $col$alter table public.social_content add column if not exists media jsonb not null default '[]'::jsonb$col$;

  execute 'create index if not exists social_content_group_idx on public.social_content(post_group_id) where post_group_id is not null';

  -- Claim the posts that are due. A post that has said "publishing" for twenty
  -- minutes was cut off half-way (the server stopped): it is marked as failed
  -- with a sentence the person can act on, instead of staying stuck for ever.
  execute $fn$
    create or replace function public.claim_social_posts(p_limit int default 25)
    returns setof public.social_content
    language plpgsql security definer set search_path = public as $body$
    begin
      update public.social_content
         set status = 'failed', last_error = 'Posting took too long and was stopped. Try again.'
       where status = 'publishing' and updated_at < now() - interval '20 minutes';

      return query
      with due as (
        select id from public.social_content
        where status = 'scheduled' and scheduled_at <= now()
        order by scheduled_at for update skip locked limit greatest(1, least(p_limit, 100))
      ), claimed as (
        update public.social_content c set status = 'publishing', updated_at = now()
        from due where c.id = due.id returning c.*
      ) select * from claimed;
    end $body$
  $fn$;
  execute 'revoke execute on function public.claim_social_posts(int) from public, anon, authenticated';
  execute 'grant execute on function public.claim_social_posts(int) to service_role';
end $$;

-- ---------------------------------------------------------------------------
-- social-media Storage bucket. Public on purpose: a platform fetches the file
-- by its address when the post is made, and what is in here is meant to be
-- published. A file's address holds a random part, so it cannot be guessed.
-- Path: <workspace_id>/<random>-<file name>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
  values ('social-media', 'social-media', true, 1073741824)   -- 1 GB per file
  on conflict (id) do update set public = true;

drop policy if exists "social_media_read"   on storage.objects;
drop policy if exists "social_media_write"  on storage.objects;
drop policy if exists "social_media_delete" on storage.objects;

-- The first part of the path is the workspace. A path that does not start with
-- a workspace id simply matches nobody.
create policy "social_media_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'social-media'
    and (string_to_array(name, '/'))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.can_access_workspace(((string_to_array(name, '/'))[1])::uuid)
  );

create policy "social_media_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'social-media'
    and (string_to_array(name, '/'))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.can_access_workspace(((string_to_array(name, '/'))[1])::uuid)
  );

create policy "social_media_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'social-media'
    and (string_to_array(name, '/'))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.can_access_workspace(((string_to_array(name, '/'))[1])::uuid)
  );

notify pgrst, 'reload schema';
