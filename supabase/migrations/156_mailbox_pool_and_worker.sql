-- 156_mailbox_pool_and_worker.sql
--
-- Phase 1 of the deliverability work. See
-- docs/superpowers/specs/2026-09-18-email-deliverability-design.md
--
-- Four things change here, and they have to change together:
--
--   1. A sending account stops being a single mailbox with a flat limit and
--      becomes a member of a pool: it warms up from a small daily volume, it
--      can be paused (by hand or by three consecutive failures), and it
--      records when it last sent so the worker can rotate least-recently-used
--      first. mailbox_status exposes today's effective limit and today's
--      usage in one place, so the cap has exactly one definition -- measured
--      in the organization's own timezone, the same day the send window is
--      evaluated against.
--   2. email_campaigns.account_id becomes nullable. Null means "use the whole
--      pool", which is the new default.
--   3. claim_email_batch() takes the mailbox it is claiming for and a budget
--      the caller already computed from mailbox_status. It no longer does its
--      own hourly/daily arithmetic: two independent implementations of the
--      same cap would drift, and the worker's is the one that also honours
--      warmup and the send window.
--   4. Sending moves off the Vercel tick and onto a persistent worker, so the
--      per-minute cron that poked /api/email/tick is removed here. Running
--      both would double-send.
--
-- Ordering matters: the pool columns (a) and the organization's send timezone
-- (b) are both read by the view (c) -- which is why the settings table is
-- created before it, not after. The view's limit is what the worker passes as
-- p_limit to the claim (e), and the claim can only stop doing its own budget
-- arithmetic once the worker has a budget to pass. The cron goes last (g),
-- after everything that replaces it exists.

-- ── 0. Refuse to run on PostgreSQL 14 or older ──────────────────────
--
-- `alter view ... set (security_invoker = on)` is PostgreSQL 15 and later, and
-- `on delete set null (column_list)` below is too. On 14 the view would be
-- CREATED and the security_invoker statement would then error, aborting the
-- migration with a definer-rights view over every organization's mailboxes
-- left behind -- precisely the leak the option exists to prevent. Fail before
-- anything is created instead, where the only cost is a clear error message.
do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'This migration needs PostgreSQL 15 or later for security_invoker views (found %).',
      current_setting('server_version');
  end if;
end $$;

-- ── a. Pool columns on email_accounts ───────────────────────────────
--
-- All "add column if not exists", because this migration must be re-runnable
-- against a database where an earlier attempt got part way.

-- Warmup ramps a new mailbox up instead of letting it send its full allowance
-- on day one, which is the fastest way to get a cold domain filtered.
alter table public.email_accounts
  add column if not exists warmup_enabled boolean not null default true;
-- Null means the ramp has not been started yet; until an admin sets it, the
-- mailbox is held at warmup_start_volume rather than its daily_limit. That is
-- deliberate for existing rows: nobody's account suddenly starts sending
-- *more* than it did before because of this migration.
alter table public.email_accounts
  add column if not exists warmup_started_on date;
alter table public.email_accounts
  add column if not exists warmup_start_volume integer not null default 5;
alter table public.email_accounts
  add column if not exists warmup_increment integer not null default 3;

-- is_active is the pool's own on/off switch, separate from `status`
-- ('unverified'/'active'/'error'), which records whether the credentials
-- verified. A mailbox can be verified and still be out of rotation.
alter table public.email_accounts
  add column if not exists is_active boolean not null default true;
-- Set when a mailbox is paused, by hand or by record_send_result() below on
-- the third consecutive failure. It is the sentence the UI shows.
alter table public.email_accounts
  add column if not exists paused_reason text;
-- Reset to zero on every success; at three the mailbox is pulled out of
-- rotation rather than replaying the same SMTP failure at the provider.
alter table public.email_accounts
  add column if not exists consecutive_failures integer not null default 0;
-- Drives rotation order: the worker sends from the least recently used
-- mailbox first, so volume spreads across the pool.
alter table public.email_accounts
  add column if not exists last_sent_at timestamptz;

