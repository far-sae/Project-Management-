-- 160_claim_respects_pinned_mailbox.sql
--
-- Phase 3, part three: claim_email_batch() learns two things about a sequence
-- step -- the mailbox it has to go through, and the enrollment it belongs to.
--
-- 158 adds email_messages.pinned_account_id and says at length why the pin
-- belongs on the message and not on the campaign. This file is the other half
-- of it: one condition, in the one function that decides which rows a mailbox
-- may take.
--
-- The function is otherwise copied VERBATIM from 156. Every comment in it was
-- written in response to a specific bug -- the ambiguous OUT parameter, the
-- stuck-row sweep's three cases, the suppression belt-and-braces -- and is
-- carried across unchanged. The only difference is the condition marked
-- "...and the same rule one grain finer".
--
-- Nothing in this file is applied by the app. The user runs migrations by hand.

-- The return type changes, so the old signature has to go first: CREATE OR
-- REPLACE cannot alter a function's OUT columns, and a database that ran 156
-- would otherwise keep the seven-column version. Dropped by exact signature,
-- and re-created immediately below, so there is never a window where the
-- worker's only claim is missing.
drop function if exists public.claim_email_batch(uuid, integer);

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
       and (c.account_id = p_account or c.account_id is null)
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

revoke execute on function public.claim_email_batch(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_batch(uuid, integer) to service_role;

notify pgrst, 'reload schema';
