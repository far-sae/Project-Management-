-- Put one workspace into another, then remove it.
--
-- For an organisation that still has the old "General" workspace next to the
-- workspace it really uses: everything in the first is moved into the second
-- (projects, leads, companies, deals, follow-ups, emails, people, ...), and the
-- first is then removed.
--
-- It is all or nothing. The whole merge runs as one step: when any part of it
-- cannot be done, an error says why and NOTHING is changed. Nothing is ever
-- deleted to make room, with these exceptions, which hold no records of work:
--   * a tag or a deal stage with the same name in both workspaces becomes one
--     (the leads and deals that used the first now use the second);
--   * settings that exist once for each workspace keep the target's own.
-- Agreements and invoices are legal records with their own numbering. A
-- workspace that holds any is not merged: the function refuses.
--
-- Only the organisation's owner and admins may run it.
-- Safe to run more than once.

set search_path = public;

create or replace function public.merge_workspace(p_from uuid, p_into uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_org_into uuid;
  v_from_name text;
  v_from_default boolean;
  v_suffix text;
  v_table text;
  v_tables text[];
  v_pending text[];
  v_next text[];
  v_progress boolean;
  v_last_error text;
  v_count bigint;
  v_moved bigint := 0;
  v_only_key boolean;
  v_what text;
  v_came_stages uuid[] := '{}';
  v_renamed_tags uuid[] := '{}';
  r record;
  v_target uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'Choose two different workspaces.' using errcode = 'P0001';
  end if;

  -- Both rows are held until the merge is over, so nothing else changes them half-way.
  select organization_id, name, coalesce(is_default, false)
    into v_org, v_from_name, v_from_default
    from public.workspaces where workspace_id = p_from for update;
  if not found then
    raise exception 'That workspace no longer exists.' using errcode = 'P0002';
  end if;
  select organization_id into v_org_into
    from public.workspaces where workspace_id = p_into for update;
  if not found then
    raise exception 'The workspace to move into no longer exists.' using errcode = 'P0002';
  end if;
  if v_org is distinct from v_org_into then
    raise exception 'Both workspaces must belong to the same organisation.' using errcode = 'P0001';
  end if;
  if not public.is_org_admin_or_owner(v_org) then
    raise exception 'Only the owner and admins can merge workspaces.' using errcode = '42501';
  end if;

  v_suffix := ' (' || coalesce(nullif(btrim(v_from_name), ''), 'merged') || ')';

  -- ── Agreements and invoices stay where they are ───────────────────────────
  -- The documents area keeps its records by workspace in tables of its own.
  -- They are not moved, so a workspace that holds any is not merged.
  foreach v_table in array array['sr_invoices', 'sr_agreements', 'sr_projects', 'sr_agreement_templates'] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_from;
      if v_count > 0 then
        raise exception 'This workspace has agreements, invoices or billing plans. They are legal records and keep their own numbers, so the workspace cannot be put into another one.'
          using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- ── The tables to move: every table that says which workspace a row is in ─
  select coalesce(array_agg(c.table_name::text order by c.table_name::text), '{}')
    into v_tables
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'workspace_id' and c.udt_name = 'uuid'
     and t.table_type = 'BASE TABLE'
     and c.table_name <> 'workspaces'
     and c.table_name not like 'sr\_%' escape '\';

  -- ── Names that must be different within one workspace ─────────────────────
  -- A row of the first workspace whose name the second already uses gets the
  -- first workspace's name in brackets, so both can live side by side. Tags
  -- are made one again further down; the others keep the brackets, so nothing
  -- is lost and a person can tidy them later.
  if to_regclass('public.crm_tags') is not null then
    with clash as (
      update public.crm_tags a set name = a.name || v_suffix
       where a.workspace_id = p_from
         and exists (select 1 from public.crm_tags b where b.workspace_id = p_into and lower(b.name) = lower(a.name))
      returning a.id
    ) select coalesce(array_agg(id), '{}') into v_renamed_tags from clash;
  end if;
  if to_regclass('public.client_categories') is not null then
    update public.client_categories a set name = a.name || v_suffix
     where a.workspace_id = p_from
       and exists (select 1 from public.client_categories b where b.workspace_id = p_into and lower(b.name) = lower(a.name));
  end if;
  if to_regclass('public.crm_field_defs') is not null then
    update public.crm_field_defs a set name = a.name || v_suffix
     where a.workspace_id = p_from
       and exists (select 1 from public.crm_field_defs b where b.workspace_id = p_into and lower(btrim(b.name)) = lower(btrim(a.name)));
  end if;
  if to_regclass('public.crm_saved_views') is not null then
    update public.crm_saved_views a set name = a.name || v_suffix
     where a.workspace_id = p_from
       and exists (select 1 from public.crm_saved_views b where b.workspace_id = p_into and lower(btrim(b.name)) = lower(btrim(a.name)));
  end if;
  if to_regclass('public.auto_automations') is not null then
    update public.auto_automations a set name = a.name || v_suffix
     where a.workspace_id = p_from
       and exists (select 1 from public.auto_automations b where b.workspace_id = p_into and lower(b.name) = lower(a.name));
  end if;
  -- A workspace has one agent of each ready-made kind. One that comes over
  -- while the target has its own of that kind is kept as an agent of its own.
  if to_regclass('public.auto_agents') is not null then
    update public.auto_agents a set kind = 'custom'
     where a.workspace_id = p_from and a.kind <> 'custom'
       and exists (select 1 from public.auto_agents b where b.workspace_id = p_into and b.kind = a.kind);
  end if;

  -- The deal stages that come over, to make same-named ones one again afterwards.
  if to_regclass('public.crm_deal_stages') is not null then
    select coalesce(array_agg(id), '{}') into v_came_stages from public.crm_deal_stages where workspace_id = p_from;
    -- They go after the target's own stages, in the order they had.
    update public.crm_deal_stages s
       set sort_order = s.sort_order + 1 + coalesce((select max(sort_order) from public.crm_deal_stages where workspace_id = p_into), 0)
     where s.workspace_id = p_from;
  end if;

  -- ── Move ──────────────────────────────────────────────────────────────────
  -- Some tables check that a row and what it belongs to are in the same
  -- workspace (a deal and its company, a follow-up and its lead). Such a table
  -- can only move after the other one has. So: try every table; the ones that
  -- are refused are tried again in the next round, until all have moved or a
  -- round moves none.
  v_pending := v_tables;
  loop
    exit when coalesce(array_length(v_pending, 1), 0) = 0;
    v_next := '{}';
    v_progress := false;
    foreach v_table in array v_pending loop
      begin
        -- A table with one row for each workspace holds that workspace's settings: the target keeps its own.
        select count(*) = 1 and bool_and(a.attname = 'workspace_id') into v_only_key
          from pg_index i
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
         where i.indrelid = format('public.%I', v_table)::regclass and i.indisprimary;
        if coalesce(v_only_key, false) then
          execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_into;
          if v_count > 0 then
            execute format('delete from public.%I where workspace_id = $1', v_table) using p_from;
          else
            execute format('update public.%I set workspace_id = $1 where workspace_id = $2', v_table) using p_into, p_from;
          end if;
        else
          execute format('update public.%I set workspace_id = $1 where workspace_id = $2', v_table) using p_into, p_from;
          get diagnostics v_count = row_count;
          v_moved := v_moved + v_count;
        end if;
        v_progress := true;
      exception
        when unique_violation then
          -- The same thing exists in both workspaces. Nothing is thrown away to make room: stop, and say what.
          v_what := case v_table
            when 'social_accounts' then 'social account'
            when 'crm_tags' then 'tag'
            when 'crm_field_defs' then 'custom field'
            when 'crm_saved_views' then 'saved view'
            when 'client_categories' then 'category'
            when 'auto_automations' then 'automation'
            when 'auto_agents' then 'agent'
            else 'record' end;
          raise exception 'Both workspaces have the same % (in %). Remove or rename it in one of them, then merge again. Nothing was changed.', v_what, replace(v_table, '_', ' ')
            using errcode = 'P0001';
        when others then
          v_next := v_next || v_table;
          v_last_error := v_table || ': ' || sqlerrm;
      end;
    end loop;
    if coalesce(array_length(v_next, 1), 0) > 0 and not v_progress then
      raise exception 'This workspace could not be merged. Nothing was changed.'
        using errcode = 'P0001', detail = coalesce(v_last_error, '');
    end if;
    v_pending := v_next;
  end loop;

  -- ── Same-named tags and deal stages become one ────────────────────────────
  -- Everything is in the target workspace now, so a lead or a deal can be
  -- pointed at the target's own tag or stage.
  if to_regclass('public.crm_tags') is not null and to_regclass('public.crm_contact_tags') is not null then
    for r in select id, name from public.crm_tags where id = any (v_renamed_tags) loop
      select t.id into v_target from public.crm_tags t
       where t.workspace_id = p_into and t.id <> r.id
         and lower(t.name) = lower(left(r.name, length(r.name) - length(v_suffix)))
       limit 1;
      if v_target is not null then
        insert into public.crm_contact_tags (contact_id, tag_id)
          select contact_id, v_target from public.crm_contact_tags where tag_id = r.id
          on conflict do nothing;
        delete from public.crm_tags where id = r.id;
      end if;
    end loop;
  end if;

  if to_regclass('public.crm_deal_stages') is not null and coalesce(array_length(v_came_stages, 1), 0) > 0 then
    -- A deal goes to the stage of the same name. That is not a move through
    -- the pipeline, so the rules that run "when a deal reaches a stage" and the
    -- change log are switched off for these few statements, and on again after.
    -- (If anything fails, the whole merge is undone, this included.)
    execute 'alter table public.crm_deals disable trigger user';
    for r in select id, name, status from public.crm_deal_stages where id = any (v_came_stages) loop
      select s.id into v_target from public.crm_deal_stages s
       where s.workspace_id = p_into and not (s.id = any (v_came_stages))
         and lower(btrim(s.name)) = lower(btrim(r.name)) and s.status = r.status
       order by s.sort_order limit 1;
      if v_target is not null then
        update public.crm_deals set stage_id = v_target where stage_id = r.id;
        if to_regclass('public.crm_rules') is not null then
          update public.crm_rules set stage_id = v_target where stage_id = r.id;
        end if;
        delete from public.crm_deal_stages where id = r.id;
      end if;
    end loop;
    execute 'alter table public.crm_deals enable trigger user';
  end if;

  -- ── Nothing may be left behind ────────────────────────────────────────────
  -- Removing the workspace removes whatever still points at it. So it is only
  -- removed when nothing does.
  foreach v_table in array v_tables loop
    execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_from;
    if v_count > 0 then
      raise exception 'This workspace could not be merged. Nothing was changed.'
        using errcode = 'P0001', detail = v_table || ' still has rows';
    end if;
  end loop;

  -- The organisation's main workspace is the one every plan includes: the target takes that over.
  if v_from_default then
    update public.workspaces set is_default = false where workspace_id = p_from;
    update public.workspaces set is_default = true, updated_at = now() where workspace_id = p_into;
  end if;
  delete from public.workspaces where workspace_id = p_from;

  return jsonb_build_object('moved', v_moved, 'from', v_from_name);
end;
$$;

revoke all on function public.merge_workspace(uuid, uuid) from public;
grant execute on function public.merge_workspace(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
