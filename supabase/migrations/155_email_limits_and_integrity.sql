-- 155_email_limits_and_integrity.sql
--
-- Four fixes from the whole-branch review of the email marketing feature:
--
--   1. Cross-organization integrity. A user who belongs to two organizations
--      could create a campaign in org A whose account_id pointed at org B's
--      SMTP identity, and send org A's mail from org B's domain. Composite
--      foreign keys now make that unrepresentable.
--   2. Sending limits. claim_email_batch() claimed 25 rows a minute whatever
--      email_accounts.hourly_limit, email_accounts.daily_limit and
--      email_campaigns.rate_per_hour said. All three are collected in the UI
--      and stored, so users reasonably believe they work. Now they do.
--   3. Retry budget. Rows were claimed forever; now the claim skips rows with
--      attempts >= 3, and the stuck-row recovery retires them to 'failed'.
--   4. Campaign rollup. finalize_email_campaigns() recomputes the counters
--      from real row counts, replacing the per-campaign loop the worker ran,
--      and kick_email_worker() stops POSTing to Vercel every minute forever
--      because of a campaign parked in 'draft' or 'paused'.
--
-- Section 1 runs first because the claim in section 2 joins on the keys it
-- adds. Note that section 1 is strict on purpose: if this database already
-- holds a campaign whose account lives in another organization, the ALTER
-- fails loudly rather than blessing the row. Fix the data and re-run.

-- ── 1. Cross-organization integrity ─────────────────────────────────

-- (id) is already the primary key of each table; these composite unique
-- constraints exist only so (id, organization_id) can be a foreign key target.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'email_accounts_id_org_key'
       and conrelid = 'public.email_accounts'::regclass
  ) then
    alter table public.email_accounts
      add constraint email_accounts_id_org_key unique (id, organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'email_campaigns_id_org_key'
       and conrelid = 'public.email_campaigns'::regclass
  ) then
    alter table public.email_campaigns
      add constraint email_campaigns_id_org_key unique (id, organization_id);
  end if;
end $$;

-- Drop the single-column foreign keys the composite ones replace. They are
-- found by their referencing column rather than by name, so a differently
-- named constraint from an older hand-applied schema is still removed.
do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where con.contype = 'f'
       and con.conrelid = 'public.email_campaigns'::regclass
       and con.confrelid = 'public.email_accounts'::regclass
       and con.conkey = array[
             (select attnum from pg_attribute
               where attrelid = rel.oid and attname = 'account_id' and not attisdropped)
           ]::int2[]
  loop
    execute format('alter table public.email_campaigns drop constraint %I', r.conname);
  end loop;

  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where con.contype = 'f'
       and con.conrelid = 'public.email_messages'::regclass
       and con.confrelid = 'public.email_campaigns'::regclass
       and con.conkey = array[
             (select attnum from pg_attribute
               where attrelid = rel.oid and attname = 'campaign_id' and not attisdropped)
           ]::int2[]
  loop
    execute format('alter table public.email_messages drop constraint %I', r.conname);
  end loop;
end $$;

-- A campaign's account must live in the campaign's organization...
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'email_campaigns_account_org_fkey'
       and conrelid = 'public.email_campaigns'::regclass
  ) then
    alter table public.email_campaigns
      add constraint email_campaigns_account_org_fkey
      foreign key (account_id, organization_id)
      references public.email_accounts (id, organization_id)
      on delete restrict;
  end if;
end $$;

-- ...and a message's campaign must live in the message's organization.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'email_messages_campaign_org_fkey'
       and conrelid = 'public.email_messages'::regclass
  ) then
    alter table public.email_messages
      add constraint email_messages_campaign_org_fkey
      foreign key (campaign_id, organization_id)
      references public.email_campaigns (id, organization_id)
      on delete cascade;
  end if;
end $$;

-- Composite foreign keys need an index on the referencing side or every
-- parent delete degrades into a sequential scan of the child table.
create index if not exists idx_email_campaigns_account_org
  on public.email_campaigns (account_id, organization_id);
create index if not exists idx_email_messages_campaign_org
  on public.email_messages (campaign_id, organization_id);

