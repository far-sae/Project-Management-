-- 123_user_profiles_timezone.sql
-- Per-user IANA timezone (e.g. 'Europe/London'). Null is treated as 'UTC' by
-- readers. Used by the Telegram/WhatsApp bot to parse relative dates
-- ("tomorrow 3pm") and to render dates back to the user in their local time.

alter table public.user_profiles
  add column if not exists timezone text;

comment on column public.user_profiles.timezone is
  'IANA timezone name (e.g. America/New_York). Null = UTC.';
