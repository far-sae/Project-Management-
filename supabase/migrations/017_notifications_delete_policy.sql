-- Allow users to remove their own notifications (Inbox delete) under RLS.
drop policy if exists "Users can delete own notifications" on public.notifications;
create policy "Users can delete own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);
