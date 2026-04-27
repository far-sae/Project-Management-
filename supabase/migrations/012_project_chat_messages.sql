-- Project-scoped chat (right rail). Messages are visible to project owner and project members.

create table if not exists public.project_chat_messages (
  message_id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  organization_id uuid,
  user_id uuid not null,
  display_name text not null default '',
  user_photo text,
  body text not null,
  task_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_chat_project_created
  on public.project_chat_messages (project_id, created_at desc);

alter table public.project_chat_messages enable row level security;

drop policy if exists "Project members can read project chat" on public.project_chat_messages;
drop policy if exists "Project members can insert project chat" on public.project_chat_messages;

create policy "Project members can read project chat"
  on public.project_chat_messages for select
  using (
    exists (
      select 1 from public.projects p
      where p.project_id = project_chat_messages.project_id
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

create policy "Project members can insert project chat"
  on public.project_chat_messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.projects p
      where p.project_id = project_chat_messages.project_id
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

do $$
begin
  alter publication supabase_realtime add table public.project_chat_messages;
exception
  when others then null;
end $$;
