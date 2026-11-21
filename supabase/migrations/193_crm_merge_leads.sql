-- ============================================================================
-- 193: Merging two leads that are the same person.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor; until
-- then "Merge" in the Duplicates window says
-- "run supabase/migrations/193_crm_merge_leads.sql".
--
-- What it adds, in plain words:
--   * One function, crm_merge_contacts(keep, drop). It makes one lead out of
--     two: everything that belonged to the lead being dropped (its deals,
--     follow-ups, notes, timeline, calls, emails, tags, automation runs and
--     anything else that points at a lead) is moved to the lead being kept,
--     the kept lead's empty fields are filled from the other one, one line
--     "Merged with ..." is written on its timeline, and the other lead is
--     deleted. It all happens together or not at all.
--   * No new table and no new column.
--
-- Who may use it: a person who can change that workspace's CRM (the same rule
-- as editing a lead; viewers cannot). Both leads must be in the same
-- workspace.
--
-- It finds the tables to move by asking the database which ones point at a
-- lead, so tables added later (calls, emails, web forms) are covered without
-- changing this file.
-- ============================================================================

create or replace function public.crm_merge_contacts(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k public.crm_contacts%rowtype;
  d public.crm_contacts%rowtype;
  r record;
  v_name text;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'Choose two different leads to merge.' using errcode = '22023';
  end if;

  -- Locked in id order, so two people merging the same pair the other way round cannot block each other for ever.
  perform 1 from public.crm_contacts where id in (p_keep, p_drop) order by id for update;
  select * into k from public.crm_contacts where id = p_keep;
  select * into d from public.crm_contacts where id = p_drop;
  if k.id is null or d.id is null then
    raise exception 'One of the leads no longer exists.' using errcode = 'P0002';
  end if;
  if k.organization_id <> d.organization_id or k.workspace_id is distinct from d.workspace_id then
    raise exception 'Both leads must be in the same workspace.' using errcode = '22023';
  end if;
  if not public.can_access_crm_scope(k.organization_id, k.workspace_id) or public.is_org_viewer(k.organization_id) then
    raise exception 'You may not change leads in this workspace.' using errcode = '42501';
  end if;

  -- The tags of both, without doubles.
  insert into public.crm_contact_tags (contact_id, tag_id)
  select p_keep, t.tag_id from public.crm_contact_tags t where t.contact_id = p_drop
  on conflict do nothing;
  delete from public.crm_contact_tags where contact_id = p_drop;

  -- Everything else that points at the lead being dropped now points at the one kept.
  for r in
    select c.relname as table_name, a.attname as column_name
    from pg_constraint f
    join pg_class c on c.oid = f.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = f.conrelid and a.attnum = f.conkey[1]
    where f.contype = 'f'
      and f.confrelid = 'public.crm_contacts'::regclass
      and array_length(f.conkey, 1) = 1
      and n.nspname = 'public'
      and c.relname <> 'crm_contact_tags'
  loop
    begin
      execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name)
        using p_keep, p_drop;
    exception
      -- The kept lead already has the same row there (one row per lead is allowed): the other one goes with the dropped lead.
      when unique_violation then
        null;
    end;
  end loop;

  -- What the kept lead does not know yet, it learns from the other one. What it knows, it keeps.
  update public.crm_contacts set
    last_name = coalesce(nullif(btrim(last_name), ''), d.last_name),
    email = coalesce(nullif(btrim(email), ''), d.email),
    phone = coalesce(nullif(btrim(phone), ''), d.phone),
    job_title = coalesce(nullif(btrim(job_title), ''), d.job_title),
    company_id = coalesce(company_id, d.company_id),
    owner_id = coalesce(owner_id, d.owner_id),
    source = coalesce(nullif(btrim(source), ''), d.source),
    notes = case
      when nullif(btrim(coalesce(d.notes, '')), '') is null then notes
      when nullif(btrim(coalesce(notes, '')), '') is null then d.notes
      when notes = d.notes then notes
      else notes || E'\n\n' || d.notes
    end,
    last_contacted_at = greatest(last_contacted_at, d.last_contacted_at)
  where id = p_keep;

  -- Columns that later migrations added: only where this database has them.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_contacts' and column_name = 'custom_fields') then
    execute 'update public.crm_contacts k set custom_fields = coalesce(o.custom_fields, ''{}''::jsonb) || coalesce(k.custom_fields, ''{}''::jsonb) from public.crm_contacts o where k.id = $1 and o.id = $2'
      using p_keep, p_drop;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_contacts' and column_name = 'category') then
    execute 'update public.crm_contacts k set category = coalesce(nullif(btrim(k.category), ''''), o.category) from public.crm_contacts o where k.id = $1 and o.id = $2'
      using p_keep, p_drop;
  end if;

  v_name := btrim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, ''));
  insert into public.crm_activities (organization_id, workspace_id, user_id, type, description, contact_id, metadata)
  values (
    k.organization_id, k.workspace_id, auth.uid(), 'note',
    'Merged with ' || coalesce(nullif(v_name, ''), 'another lead') || coalesce(' (' || nullif(btrim(d.email), '') || ')', '') || '. Its deals, follow-ups and history are now here.',
    p_keep,
    jsonb_build_object('automation', 'true', 'source', 'merge', 'mergedContactId', p_drop::text)
  );

  delete from public.crm_contacts where id = p_drop;
end;
$$;

revoke all on function public.crm_merge_contacts(uuid, uuid) from public, anon;
grant execute on function public.crm_merge_contacts(uuid, uuid) to authenticated, service_role;
