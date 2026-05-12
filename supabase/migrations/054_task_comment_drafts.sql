-- Task comment drafts
--
-- Per-user, per-task draft text for the comment box. Saved automatically as
-- the user types so closing the modal, refreshing, or switching devices
-- doesn't lose unsent comments. PK is (task_id, user_id) — each user has at
-- most one draft per task. The draft is deleted on successful comment post.

create table if not exists public.task_comment_drafts (
  task_id    uuid        not null references public.tasks(task_id) on delete cascade,
  user_id    uuid        not null references auth.users(id)         on delete cascade,
  content    text        not null default '',
  updated_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

comment on table public.task_comment_drafts is
  'Per-user draft text for the task comment composer. One row per (task, user). Deleted when comment is posted.';

create index if not exists idx_task_comment_drafts_user
  on public.task_comment_drafts (user_id, updated_at desc);

alter table public.task_comment_drafts enable row level security;

-- Each user can only see, write, and delete their OWN drafts.
drop policy if exists "task_comment_drafts_owner_select" on public.task_comment_drafts;
create policy "task_comment_drafts_owner_select" on public.task_comment_drafts
  for select using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "task_comment_drafts_owner_insert" on public.task_comment_drafts;
create policy "task_comment_drafts_owner_insert" on public.task_comment_drafts
  for insert with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "task_comment_drafts_owner_update" on public.task_comment_drafts;
create policy "task_comment_drafts_owner_update" on public.task_comment_drafts
  for update using (auth.uid() is not null and user_id = auth.uid())
  with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "task_comment_drafts_owner_delete" on public.task_comment_drafts;
create policy "task_comment_drafts_owner_delete" on public.task_comment_drafts
  for delete using (auth.uid() is not null and user_id = auth.uid());
