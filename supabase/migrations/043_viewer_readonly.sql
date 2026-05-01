-- Viewer role: read-only at the database layer.
--
-- A "viewer" sits in organizations.members with role = 'viewer'. The UI hides
-- every mutation control from them, but a determined viewer could still call
-- the REST API directly. This migration blocks the four mutation paths they
-- might still try:
--
--   • tasks                          INSERT / UPDATE / DELETE
--   • project_chat_messages          INSERT
--   • project_chat_message_reactions INSERT (covers the "react" buttons)
--   • expenses                       INSERT (already member-locked, but
--                                            viewers shouldn't even appear in
--                                            expense reports)
--
-- We use a security-definer helper that resolves the user's org role from
-- organizations.members JSON. This bypasses RLS so members can check their
-- own role even when they can't read the full org row.

create or replace function public.is_org_viewer(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_org is null then false
    when auth.uid() is null then false
    else exists (
      select 1 from public.organizations o
      where o.organization_id = p_org
        and o.owner_id <> auth.uid()
        and exists (
          select 1
          from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
          where (m->>'userId')::uuid = auth.uid()
            and (m->>'role') = 'viewer'
        )
    )
  end;
$$;

grant execute on function public.is_org_viewer(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- tasks: trigger-based block for INSERT/UPDATE/DELETE when caller is a
-- viewer in the task's organization. RLS already restricts UPDATE/DELETE to
-- creator/assignee/project-owner/org-admin (migrations 006 + 042); a viewer
-- would naturally fail those checks. The explicit trigger here gives a clearer
-- error message and also blocks INSERT (which RLS allows for any project
-- member, including viewers).
-- ---------------------------------------------------------------------------
create or replace function public.tasks_block_viewer_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_org uuid;
begin
  v_org := coalesce(new.organization_id, old.organization_id);
  if v_org is null then
    return coalesce(new, old);
  end if;
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if public.is_org_viewer(v_org) then
    raise exception 'Viewers have read-only access — task changes are not permitted.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists tasks_block_viewer_mutation_trg on public.tasks;
create trigger tasks_block_viewer_mutation_trg
  before insert or update or delete on public.tasks
  for each row
  execute function public.tasks_block_viewer_mutation();

-- ---------------------------------------------------------------------------
-- project_chat_messages: block INSERT when caller is a viewer in the project's
-- organization. Lookup the org via the project (project_chat_messages stores
-- organization_id directly, but it can be null on legacy rows — fall back to
-- the project row).
-- ---------------------------------------------------------------------------
create or replace function public.project_chat_block_viewer_post()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_org uuid;
begin
  v_org := new.organization_id;
  if v_org is null then
    select organization_id into v_org from public.projects where project_id = new.project_id;
  end if;
  if v_org is null then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if public.is_org_viewer(v_org) then
    raise exception 'Viewers have read-only access — cannot post in chat.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists project_chat_block_viewer_post_trg on public.project_chat_messages;
create trigger project_chat_block_viewer_post_trg
  before insert on public.project_chat_messages
  for each row
  execute function public.project_chat_block_viewer_post();

-- Reactions table — same idea. `project_chat_message_reactions` was added in
-- migration 031; it stores project_id, so we resolve org via the project row.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'project_chat_message_reactions'
  ) then
    create or replace function public.project_chat_reactions_block_viewer()
    returns trigger
    language plpgsql
    security invoker
    set search_path = public, pg_catalog
    as $fn$
    declare
      v_org uuid;
    begin
      select organization_id into v_org from public.projects where project_id = new.project_id;
      if v_org is null then
        return new;
      end if;
      if auth.uid() is null then
        return new;
      end if;
      if public.is_org_viewer(v_org) then
        raise exception 'Viewers have read-only access — cannot react to messages.'
          using errcode = '42501';
      end if;
      return new;
    end;
    $fn$;

    drop trigger if exists project_chat_reactions_block_viewer_trg on public.project_chat_message_reactions;
    create trigger project_chat_reactions_block_viewer_trg
      before insert on public.project_chat_message_reactions
      for each row
      execute function public.project_chat_reactions_block_viewer();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- expenses: viewers shouldn't be filing expenses for reimbursement — this is
-- a small extra guard on top of the existing RLS that already gates inserts
-- to org members.
-- ---------------------------------------------------------------------------
create or replace function public.expenses_block_viewer_insert()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
begin
  if new.organization_id is null then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if public.is_org_viewer(new.organization_id) then
    raise exception 'Viewers have read-only access — cannot file expenses.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists expenses_block_viewer_insert_trg on public.expenses;
create trigger expenses_block_viewer_insert_trg
  before insert on public.expenses
  for each row
  execute function public.expenses_block_viewer_insert();
