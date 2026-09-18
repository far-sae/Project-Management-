-- 153_email_claim_and_cron.sql
--
-- 1. claim_email_batch(): the worker's atomic claim. FOR UPDATE SKIP LOCKED
--    means two overlapping ticks can never claim the same row, so a
--    recipient is never emailed twice.
-- 2. A cron job that pokes the Vercel worker every minute. Sending runs on
--    Vercel, not in an edge function, because Deno blocks outbound SMTP
--    ports 25 and 587 and Microsoft 365 requires 587.
-- 3. Cleanup: migration 143 deleted the crm-run-automations function but left
--    migration 111's cron job pointing at it, so this database has been
--    POSTing to a missing endpoint every minute ever since.

-- ── 1. Atomic claim ─────────────────────────────────────────────────
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

  return query
  with claimed as (
    select m.id
      from public.email_messages m
      join public.email_campaigns c on c.id = m.campaign_id
     where m.status = 'queued'
       and m.send_after <= now()
       and c.status in ('sending','scheduled')
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

revoke execute on function public.claim_email_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_email_batch(integer) to service_role;

-- ── 2. Poke the Vercel worker every minute ──────────────────────────
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Configure once, as the project owner:
--   insert into public.app_secrets(key, value) values
--     ('site_url', 'https://your-app.vercel.app'),
--     ('email_worker_secret', '<same value as EMAIL_WORKER_SECRET in Vercel>')
--   on conflict (key) do update set value = excluded.value;
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
    from public.email_messages
   where status = 'queued' and send_after <= now();
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

do $$
begin
  perform cron.unschedule('email_worker_minute');
exception when others then null;
end $$;

select cron.schedule(
  'email_worker_minute',
  '* * * * *',
  $$ select public.kick_email_worker(); $$
);

-- ── 3. Remove the orphaned CRM automation cron ──────────────────────
do $$
begin
  perform cron.unschedule('crm_automation_worker_minute');
exception when others then null;
end $$;

drop function if exists public.crm_kick_automation_worker();

notify pgrst, 'reload schema';
