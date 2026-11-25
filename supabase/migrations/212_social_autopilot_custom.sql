-- Social media autopilot: the owner's own wishes for the posts.
--
-- Until now the owner could tell the autopilot what the business is, how
-- often to post and what it may spend. This adds one place for everything
-- else the owner may want to decide: what the posts are for, what to post
-- about and what to leave out, what people should do after a post, a link,
-- how long the captions are, how many emoji, tags for every post, how the
-- pictures and videos should look, how pictures and videos are shared out,
-- how often the latest trends are looked up, and the owner's own rules.
--
--   social_autopilot.custom   all of these in one JSON value. Empty ({}):
--                             the autopilot chooses, as it did before.
--
-- One JSON value on purpose: a new option later needs no new SQL.
--
-- Who can read and change it: the same people as the rest of the row. The
-- table's own rules (207_social_autopilot.sql) already cover every column:
-- the people of the workspace read, the owner and admins change.
--
-- Safe to run more than once. It changes nothing when the autopilot's table
-- (207_social_autopilot.sql) has not been made yet.

set search_path = public;

do $do$
begin
  if to_regclass('public.social_autopilot') is null then
    raise notice 'social_autopilot is not there yet: run 207_social_autopilot.sql first, then this file again.';
    return;
  end if;
  execute $q$alter table public.social_autopilot add column if not exists custom jsonb not null default '{}'::jsonb$q$;
  if not exists (select 1 from pg_constraint where conname = 'social_autopilot_custom_is_object') then
    execute $q$alter table public.social_autopilot add constraint social_autopilot_custom_is_object check (jsonb_typeof(custom) = 'object')$q$;
  end if;
end
$do$;

-- The API keeps a list of every table's columns. Tell it to read the list again, so the new column can be saved at once.
notify pgrst, 'reload schema';
