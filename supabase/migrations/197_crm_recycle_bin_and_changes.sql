-- CRM: a recycle bin and a change log.
--
-- 1. Recycle bin. A deleted lead, company or deal was gone for good, with its
--    notes and timeline. A copy is now kept for 30 days in public.crm_trash,
--    with the notes, timeline entries and tags that went with it, and
--    public.crm_restore(id) puts it all back.
--
-- 2. Change log. Nothing recorded who changed what. Every change to a lead, a
--    company or a deal now writes one row in public.crm_changes: which fields,
--    from what, to what, by whom. Kept for 180 days.
--
-- Both are read by the organisation's owner and admins only. Neither can stop
-- a delete or a change: if keeping the copy or the log line fails, the delete
-- or the change still happens.
--
-- An erased person (public.crm_erase_person, migration 195) is never kept:
-- that function says so and the bin steps aside.
--
-- Safe to run more than once.

-- ── 1. Recycle bin ──────────────────────────────────────────────────────────

-- No foreign key to the organisation on purpose: when a whole organisation is
-- deleted its leads go with it, and a copy pointing at a row that is being
-- removed would stop that delete.
create table if not exists public.crm_trash (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid,
  kind text not null check (kind in ('lead', 'company', 'deal')),
  record_id uuid not null,
  name text not null default '',
  record jsonb not null,
  children jsonb not null default '{}'::jsonb,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);

create index if not exists idx_crm_trash_org on public.crm_trash (organization_id, deleted_at desc);
create index if not exists idx_crm_trash_age on public.crm_trash (deleted_at);

alter table public.crm_trash enable row level security;
revoke all on public.crm_trash from anon, authenticated;
grant select on public.crm_trash to authenticated;
grant all on public.crm_trash to service_role;

drop policy if exists "crm_trash_read" on public.crm_trash;
create policy "crm_trash_read" on public.crm_trash
  for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.crm_keep_deleted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  j jsonb := to_jsonb(old);
  v_kind text;
  v_column text;
  v_children jsonb := '{}'::jsonb;
begin
  begin
    -- An erased person leaves no copy behind.
    if current_setting('crm.skip_trash', true) = 'on' then
      return old;
    end if;
    -- The organisation itself is being deleted: there is nobody to keep it for.
    if not exists (select 1 from public.organizations o where o.organization_id = (j->>'organization_id')::uuid) then
      return old;
    end if;

    if tg_table_name = 'crm_contacts' then
      v_kind := 'lead';
      v_column := 'contact_id';
    elsif tg_table_name = 'crm_companies' then
      v_kind := 'company';
      v_column := 'company_id';
    else
      v_kind := 'deal';
      v_column := 'deal_id';
    end if;

    -- What the database removes together with it, so it can come back too.
    execute format(
      'select jsonb_build_object(
         ''activities'', coalesce((select jsonb_agg(to_jsonb(a)) from public.crm_activities a where a.%1$I = $1), ''[]''::jsonb),
         ''notes'', coalesce((select jsonb_agg(to_jsonb(n)) from public.crm_notes n where n.%1$I = $1), ''[]''::jsonb))',
      v_column)
      into v_children using (j->>'id')::uuid;
    if v_kind = 'lead' then
      v_children := v_children || jsonb_build_object(
        'tags', coalesce((select jsonb_agg(to_jsonb(t)) from public.crm_contact_tags t where t.contact_id = (j->>'id')::uuid), '[]'::jsonb));
    end if;

    insert into public.crm_trash (organization_id, workspace_id, kind, record_id, name, record, children, deleted_by)
    values (
      (j->>'organization_id')::uuid,
      (j->>'workspace_id')::uuid,
      v_kind,
      (j->>'id')::uuid,
      coalesce(
        nullif(btrim(coalesce(j->>'first_name', '') || ' ' || coalesce(j->>'last_name', '')), ''),
        nullif(btrim(coalesce(j->>'name', '')), ''),
        'No name'),
      j,
      v_children,
      auth.uid());

    delete from public.crm_trash where deleted_at < now() - interval '30 days';
  exception when others then
    -- Keeping a copy must never be the reason a delete fails.
    null;
  end;
  return old;
end;
$$;