-- 40 a day per mailbox is a conservative cold-outreach figure. Provider
-- limits are usually far higher, but reputation is not, and this is the
-- ceiling warmup ramps *towards*, not a starting point. Only new rows get it:
-- existing accounts keep whatever daily_limit they already have, because
-- changing a default never rewrites stored values.
alter table public.email_accounts alter column daily_limit set default 40;

-- Sanity bounds on the ramp. A negative start volume or increment is not a
-- configuration anyone means, and it would make effective_limit nonsense.
-- Added through pg_constraint lookups because ALTER TABLE ADD CONSTRAINT has
-- no IF NOT EXISTS, and this migration must survive a re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'email_accounts_warmup_start_volume_check'
       and conrelid = 'public.email_accounts'::regclass
  ) then
    alter table public.email_accounts
      add constraint email_accounts_warmup_start_volume_check
      check (warmup_start_volume >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'email_accounts_warmup_increment_check'
       and conrelid = 'public.email_accounts'::regclass
  ) then
    alter table public.email_accounts
      add constraint email_accounts_warmup_increment_check
      check (warmup_increment >= 0);
  end if;
end $$;

-- Existing mailboxes must not silently drop to 5 sends a day. warmup_enabled
-- defaults true and warmup_started_on is null for every row that predates this
-- migration, which would pin effective_limit at warmup_start_volume and never
-- ramp, because nothing sets the start date on its own -- a mailbox on a
-- daily_limit of 500 would look like an outage. Warmup is for a new mailbox
-- proving itself, not for one that has been sending for months: these keep the
-- limit they were already configured with. New mailboxes get warmup on by
-- default, and an admin starts the ramp from the Accounts screen.
--
-- This is a one-time backfill, not an idempotent statement: re-running the
-- whole migration later would also switch off warmup for mailboxes added since.
update public.email_accounts
   set warmup_enabled = false
 where warmup_started_on is null;

-- Which mailbox actually delivered a message. A campaign may send from the
-- whole pool (see (d) below), so the campaign's account_id cannot say which
-- mailbox delivered any particular message -- for a pooled campaign it says
-- nothing at all. This records the mailbox that actually sent it, which is
-- what every per-mailbox cap is measured against: without it mailbox_status's
-- sent_today would read zero for every pool send, and neither the warmup ramp
-- nor the daily limit would bind.
alter table public.email_messages
  add column if not exists sent_account_id uuid;

-- The reference is composite, on (sent_account_id, organization_id), for the
-- same reason migration 155 made the campaign's account reference composite: a
-- single-column foreign key would make a cross-organization reference
-- representable again. Members hold INSERT on email_messages checked only by
-- is_org_member(organization_id), with no column restriction, and foreign key
-- validation bypasses row level security -- so with a single-column key a
-- member of org A could insert a row carrying org A's organization_id and org
-- B's mailbox in sent_account_id. Org B's UI would never show it, because
-- mailbox_status is security_invoker, but the worker reads that view as
-- service_role, which bypasses RLS, so the row would inflate org B's
-- sent_today and throttle their real sending while the two disagreed about
-- why. The composite key makes it unrepresentable. Its target is the
-- email_accounts_id_org_key unique constraint added by 155.
--
-- ON DELETE SET NULL names its column explicitly (PostgreSQL 15 and later,
-- which section 0 has already insisted on). Without the column list the
-- action nulls *every* referencing column, including organization_id, which
-- is NOT NULL -- so deleting a mailbox that had ever sent anything would fail
-- on a not-null violation instead of quietly forgetting which mailbox it was.
-- History has to outlive the account that made it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'email_messages_sent_account_org_fkey'
       and conrelid = 'public.email_messages'::regclass
  ) then
    alter table public.email_messages
      add constraint email_messages_sent_account_org_fkey
      foreign key (sent_account_id, organization_id)
      references public.email_accounts (id, organization_id)
      on delete set null (sent_account_id);
  end if;
end $$;

-- The view's sent_today subquery runs once per mailbox per worker cycle and
-- filters on exactly this pair. sent_account_id leading also serves the
-- referential check that runs when a mailbox is deleted, which is why there is
-- no second index for the foreign key.
create index if not exists idx_email_messages_sent_account
  on public.email_messages (sent_account_id, sent_at);