-- ── 2. claim_email_batch(): honour the configured sending limits ────
--
-- Everything migration 154 established is kept: the signature, the returns
-- table column list, security definer, the search_path, the stuck-row
-- recovery, the suppression sweep, the NOT EXISTS guard inside the claim, and
-- FOR UPDATE OF m SKIP LOCKED. What is added is a per-account budget and the
-- attempts < 3 predicate.
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
  -- mid-send. Settle them before claiming:
  --   * provider_message_id set means SMTP already accepted the message and
  --     only the status write-back failed (api/email/tick.ts records the id
  --     for exactly this reason) -- so it is 'sent', never re-queued;
  --   * attempts >= 3 means the retry budget is spent, so it is 'failed'
  --     rather than a row that cycles through the queue forever;
  --   * anything else goes back to the queue for another try.
  update public.email_messages
     set status = case
                    when provider_message_id is not null then 'sent'
                    when attempts >= 3 then 'failed'
                    else 'queued'
                  end,
         claimed_at = null,
         sent_at = case
                     when provider_message_id is not null then coalesce(sent_at, now())
                     else sent_at
                   end,
         last_error = case
                        when provider_message_id is null and attempts >= 3
                          then coalesce(last_error, 'Abandoned after 3 delivery attempts')
                        else last_error
                      end
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
  with
  -- What each sending account has already put on the wire. Rows still in
  -- 'sending' count: they were handed to SMTP inside this window, so ignoring
  -- them would let two overlapping ticks blow straight through the limit.
  account_usage as (
    select c.account_id,
           count(*) filter (
             where coalesce(m.sent_at, m.claimed_at) >= now() - interval '1 hour'
           ) as sent_hour,
           count(*) as sent_day
      from public.email_messages m
      join public.email_campaigns c
        on c.id = m.campaign_id and c.organization_id = m.organization_id
     where m.status in ('sent', 'sending')
       and coalesce(m.sent_at, m.claimed_at) >= now() - interval '24 hours'
     group by c.account_id
  ),
  candidates as (
    select m.id,
           m.send_after,
           c.account_id,
           a.hourly_limit,
           a.daily_limit,
           c.rate_per_hour
      from public.email_messages m
      join public.email_campaigns c
        on c.id = m.campaign_id and c.organization_id = m.organization_id
      join public.email_accounts a
        on a.id = c.account_id and a.organization_id = c.organization_id
     where m.status = 'queued'
       and m.send_after <= now()
       -- Three tries is the budget; past that the row is the recovery
       -- sweep's problem, not something to claim again.
       and m.attempts < 3
       and c.status in ('sending','scheduled')
       -- Belt and braces: the sweep above already flipped these rows, but a
       -- suppression written between the two statements must not slip through.
       and not exists (
         select 1
           from public.email_suppressions s
          where s.organization_id = m.organization_id
            and lower(s.email) = lower(m.to_email)
       )
  ),
  -- How many more this account may send right now: whatever is left of its
  -- hourly limit, of its daily limit, and of the campaign's per-hour rate
  -- expressed as a per-minute ceiling (the worker ticks once a minute). The
  -- smallest of the three wins, and it never goes below zero. Where one
  -- account serves several candidate campaigns the strictest rate applies.
  budget as (
    select cd.account_id,
           greatest(
             least(
               cd.hourly_limit - coalesce(u.sent_hour, 0),
               cd.daily_limit  - coalesce(u.sent_day, 0),
               ceil(cd.rate_per_hour::numeric / 60)::integer
             ),
             0
           ) as allowance
      from (
        select account_id,
               min(hourly_limit)  as hourly_limit,
               min(daily_limit)   as daily_limit,
               min(rate_per_hour) as rate_per_hour
          from candidates
         group by account_id
      ) cd
      left join account_usage u on u.account_id = cd.account_id
  ),
  ranked as (
    select cd.id,
           cd.send_after,
           cd.account_id,
           row_number() over (partition by cd.account_id order by cd.send_after) as rn
      from candidates cd
  ),
  claimed as (
    select m.id
      from public.email_messages m
      join ranked r on r.id = m.id
      join budget b on b.account_id = r.account_id
     where r.rn <= b.allowance
     order by r.send_after
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

-- ── 3. finalize_email_campaigns(): the rollup, in one statement ─────
--
-- Replaces the per-campaign loop api/email/tick.ts used to run (four count
-- queries plus an update, per campaign, per tick). The worker now calls this
-- at the end of every tick, including the tick that claimed nothing -- which
-- is what closes a campaign whose last rows were suppressed rather than sent.
--
-- It only ever touches campaigns in 'sending' or 'scheduled'. A 'paused',
-- 'draft', 'sent' or 'failed' campaign is left exactly as it is.
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
     and c.status in ('sending','scheduled');
end;
$$;

revoke execute on function public.finalize_email_campaigns() from public, anon, authenticated;
grant execute on function public.finalize_email_campaigns() to service_role;

-- ── 4. kick_email_worker(): only poke Vercel for sendable mail ──────
--
-- The count ignored campaigns entirely, so one campaign left in 'draft' or
-- 'paused' with queued rows made the cron POST to Vercel every minute for
-- ever. Join the campaign and count only what claim_email_batch() would
-- actually claim. Everything else about the function is unchanged from 153.
create or replace function public.kick_email_worker()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_pending integer;
begin
  select count(*) into v_pending
    from public.email_messages m
    join public.email_campaigns c
      on c.id = m.campaign_id and c.organization_id = m.organization_id
   where m.status = 'queued'
     and m.send_after <= now()
     and m.attempts < 3
     and c.status in ('sending','scheduled');
  if v_pending = 0 then
    return;  -- nothing to do; don't spend an HTTP call
  end if;

  begin
    select value into v_url    from public.app_secrets where key = 'site_url';
    select value into v_secret from public.app_secrets where key = 'email_worker_secret';
  exception when others then
    v_url := null; v_secret := null;
  end;

  if v_url is null or v_secret is null then
    raise notice 'kick_email_worker: site_url or email_worker_secret not configured; skipping.';
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/api/email/tick',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-worker-secret', v_secret
    ),
    body    := jsonb_build_object('source', 'pg_cron')
  );
end;
$$;

revoke execute on function public.kick_email_worker() from public, anon, authenticated;

-- create or replace resets nothing but the body, so the grants from 153 still
-- stand -- but this function reads every organization's outbox as the definer,
-- so its privileges are not left to chance.
revoke execute on function public.claim_email_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_email_batch(integer) to service_role;

notify pgrst, 'reload schema';
