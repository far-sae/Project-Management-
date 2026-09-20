-- 164_mailbox_health_protection.sql
--
-- Stop a mailbox that is damaging itself, and record why.
--
-- What this feature calls "warmup" is a VOLUME RAMP: it raises a mailbox's
-- daily allowance from a small number towards its limit on a schedule. That is
-- worth having and it is not the same thing as warming up an inbox. A ramp
-- proves nothing about placement or reputation; it only decides how fast mail
-- leaves. The columns and the screens now say which of the two they mean.
--
-- The thing a ramp on its own cannot do is NOTICE. It will climb happily while
-- a mailbox bounces a third of what it sends, which is exactly the behaviour
-- that gets a domain blocked -- receiving systems treat a rising volume of
-- undeliverable mail as the signature of a list nobody cleaned. Migration 156
-- already pauses a mailbox after three consecutive SMTP failures; that catches
-- a broken credential and is blind to this, because every one of those sends
-- succeeded.
--
-- Nothing in this file is applied by the app. The user runs migrations by hand.

-- ── a. what a mailbox may tolerate ──────────────────────────────────
--
-- A percentage, per mailbox, because tolerance genuinely differs: a mailbox
-- writing to addresses somebody typed at a conference bounces more than one
-- writing to a list that opted in, and the same threshold for both is either
-- useless or punitive.
--
-- 5% is the default and it is deliberately not 2%. Two percent is the figure
-- providers throttle around, so a threshold set there fires on ordinary
-- variation and trains people to ignore it; five is comfortably bad -- a
-- mailbox bouncing one in twenty has a list problem, not a bad afternoon.
alter table public.email_accounts
  add column if not exists bounce_pause_percent integer not null default 5
    check (bounce_pause_percent between 1 and 100);

-- How many recent sends a mailbox needs before its bounce rate means
-- anything. Two bounces out of three sends is 67% and is not evidence of
-- anything at all.
alter table public.email_accounts
  add column if not exists bounce_pause_min_sends integer not null default 20
    check (bounce_pause_min_sends >= 1);

-- ── b. mailbox_bounce_rate: the measurement, alone ──────────────────
--
-- A view rather than a stored counter, and over a WINDOW rather than all time.
--
-- Stored counters drift: every path that marks a bounce would have to remember
-- to increment, and the one that forgets is silent. And a lifetime rate is
-- the wrong question -- a mailbox that bounced badly in March and has been
-- clean since should not still be paused in September, while a lifetime
-- average would hold it down for months.
--
-- Thirty days matches the recency gate record_inbox_result() already applies
-- to a bounce (migration 157d), so the two ends of this agree about which
-- bounces are current.
--
-- security_invoker so it cannot be used to read another organization's
-- mailboxes. Requires PostgreSQL 15, which migration 156 already enforces.
drop view if exists public.mailbox_bounce_rate;
create view public.mailbox_bounce_rate
with (security_invoker = on)
as
select
  a.id as account_id,
  a.organization_id,
  count(m.id) filter (
    where m.status = 'sent' and m.sent_at >= now() - interval '30 days'
  )::integer as sent_30d,
  count(m.id) filter (
    where m.bounced_at is not null and m.sent_at >= now() - interval '30 days'
  )::integer as bounced_30d,
  -- Null, not zero, when nothing has been sent. They are different facts and
  -- the screen has to be able to say "not measured yet" rather than "0%",
  -- which reads as proof of health that nobody has earned.
  case
    when count(m.id) filter (
      where m.status = 'sent' and m.sent_at >= now() - interval '30 days'
    ) = 0 then null
    else round(
      100.0 * count(m.id) filter (
        where m.bounced_at is not null and m.sent_at >= now() - interval '30 days'
      ) / count(m.id) filter (
        where m.status = 'sent' and m.sent_at >= now() - interval '30 days'
      ),
      1
    )
  end as bounce_percent
from public.email_accounts a
-- The mailbox that ACTUALLY sent it, not the campaign's nominal account: a
-- pooled campaign has no single sender, and sent_account_id is what
-- record_send_result() stamps with the one that delivered.
left join public.email_messages m on m.sent_account_id = a.id
group by a.id, a.organization_id;

grant select on public.mailbox_bounce_rate to authenticated;
grant select on public.mailbox_bounce_rate to service_role;

-- ── c. pause_mailboxes_over_bounce_rate() ───────────────────────────
--
-- The protection, run by the worker on its regular cycle.
--
-- It pauses SENDING, not merely the ramp. A mailbox past its threshold is
-- doing damage with every message, and slowing the rate at which it does
-- damage is not a remedy.
--
-- `is_active = false` with a reason is the same mechanism migration 156 uses
-- for three consecutive failures, so there is one way a mailbox leaves
-- rotation and one place the screens read to explain it. claim_email_batch()
-- already refuses an inactive mailbox, so nothing else has to change.
--
-- It never un-pauses. Coming back is a person's decision, because the fix is
-- to clean the list and nothing here can tell whether that has happened --
-- and a mailbox that resumed on its own the moment its rolling average dipped
-- would oscillate in and out of rotation while the underlying problem stayed.
create or replace function public.pause_mailboxes_over_bounce_rate()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_paused integer;
begin
  update public.email_accounts a
     set is_active = false,
         paused_reason =
           'Paused automatically: ' || r.bounce_percent || '% of the last ' ||
           r.sent_30d || ' messages bounced, over this mailbox''s ' ||
           a.bounce_pause_percent || '% limit. Clean the list, then resume it.'
    from public.mailbox_bounce_rate r
   where r.account_id = a.id
     and a.is_active
     -- Enough sends for the rate to mean anything.
     and r.sent_30d >= a.bounce_pause_min_sends
     and r.bounce_percent is not null
     and r.bounce_percent >= a.bounce_pause_percent;

  get diagnostics v_paused = row_count;
  return v_paused;
end;
$$;

revoke all on function public.pause_mailboxes_over_bounce_rate() from public, anon, authenticated;
grant execute on function public.pause_mailboxes_over_bounce_rate() to service_role;

notify pgrst, 'reload schema';
