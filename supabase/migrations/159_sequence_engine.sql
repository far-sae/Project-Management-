-- 159_sequence_engine.sql
--
-- Phase 3, part two: the engine that turns an enrollment into mail.
--
-- 158 created the tables. Nothing yet moves an enrollment forward, and nothing
-- stops one. This file is all of that, and it is deliberately small, because a
-- sequence step is an ORDINARY email_messages row: the mailbox pool, the daily
-- and hourly caps, the warmup ramp, the send window, the suppression list and
-- the retry budget all still belong to claim_email_batch() and are not
-- reimplemented here. What is here is only the cycle that sits above them:
--
--   a. stop_enrollments_for_address() -- stopping, organisation-wide by
--      address: what the RECIPIENT did. A reply, an unsubscribe, a bounce.
--   a2. stop_enrollment()             -- stopping, one enrollment wide: what
--      OUR end did. A send that failed is not a statement about them.
--   b. claim_sequence_enrollments()   -- due enrollments out, one step each,
--      advanced so the same one is never taken twice.
--   c. record_send_result()           -- re-declared: a 'sent' step schedules
--      the next one; a step that died ends its enrollment.
--   d. record_inbox_result()          -- re-declared: a reply or a bounce ends
--      the sequence, and 'auto_reply' becomes a kind that does neither.
--   e. finalize_email_campaigns()     -- re-declared: it must leave a step's
--      hidden campaign alone.
--   f. reconcile_stalled_enrollments() -- the net: no enrollment may be left
--      active with nothing that can ever move it again.
--   g. stop_enrollment_by_member()    -- the Stop button, so the screens stop
--      an enrollment the same way everything else does.
--   h. count_steps_waiting_on_paused_mailbox() -- what the Sequences banner
--      counts.
--
-- The shape of the one bug this file has to keep designing against: the claim
-- advances current_step and clears next_due_at in the same statement, and the
-- claim takes nothing with a null due date. So from that instant the ONLY
-- thing that can move an enrollment is its message reaching a terminal state.
-- Any path that ends a message without ending or rescheduling its enrollment
-- leaves a person stopped for ever while every screen reports them active.
-- (c) closes the paths it can see and (f) is the net under the ones it cannot.
--
-- (c), (d) and (e) are copied verbatim from the migrations that define them --
-- 156, 157 and 155 respectively -- with only the additions described above.
-- Every comment in those bodies was written in response to a specific bug and
-- is carried across unchanged.
--
-- Nothing in this file is applied by the app. The user runs migrations by hand.

-- ── a. stop_enrollments_for_address() ───────────────────────────────
--
-- One definition of what stopping means, called from four places: the inbox
-- scan (reply, bounce), the unsubscribe endpoint, and the send result
-- (permanent failure). Having four callers write this UPDATE themselves is how
-- the reasons drift apart and one of them forgets the idempotency guard.
--
-- Organization-wide by ADDRESS, not per enrollment: somebody enrolled in two
-- sequences who replies to one has answered a human, and a second machine
-- still talking to them is the same failure the reply was supposed to prevent.
--
-- `status = 'active'` in the WHERE clause is the idempotency guard and the
-- one-way guard at once. A stopped enrollment is never re-stopped, so
-- stop_reason and stopped_at record the FIRST thing that ended it -- which is
-- the one a support question is ever about -- and a later bounce for an
-- address that already replied does not rewrite the history.
--
-- Dropped before it is created, not merely replaced: CREATE OR REPLACE cannot
-- change a function's return type, so a database where an earlier revision of
-- this file installed a different shape under this name would fail on the
-- replace rather than pick the new definition up. This migration has to survive
-- a re-run against a database where an earlier attempt got part way.
drop function if exists public.stop_enrollments_for_address(uuid, text, text);

