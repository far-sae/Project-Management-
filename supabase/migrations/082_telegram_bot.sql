-- 082_telegram_bot.sql
-- Adds the Telegram bot's two backing tables and extends the integrations
-- provider check to allow 'telegram'.

-- Allow 'telegram' (and reserve 'whatsapp' for the future adapter).
alter table public.integrations
  drop constraint if exists integrations_provider_check;
alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('google','gmail','slack','telegram','whatsapp'));

-- One-time link codes (6 digits, hashed, 10-minute TTL).
create table if not exists public.telegram_link_codes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  org_id       uuid not null references public.organizations(organization_id) on delete cascade,
  code_hash    text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

create unique index if not exists telegram_link_codes_active_hash
  on public.telegram_link_codes(code_hash)
  where consumed_at is null;

create index if not exists telegram_link_codes_user_idx
  on public.telegram_link_codes(user_id, created_at desc);

alter table public.telegram_link_codes enable row level security;

create policy "users read own link codes"
  on public.telegram_link_codes for select
  using (auth.uid() = user_id);

-- Writes happen via the telegram-link-code edge function (service role) and the
-- webhook (service role). No INSERT/UPDATE policies for end users.

-- Buffer for actions awaiting confirmation.
create table if not exists public.agent_pending_actions (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null check (provider in ('telegram','whatsapp')),
  chat_id     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(organization_id) on delete cascade,
  action      jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists agent_pending_actions_chat_idx
  on public.agent_pending_actions(provider, chat_id, expires_at desc);

alter table public.agent_pending_actions enable row level security;

-- Service-role only; no end-user policies.