revoke all on function public.crm_keep_deleted() from public, anon, authenticated;

drop trigger if exists trg_crm_contacts_keep_deleted on public.crm_contacts;
create trigger trg_crm_contacts_keep_deleted
  before delete on public.crm_contacts
  for each row execute function public.crm_keep_deleted();

drop trigger if exists trg_crm_companies_keep_deleted on public.crm_companies;
create trigger trg_crm_companies_keep_deleted
  before delete on public.crm_companies
  for each row execute function public.crm_keep_deleted();

drop trigger if exists trg_crm_deals_keep_deleted on public.crm_deals;
create trigger trg_crm_deals_keep_deleted
  before delete on public.crm_deals
  for each row execute function public.crm_keep_deleted();

-- Puts one thing from the bin back, with its notes, timeline and tags.
-- Returns the id of the restored lead, company or deal.
create or replace function public.crm_restore(p_trash uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  t public.crm_trash%rowtype;
  r jsonb;
  v_stage uuid;
  child jsonb;
begin
  if p_trash is null then
    raise exception 'Choose what to restore.' using errcode = '22023';
  end if;

  select * into t from public.crm_trash where id = p_trash for update;
  if not found then
    raise exception 'This is no longer in the recycle bin.' using errcode = 'P0002';
  end if;
  if not public.is_org_admin_or_owner(t.organization_id) then
    raise exception 'Only the owner and admins can restore.' using errcode = '42501';
  end if;

  r := t.record;

  -- What it was linked to may have been deleted since. Those links are dropped; the record still comes back.
  if r->>'workspace_id' is not null and not exists (select 1 from public.workspaces w where w.workspace_id = (r->>'workspace_id')::uuid) then
    raise exception 'The workspace this belonged to was deleted, so it cannot be restored.' using errcode = '23503';
  end if;
  if r->>'company_id' is not null and not exists (select 1 from public.crm_companies x where x.id = (r->>'company_id')::uuid) then
    r := r || jsonb_build_object('company_id', null);
  end if;
  if r->>'contact_id' is not null and not exists (select 1 from public.crm_contacts x where x.id = (r->>'contact_id')::uuid) then
    r := r || jsonb_build_object('contact_id', null);
  end if;
  if r->>'owner_id' is not null and not exists (select 1 from auth.users u where u.id = (r->>'owner_id')::uuid) then
    r := r || jsonb_build_object('owner_id', null);
  end if;
  if r->>'project_id' is not null and not exists (select 1 from public.projects p where p.project_id = (r->>'project_id')::uuid) then
    r := r || jsonb_build_object('project_id', null);
  end if;
  if t.kind = 'deal' and not exists (select 1 from public.crm_deal_stages s where s.id = (r->>'stage_id')::uuid) then
    -- Its stage was deleted: it comes back in the first stage of its pipeline.
    select s.id into v_stage
      from public.crm_deal_stages s
     where s.organization_id = t.organization_id and s.workspace_id is not distinct from t.workspace_id
     order by s.sort_order
     limit 1;
    if v_stage is null then
      raise exception 'Add a pipeline stage first, then restore this deal.' using errcode = '23503';
    end if;
    r := r || jsonb_build_object('stage_id', v_stage);
  end if;

  begin
    if t.kind = 'lead' then
      insert into public.crm_contacts select * from jsonb_populate_record(null::public.crm_contacts, r);
    elsif t.kind = 'company' then
      insert into public.crm_companies select * from jsonb_populate_record(null::public.crm_companies, r);
    else
      insert into public.crm_deals select * from jsonb_populate_record(null::public.crm_deals, r);
    end if;
  exception
    when unique_violation then
      raise exception 'This is already back in the CRM.' using errcode = '23505';
    when foreign_key_violation then
      raise exception 'It cannot be restored because something it was linked to was deleted too.' using errcode = '23503';
    when not_null_violation then
      raise exception 'It cannot be restored: the CRM has changed since it was deleted.' using errcode = '23502';
  end;

  -- Its timeline, notes and tags, one at a time: one that no longer fits is left out, the rest come back.
  for child in select * from jsonb_array_elements(coalesce(t.children->'activities', '[]'::jsonb)) loop
    begin
      insert into public.crm_activities select * from jsonb_populate_record(null::public.crm_activities, child) on conflict (id) do nothing;
    exception when others then
      null;
    end;
  end loop;
  for child in select * from jsonb_array_elements(coalesce(t.children->'notes', '[]'::jsonb)) loop
    begin
      insert into public.crm_notes select * from jsonb_populate_record(null::public.crm_notes, child) on conflict (id) do nothing;
    exception when others then
      null;
    end;
  end loop;
  for child in select * from jsonb_array_elements(coalesce(t.children->'tags', '[]'::jsonb)) loop
    begin
      insert into public.crm_contact_tags select * from jsonb_populate_record(null::public.crm_contact_tags, child) on conflict do nothing;
    exception when others then
      null;
    end;
  end loop;

  -- Putting old things back is not news: the automation must not treat a restored
  -- lead as a new one, or an old call as a fresh reply. Everything this step
  -- wrote for the automation is marked as already dealt with.
  begin
    if to_regclass('public.auto_events') is not null then
      execute 'update public.auto_events set own = true, processed_at = now()
                where processed_at is null and created_at = now() and workspace_id is not distinct from $1'
        using t.workspace_id;
    end if;
  exception when others then
    null;
  end;

  delete from public.crm_trash where id = p_trash;
  return t.record_id;
end;
$$;

revoke all on function public.crm_restore(uuid) from public, anon;
grant execute on function public.crm_restore(uuid) to authenticated, service_role;

-- ── 2. Change log ───────────────────────────────────────────────────────────

create table if not exists public.crm_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid,
  kind text not null check (kind in ('lead', 'company', 'deal')),
  record_id uuid not null,
  name text not null default '',
  changes jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists idx_crm_changes_org on public.crm_changes (organization_id, changed_at desc);
create index if not exists idx_crm_changes_record on public.crm_changes (record_id, changed_at desc);

alter table public.crm_changes enable row level security;
revoke all on public.crm_changes from anon, authenticated;
grant select on public.crm_changes to authenticated;
grant all on public.crm_changes to service_role;

drop policy if exists "crm_changes_read" on public.crm_changes;
create policy "crm_changes_read" on public.crm_changes
  for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.crm_log_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  j jsonb := to_jsonb(new);
  v_changes jsonb;
begin
  begin
    -- The fields that are different, without the ones that change by themselves.
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
      into v_changes
      from jsonb_each(j) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value
       and n.key not in ('updated_at', 'last_contacted_at', 'sort_order');
    if v_changes is null then
      return new;
    end if;

    insert into public.crm_changes (organization_id, workspace_id, kind, record_id, name, changes, changed_by)
    values (
      (j->>'organization_id')::uuid,
      (j->>'workspace_id')::uuid,
      case tg_table_name when 'crm_contacts' then 'lead' when 'crm_companies' then 'company' else 'deal' end,
      (j->>'id')::uuid,
      coalesce(
        nullif(btrim(coalesce(j->>'first_name', '') || ' ' || coalesce(j->>'last_name', '')), ''),
        nullif(btrim(coalesce(j->>'name', '')), ''),
        'No name'),
      v_changes,
      auth.uid());

    -- Old lines are cleared now and then, not on every change.
    if random() < 0.01 then
      delete from public.crm_changes where changed_at < now() - interval '180 days';
    end if;
  exception when others then
    -- Writing the log must never be the reason a change fails.
    null;
  end;
  return new;
end;
$$;

revoke all on function public.crm_log_change() from public, anon, authenticated;

drop trigger if exists trg_crm_contacts_log_change on public.crm_contacts;
create trigger trg_crm_contacts_log_change
  after update on public.crm_contacts
  for each row execute function public.crm_log_change();

drop trigger if exists trg_crm_companies_log_change on public.crm_companies;
create trigger trg_crm_companies_log_change
  after update on public.crm_companies
  for each row execute function public.crm_log_change();

drop trigger if exists trg_crm_deals_log_change on public.crm_deals;
create trigger trg_crm_deals_log_change
  after update on public.crm_deals
  for each row execute function public.crm_log_change();

-- Tell the API about the new tables and the function straight away.
notify pgrst, 'reload schema';
