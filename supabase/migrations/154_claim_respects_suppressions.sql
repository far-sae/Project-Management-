-- 154_claim_respects_suppressions.sql
--
-- Migration 153's claim_email_batch() ignored public.email_suppressions, so a
-- recipient who unsubscribed after a campaign was queued still received the
-- rest of it: the suppression list was only consulted when messages were
-- enqueued. The spec requires suppression to be honoured at claim time.
--
-- This replaces the function body only. Everything else about it -- the
-- signature, the returns table column list, security definer, the search_path,
-- the stuck-row recovery and the FOR UPDATE ... SKIP LOCKED claim -- is
-- unchanged from 153. Two things are added:
--
--   1. A sweep that marks queued messages to a suppressed address as
--      'suppressed', so the outbox reflects why they were never sent and the
--      campaign counters can settle.
--   2. A matching NOT EXISTS guard inside the claim itself, so a row that is
--      suppressed in the window between the two statements is still never
--      claimed. The sweep alone would leave that race open.

create or replace function public.claim_email_batch(p_limit integer default 25)
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
  -- mid-send. Return them to the queue before claiming.
  update public.email_messages
     set status = 'queued', claimed_at = null
   where status = 'sending'
     and claimed_at < now() - interval '10 minutes';

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
  with claimed as (
    select m.id
      from public.email_messages m
      join public.email_campaigns c on c.id = m.campaign_id
     where m.status = 'queued'
       and m.send_after <= now()
       and c.status in ('sending','scheduled')
       -- Belt and braces: the sweep above already flipped these rows, but a
       -- suppression written between the two statements must not slip through.
       and not exists (
         select 1
           from public.email_suppressions s
          where s.organization_id = m.organization_id
            and lower(s.email) = lower(m.to_email)
       )
     order by m.send_after
     limit greatest(p_limit, 1)
     for update of m skip locked
  )
  update public.email_messages m
     set status = 'sending', claimed_at = now(), attempts = m.attempts + 1
    from claimed
   where m.id = claimed.id
  returning m.id, m.campaign_id, m.organization_id, m.to_email, m.to_name,
            m.merge_data, m.attempts;
end;
$$;

-- create or replace resets nothing but the body, so the grants from 153 still
-- stand -- but this function reads every organization's outbox as the definer,
-- so its privileges are not left to chance.
revoke execute on function public.claim_email_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_email_batch(integer) to service_role;

notify pgrst, 'reload schema';