create or replace function public.stop_enrollments_for_address(
  p_org uuid,
  p_address text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_stopped integer;
begin
  -- Stopping the enrollment is only HALF of stopping the sequence, and the
  -- other half is the whole point of the feature.
  --
  -- A step that has already been materialized is an ordinary queued
  -- email_messages row, and claim_email_batch() knows nothing about
  -- enrollments. So a reply that stopped the enrollment and left that row
  -- alone would be delivered anyway, hours or days later -- and the window is
  -- hours or days, not seconds, because the send window and the warmup
  -- allowance are exactly what hold a sequence step in the queue:
  --
  --   step 2 falls due at 17:55 and is queued; the send window closes at
  --   18:00; the recipient replies at 19:30 and the enrollment stops; at 08:00
  --   the next morning the claim takes that row and sends the follow-up,
  --   threaded onto the conversation they already answered.
  --
  -- That is the single failure this phase exists to prevent, so the cancel
  -- lives HERE, in the one definition of what stopping means, rather than in
  -- each of the four callers.
  --
  -- 'failed', because the message will never be delivered and 'failed' is what
  -- that status means; the reason goes in last_error so a support question has
  -- an answer. The campaign counters are untouched, which is correct -- they
  -- are maintained by record_send_result(), and this message was never handed
  -- to SMTP at all.
  --
  -- Only rows that have not gone out ('queued'), and only rows belonging to
  -- the enrollments this call actually stopped. A 'sending' row is already
  -- with the mailbox and cancelling it here would leave the worker settling a
  -- row this statement had rewritten underneath it; a campaign message to the
  -- same person is not this function's business.
  with stopped as (
    update public.email_sequence_enrollments e
       set status = 'stopped',
           stop_reason = p_reason,
           stopped_at = now(),
           next_due_at = null
     where e.organization_id = p_org
       and lower(e.to_email) = lower(trim(p_address))
       and e.status = 'active'
    returning e.id
  ), cancelled as (
    update public.email_messages m
       set status = 'failed',
           last_error = 'Cancelled: the sequence stopped (' || p_reason || ') before this step was sent.'
      from stopped
     where m.enrollment_id = stopped.id
       and m.status = 'queued'
    returning m.id
  )
  select count(*) into v_stopped from stopped;

  return v_stopped;
end;
$$;

revoke all on function public.stop_enrollments_for_address(uuid, text, text) from public;
grant execute on function public.stop_enrollments_for_address(uuid, text, text) to service_role;

-- ── a2. stop_enrollment(): the same thing, one enrollment wide ──────
--
-- The sibling of the function above, and the two are separate because the
-- SCOPE of a stop is a decision, not an implementation detail.
--
-- Organisation-wide by address is right for something the RECIPIENT did: a
-- reply, an unsubscribe, an address that bounced. They have answered, or opted
-- out, or ceased to exist, and that is true of every sequence talking to them.
--
-- It is wrong for something OUR end did. A permanent SMTP failure is often the
-- mailbox's fault rather than the recipient's -- bad credentials, a sender the
-- provider rejected -- and phase 1 routes exactly those through 'permanent',
-- incrementing consecutive_failures and pausing the mailbox at three strikes.
-- Stopping every sequence at that address would then punish the recipient for
-- our own misconfiguration, permanently and one-way, while an enrollment
-- running through a different mailbox was delivering perfectly well. So a send
-- failure stops the enrollment that failed, and nothing else.
create or replace function public.stop_enrollment(
  p_enrollment uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_stopped integer;
begin
  -- `status = 'active'` is the idempotency guard and the one-way guard at
  -- once, exactly as in stop_enrollments_for_address(): the recorded reason
  -- stays the FIRST thing that ended this enrollment.
  -- The queued step is cancelled here too, for the reason spelled out on
  -- stop_enrollments_for_address(): stopping the enrollment alone leaves an
  -- already-materialized row that claim_email_batch() will still send, and it
  -- knows nothing about enrollments. This scope reaches here by a send that
  -- failed, so there is usually nothing queued -- but a mailbox paused at its
  -- third strike can have a later step already waiting behind the one that
  -- just died, and that one must not go out on its own.
  with stopped as (
    update public.email_sequence_enrollments e
       set status = 'stopped',
           stop_reason = p_reason,
           stopped_at = now(),
           next_due_at = null
     where e.id = p_enrollment
       and e.status = 'active'
    returning e.id
  ), cancelled as (
    update public.email_messages m
       set status = 'failed',
           last_error = 'Cancelled: the sequence stopped (' || p_reason || ') before this step was sent.'
      from stopped
     where m.enrollment_id = stopped.id
       and m.status = 'queued'
    returning m.id
  )
  select count(*) into v_stopped from stopped;

  return v_stopped;
end;
$$;

revoke all on function public.stop_enrollment(uuid, text) from public;
grant execute on function public.stop_enrollment(uuid, text) to service_role;

-- ── b. claim_sequence_enrollments() ─────────────────────────────────
--
-- The materializer's half of the cycle: take due enrollments, hand the worker
-- everything it needs to write an email_messages row, and advance the
-- enrollment so the same one is not taken twice.
--
-- FOR UPDATE SKIP LOCKED, as claim_email_batch() does, so two workers -- or
-- one worker overlapping itself after a slow cycle -- cannot take the same
-- enrollment. Without it the same person gets the same step twice.
--
-- What it does NOT do is send, or decide whether sending is allowed. Suppression,
-- the pool, the caps, the warmup and the send window are all applied later by
-- claim_email_batch() on the row this produces. The ONE gate here is the
-- suppression check, and it is here as well as there because materializing a
-- message that the send claim will refuse leaves a queued row that never sends
-- and never finalizes, and because an enrollment for a suppressed address
-- should END rather than accumulate dead rows.
--
-- Dropped first for the same reason the helper above is, and more sharply:
-- CREATE OR REPLACE cannot change the OUT parameter list of an existing
-- function at all, so a database that ran an earlier revision of this file
-- would fail on the replace instead of taking the new column list.
drop function if exists public.claim_sequence_enrollments(integer);

create or replace function public.claim_sequence_enrollments(p_limit integer default 50)
returns table (
  enrollment_id uuid,
  message_id uuid,
  step_index integer
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ids uuid[];
begin
  -- Every reference below is qualified. An unqualified `step_index` or
  -- `to_email` here resolves to this function's own OUT parameter, which
  -- installs cleanly and raises on the first call -- the exact failure this
  -- codebase has already shipped twice.
  select array_agg(d.id)
    into v_ids
    from (
      select e.id
        from public.email_sequence_enrollments e
        join public.email_sequences s on s.id = e.sequence_id
       where e.status = 'active'
         and e.next_due_at is not null
         and e.next_due_at <= now()
         and s.status = 'active'
       order by e.next_due_at
       limit greatest(p_limit, 0)
         for update of e skip locked
    ) d;

  if v_ids is null then
    return;
  end if;

  -- Suppressed addresses end their enrollment rather than queue a message the
  -- send claim would refuse. Done in its own statement, before the advance, so
  -- a suppressed enrollment is never advanced and never returned.
  update public.email_sequence_enrollments e
     set status = 'stopped',
         stop_reason = 'unsubscribed',
         stopped_at = now(),
         next_due_at = null
   where e.id = any(v_ids)
     and exists (
       select 1
         from public.email_suppressions sup
        where sup.organization_id = e.organization_id
          and lower(sup.email) = lower(e.to_email)
     );

  -- A pinned mailbox that has gone, or that has been taken out of rotation,
  -- stops the enrollment too. Switching sender mid-conversation would break
  -- the thread for the recipient and put a stranger's address on a reply they
  -- were expecting from someone else.
  update public.email_sequence_enrollments e
     set status = 'stopped',
         stop_reason = 'failed',
         stopped_at = now(),
         next_due_at = null
   where e.id = any(v_ids)
     and e.status = 'active'
     and (
       -- The mailbox is still there but is paused or in error.
       (
         e.account_id is not null
         and not exists (
           select 1
             from public.email_accounts a
            where a.id = e.account_id
              and a.is_active
              and a.status <> 'error'
         )
       )
       -- ...or it has been DELETED, which the check above cannot see.
       -- email_sequence_enrollments.account_id is ON DELETE SET NULL, so
       -- deleting the mailbox erases the very evidence that check reads, and a
       -- deleted pin becomes indistinguishable from "never pinned". The
       -- enrollment would then be materialized unpinned, sent from whichever
       -- pool member was free, and record_send_result() would re-pin it there
       -- -- so the recipient gets a correctly threaded reply from a different
       -- address, which is precisely what pinning exists to prevent.
       --
       -- pinned_at tells the two apart: it is set the first time a step is
       -- actually sent, in the same statement that sets account_id, and it
       -- references nothing, so no DELETE can null it. A null account_id
       -- beside a non-null pinned_at can only mean the mailbox has gone.
       --
       -- last_message_id would have looked like the natural column to read
       -- here and would have been wrong: it references email_messages ON
       -- DELETE SET NULL, and email_messages cascades from its campaign, so
       -- deleting a step's hidden campaign silently nulls it on every
       -- enrollment pointing at one. The gate would then read "never pinned"
       -- for an enrollment whose mailbox really had gone -- a false negative
       -- landing exactly on the case this arm exists for.
       or (e.account_id is null and e.pinned_at is not null)
     );

  -- A step that EXISTS but has no campaign is not sendable, and the enrollment
  -- must not be advanced past it.
  --
  -- The select below drops such a step on `st.campaign_id is not null`, and
  -- the completion sweep at the end does not catch it either -- the step row
  -- is right there, so the enrollment is not finished. It would be left
  -- active, one step further on, with next_due_at null: never claimed again,
  -- never completed, never sent to, and reporting nothing wrong. That is the
  -- same silent permanent stall that phase 2's scan cap turned out to be.
  --
  -- So these are removed from the claim set instead, with next_due_at left
  -- exactly where it is. The enrollment stays due, this function tries it
  -- again on the next cycle, and the moment the step is saved with its
  -- campaign -- which is what saving a step does -- it sends. A wait that
  -- fixes itself, rather than a stall that does not.
  select array_agg(t.id)
    into v_ids
    from unnest(v_ids) as t(id)
   where not exists (
     select 1
       from public.email_sequence_enrollments e
       join public.email_sequence_steps st
         on st.sequence_id = e.sequence_id
        -- current_step has NOT been advanced yet at this point, so this is the
        -- step about to be taken.
        and st.step_index = e.current_step
      where e.id = t.id
        and st.campaign_id is null
   );

  if v_ids is null then
    return;
  end if;

  -- What is left is sendable, and the claim WRITES THE MESSAGE ITSELF.
  --
  -- The advance and the insert are one statement in one transaction, and that
  -- is not a tidiness preference. The advance sets next_due_at to null, and
  -- this function takes nothing with a null due date, so from the instant it
  -- commits the only thing that can move that enrollment again is its message
  -- reaching a terminal state. If the insert were a second round trip -- the
  -- worker calling back with the rows it had been handed -- any failure in
  -- between would leave an enrollment advanced past a step that does not
  -- exist: never claimed again, never completed, never sent to, and shown on
  -- the enrollment screen as "Active, nothing scheduled", which is exactly
  -- what a healthy in-flight enrollment looks like.
  --
  -- That failure needed nothing exotic. One timed-out HTTP response on this
  -- very call, after PostgREST had already committed it, would have stranded
  -- every enrollment in the batch permanently, over one log line saying the
  -- claim failed.
  --
  -- So the worker no longer writes messages at all. It calls this and counts
  -- what comes back.
  return query
  with claimed as (
    update public.email_sequence_enrollments e
       set current_step = e.current_step + 1,
           -- Cleared, not computed. The NEXT step becomes due when THIS one is
           -- actually sent, which record_send_result() knows and this function
           -- cannot: the row it is about to create may sit in the queue for
           -- hours behind a send window.
           next_due_at = null
     where e.id = any(v_ids)
       and e.status = 'active'
    returning e.id, e.sequence_id, e.organization_id, e.contact_id,
              e.current_step - 1 as taking_step,
              e.account_id, e.to_email, e.to_name, e.merge_data
  ),
  -- No subject and no body: email_messages carries neither (migration 152).
  -- The step's own hidden campaign holds the wording, which is why a step with
  -- no campaign was removed from the set above rather than claimed.
  --
  -- Every column is aliased to a name no table here uses, so nothing in the
  -- insert below can resolve to the wrong relation or to an OUT parameter.
  ready as (
    select c.id as enrollment,
           c.organization_id as org,
           c.contact_id as contact,
           c.to_email as address,
           c.to_name as display_name,
           c.merge_data as merge,
           c.account_id as pin,
           st.campaign_id as campaign,
           st.step_index as idx
      from claimed c
      join public.email_sequence_steps st
        on st.sequence_id = c.sequence_id
       and st.step_index = c.taking_step
     where st.campaign_id is not null
  ),
  queued as (
    insert into public.email_messages (
      campaign_id, organization_id, contact_id, enrollment_id, step_index,
      to_email, to_name, merge_data, pinned_account_id, status, send_after
    )
    select r.campaign, r.org, r.contact, r.enrollment, r.idx,
           r.address, r.display_name, r.merge,
           -- The mailbox this step must go through, or null for "any pool
           -- member" on a first step. See migrations 158d and 160: the pin
           -- cannot live on the campaign, which every enrollment at this step
           -- shares.
           r.pin,
           'queued',
           now()
      from ready r
    returning public.email_messages.id,
              public.email_messages.enrollment_id,
              public.email_messages.step_index
  )
  select q.enrollment_id, q.id, q.step_index from queued q;

  -- An enrollment whose current_step has no step row has reached the end.
  -- Marked here rather than by the worker, because this function is the only
  -- thing that knows the step did not exist: the join above simply dropped it.
  update public.email_sequence_enrollments e
     set status = 'completed',
         next_due_at = null
   where e.id = any(v_ids)
     and e.status = 'active'
     and not exists (
       select 1
         from public.email_sequence_steps st
        where st.sequence_id = e.sequence_id
          and st.step_index = e.current_step - 1
     );
end;
$$;

revoke all on function public.claim_sequence_enrollments(integer) from public;
grant execute on function public.claim_sequence_enrollments(integer) to service_role;

-- ── c. record_send_result(): a sent step schedules the next one ─────
--
-- Re-declared whole, with the body copied verbatim from migration 156 section
-- (f). The signature is unchanged, so there is nothing to drop and no overload
-- to create: this is the same six-argument function, and everything 156
-- established -- the four outcomes, p_restore_attempt, the three-strike pause
-- through record_mailbox_failure(), the hard-bounce suppression, the loud
-- raise on an outcome nobody defined -- is exactly as it was.
--
-- What is added is phase 3's half of the cycle, and only that:
--   * on 'sent', the enrollment's next step becomes due, the mailbox is pinned,
--     and an enrollment with no further step is completed;
--   * on 'permanent' and on 'hard_bounce', the address's enrollments stop.
--
-- A campaign message is unaffected by every one of those statements: its
-- enrollment_id is null, so the joins below match nothing.
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
    --
    -- last_error is cleared too. A row that was greylisted, went back on the
    -- queue and then delivered would otherwise keep the failure text from the
    -- attempt before, and the campaign view reads that column straight out --
    -- so a delivered message would sit in the list explaining why it had not
    -- been sent.
    update public.email_messages m
       set status = 'sent',
           sent_at = now(),
           sent_account_id = p_account,
           provider_message_id = p_provider_message_id,
           last_error = null
     where m.id = p_message;

    -- A success clears the failure streak outright: three failures means
    -- three in a row, not three ever. last_sent_at is what rotation orders by.
    update public.email_accounts a
       set consecutive_failures = 0,
           last_sent_at = now(),
           last_error = null
     where a.id = p_account;

    -- ── phase 3: the next step becomes due ──────────────────────────
    --
    -- HERE and nowhere else, because this is the one place a message becomes
    -- 'sent'. The delay runs from the actual send, so a queue held overnight
    -- by the send window releases the follow-up a proper interval later rather
    -- than minutes after the first message finally went out.
    --
    -- The mailbox is pinned on the way through: the first step's sender is the
    -- sequence's sender, and every later step is queued for it.
    --
    -- The step is brought in as a second FROM entry with its join conditions in
    -- the WHERE clause, rather than as an explicit JOIN. UPDATE ... FROM cannot
    -- see its own target table from inside a join condition: `from
    -- public.email_messages m join public.email_sequence_steps st on
    -- st.sequence_id = e.sequence_id` raises "invalid reference to FROM-clause
    -- entry for table e" on the first call. Listing both tables and putting
    -- every condition in WHERE is the identical inner join, spelled the way
    -- UPDATE allows.
    --
    -- A campaign message has a null enrollment_id and a null step_index, so
    -- `m.enrollment_id = e.id` matches nothing and the ordinary send path is
    -- untouched by this statement.
    update public.email_sequence_enrollments e
       set next_due_at = now() + make_interval(hours => st.delay_hours),
           last_message_id = m.id,
           account_id = coalesce(e.account_id, p_account),
           -- Set with the pin and never cleared. Unlike account_id and
           -- last_message_id, nothing references it, so no DELETE anywhere can
           -- erase it -- which is the whole reason it exists. See 158c.
           pinned_at = coalesce(e.pinned_at, now())
      from public.email_messages m,
           public.email_sequence_steps st
     where m.id = p_message
       and m.enrollment_id = e.id
       and e.status = 'active'
       and st.sequence_id = e.sequence_id
       and st.step_index = m.step_index + 1;

    -- The last step has no successor, so the join above matched nothing and
    -- the enrollment is done. Separate statement: a single one cannot both
    -- schedule and complete. `e.next_due_at is null` is what tells the two
    -- apart -- the claim cleared it, and only the statement above sets it.
    update public.email_sequence_enrollments e
       set status = 'completed',
           next_due_at = null,
           last_message_id = m.id,
           pinned_at = coalesce(e.pinned_at, now())
      from public.email_messages m
     where m.id = p_message
       and m.enrollment_id = e.id
       and e.status = 'active'
       and e.next_due_at is null
       and not exists (
         select 1
           from public.email_sequence_steps st
          where st.sequence_id = e.sequence_id
            and st.step_index = m.step_index + 1
       );

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

    -- Retiring at three attempts sets 'failed' in the statement above, and for
    -- a sequence step that must also end its enrollment. The claim has already
    -- advanced current_step and cleared next_due_at, so an enrollment whose
    -- step quietly ran out of attempts would sit active for ever, never
    -- claimed again and never completed -- a message that failed three times
    -- is no less final for having taken three goes about it.
    --
    -- This enrollment only, for the same reason as the 'permanent' branch: a
    -- mailbox that greylists everything is our problem, not the recipient's.
    perform public.stop_enrollment(m.enrollment_id, 'failed')
       from public.email_messages m
      where m.id = p_message
        and m.status = 'failed'
        and m.enrollment_id is not null;

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

    -- A step that cannot be delivered ends ITS enrollment -- and only its own.
    --
    -- It has to end something: the claim has already advanced current_step and
    -- cleared next_due_at, so an enrollment left active here is never claimed
    -- again and never completed. Silent, permanent, and invisible on every
    -- screen.
    --
    -- But only its own, because 'permanent' is not a statement about the
    -- recipient. It is what phase 1 routes bad credentials and a rejected
    -- sender through -- the branch above increments the mailbox's strike count
    -- on exactly this outcome -- so stopping every sequence at that address
    -- would end conversations that a sibling mailbox was delivering perfectly
    -- well, over our own misconfiguration, one-way. See stop_enrollment().
    perform public.stop_enrollment(
      (select m.enrollment_id from public.email_messages m where m.id = p_message),
      'failed'
    );

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

    -- A bounce IS a statement about the recipient, so this one is
    -- organisation-wide: the address does not exist, which is equally true of
    -- every sequence talking to it, and the suppression written just above
    -- says so for campaigns already.
    --
    -- Reason 'bounced', not 'failed'. The enrollment screen shows this word to
    -- a person, and "Bounced" and "Could not be delivered" send them to two
    -- different places: one is a dead address to remove from their list, the
    -- other is something to check at our end.
    perform public.stop_enrollments_for_address(
      (select m.organization_id from public.email_messages m where m.id = p_message),
      (select m.to_email from public.email_messages m where m.id = p_message),
      'bounced'
    );

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

-- ── d. record_inbox_result(): a reply ends the conversation ─────────
--
-- The event kinds this function accepts. 'auto_reply' is new in phase 3: an
-- out-of-office is recorded so the scan's work is visible and a support
-- question has an answer, and it does exactly nothing else. It does not mark
-- replied_at, so it does not inflate the reply rate; it does not stop a
-- sequence, because the person has not read the message. Phase 2 counted one
-- as a reply and flagged this as phase 3's to settle. This is it, settled.
--
-- Dropped and recreated by name rather than altered, because a check constraint
-- cannot be extended in place -- the same move 158 made on
-- email_campaigns.kind. The name is the one PostgreSQL gave the inline column
-- check in 157 (<table>_<column>_check), and `drop constraint if exists` makes
-- the pair re-runnable.
alter table public.email_inbox_events drop constraint if exists email_inbox_events_kind_check;
alter table public.email_inbox_events
  add constraint email_inbox_events_kind_check
  check (kind in ('reply','bounce','auto_reply'));

-- Re-declared whole, with the body copied verbatim from migration 157 section
-- (d). The signature is unchanged, so there is nothing to drop. Everything 157
-- established -- the raise on an unknown account, the organization-wide match,
-- the first-reply-wins transition guard, the thirty-day bound on a bounce, the
-- evidence-led suppression that inserts the MATCHED message's own address, the
-- event row written for every kind -- is exactly as it was.
--
-- What is added is three things and only three:
--   * a reply stops every sequence this organization runs at that address;
--   * a matched bounce does the same;
--   * 'auto_reply' is accepted, and does neither.
create or replace function public.record_inbox_result(
  p_account uuid,
  p_kind text,
  p_address text,
  p_at timestamptz,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_message uuid;
  -- When that matched message actually went out. Only the bounce path reads
  -- it; see the recency gate in that branch for why.
  v_sent_at timestamptz;
begin
  -- The scan is always for one mailbox, and the event row's organization_id is
  -- NOT NULL, so a missing account is not something to record quietly: it
  -- means the worker is holding an account row that has since been deleted.
  --
  -- Raising here is deliberate and was reviewed as such. Nothing but the
  -- worker can call this function -- it is service_role-only -- so an account
  -- id that does not resolve is not user input to be tolerated, it is a bug or
  -- a race, and returning null would hide it behind a scan that looked
  -- successful. The caller wraps each mailbox in its own try/catch, so the
  -- blast radius is that one mailbox's cycle and nothing else.
  select a.organization_id
    into v_org
    from public.email_accounts a
   where a.id = p_account;

  if v_org is null then
    raise exception 'record_inbox_result: unknown account %', p_account;
  end if;

  -- The message this is about, if we sent one.
  --
  -- Scoped to the ORGANIZATION rather than to p_account: a pooled campaign
  -- sends from whichever mailbox was free, and a reply goes wherever From or
  -- Reply-To pointed, so requiring the reply to arrive in the same mailbox
  -- that sent it would miss ordinary matches. Suppression is organization-wide
  -- in any case, and the tenant boundary is what actually matters here.
  --
  -- status = 'sent' is what makes this a match against something that really
  -- went out: nobody replied to a queued row, and a bounce quoting a failed
  -- one is quoting a message that never left.
  --
  -- Most recent first, because an address mailed twice is replying to the
  -- latest. NULLS LAST because DESC sorts nulls first in PostgreSQL, and a
  -- 'sent' row with no sent_at -- which record_send_result() never produces,
  -- but 152's schema permits -- would otherwise outrank every real send.
  select m.id, m.sent_at
    into v_message, v_sent_at
    from public.email_messages m
   where m.organization_id = v_org
     and m.status = 'sent'
     and lower(m.to_email) = lower(trim(p_address))
   order by m.sent_at desc nulls last
   limit 1;

  if p_kind = 'reply' then
    -- The WHERE clause carries `and m.replied_at is null` rather than the
    -- coalesce an earlier revision used, and it is doing the same job that
    -- coalesce did -- the FIRST reply's time wins, and what follows is more
    -- of the same conversation, not a second reply, so overwriting it would
    -- push every "replied after" figure later each time they wrote again.
    -- Gating the WHERE clause this way, instead of writing the same value
    -- back unconditionally, is what makes plpgsql's FOUND below tell the
    -- truth: it is only true when this call is the one that actually made
    -- the null-to-set transition, never on a repeat, and never when
    -- v_message is null (m.id = null matches no row either way, exactly as
    -- it did before) -- a reply from someone we never mailed is not an
    -- error, it is simply not ours. The event row below still records that
    -- we saw it.
    update public.email_messages m
       set replied_at = p_at
     where m.id = v_message
       and m.replied_at is null;

    -- Increments the matched message's own campaign, and only on the
    -- transition FOUND just confirmed -- never on a repeat reply to a
    -- message already marked replied, and never for an unmatched reply,
    -- since FOUND is then false too. campaign_id is NOT NULL on
    -- email_messages (152), so a matched message always has exactly one
    -- campaign to credit.
    if found then
      update public.email_campaigns c
         set replied_count = c.replied_count + 1
        from public.email_messages m
       where m.id = v_message
         and c.id = m.campaign_id;
    end if;

    -- A reply ends every sequence this organisation is running at that
    -- address, whether or not it matched a message -- somebody writing to a
    -- mailbox we are sequencing has engaged, and a follow-up after that reads
    -- as a machine that is not listening. Organisation-wide and by address,
    -- for the reason on stop_enrollments_for_address().
    --
    -- After the `if found` block, never before it: PERFORM sets FOUND, so
    -- calling this first would decide the campaign counter on this call's
    -- result instead of the reply's.
    perform public.stop_enrollments_for_address(v_org, p_address, 'replied');

  elsif p_kind = 'bounce' then
    -- A bounce for mail sent a year ago is not a bounce for it.
    --
    -- The lookup above takes the most recent 'sent' row to that address with
    -- no bound on how old it may be, which is right for a reply -- somebody
    -- answering late is still answering -- and wrong for a bounce. A delivery
    -- failure arrives minutes to hours after the send, occasionally a day or
    -- two. A notification naming an address this organisation last mailed in
    -- another quarter is not reporting on that message, and treating it as
    -- though it were marks a long-settled message bounced, decrements nothing
    -- back out of the campaign it already counted as delivered, and adds a
    -- permanent tenant-wide suppression on the strength of it.
    --
    -- Thirty days matches SENT_LOOKBACK_MS in worker/lib/inboxCycle.ts, so the
    -- two ends of this phase bound the same way. A null sent_at cannot be aged
    -- at all, so it does not qualify either: nothing is suppressed on evidence
    -- that cannot be dated.
    if v_sent_at is null or v_sent_at < now() - interval '30 days' then
      v_message := null;
    end if;

    -- Same transition guard, same reason: the first failure is when it
    -- bounced.
    update public.email_messages m
       set bounced_at = p_at
     where m.id = v_message
       and m.bounced_at is null;

    -- Same increment, same transition-only rule, for the campaign's
    -- bounced_count. Deliberately BEFORE the suppression insert below: that
    -- insert runs unconditionally against whatever v_message resolved to,
    -- repeat bounce or not (it is itself idempotent via `on conflict do
    -- nothing`), so this count would otherwise have no fixed point to check
    -- FOUND against once other statements below have run and reset it.
    if found then
      update public.email_campaigns c
         set bounced_count = c.bounced_count + 1
        from public.email_messages m
       where m.id = v_message
         and c.id = m.campaign_id;
    end if;

    -- The rule this function exists to enforce. A bounce notification is
    -- unauthenticated mail: anyone who knows a customer's address can post
    -- their mailbox a delivery-failure report naming that customer's best
    -- client, and a suppression is permanent and tenant-wide. So suppression
    -- has to be evidence-led.
    --
    -- The address inserted is the MATCHED MESSAGE's own to_email, read back
    -- out of email_messages -- not p_address. With no match there is no row to
    -- select from and nothing at all is inserted, so the rule is the shape of
    -- the statement rather than an `if` that a later edit could quietly drop.
    -- It also means what gets suppressed is the address we hold, not the
    -- spelling a stranger chose to put in their DSN.
    --
    -- Lower-cased and trimmed, and `on conflict do nothing` so an address
    -- already suppressed keeps the reason it has -- both matching 156's
    -- hard_bounce branch and api/email/unsubscribe.ts.
    insert into public.email_suppressions (organization_id, email, reason, campaign_id)
    select m.organization_id,
           lower(trim(m.to_email)),
           'bounced',
           m.campaign_id
      from public.email_messages m
     where m.id = v_message
    on conflict do nothing;

    -- ...and the same evidence rule governs stopping a sequence. A bounce for
    -- an address this organisation never mailed -- or mailed in another
    -- quarter, which the recency gate above has already turned into no match
    -- at all -- must not end somebody's sequence on a stranger's say-so. The
    -- suppression insert above gets that rule from the shape of the statement;
    -- a PERFORM cannot, so it is guarded explicitly.
    --
    -- Last in the branch, after the `if found` block, for the same reason the
    -- reply's call is: PERFORM sets FOUND.
    if v_message is not null then
      perform public.stop_enrollments_for_address(v_org, p_address, 'bounced');
    end if;

  elsif p_kind = 'auto_reply' then
    -- An out-of-office, recorded and nothing more. It does NOT mark
    -- replied_at, so it does not inflate the reply rate, and it does not stop
    -- a sequence, because nobody has read the message -- a follow-up to
    -- somebody on holiday is exactly what a sequence is for. Phase 2 counted
    -- one of these as a reply and flagged this as phase 3's to settle; this is
    -- it, settled.
    --
    -- The branch deliberately touches email_messages not at all. The shared
    -- insert below still writes the event row, carrying whatever v_message the
    -- lookup resolved so the auto-reply is filed against the message it
    -- answered, and the function still returns it.
    null;

  else
    -- Loud rather than silent, matching record_send_result()'s contract. A
    -- kind the caller invented would otherwise reach the insert below and
    -- surface as a check constraint violation naming a column rather than the
    -- caller. Raising here also guarantees no event is written for a kind we
    -- do not understand.
    raise exception 'record_inbox_result: unknown kind %', p_kind;
  end if;

  -- Written for both kinds, matched or not. The unmatched bounce is the row
  -- that answers "we saw this and deliberately did nothing with it", which is
  -- the answer nothing else in the schema can give.
  --
  -- Three kinds now rather than two, and still one insert: an 'auto_reply'
  -- files its event here with every other, and that is the whole of what its
  -- branch above does.
  insert into public.email_inbox_events
    (organization_id, account_id, kind, address, message_id, detail)
  values
    (v_org, p_account, p_kind, lower(trim(p_address)), v_message, p_detail);

  return v_message;
end;
$$;

-- This writes to every organization's messages and suppression list as the
-- definer, so its privileges are not left to chance.
revoke execute on function public.record_inbox_result(uuid, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_inbox_result(uuid, text, text, timestamptz, text)
  to service_role;

-- ── e. finalize_email_campaigns() leaves a step's campaign alone ────
--
-- Re-declared whole, with the body copied verbatim from migration 155 section
-- 3, and one condition added to the outer WHERE clause.
--
-- The finalizer closes a campaign once no message of it is still open. A
-- step's campaign is open for as long as the sequence can enroll anybody,
-- which is not a state the finalizer can see.
create or replace function public.finalize_email_campaigns()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.email_campaigns c
     set sent_count       = t.sent_count,
         failed_count     = t.failed_count,
         suppressed_count = t.suppressed_count,
         -- Only close a campaign that actually has rows: a scheduled campaign
         -- whose recipients have not been queued yet has nothing outstanding
         -- and must not be declared sent.
         status = case
                    when t.total > 0 and t.open_count = 0 then 'sent'
                    else c.status
                  end,
         updated_at = now()
    from (
      select c2.id,
             count(m.id)                                                as total,
             count(*) filter (where m.status = 'sent')                  as sent_count,
             count(*) filter (where m.status = 'failed')                as failed_count,
             count(*) filter (where m.status = 'suppressed')            as suppressed_count,
             count(*) filter (where m.status in ('queued','sending'))   as open_count
        from public.email_campaigns c2
        left join public.email_messages m
          on m.campaign_id = c2.id and m.organization_id = c2.organization_id
       where c2.status in ('sending','scheduled')
       group by c2.id
    ) t
   where c.id = t.id
     and c.status in ('sending','scheduled')
     -- ...and never a sequence step's campaign. Its queue empties every time the
     -- last enrolled person reaches that step and fills again with the next
     -- enrollment, so "no open messages" means nothing here -- finalizing it would
     -- mark a running sequence complete, repeatedly.
     and c.kind <> 'sequence';
end;
$$;

revoke execute on function public.finalize_email_campaigns() from public, anon, authenticated;
grant execute on function public.finalize_email_campaigns() to service_role;

-- ── f. reconcile_stalled_enrollments(): the net under all of it ─────
--
-- An enrollment is claimed, its step is materialized, and current_step is
-- advanced with next_due_at cleared in the same statement. From that moment
-- the ONLY thing that can move it again is its message reaching a terminal
-- state, because next_due_at is null and the claim takes nothing with a null
-- due date. Every path that ends a message therefore has to end or reschedule
-- its enrollment, and every path that forgets to leaves that person stopped
-- for ever with the screen reporting them active.
--
-- Three such paths have already been found by reading rather than by running:
-- a step whose campaign was missing, a message retired after three transient
-- attempts, and a permanent failure. A fourth is reachable today and is not
-- fixable where the others were -- claim_email_batch() marks a message
-- 'suppressed' when the address was suppressed between materializing and
-- sending, and that happens nowhere near record_send_result().
--
-- So this is the net, run by the worker on every sequence cycle: any active
-- enrollment with no due date whose most recent message is terminal gets the
-- outcome that message implies. It costs one indexed scan of a small table and
-- it makes the invisible stall unreachable by construction, including from
-- paths nobody has written yet.
create or replace function public.reconcile_stalled_enrollments()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_fixed integer;
  v_second integer;
begin
  with latest as (
    select distinct on (m.enrollment_id)
           m.enrollment_id,
           m.status,
           m.to_email,
           m.organization_id
      from public.email_messages m
     where m.enrollment_id is not null
     order by m.enrollment_id, m.step_index desc, m.created_at desc
  )
  update public.email_sequence_enrollments e
     set status = 'stopped',
         stop_reason = case
                         when l.status = 'suppressed' then 'unsubscribed'
                         else 'failed'
                       end,
         stopped_at = now(),
         next_due_at = null
    from latest l
   where l.enrollment_id = e.id
     and e.status = 'active'
     and e.next_due_at is null
     -- 'sent' is not terminal for an enrollment: record_send_result() either
     -- scheduled the next step or completed it, and either way next_due_at is
     -- no longer null, so a sent step cannot reach this statement. Listing the
     -- two dead states explicitly rather than excluding 'sent' means a status
     -- added later is not swept up by accident.
     and l.status in ('failed', 'suppressed');

  get diagnostics v_fixed = row_count;

  -- ...and the same enrollment stranded with NO message at all for the step it
  -- is sitting on.
  --
  -- The sweep above joins the enrollment's most recent message, so it is blind
  -- to the case where that message does not exist: `distinct on` then resolves
  -- to the PREVIOUS step's row, whose status is 'sent' and which the filter
  -- excludes, or to no row at all, and the join matches nothing either way.
  --
  -- The claim writes the message in the same transaction as the advance, so
  -- this should be unreachable. "Should be unreachable" is what the three
  -- patched stalls before it were too, and the ones after this will be written
  -- by somebody who has not read this file. One path is reachable today: a
  -- step's hidden campaign being deleted takes its messages with it by
  -- cascade.
  --
  -- Stopped rather than rescheduled, and 'failed' rather than a new reason: an
  -- enrollment in this state has already been advanced past the step, so there
  -- is nothing left that knows what it was supposed to send.
  update public.email_sequence_enrollments e
     set status = 'stopped',
         stop_reason = 'failed',
         stopped_at = now(),
         next_due_at = null
   where e.status = 'active'
     and e.next_due_at is null
     -- current_step has already been advanced, so the step it is waiting on is
     -- the one before it.
     and e.current_step > 0
     and not exists (
       select 1
         from public.email_messages m
        where m.enrollment_id = e.id
          and m.step_index = e.current_step - 1
     );

  -- Both statements counted, so a non-zero result means one of the paths
  -- above fired and is worth a look, whichever it was.
  get diagnostics v_second = row_count;
  return v_fixed + v_second;
end;
$$;

revoke all on function public.reconcile_stalled_enrollments() from public;
grant execute on function public.reconcile_stalled_enrollments() to service_role;

-- ── g. stop_enrollment_by_member(): the Stop button ─────────────────
--
-- The screens cannot call stop_enrollment() -- it is service_role only, as
-- everything the worker uses is -- and they must not do the work themselves,
-- which is what they were doing: a plain UPDATE on the enrollment, setting
-- status and stop_reason and nothing else.
--
-- That update is the Critical this file was already written to close, on the
-- one path a person drives. An operator who stops an enrollment whose next
-- step is already queued would have had that step delivered anyway, hours
-- later, because claim_email_batch() has no idea what an enrollment is. And it
-- was unrecoverable: the status is now 'stopped', so a later reply or bounce
-- finds nothing to stop and cancels nothing either.
--
-- So the button calls this, and this calls the one definition of stopping.
--
-- security definer with its own membership check, because the browser's role
-- must not be handed the underlying grant: authenticated has no UPDATE on
-- email_messages at all, by design (152), and this is the only thing that
-- should ever get past that on its behalf.
create or replace function public.stop_enrollment_by_member(p_enrollment uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
begin
  select e.organization_id
    into v_org
    from public.email_sequence_enrollments e
   where e.id = p_enrollment;

  -- Silent on a missing row rather than raising: an enrollment id that does
  -- not resolve is a stale screen, not an attack, and the caller's own RLS
  -- already decides what they can see. Returning zero says "nothing stopped".
  if v_org is null then
    return 0;
  end if;

  -- The membership check this function exists to enforce. Without it, a
  -- definer function taking a bare uuid would stop any enrollment in any
  -- organization for anyone who could guess one.
  if not public.is_org_member(v_org) then
    raise exception 'stop_enrollment_by_member: not a member of that organization';
  end if;

  return public.stop_enrollment(p_enrollment, 'manual');
end;
$$;

revoke all on function public.stop_enrollment_by_member(uuid) from public;
grant execute on function public.stop_enrollment_by_member(uuid) to authenticated;

-- ── h. count_steps_waiting_on_paused_mailbox() ──────────────────────
--
-- How many sequence steps are queued behind a mailbox that cannot send, for
-- the banner on the Sequences tab.
--
-- A definer function rather than a query from the browser, because the join it
-- needs -- message to enrollment to sequence, to filter by workspace -- is
-- three levels deep, and doing it client-side meant either counting the whole
-- organization (telling somebody in workspace A about mail that belongs to
-- workspace B, on a screen where none of it appears) or shipping thousands of
-- enrollment ids through a URL.
--
-- Archived sequences are excluded: their mail is not going out and nobody is
-- waiting on anything.
create or replace function public.count_steps_waiting_on_paused_mailbox(
  p_org uuid,
  p_workspace uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  if not public.is_org_member(p_org) then
    raise exception 'count_steps_waiting_on_paused_mailbox: not a member of that organization';
  end if;

  select count(*)
    into v_count
    from public.email_messages m
    join public.email_sequence_enrollments e on e.id = m.enrollment_id
    join public.email_sequences s on s.id = e.sequence_id
    join public.email_accounts a on a.id = m.pinned_account_id
   where m.organization_id = p_org
     and m.status = 'queued'
     -- The pin is what makes this different from any other queued message: a
     -- campaign row would simply be taken by another pool member.
     and m.pinned_account_id is not null
     and (not a.is_active or a.status = 'error')
     and s.status <> 'archived'
     and (p_workspace is null or s.workspace_id = p_workspace);

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.count_steps_waiting_on_paused_mailbox(uuid, uuid) from public;
grant execute on function public.count_steps_waiting_on_paused_mailbox(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
