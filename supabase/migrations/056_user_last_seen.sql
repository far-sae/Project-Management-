-- "Last seen" presence for chat / team lists.
--
-- Tracks the last time each user was active in the app so DM and team
-- panels can show "Online" vs "Last seen 5 min ago" the same way WhatsApp
-- and Teams do. Live presence (Supabase realtime channel) tells us who is
-- *currently* online; this column fills in everyone else.
--
-- Heartbeat policy (client side): app pings `last_seen_at = now()` on
-- start, every 60s while the tab is visible, on focus/online events, and
-- once on `pagehide` via a keepalive request — so a clean tab close shows
-- "Last seen seconds ago" instead of an hours-old stamp.

alter table public.user_profiles
  add column if not exists last_seen_at timestamptz;

comment on column public.user_profiles.last_seen_at is
  'Last time this user was active in the app. Updated by the client heartbeat (~60s while visible) and on tab close. Used to render Online / Last seen X ago in chat panels.';

-- Sort/filter by recency when listing recent contacts in a workspace.
create index if not exists idx_user_profiles_last_seen
  on public.user_profiles (organization_id, last_seen_at desc);
