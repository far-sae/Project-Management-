-- Email: one campaign goes out through every mailbox of its workspace, in turn.
--
-- A campaign can name one mailbox, or none ("all mailboxes"). With none, the
-- sender was meant to share the campaign out over the mailboxes, each one
-- within its own emails a day. Since 168 that did not happen: to keep a
-- campaign inside its own workspace, the database gave it ONE mailbox the
-- moment it started, and the whole campaign went from that one. Five mailboxes
-- sent no more than one.
--
-- From now on:
--   * a campaign that names no mailbox keeps naming none. Every working
--     mailbox of the campaign's own workspace takes some of its emails, the
--     one that sent least recently first, each within its own daily limit.
--     A mailbox of another workspace never takes any (that is what 168 was
--     for, and it is now checked where the emails are handed out);
--   * starting a campaign still needs at least one working mailbox in its
--     workspace, and a campaign that names a mailbox is still sent by that
--     mailbox only;
--   * the steps of a sequence are no longer tied to one mailbox either. A
--     follow-up still leaves from the mailbox that sent the email before it
--     (the email itself remembers that). Until now a step could be tied to a
--     different mailbox than its follow-ups needed, and they waited for ever.
--
-- So that many mailboxes can still look like one sender, a campaign can carry
-- its own sender name and its own reply address:
--   email_campaigns.sender_name   the name shown as the sender, for every
--                                 mailbox that sends it. Empty: each mailbox's own.
--   email_campaigns.reply_to      where replies go, for every mailbox that
--                                 sends it. Empty: each mailbox's own.
-- The address an email comes from is always the sending mailbox's own: a mail
-- server does not send for an address that is not its mailbox.
--
-- Safe to run more than once. It changes nothing when the email tables have
-- not been made yet.

set search_path = public;

do $do$
begin
  if to_regclass('public.email_campaigns') is null or to_regclass('public.email_accounts') is null then
    raise notice 'The email tables are not there yet: run the email files (152 to 168) first, then this file again.';
    return;
  end if;

  execute 'alter table public.email_campaigns add column if not exists sender_name text';
  execute 'alter table public.email_campaigns add column if not exists reply_to text';
  if not exists (select 1 from pg_constraint where conname = 'email_campaigns_sender_name_check') then
    execute 'alter table public.email_campaigns add constraint email_campaigns_sender_name_check check (sender_name is null or char_length(sender_name) <= 120)';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'email_campaigns_reply_to_check') then
    execute 'alter table public.email_campaigns add constraint email_campaigns_reply_to_check check (reply_to is null or char_length(reply_to) <= 254)';
  end if;
end
$do$;

-- The check that runs when a campaign starts. Its name is from 168, when it
-- gave the campaign a mailbox; it no longer does. It still refuses a campaign
-- with no workspace, a named mailbox of another workspace, and a workspace
-- with no working mailbox at all.
create or replace function public.email_pin_workspace_mailbox()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status not in ('scheduled', 'sending') then return new; end if;
  if new.workspace_id is null then
    raise exception 'A workspace is required before sending a campaign' using errcode = '23514';
  end if;
  if new.account_id is not null and not exists (
    select 1 from public.email_accounts a where a.id = new.account_id
      and a.organization_id = new.organization_id and a.workspace_id = new.workspace_id
  ) then
    raise exception 'Sending mailbox must belong to the campaign workspace' using errcode = '23514';
  end if;
  if new.account_id is null and not exists (
    select 1 from public.email_accounts a
    where a.organization_id = new.organization_id and a.workspace_id = new.workspace_id
      and a.status = 'active' and coalesce(a.is_active, true)
  ) then
    raise exception 'No active sending mailbox is connected to this workspace' using errcode = '23514';
  end if;
  return new;
end $$;

-- Handing emails to a mailbox. The same function as in 160, with one rule
-- changed: the one marked 216.
do $do$
begin
  if to_regclass('public.email_messages') is null then
    return;
  end if;
  execute $fn$
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
  attempts integer,
  -- Carried out of the claim rather than read back per message. The send path
  -- needs them to thread a sequence follow-up onto the message before it, and
  -- the alternative -- one lookup per claimed row -- would charge every
  -- campaign message for a column only a sequence step uses. Null for a
  -- campaign message, which is most of them.
  enrollment_id uuid,
  step_index integer
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
       and (
         c.account_id = p_account
         -- 216: a campaign that names no mailbox is taken by the mailboxes of
         -- its own workspace, in turn, and by no other. (A campaign from before
         -- workspaces has none, and keeps the whole organisation's pool.)
         or (c.account_id is null and (c.workspace_id is null or a.workspace_id is not distinct from c.workspace_id))
       )
       -- ...and the same rule one grain finer, for a sequence step. A
       -- follow-up must leave from the mailbox that sent the message it is
       -- replying to, or the recipient sees a second stranger in what their
       -- client will not even thread as one conversation. The campaign cannot
       -- carry that: a step's hidden campaign is shared by every enrollment at
       -- that step, so pinning it would route all of them through one mailbox
       -- and undo the pool for sequences. Null means unpinned, which is every
       -- campaign message and every first step. See migration 158d.
       and (m.pinned_account_id is null or m.pinned_account_id = p_account)
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
            m.merge_data, m.attempts, m.enrollment_id, m.step_index;
end;
$$;
  $fn$;
  execute 'revoke execute on function public.claim_email_batch(uuid, integer) from public, anon, authenticated';
  execute 'grant execute on function public.claim_email_batch(uuid, integer) to service_role';
end
$do$;

-- The steps of a sequence: free of the mailbox 168 tied them to. Each email of
-- a sequence remembers its own mailbox, so nothing is sent from a wrong one.
do $do$
begin
  if to_regclass('public.email_campaigns') is null then
    return;
  end if;
  begin
    update public.email_campaigns set account_id = null where kind = 'sequence' and account_id is not null;
  exception when others then
    -- Freeing them is a repair, never the reason this file fails.
    null;
  end;
end
$do$;

-- Tell the API about the new columns straight away.
notify pgrst, 'reload schema';
