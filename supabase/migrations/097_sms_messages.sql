-- 097_sms_messages.sql
-- Outbound SMS log. Stores every send so the activity timeline can show
-- "SMS sent to +1…" entries, and the edge function has somewhere to
-- record the Twilio message SID for follow-up status callbacks.

create table if not exists public.sms_messages (
  message_id        uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  client_id         uuid references public.clients(client_id) on delete set null,
  deal_id           uuid references public.deals(deal_id) on delete set null,
  direction         text not null default 'outbound',  -- outbound | inbound
  to_number         text not null,
  from_number       text,
  body              text not null,
  provider          text not null default 'twilio',
  provider_sid      text,
  status            text not null default 'queued',    -- queued | sent | delivered | failed
  error_code        text,
  error_message     text,
  sent_by           uuid,
  sent_by_name      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (direction in ('outbound','inbound')),
  check (status in ('queued','sent','delivered','failed','undelivered','received'))
);

create index if not exists idx_sms_messages_org_time
  on public.sms_messages (organization_id, created_at desc);
create index if not exists idx_sms_messages_client
  on public.sms_messages (client_id, created_at desc)
  where client_id is not null;

alter table public.sms_messages enable row level security;

grant select on table public.sms_messages to anon;
grant select, insert, update on table public.sms_messages to authenticated;

drop policy if exists "anon_no_sms"           on public.sms_messages;
drop policy if exists "members_view_sms"      on public.sms_messages;
drop policy if exists "members_insert_sms"    on public.sms_messages;
drop policy if exists "members_update_sms"    on public.sms_messages;

create policy "anon_no_sms"
  on public.sms_messages for select to anon using (false);

create policy "members_view_sms"
  on public.sms_messages for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members_insert_sms"
  on public.sms_messages for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (sent_by = auth.uid() or sent_by is null)
  );

create policy "members_update_sms"
  on public.sms_messages for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create or replace function public.sms_messages_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists sms_messages_set_updated_at on public.sms_messages;
create trigger sms_messages_set_updated_at
  before update on public.sms_messages
  for each row execute function public.sms_messages_set_updated_at();
