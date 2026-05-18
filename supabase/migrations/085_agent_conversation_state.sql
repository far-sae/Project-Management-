-- 085_agent_conversation_state.sql
-- Conversation state for the Telegram/WhatsApp bot. When the bot asks for a
-- missing field ("What's the task title?"), it records (chat_id, the field
-- it's awaiting, the partial intent so far) here. The next inbound message
-- on that chat is then treated as the value for that field instead of being
-- parsed as a fresh command.
--
-- One row per (provider, chat_id). 5-minute TTL.

create table if not exists public.agent_conversation_state (
  provider        text not null check (provider in ('telegram','whatsapp')),
  chat_id         text not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  org_id          uuid not null references public.organizations(organization_id) on delete cascade,
  awaiting_field  text not null,
  partial_intent  jsonb not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  primary key (provider, chat_id)
);

create index if not exists agent_conversation_state_expires_idx
  on public.agent_conversation_state(expires_at);

alter table public.agent_conversation_state enable row level security;
-- Service-role only; no end-user policies.
