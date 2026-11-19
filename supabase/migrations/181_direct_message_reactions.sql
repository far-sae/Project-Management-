-- Emoji reactions on one-to-one messages, the same way the project chat has them
-- (031_project_chat_message_reactions.sql). One row per person per emoji per message.
--
-- Safe to run more than once.

set search_path = public;

create table if not exists public.direct_message_reactions (
  reaction_id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.direct_messages (message_id) on delete cascade,
  -- Copied from the message so realtime can filter by conversation.
  thread_key text not null default '',
  user_id uuid not null,
  emoji text not null check (char_length(emoji) >= 1 and char_length(emoji) <= 32),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_dm_reactions_thread on public.direct_message_reactions (thread_key);
create index if not exists idx_dm_reactions_message on public.direct_message_reactions (message_id);

alter table public.direct_message_reactions enable row level security;

-- The conversation a reaction belongs to always comes from its message, never from the client.
create or replace function public.direct_message_reaction_set_thread_key()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key text;
begin
  select m.thread_key into strict v_key
  from public.direct_messages m
  where m.message_id = NEW.message_id;
  NEW.thread_key := v_key;
  return NEW;
exception
  when no_data_found then
    raise exception 'direct message not found for message_id';
end;
$$;

drop trigger if exists trg_dm_reaction_thread_key on public.direct_message_reactions;
create trigger trg_dm_reaction_thread_key
  before insert on public.direct_message_reactions
  for each row execute function public.direct_message_reaction_set_thread_key();

-- Only the two people in the conversation can see or add reactions.
drop policy if exists "Participants can read direct message reactions" on public.direct_message_reactions;
create policy "Participants can read direct message reactions"
  on public.direct_message_reactions for select
  to authenticated
  using (
    exists (
      select 1 from public.direct_messages m
      where m.message_id = direct_message_reactions.message_id
        and (select auth.uid()) in (m.sender_id, m.recipient_id)
    )
  );

drop policy if exists "Participants can add their own direct message reactions" on public.direct_message_reactions;
create policy "Participants can add their own direct message reactions"
  on public.direct_message_reactions for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.direct_messages m
      where m.message_id = direct_message_reactions.message_id
        and (select auth.uid()) in (m.sender_id, m.recipient_id)
    )
  );

drop policy if exists "People can remove their own direct message reactions" on public.direct_message_reactions;
create policy "People can remove their own direct message reactions"
  on public.direct_message_reactions for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, delete on table public.direct_message_reactions to authenticated;
grant all on table public.direct_message_reactions to service_role;

-- A removed reaction has to reach the other person live, so deletes carry the whole row.
alter table public.direct_message_reactions replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.direct_message_reactions;
exception
  when others then null; -- already in the publication
end $$;

notify pgrst, 'reload schema';
