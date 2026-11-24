-- Social media autopilot: a second try for a post that did weakly.
--
-- A platform does not let a post be changed through the posting service once
-- it is out. So when one of the autopilot's posts does clearly worse than the
-- usual post of the same page, the autopilot makes a better version (another
-- opening, another picture or video) and posts that, once. The owner can
-- switch this off, and can also ask for a second try of any of its posts.
--
--   social_autopilot.retry_weak    the switch for this (on by default)
--   social_autopilot.reviewed_at   when it last looked for a weak post (once a day)
--
-- The same file adds two more things the owner can give the autopilot:
--
--   social_autopilot.website       the business's own website. The autopilot
--                                  reads it (once a month) to learn what the
--                                  business sells, so nobody has to type it.
--   social_autopilot.site_notes    what it learned there
--   social_autopilot.site_at       when it last read the website
--   social_autopilot.post_days     the weekdays it may post on (0 is Sunday).
--                                  Empty: any day.
--   social_autopilot.post_times    the times it may post at ("18:00").
--                                  Empty: it chooses from the numbers.
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
  execute 'alter table public.social_autopilot add column if not exists retry_weak boolean not null default true';
  execute 'alter table public.social_autopilot add column if not exists reviewed_at timestamptz';
  execute $q$alter table public.social_autopilot add column if not exists website text not null default ''$q$;
  execute $q$alter table public.social_autopilot add column if not exists site_notes text not null default ''$q$;
  execute 'alter table public.social_autopilot add column if not exists site_at timestamptz';
  execute $q$alter table public.social_autopilot add column if not exists post_days jsonb not null default '[]'::jsonb$q$;
  execute $q$alter table public.social_autopilot add column if not exists post_times jsonb not null default '[]'::jsonb$q$;
end
$do$;
