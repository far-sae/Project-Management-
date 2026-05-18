-- 084_telegram_unlink_policy.sql
-- Allow users to delete their own telegram integration row from the client.
-- The integrations table otherwise has no end-user write policies because
-- OAuth providers (google/gmail/slack) hold encrypted tokens that must be
-- revoked through an edge function. Telegram has no provider-side token,
-- so a direct DELETE is the simplest path for the Settings "Unlink" button.

drop policy if exists "users delete own telegram integration" on public.integrations;
create policy "users delete own telegram integration"
  on public.integrations for delete
  using (provider = 'telegram' and auth.uid() = user_id);