-- ── b. email_settings: the send window and pacing, per organization ─
--
-- One row per organization. Outside the window the worker sends nothing and
-- the queue simply waits; inside it, it sleeps a random interval between
-- messages, because perfectly regular timing is itself a spam signal.
create table if not exists public.email_settings (
  organization_id uuid primary key
    references public.organizations(organization_id) on delete cascade,
  send_window_enabled boolean not null default true,
  -- Inclusive start hour, exclusive end hour, read in send_timezone. 8 to 18
  -- is an ordinary working day; office hours read as human rather than robotic.
  send_window_start integer not null default 8
    check (send_window_start between 0 and 23),
  send_window_end integer not null default 18
    check (send_window_end between 1 and 24),
  -- ISO weekdays, 1 = Monday ... 7 = Sunday. Monday to Friday by default.
  send_days integer[] not null default '{1,2,3,4,5}',
  -- IANA zone name. The window is evaluated in this zone, never the server's.
  send_timezone text not null default 'UTC',
  jitter_min_ms integer not null default 8000,
  jitter_max_ms integer not null default 25000,
  updated_at timestamptz not null default now(),
  -- Bounds, so a saved-but-impossible setting cannot silently stop all
  -- sending: a window that ends before it starts is empty for every hour of
  -- the day, and a jitter range with min above max has no interval to pick
  -- from. Both are table-level checks because they span two columns.
  constraint email_settings_window_order_check
    check (send_window_start < send_window_end),
  constraint email_settings_jitter_order_check
    check (jitter_min_ms <= jitter_max_ms)
);

alter table public.email_settings enable row level security;
grant select, insert, update, delete on public.email_settings to authenticated;
grant all on public.email_settings to service_role;

-- Any member may read the window, because it is the explanation for why their
-- campaign is not sending right now...
drop policy if exists "email_settings_read" on public.email_settings;
create policy "email_settings_read" on public.email_settings
  for select to authenticated
  using (public.is_org_member(organization_id));

-- ...but changing when and how fast the organization sends is an admin
-- decision: it is a deliverability setting for the whole tenant, not a
-- personal preference.
drop policy if exists "email_settings_insert" on public.email_settings;
create policy "email_settings_insert" on public.email_settings
  for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "email_settings_update" on public.email_settings;
create policy "email_settings_update" on public.email_settings
  for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "email_settings_delete" on public.email_settings;
create policy "email_settings_delete" on public.email_settings
  for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- ── c. mailbox_status: one definition of today's allowance ──────────
--
-- The worker reads this to decide which mailboxes can send and how much each
-- may take, and the Accounts screen reads it to show mailbox health. Both see
-- the same numbers because there is only one expression.
--
-- "Today" is the ORGANISATION's day, not the server's. The send window in (b)
-- is evaluated in send_timezone, so a US organisation working 08:00-18:00
-- local crosses UTC midnight at 17:00 local. Counted in UTC, a mailbox that
-- had just spent its whole allowance would be handed a fresh one for the last
-- hour of the working day, and a warmup day-one mailbox would send ten rather
-- than five. The window and the cap have to measure the same day, or the daily
-- limit this feature exists to enforce simply does not hold.

-- send_timezone is plain text with no constraint behind it, and `at time zone`
-- raises on a name PostgreSQL does not know. Inside the view that error would
-- not be one organisation's problem: it would make the whole view fail, for
-- every tenant, including the worker's single read of it. This resolves a
-- usable name or falls back to UTC, and cannot raise -- `when others` is
-- deliberate, because the entire point is that no stored value may take the
-- view down. Asking the server whether it can use the name is cheaper than
-- scanning pg_timezone_names' ~1200 rows once per mailbox.
create or replace function public.email_safe_timezone(p_name text)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
begin
  if p_name is null or p_name = '' then
    return 'UTC';
  end if;
  perform now() at time zone p_name;
  return p_name;
exception when others then
  return 'UTC';
end;
$$;

grant execute on function public.email_safe_timezone(text) to authenticated;
grant execute on function public.email_safe_timezone(text) to service_role;

