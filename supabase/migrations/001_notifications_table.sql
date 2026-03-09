-- Notifications table for the header bell (task assigned, completed, comments, reminders).
-- Run this in Supabase SQL Editor if the bell shows "No notifications yet" and you want notifications to work.

create table if not exists public.notifications (
  notification_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  title text not null,
  message text not null,
  task_id uuid,
  project_id uuid,
  actor_user_id uuid,
  actor_display_name text,
  read boolean not null default false,
  link text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_id on public.notifications (user_id);
create index if not exists idx_notifications_created_at on public.notifications (created_at desc);

alter table public.notifications enable row level security;

-- Drop policies if they exist so this migration can be re-run safely
drop policy if exists "Users can read own notifications" on public.notifications;
drop policy if exists "Users can update own notifications (mark read)" on public.notifications;
drop policy if exists "Authenticated users can insert notifications" on public.notifications;

-- Users can only see and update their own notifications
create policy "Users can read own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users can update own notifications (mark read)"
  on public.notifications for update
  using (auth.uid() = user_id);

-- Allow insert from service role and from authenticated users (for createNotification)
create policy "Authenticated users can insert notifications"
  on public.notifications for insert
  with check (true);

-- Enable realtime so the header bell updates when new notifications are created.
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when others then null; -- e.g. already in publication (42710), ignore
end $$;
