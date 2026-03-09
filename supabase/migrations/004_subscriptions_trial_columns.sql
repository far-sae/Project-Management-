-- Ensure 28-day trial columns exist so new users get a trial and auto-downgrade to Starter after 28 days.
alter table if exists public.subscriptions
  add column if not exists trial_starts_at timestamptz,
  add column if not exists trial_ends_at timestamptz;

comment on column public.subscriptions.trial_starts_at is 'When the 28-day trial started';
comment on column public.subscriptions.trial_ends_at is 'When the trial ends; after this, user is auto-moved to Starter if not subscribed';
