-- Emoji reactions on project rail chat (WhatsApp-style). One row per user per emoji per message.

create table if not exists public.project_chat_message_reactions (
  reaction_id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.project_chat_messages (message_id) on delete cascade,
  project_id uuid not null references public.projects (project_id) on delete cascade,
  user_id uuid not null,
  emoji text not null check (char_length(emoji) >= 1 and char_length(emoji) <= 32),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_pc_msg_reactions_project
  on public.project_chat_message_reactions (project_id);

create index if not exists idx_pc_msg_reactions_message
  on public.project_chat_message_reactions (message_id);

alter table public.project_chat_message_reactions enable row level security;

-- Fill project_id from parent chat row so realtime can filter by project_id.
create or replace function public.project_chat_reaction_set_project_id()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pid uuid;
begin
  select m.project_id into strict v_pid
  from public.project_chat_messages m
  where m.message_id = NEW.message_id;
  NEW.project_id := v_pid;
  return NEW;
exception
  when no_data_found then
    raise exception 'project_chat_message not found for message_id';
end;
$$;

drop trigger if exists trg_pc_reaction_project on public.project_chat_message_reactions;
create trigger trg_pc_reaction_project
  before insert on public.project_chat_message_reactions
  for each row execute function public.project_chat_reaction_set_project_id();

create policy "Project members can read chat reactions"
  on public.project_chat_message_reactions for select
  using (
    exists (
      select 1 from public.projects p
      where p.project_id = project_chat_message_reactions.project_id
        and (
          p.owner_id = auth.uid()
          or exists (
            select 1
            from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) as m
            where (m->>'userId')::uuid = auth.uid()
          )
        )
    )
  );

create policy "Project members can insert own chat reactions"
  on public.project_chat_message_reactions for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.projects p
      where p.project_id = project_chat_message_reactions.project_id
        and (
          p.owner_id = auth.uid()
          or exists (
            select 1
            from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) as m
            where (m->>'userId')::uuid = auth.uid()
          )
        )
    )
  );

create policy "Users can delete own chat reactions"
  on public.project_chat_message_reactions for delete
  using (auth.uid() = user_id);

grant select, insert, delete on table public.project_chat_message_reactions to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.project_chat_message_reactions;
exception
  when others then null;
end $$;
