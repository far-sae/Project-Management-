-- 161_email_open_tracking.sql
--
-- Phase 4: open tracking.
--
-- A 1x1 image with a unique URL. A mail client renders the message, fetches
-- the image, and this records it. What that number MEANS is the whole
-- difficulty, and the schema is shaped around it rather than around the
-- mechanism:
--
--   * Apple Mail Privacy Protection pre-fetches every image in every message,
--     read or not, and has been on by default since 2021 on roughly half the
--     consumer market. Those fetches are Apple's proxy, not a person.
--   * Gmail proxies and caches images, so a second open from the same person
--     often never arrives at all.
--   * Many clients block images, so a careful read records nothing.
--   * Security scanners fetch every URL in a message within seconds of
--     delivery.
--
-- So an open is a floor with a large false positive rate on top. The columns
-- below let the screen show the honest version: how many messages were opened,
-- how many of those look automatic, and how many times in total. A product
-- that shows "68% open rate" in large type beside "12 replies" is teaching its
-- user something false.
--
-- Nothing in this file is applied by the app. The user runs migrations by hand.

-- ── a. the switch, off ──────────────────────────────────────────────
--
-- Default FALSE, and that is a decision rather than caution. Recording when
-- somebody's customer opened an email is surveillance, however ordinary it has
-- become; some of this product's users need consent for it and some simply
-- would not want it. Nothing is tracked until an organization turns this on,
-- and nothing anywhere infers an open from anything else.
alter table public.email_settings
  add column if not exists track_opens boolean not null default false;

-- ── b. what a message knows about being opened ──────────────────────
--
-- The first open, which never moves: the same transition guard replied_at uses
-- (157d), so "opened after N hours" does not slide later every time the
-- message is re-rendered in somebody's client.
alter table public.email_messages
  add column if not exists opened_at timestamptz;

-- The most recent one, which does move.
alter table public.email_messages
  add column if not exists last_opened_at timestamptz;

-- Every fetch, including the ones that are the same person's client rendering
-- the message again. Shown beside the message count, never instead of it.
alter table public.email_messages
  add column if not exists open_count integer not null default 0;

-- True when the FIRST open looked automatic -- a known proxy's user agent, or
-- a fetch within ten seconds of the send. It is a heuristic and the screen
-- says so; what it is for is stopping Apple's proxy from making every campaign
-- look like a triumph.
--
-- Set from the first open only, so a person who opens a message an hour after
-- Apple pre-fetched it does not retroactively relabel it. That direction is
-- deliberate: it undercounts real opens rather than overcounting them, and an
-- honest floor is worth more here than a flattering estimate.
--
-- The user agent itself is NOT stored. It is read to make this decision and
-- discarded -- along with the IP address, which is never read at all. This
-- phase records that a message was opened and when; it does not build a
-- profile of the person who opened it.
alter table public.email_messages
  add column if not exists open_was_prefetch boolean not null default false;

-- ── c. what a campaign knows ────────────────────────────────────────
--
-- A count of MESSAGES opened, not of fetches: incremented only on the
-- null-to-set transition below, exactly as replied_count and bounced_count are
-- (157d). A campaign whose one recipient opened it fifty times reads 1.
alter table public.email_campaigns
  add column if not exists opened_count integer not null default 0;

-- The campaigns screen orders and filters by this; the sequences screen reads
-- it per step through the step's hidden campaign.
create index if not exists email_messages_opened
  on public.email_messages (campaign_id)
  where opened_at is not null;

-- ── d. record_email_open() ──────────────────────────────────────────
--
-- Called by the Vercel route behind the pixel, which has already verified the
-- URL's HMAC. It is service_role only, like every other write in this feature.
--
-- It returns void and swallows nothing: the route ignores the outcome either
-- way, because the one thing it must always do is return the image. A pixel
-- that 404s or hangs shows a broken-image icon in the customer's own mail,
-- which is a visible defect in their message caused by our bookkeeping.
create or replace function public.record_email_open(
  p_message uuid,
  p_prefetch boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_first boolean;
begin
  -- The organization's switch is checked HERE, not only where the pixel is
  -- inserted. A message sent while tracking was on sits in somebody's mailbox
  -- for ever, and its pixel is fetched every time that message is re-rendered
  -- -- so an organization that switches tracking OFF would otherwise go on
  -- recording opens indefinitely from mail it had already sent. Off has to
  -- mean off.
  --
  -- A missing settings row reads as off: the column defaults to false, and a
  -- row that does not exist cannot have been switched on.
  if not exists (
    select 1
      from public.email_messages m
      join public.email_settings s on s.organization_id = m.organization_id
     where m.id = p_message
       and s.track_opens
  ) then
    return;
  end if;

  -- The first-open transition, in its own gated statement.
  --
  -- `opened_at is null` in the WHERE clause is what makes FOUND below tell the
  -- truth: it is true only when THIS call made the null-to-set transition,
  -- never on a repeat, and never for a message that does not qualify. That is
  -- the same shape record_inbox_result() uses for replied_at (157d) and it is
  -- also what makes this safe under concurrency -- two proxies fetching the
  -- pixel at once both try this update, one wins the row lock, and the other
  -- then sees a non-null opened_at and matches nothing.
  --
  -- status = 'sent' because a message that never left cannot have been opened,
  -- and a URL replayed against a cancelled or failed row is somebody testing
  -- rather than somebody reading.
  update public.email_messages m
     set opened_at = now(),
         -- Decided by the first open and never revisited, so a person who
         -- opens a message an hour after Apple pre-fetched it does not
         -- retroactively relabel it. That direction undercounts real opens
         -- rather than overcounting them, which is the right way round: an
         -- honest floor is worth more here than a flattering estimate.
         open_was_prefetch = coalesce(p_prefetch, false)
   where m.id = p_message
     and m.status = 'sent'
     and m.opened_at is null;

  v_first := found;

  -- Every fetch, first or not: the count and the most recent time. Separate
  -- from the statement above precisely because this one is NOT gated -- a
  -- message opened fifty times is one open and fifty fetches, and the screen
  -- shows both.
  update public.email_messages m
     set last_opened_at = now(),
         open_count = m.open_count + 1
   where m.id = p_message
     and m.status = 'sent';

  -- The campaign counts MESSAGES, not fetches, so it moves only on the
  -- transition FOUND just confirmed. campaign_id is NOT NULL on email_messages
  -- (152), so a message always has exactly one campaign to credit -- including
  -- a sequence step, whose hidden campaign is how the Sequences screen reads
  -- opens per step.
  if v_first then
    update public.email_campaigns c
       set opened_count = c.opened_count + 1
      from public.email_messages m
     where m.id = p_message
       and c.id = m.campaign_id;
  end if;
end;
$$;

revoke all on function public.record_email_open(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_email_open(uuid, boolean) to service_role;

notify pgrst, 'reload schema';
