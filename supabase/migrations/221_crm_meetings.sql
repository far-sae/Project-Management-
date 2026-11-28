-- 221_crm_meetings.sql
-- Video meetings with a lead or a client.
--
-- Until now a meeting with a lead could only be written down after it had
-- happened ("Log meeting"). A call could be held in the app, but only inside
-- a project, and its guest link stopped working a day after it was made.
--
-- A meeting can now be planned from the lead's page: a day and a time, a
-- video room of its own, and a link the lead opens in a browser. The link can
-- be emailed to the lead from the app.
--
--   crm_meetings   one row for each planned meeting: who it is with, what it
--                  is about, when it starts and how long it is, the room it
--                  is held in, the link for the guest, and when the invite
--                  was emailed and to which address
--
-- Who can read it: the people who can use the CRM of that workspace. Who can
-- add and change one: the same people, except viewers. The link works only
-- until a day after the meeting starts; the call server decides who gets in.
--
-- Safe to run more than once.

set search_path = public;

create table if not exists public.crm_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  -- The lead it is with. Kept when the lead is deleted: the meeting still happened.
  contact_id uuid references public.crm_contacts(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  starts_at timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  -- The call room: crm:<workspace id>:<random id>. Made by the call server.
  room_name text not null check (room_name ~ '^crm:[A-Za-z0-9-]{1,64}:[A-Za-z0-9-]{1,64}$'),
  -- The link a guest opens.
  join_url text not null check (char_length(join_url) <= 5000),
  notes text check (notes is null or char_length(notes) <= 2000),
  invited_email text,
  invited_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_meetings_workspace on public.crm_meetings(workspace_id, starts_at desc);
create index if not exists idx_crm_meetings_contact on public.crm_meetings(contact_id) where contact_id is not null;

alter table public.crm_meetings enable row level security;
revoke all on public.crm_meetings from public, anon;
grant select, insert, update on public.crm_meetings to authenticated;
grant all on public.crm_meetings to service_role;

drop policy if exists crm_meetings_read on public.crm_meetings;
create policy crm_meetings_read on public.crm_meetings for select to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id));

-- A row must name a workspace of the same organisation, and a room of that workspace.
drop policy if exists crm_meetings_add on public.crm_meetings;
create policy crm_meetings_add on public.crm_meetings for insert to authenticated
  with check (
    public.can_access_crm_scope(organization_id, workspace_id)
    and not public.is_org_viewer(organization_id)
    and exists (select 1 from public.workspaces w where w.workspace_id = crm_meetings.workspace_id and w.organization_id = crm_meetings.organization_id)
    and room_name like 'crm:' || workspace_id::text || ':%'
  );

drop policy if exists crm_meetings_change on public.crm_meetings;
create policy crm_meetings_change on public.crm_meetings for update to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id))
  with check (
    public.can_access_crm_scope(organization_id, workspace_id)
    and not public.is_org_viewer(organization_id)
    and exists (select 1 from public.workspaces w where w.workspace_id = crm_meetings.workspace_id and w.organization_id = crm_meetings.organization_id)
    and room_name like 'crm:' || workspace_id::text || ':%'
  );

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';