create or replace view public.mailbox_status as
select
  a.id,
  a.organization_id,
  a.label,
  a.from_email,
  -- 'unverified' / 'active' / 'error' from the credential check. Pool
  -- selection requires 'active', so a mailbox that never passed a test send
  -- cannot be used for a campaign.
  a.status,
  a.is_active,
  a.paused_reason,
  a.consecutive_failures,
  a.last_sent_at,
  a.daily_limit,
  a.warmup_enabled,
  a.warmup_started_on,
  a.warmup_start_volume,
  a.warmup_increment,
  -- Today's ceiling: the full daily limit when warmup is off; the start
  -- volume while the ramp has no start date; otherwise the start volume plus
  -- one increment per elapsed day, never above the daily limit.
  --
  -- The elapsed day count is measured against the organisation's own date
  -- (d.today), not current_date. Under current_date a mailbox whose admin
  -- started the ramp "today" in Los Angeles is already on day 1 from 17:00
  -- local, and sends the day-2 allowance on its first evening.
  --
  -- greatest(..., 0) because a warmup_started_on in the future makes
  -- (d.today - a.warmup_started_on) negative. A negative ceiling would read as
  -- "less than nothing left" everywhere downstream; zero is what a ramp that
  -- has not begun actually means.
  greatest(
    case
      when not a.warmup_enabled then a.daily_limit
      when a.warmup_started_on is null then a.warmup_start_volume
      else least(
        a.daily_limit,
        a.warmup_start_volume + a.warmup_increment * (d.today - a.warmup_started_on)
      )
    end,
    0
  ) as effective_limit,
  -- What this mailbox has already put out today, counted from the mailbox
  -- that actually delivered each message rather than from the campaign's
  -- account_id -- which is null for every pooled campaign and so would make
  -- this read zero exactly when the cap matters most.
  --
  -- 'sending' counts as well as 'sent', which is the rule migration 155's
  -- claim used: a row handed to SMTP has consumed the allowance whether or not
  -- its result has been written back yet. Without it a second worker, or the
  -- same worker restarted with a batch still in flight, reads the full
  -- allowance again and claims it -- and the claim's only other bound is
  -- p_limit, which the worker computes from this very view.
  --
  -- The two statuses are dated by different columns because an in-flight row
  -- has no sent_at yet: a 'sent' row is placed by sent_at, a 'sending' row by
  -- the claimed_at the claim stamped on it. Both are compared against
  -- d.day_start -- the instant local midnight happened in the organisation's
  -- zone -- rather than against a local date computed per row, so the
  -- comparison still uses idx_email_messages_sent_account.
  (
    select count(*)::integer
      from public.email_messages m
     where m.sent_account_id = a.id
       and (
         (m.status = 'sent'    and m.sent_at    >= d.day_start)
         or
         (m.status = 'sending' and m.claimed_at >= d.day_start)
       )
  ) as sent_today
from public.email_accounts a
-- LEFT, because an organisation that has never opened the settings screen has
-- no row here and takes the column defaults -- of which send_timezone is
-- 'UTC'. email_safe_timezone() turns the resulting null into exactly that, so
-- a missing row and a saved 'UTC' behave identically.
left join public.email_settings s
  on s.organization_id = a.organization_id
-- Resolved once per mailbox rather than once per comparison below.
cross join lateral (
  select public.email_safe_timezone(s.send_timezone) as name
) tz
cross join lateral (
  select (now() at time zone tz.name)::date as today,
         (date_trunc('day', now() at time zone tz.name) at time zone tz.name) as day_start
) d;

-- Without this the view would run as its owner and bypass row level security,
-- which would turn it into a way to read every organization's mailboxes. With
-- it, the caller's own policies on email_accounts, email_messages and
-- email_settings apply exactly as they do to a direct select.
alter view public.mailbox_status set (security_invoker = on);

grant select on public.mailbox_status to authenticated;
grant select on public.mailbox_status to service_role;

-- ── d. Campaigns may use the whole pool ─────────────────────────────
--
-- Null account_id now means "use the whole pool", which is the new default; a
-- specific account still pins the campaign to one mailbox, which is what a
-- single send from a named address needs.
--
-- The composite foreign key added in 155 stays valid: under MATCH SIMPLE a
-- foreign key with any null column is not checked at all, so a pooled
-- campaign skips the constraint while a pinned one is still forced to name an
-- account in its own organization.
alter table public.email_campaigns alter column account_id drop not null;

