-- Social media autopilot.
--
-- A workspace can let the autopilot run its social media. It works in a loop:
--   1. it reads the workspace's own pages (every post, also the ones not made
--      here) with their numbers, and keeps a record of them day by day;
--   2. it studies those records: what works, what does not, and why;
--   3. it looks up what is going well on the platforms right now;
--   4. it plans the next week: a campaign and its posts, each with a text,
--      tags, a picture or a video (with or without a voice) and a time;
--   5. it makes the pictures and videos, and posts (or asks first);
--   6. it watches how each post does, and the next study learns from it.
--
-- What this file adds:
--   social_autopilot         one row for each workspace: the switch and the brief
--   social_feed_posts        every post on the workspace's pages, with its latest numbers
--   social_feed_snapshots    the numbers of a post, one row for each day (the record)
--   social_autopilot_notes   what the autopilot found and did: studies, trends, plans, problems
--   social_media_jobs        a picture or video being made
--   social_content.origin    who made a post: a person or the autopilot
--   social_content.idea      why the autopilot made it, and what it tries out
--   social_campaigns.origin  who made a campaign
--
-- People of the workspace can read all of it. Only the owner and admins can
-- change the switch and the brief. Everything else is written by the server.
--
-- Safe to run more than once. It changes nothing when the social tables
-- (167_workspace_social_marketing.sql) have not been made yet.

set search_path = public;

do $do$
declare
  t text;
begin
  if to_regclass('public.social_content') is null then
    raise notice 'social_content is not there yet: run 167_workspace_social_marketing.sql first, then this file again.';
    return;
  end if;

  execute $q$
    create table if not exists public.social_autopilot (
      workspace_id uuid primary key references public.workspaces(workspace_id) on delete cascade,
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      -- off: does nothing.  ask: makes posts and waits for a yes.  auto: makes posts and sends them.
      mode text not null default 'off' check (mode in ('off', 'ask', 'auto')),
      brief text not null default '',
      audience text not null default '',
      tone text not null default '',
      language text not null default 'English',
      posts_per_week integer not null default 4 check (posts_per_week between 1 and 14),
      formats jsonb not null default '["image","video"]'::jsonb,
      voice text not null default 'mixed' check (voice in ('with', 'without', 'mixed')),
      -- The accounts it posts to. Empty: every connected account of the workspace.
      account_ids jsonb not null default '[]'::jsonb,
      -- TikTok asks the poster who may see a video: the owner chooses it once, here.
      tiktok_privacy text not null default '',
      -- The most it may spend in a calendar month on writing, pictures and videos, in US cents.
      budget_cents integer not null default 3000 check (budget_cents between 0 and 100000),
      timezone text not null default 'Europe/London',
      -- What it has learned so far, in its own words. Every plan starts from it.
      playbook text not null default '',
      collected_at timestamptz,
      studied_at timestamptz,
      trends_at timestamptz,
      planned_at timestamptz,
      -- Set while a step runs, so two runs never work on one workspace at once.
      busy_since timestamptz,
      -- When a run last worked on this workspace: the one that waited longest goes first.
      worked_at timestamptz,
      updated_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $q$;

  execute $q$
    create table if not exists public.social_feed_posts (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
      account_id uuid not null references public.social_accounts(id) on delete cascade,
      platform text not null,
      platform_post_id text not null,
      url text not null default '',
      caption text not null default '',
      -- 'video', 'image' or '' when the platform does not say.
      kind text not null default '',
      posted_at timestamptz,
      -- Our own post, when this one was made here.
      content_id uuid references public.social_content(id) on delete set null,
      views bigint not null default 0,
      likes bigint not null default 0,
      comments bigint not null default 0,
      shares bigint not null default 0,
      saves bigint not null default 0,
      reach bigint not null default 0,
      measured_at timestamptz,
      first_seen_at timestamptz not null default now(),
      unique (account_id, platform_post_id)
    )
  $q$;
  execute 'create index if not exists social_feed_posts_ws_idx on public.social_feed_posts(workspace_id, posted_at desc)';

  execute $q$
    create table if not exists public.social_feed_snapshots (
      feed_post_id uuid not null references public.social_feed_posts(id) on delete cascade,
      taken_on date not null,
      workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
      views bigint not null default 0,
      likes bigint not null default 0,
      comments bigint not null default 0,
      shares bigint not null default 0,
      saves bigint not null default 0,
      reach bigint not null default 0,
      primary key (feed_post_id, taken_on)
    )
  $q$;
  execute 'create index if not exists social_feed_snapshots_ws_idx on public.social_feed_snapshots(workspace_id, taken_on)';

  execute $q$
    create table if not exists public.social_autopilot_notes (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
      kind text not null check (kind in ('study', 'trends', 'plan', 'problem')),
      title text not null default '',
      body text not null default '',
      data jsonb not null default '{}'::jsonb,
      -- What the writing cost, in millionths of a US dollar.
      cost_micro_usd bigint not null default 0,
      created_at timestamptz not null default now()
    )
  $q$;
  execute 'create index if not exists social_autopilot_notes_ws_idx on public.social_autopilot_notes(workspace_id, created_at desc)';

  execute $q$
    create table if not exists public.social_media_jobs (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
      -- The posts of one idea (one for each account) share this file.
      post_group_id uuid not null,
      kind text not null check (kind in ('image', 'video')),
      prompt text not null default '',
      with_voice boolean not null default false,
      status text not null default 'waiting' check (status in ('waiting', 'running', 'done', 'failed')),
      task_id text,
      -- What the maker charged: one credit is one US cent.
      credits integer not null default 0,
      url text,
      error text,
      attempts integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $q$;
  execute 'create index if not exists social_media_jobs_ws_idx on public.social_media_jobs(workspace_id, status)';
  execute 'create index if not exists social_media_jobs_group_idx on public.social_media_jobs(post_group_id)';

  execute $q$alter table public.social_content add column if not exists origin text not null default 'person'$q$;
  execute $q$alter table public.social_content add column if not exists idea jsonb not null default '{}'::jsonb$q$;
  execute $q$alter table public.social_campaigns add column if not exists origin text not null default 'person'$q$;

  -- Reading: the people of the workspace. Writing: the server, except the
  -- switch and the brief, which the owner and admins may change.
  foreach t in array array['social_autopilot', 'social_feed_posts', 'social_feed_snapshots', 'social_autopilot_notes', 'social_media_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_access_workspace(workspace_id))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;

  execute 'grant insert, update on public.social_autopilot to authenticated';
  execute 'drop policy if exists social_autopilot_insert on public.social_autopilot';
  execute $q$
    create policy social_autopilot_insert on public.social_autopilot for insert to authenticated
      with check (public.can_access_workspace(workspace_id) and public.is_org_admin_or_owner(organization_id)
        and exists (select 1 from public.workspaces w where w.workspace_id = social_autopilot.workspace_id and w.organization_id = social_autopilot.organization_id))
  $q$;
  execute 'drop policy if exists social_autopilot_update on public.social_autopilot';
  execute $q$
    create policy social_autopilot_update on public.social_autopilot for update to authenticated
      using (public.can_access_workspace(workspace_id) and public.is_org_admin_or_owner(organization_id))
      with check (public.can_access_workspace(workspace_id) and public.is_org_admin_or_owner(organization_id)
        and exists (select 1 from public.workspaces w where w.workspace_id = social_autopilot.workspace_id and w.organization_id = social_autopilot.organization_id))
  $q$;
end
$do$;
