-- 1-on-1 direct messages between organization members. Surfaced from the project right
-- rail's Team tab: clicking a teammate opens a DM thread on the left side of the screen.
--
-- A DM "thread" is identified by a deterministic key built from the two participant ids
-- (smaller id first). Each row stores the sender + recipient explicitly so RLS can confirm
-- the requesting user is one of the two participants without re-deriving the key.

create table if not exists public.direct_messages (
  message_id uuid primary key default gen_random_uuid(),
  thread_key text not null,
  sender_id uuid not null,
  recipient_id uuid not null,
  organization_id uuid,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists idx_direct_messages_thread_created
  on public.direct_messages (thread_key, created_at desc);

create index if not exists idx_direct_messages_recipient_unread
  on public.direct_messages (recipient_id) where read_at is null;

alter table public.direct_messages enable row level security;

-- PostgREST: anon must hold SELECT privilege so REST handshakes succeed; RLS still hides
-- every row from anon (policy below is restricted to authenticated participants only).
grant select on table public.direct_messages to anon;
grant select, insert, update on table public.direct_messages to authenticated;

drop policy if exists "Participants can read direct messages" on public.direct_messages;
drop policy if exists "Participants can insert direct messages" on public.direct_messages;
drop policy if exists "Recipient can mark direct message read" on public.direct_messages;
drop policy if exists "anon_no_direct_messages" on public.direct_messages;

create policy "anon_no_direct_messages"
  on public.direct_messages for select
  to anon
  using (false);

create policy "Participants can read direct messages"
  on public.direct_messages for select
  to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));

create policy "Participants can insert direct messages"
  on public.direct_messages for insert
  to authenticated
  with check (
    (select auth.uid()) = sender_id
    and sender_id <> recipient_id
  );

-- Recipient can flip read_at to record they've seen the message; sender can't.
create policy "Recipient can mark direct message read"
  on public.direct_messages for update
  to authenticated
  using ((select auth.uid()) = recipient_id)
  with check ((select auth.uid()) = recipient_id);

do $$
begin
  alter publication supabase_realtime add table public.direct_messages;
exception
  when others then null; -- already in publication
end $$;