-- ── e. claim_email_batch(): one mailbox, one budget ─────────────────
--
-- Changing the argument list creates an overload rather than replacing the
-- function, and two candidate signatures would leave callers binding whichever
-- one resolution happened to pick. Drop the old one explicitly, first.
drop function if exists public.claim_email_batch(integer);

-- Everything migration 155 established is kept: the returns table column list,
-- security definer, the search_path, the stuck-row recovery (including the
-- attempts >= 3 retirement and settling a row that already carries a
-- provider_message_id as 'sent'), the suppression sweep, the NOT EXISTS
-- suppression guard inside the claim, the status and attempts recheck at the
-- locking level, and FOR UPDATE OF m SKIP LOCKED.
--
-- Two things change:
--   * the candidate set is now "mail this mailbox may send" rather than "mail
--     anyone may send" -- the campaign either names p_account, or names
--     nobody and p_account belongs to the same organization's pool;
--   * the per-account hourly/daily/rate budget arithmetic is gone. The worker
--     computes the budget from mailbox_status (the only place that knows
--     about warmup and today's usage) and passes it as p_limit. Two
--     implementations of the same cap would disagree the first time one of
--     them changed.
--
-- Every column reference in the body is table-qualified. Seven of this
-- function's OUT parameters (message_id, campaign_id, organization_id,
-- to_email, to_name, merge_data, attempts) share a name with a column of
-- public.email_messages, and an unqualified reference to one of those is an
-- execution-time "column reference is ambiguous" error that CREATE OR REPLACE
-- cannot catch, because it does not analyse the body at creation time.
create or replace function public.claim_email_batch(
  p_account uuid,
  p_limit integer default 25
)
returns table (
  message_id uuid,
  campaign_id uuid,
  organization_id uuid,
  to_email text,
  to_name text,
  merge_data jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Rows stuck in 'sending' for over 10 minutes belong to a worker that died
  -- mid-send. Settle them before claiming:
  --   * provider_message_id set means SMTP already accepted the message and
  --     only the status write-back failed (record_send_result() below stores
  --     the id for exactly this reason) -- so it is 'sent', never re-queued;
  --   * attempts >= 3 means the retry budget is spent, so it is 'failed'
  --     rather than a row that cycles through the queue forever;
  --   * anything else goes back to the queue for another try.
  --
  -- The target is aliased and every reference below it is qualified with that
  -- alias. `attempts` is one of this function's OUT parameters, so a bare
  -- `attempts` here is ambiguous and PL/pgSQL's default variable_conflict =
  -- error would raise on the first execution -- which CREATE OR REPLACE never
  -- catches, because it does not analyse the body.
  update public.email_messages m
     set status = case
                    when m.provider_message_id is not null then 'sent'
                    when m.attempts >= 3 then 'failed'
                    else 'queued'
                  end,
         claimed_at = null,
         sent_at = case
                     when m.provider_message_id is not null then coalesce(m.sent_at, now())
                     else m.sent_at
                   end,
         last_error = case
                        when m.provider_message_id is null and m.attempts >= 3
                          then coalesce(m.last_error, 'Abandoned after 3 delivery attempts')
                        else m.last_error
                      end
   where m.status = 'sending'
     and m.claimed_at < now() - interval '10 minutes';

  -- An unsubscribe mid-campaign must stop the mail that is already queued.
  update public.email_messages m
     set status = 'suppressed'
   where m.status = 'queued'
     and exists (
       select 1
         from public.email_suppressions s
        where s.organization_id = m.organization_id
          and lower(s.email) = lower(m.to_email)
     );

  return query
  with candidates as (
    select m.id,
           m.send_after
      from public.email_messages m
      join public.email_campaigns c
        on c.id = m.campaign_id and c.organization_id = m.organization_id
      -- The mailbox this call is claiming for, constrained to the message's
      -- own organization so a pooled campaign can never be sent from another
      -- tenant's mailbox. For a pinned campaign the composite foreign key
      -- from 155 already guarantees that; for a pooled one, where account_id
      -- is null and the foreign key is not checked at all, this join is the
      -- only thing that does.
      join public.email_accounts a
        on a.id = p_account
       and a.organization_id = m.organization_id
     where m.status = 'queued'
       and m.send_after <= now()
       -- Three tries is the budget; past that the row is the recovery
       -- sweep's problem, not something to claim again.
       and m.attempts < 3
       and c.status in ('sending','scheduled')
       -- The pool rule: the campaign either names this mailbox, or names no
       -- mailbox at all and takes whichever pool member is claiming.
       and (c.account_id = p_account or c.account_id is null)
       -- An account whose credentials failed is set to status = 'error' (by
       -- record_send_result() on the third consecutive permanent failure, or
       -- by api/email/verify.ts). Claiming its rows again just replays the
       -- same SMTP authentication failure, which is how a mailbox gets locked
       -- at Google and Microsoft 365. is_active is the same idea for a
       -- mailbox that was paused. The rows stay 'queued' and resume once the
       -- mailbox is re-verified or un-paused.
       and a.status <> 'error'
       and a.is_active
       -- Belt and braces: the sweep above already flipped these rows, but a
       -- suppression written between the two statements must not slip through.
       and not exists (
         select 1
           from public.email_suppressions s
          where s.organization_id = m.organization_id
            and lower(s.email) = lower(m.to_email)
       )
  ),
  -- p_limit is the budget the worker computed from mailbox_status for this
  -- mailbox: what is left of its effective limit today, sliced so that one
  -- mailbox cannot drain the whole pass. greatest(p_limit, 1) keeps a zero or
  -- negative argument from turning into an unbounded claim.
  claimed as (
    select m.id
      from public.email_messages m
      join candidates cd on cd.id = m.id
       -- These two also live in `candidates`, and they are repeated here on
       -- purpose. Under READ COMMITTED, when a concurrent claim commits
       -- between this statement's snapshot and its lock attempt, Postgres
       -- re-evaluates only the quals present at THIS level against the updated
       -- tuple. Without them the row is claimed a second time while already
       -- 'sending' or 'sent' and the recipient is mailed twice -- exactly what
       -- FOR UPDATE SKIP LOCKED is here to prevent.
     where m.status = 'queued'
       and m.attempts < 3
     order by cd.send_after
     limit greatest(p_limit, 1)
     for update of m skip locked
  )
  -- sent_account_id is stamped at claim time, not only on success, so that an
  -- in-flight row can be attributed to the mailbox holding it: that is what
  -- lets mailbox_status count 'sending' rows against today's allowance and so
  -- bound a second or restarted worker. A row that later fails keeps the value
  -- but is never counted, because sent_today requires the status to match too,
  -- and a re-claim overwrites it with whichever mailbox took it next.
  update public.email_messages m
     set status = 'sending', claimed_at = now(), attempts = m.attempts + 1,
         sent_account_id = p_account
    from claimed
   where m.id = claimed.id
  returning m.id, m.campaign_id, m.organization_id, m.to_email, m.to_name,
            m.merge_data, m.attempts;
end;
$$;

-- This function claims from every organization's outbox as the definer, so
-- its privileges are not left to chance.
revoke execute on function public.claim_email_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_email_batch(uuid, integer) to service_role;

-- ── f. record_send_result(): the other half of the claim ────────────
--
-- The worker settles each claimed row through here rather than writing the
-- message and the mailbox separately, so a message can never be marked sent
-- while the mailbox's health silently misses it, or the reverse. One call,
-- one transaction.
--
-- The four outcomes are exactly what classifySmtpError() in
-- src/lib/email/smtpErrors.ts returns, plus 'sent'.
--
-- p_restore_attempt gives back the attempt the claim stamped on a row, and
-- applies to the transient branch only. The worker passes it for rows it
-- claimed but never handed to SMTP: the remainder of a batch abandoned after a
-- permanent failure, a batch whose campaign bodies could not be read, and the
-- rows still unsent when the worker is told to shut down. Without it, a
-- mailbox with a rotated password answers 535 on the first row of three
-- consecutive cycles -- exactly how long it takes for the mailbox to leave
-- rotation -- while the other rows of each batch silently reach attempts = 3
-- and become unclaimable forever, for a failure that was never theirs.
--
-- Column references are table-qualified throughout, for the same reason they
-- are in the claim: the alias is what keeps `status`, `last_error`,
-- `attempts` and `consecutive_failures` unambiguous in a body that touches
-- three tables.
--
-- Adding an argument creates an OVERLOAD rather than replacing the function,
-- and two candidate signatures would leave PostgREST binding whichever one
-- resolution happened to pick -- one of which silently ignores the flag. Drop
-- the five-argument form explicitly, first. (It exists only where an earlier
-- revision of this same migration was already applied; `if exists` covers the
-- ordinary case where it never was.)
drop function if exists public.record_send_result(uuid, uuid, text, text, text);

-- One definition of "this mailbox failed again", callable without failing a
-- recipient for it.
--
-- A rejected login (535/EAUTH) and a connection that never came up are the
-- MAILBOX's problem: nothing was ever offered for the recipient in flight to
-- refuse. Settling that row 'permanent' -- which is what classifySmtpError()
-- returns for a 535 -- would fail the first recipient of every batch with
-- somebody else's credential error as their reason, three recipients per
-- mailbox over the three cycles it takes to pause it. The worker now settles
-- that row like the rest of the batch and calls this instead.
--
-- record_send_result()'s 'permanent' branch calls it too, so the three-strike
-- pause has exactly one implementation rather than one per caller.
create or replace function public.record_mailbox_failure(
  p_account uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- At the third consecutive failure the mailbox comes out of rotation
  -- carrying the reason, and status goes to 'error' so claim_email_batch()
  -- stops selecting it and the Accounts screen shows that it needs
  -- re-verifying. Three is MAX_CONSECUTIVE_FAILURES in
  -- src/lib/email/mailboxPool.ts; the two must stay in step, or the worker
  -- would keep offering a mailbox the database has already paused.
  --
  -- Table-qualified throughout, for the same reason the claim is: `status`,
  -- `last_error` and `consecutive_failures` are all column names this body
  -- reads and writes.
  update public.email_accounts a
     set consecutive_failures = a.consecutive_failures + 1,
         last_error = p_error,
         is_active = case
                       when a.consecutive_failures + 1 >= 3 then false
                       else a.is_active
                     end,
         paused_reason = case
                           when a.consecutive_failures + 1 >= 3 then p_error
                           else a.paused_reason
                         end,
         status = case
                    when a.consecutive_failures + 1 >= 3 then 'error'
                    else a.status
                  end
   where a.id = p_account;
end;
$$;

revoke execute on function public.record_mailbox_failure(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_mailbox_failure(uuid, text) to service_role;

create or replace function public.record_send_result(
  p_message uuid,
  p_account uuid,
  p_outcome text,
  p_error text default null,
  p_provider_message_id text default null,
  p_restore_attempt boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_outcome = 'sent' then
    -- provider_message_id is what lets the stuck-row recovery in
    -- claim_email_batch() tell "SMTP accepted it and the write-back failed"
    -- apart from "it never went out", so it is stored on the way through.
    -- sent_account_id is re-stated rather than assumed: the claim already
    -- stamped the mailbox that took the row, and this confirms the one that
    -- actually delivered it. It is set on this branch only. A failed or
    -- bounced message did not consume the mailbox's allowance for the day,
    -- and the stale value it carries is never counted, because sent_today
    -- matches on status as well.
    update public.email_messages m
       set status = 'sent',
           sent_at = now(),
           sent_account_id = p_account,
           provider_message_id = p_provider_message_id
     where m.id = p_message;

    -- A success clears the failure streak outright: three failures means
    -- three in a row, not three ever. last_sent_at is what rotation orders by.
    update public.email_accounts a
       set consecutive_failures = 0,
           last_sent_at = now(),
           last_error = null
     where a.id = p_account;

  elsif p_outcome = 'transient' then
    -- Greylisting, a rate limit, a dropped connection: the message goes back
    -- on the queue and the claim's attempts < 3 budget decides how many more
    -- times it is tried. Clearing claimed_at hands it back immediately rather
    -- than making it wait for the 10-minute stuck-row sweep. The mailbox is
    -- not at fault, so its health is untouched.
    --
    -- The attempt comes back only when the caller says this row was never
    -- actually tried; a row that really was handed to SMTP and refused must
    -- keep spending its budget, or it cycles through the queue forever.
    -- greatest(..., 0) because a row could in principle arrive here twice.
    --
    -- ...and once that budget IS spent the row has to be retired here, not
    -- left 'queued'. The claim only takes attempts < 3, the stuck-row sweep
    -- above only looks at 'sending', and finalize_email_campaigns counts
    -- 'queued' as still open: a row claimed at attempts = 2 that fails
    -- transiently would otherwise sit queued forever, never claimed again,
    -- never failed, holding its campaign in 'sending' permanently. Three
    -- tries and it retires, which is what the worker's comments have always
    -- claimed the database does.
    --
    -- Only when the attempt is NOT being restored. A restored row was never
    -- handed to SMTP -- it is the remainder of a batch this worker abandoned,
    -- or a batch given back at shutdown -- so it has spent nothing and must
    -- not be retired for someone else's failure.
    update public.email_messages m
       set status = case
                      when not p_restore_attempt and m.attempts >= 3 then 'failed'
                      else 'queued'
                    end,
           claimed_at = null,
           last_error = case
                          when not p_restore_attempt and m.attempts >= 3
                            then coalesce(p_error, 'Abandoned after 3 delivery attempts')
                          else p_error
                        end,
           attempts = case
                        when p_restore_attempt then greatest(m.attempts - 1, 0)
                        else m.attempts
                      end
     where m.id = p_message;

  elsif p_outcome = 'permanent' then
    -- Bad credentials or a rejected sender: retrying sends the identical
    -- request again, so the message is done.
    update public.email_messages m
       set status = 'failed',
           last_error = p_error
     where m.id = p_message;

    -- ...and it counts against the mailbox, through the single definition of a
    -- strike above: at the third consecutive failure the mailbox leaves
    -- rotation carrying the reason, and its status goes to 'error' so the
    -- claim stops selecting it.
    perform public.record_mailbox_failure(p_account, p_error);

  elsif p_outcome = 'hard_bounce' then
    update public.email_messages m
       set status = 'failed',
           last_error = p_error
     where m.id = p_message;

    -- A bad recipient is not the mailbox's fault, so mailbox health is left
    -- alone -- but mailing a dead address again is how a sender's reputation
    -- gets spent, so the address is suppressed for the whole organization.
    -- Stored lower-cased and trimmed, matching api/email/unsubscribe.ts and
    -- the suppression sweep's lower(s.email) comparison. on conflict do
    -- nothing because an address already suppressed for another reason keeps
    -- the reason it has.
    insert into public.email_suppressions (organization_id, email, reason, campaign_id)
    select m.organization_id,
           lower(trim(m.to_email)),
           'bounced',
           m.campaign_id
      from public.email_messages m
     where m.id = p_message
    on conflict do nothing;

  else
    -- Loud rather than silent: an outcome the caller made up would otherwise
    -- leave the row stuck in 'sending' until the recovery sweep found it, ten
    -- minutes later, with no record of why.
    raise exception 'record_send_result: unknown outcome %', p_outcome;
  end if;
end;
$$;

revoke execute on function public.record_send_result(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_send_result(uuid, uuid, text, text, text, boolean)
  to service_role;

-- ── g. Retire the Vercel tick ───────────────────────────────────────
--
-- Sending has moved to a persistent worker (worker/index.ts) that drains the
-- queue every few seconds. The per-minute cron that POSTed to /api/email/tick
-- is not a fallback: two senders claiming from the same outbox is how a
-- recipient gets the same message twice, and the tick knows nothing about
-- warmup, the send window or the pool. It goes now, in the same migration
-- that gives the worker what it needs, so there is never a window in which
-- both are live.
--
-- Wrapped because cron.unschedule() raises when the job is not there, which
-- is the ordinary case on a database that never ran migration 153's cron -- a
-- fresh local stack, for one -- and an unhandled raise would abort the whole
-- migration.
do $$
begin
  perform cron.unschedule('email_worker_minute');
exception when others then null;
end $$;

drop function if exists public.kick_email_worker();

notify pgrst, 'reload schema';
