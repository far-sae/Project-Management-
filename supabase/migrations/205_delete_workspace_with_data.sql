-- Delete a workspace together with everything in it.
--
-- For an organisation that wants an old workspace (the ready-made "General")
-- gone, with what is inside it: its projects and their tasks, leads, companies,
-- deals, follow-ups, emails, social posts and everything else that belongs to
-- that workspace. To KEEP the data and only lose the workspace, use
-- merge_workspace (204) instead.
--
-- Two steps, so nobody deletes by accident:
--   delete_workspace_with_data(workspace)                only counts: what would go
--   delete_workspace_with_data(workspace, true)          deletes it
--   delete_workspace_with_data(workspace, true, true)    deletes it, and its legal records too
--
-- Legal records are the documents of the workspace: invoices (with their
-- payments and receipts), agreements, billing plans and agreement templates.
-- The count names them apart ("documents"), and they are only deleted when the
-- third value is true: the owner has seen how many there are and said so. The
-- documents area itself only lets an agreement or a template go together with
-- its workspace, so this is the one way they can be removed.
--
-- It is all or nothing: when any part cannot be deleted, an error says so and
-- NOTHING is changed.
--
-- It refuses when:
--   * it is the organisation's only workspace (there must be one left);
--   * the workspace holds legal records and the third value is not true. The
--     message says how many of each there are;
--   * an agreement is out for signature right now, or is under a legal hold:
--     that is never deleted, whatever is asked;
--   * the workspace has recorded calls: the recordings are kept at the phone
--     provider, where the database cannot reach. Delete those calls on the
--     Calls page first, which removes the recordings too.
--
-- Only the organisation's owner may run it.
-- Safe to run more than once.

set search_path = public;

drop function if exists public.delete_workspace_with_data(uuid, boolean);

create or replace function public.delete_workspace_with_data(p_workspace uuid, p_confirm boolean default false, p_documents boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_name text;
  v_default boolean;
  v_other uuid;
  v_table text;
  v_tables text[];
  v_pending text[];
  v_next text[];
  v_progress boolean;
  v_last_error text;
  v_count bigint;
  v_counts jsonb := '{}'::jsonb;
  v_has_tasks boolean;
  v_documents text;
  v_docs jsonb := '{}'::jsonb;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;
  if p_workspace is null then
    raise exception 'Choose a workspace.' using errcode = 'P0001';
  end if;

  -- The row is held until this is over, so nothing else changes it half-way.
  select organization_id, name, coalesce(is_default, false)
    into v_org, v_name, v_default
    from public.workspaces where workspace_id = p_workspace for update;
  if not found then
    raise exception 'That workspace no longer exists.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.organizations o where o.organization_id = v_org and o.owner_id = v_uid) then
    raise exception 'Only the owner can delete a workspace with everything in it.' using errcode = '42501';
  end if;

  -- One workspace must be left. When the main one goes, the oldest other becomes the main one.
  select w.workspace_id into v_other
    from public.workspaces w
   where w.organization_id = v_org and w.workspace_id <> p_workspace
   order by w.created_at, w.workspace_id
   limit 1;
  if v_other is null then
    raise exception 'This is your only workspace. Make another one first, then delete this one.' using errcode = 'P0001';
  end if;

  -- ── Legal records ─────────────────────────────────────────────────────────
  -- Counted apart from everything else, and named in plain words.
  v_documents := '';
  foreach v_table in array array['sr_invoices', 'sr_agreements', 'sr_projects', 'sr_agreement_templates'] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_workspace;
      if v_count > 0 then
        v_docs := v_docs || jsonb_build_object(
          case v_table when 'sr_invoices' then 'invoices' when 'sr_agreements' then 'agreements' when 'sr_projects' then 'billing_plans' else 'agreement_templates' end,
          v_count);
        v_documents := v_documents || case when v_documents = '' then '' else ', ' end || v_count::text || ' ' || case v_table
          when 'sr_invoices' then case when v_count = 1 then 'invoice' else 'invoices' end
          when 'sr_agreements' then case when v_count = 1 then 'agreement' else 'agreements' end
          when 'sr_projects' then case when v_count = 1 then 'billing plan' else 'billing plans' end
          else case when v_count = 1 then 'agreement template' else 'agreement templates' end end;
      end if;
    end if;
  end loop;

  -- Never deleted, whatever is asked: an agreement people are signing right now, and one under a legal hold.
  if to_regclass('public.sr_agreements') is not null then
    select count(*) into v_count from public.sr_agreements where workspace_id = p_workspace and status in ('Awaiting signatures', 'Finalising');
    if v_count > 0 then
      raise exception 'An agreement of this workspace is out for signature right now. Cancel it or let it finish first, then delete the workspace.'
        using errcode = 'P0001';
    end if;
    select count(*) into v_count from public.sr_agreements where workspace_id = p_workspace and legal_hold;
    if v_count > 0 then
      raise exception 'An agreement of this workspace is under a legal hold. Release the hold first, then delete the workspace.'
        using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.crm_calls') is not null then
    select count(*) into v_count from public.crm_calls where workspace_id = p_workspace and recording_sid is not null;
    if v_count > 0 then
      raise exception 'This workspace has recorded calls. Delete those calls on the Calls page first (that removes the recordings too), then delete the workspace.'
        using errcode = 'P0001';
    end if;
  end if;

  -- ── Every table that says which workspace a row is in ─────────────────────
  select coalesce(array_agg(c.table_name::text order by c.table_name::text), '{}')
    into v_tables
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and c.column_name = 'workspace_id' and c.udt_name = 'uuid'
     and t.table_type = 'BASE TABLE'
     and c.table_name <> 'workspaces'
     and c.table_name not like 'sr\_%' escape '\';

  -- ── Count ─────────────────────────────────────────────────────────────────
  foreach v_table in array v_tables loop
    execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_workspace;
    if v_count > 0 then
      v_counts := v_counts || jsonb_build_object(v_table, v_count);
    end if;
  end loop;

  -- Tasks belong to a project, not to a workspace: they go with their project.
  v_has_tasks := to_regclass('public.tasks') is not null and to_regclass('public.projects') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'project_id');
  if v_has_tasks then
    execute 'select count(*) from public.tasks t where t.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1)'
      into v_count using p_workspace;
    if v_count > 0 then
      v_counts := v_counts || jsonb_build_object('tasks', v_count);
    end if;
  end if;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object('deleted', false, 'name', v_name, 'counts', v_counts, 'documents', v_docs);
  end if;

  if v_documents <> '' and not coalesce(p_documents, false) then
    raise exception 'This workspace has legal records: %. They are only deleted when you say so: tick the box for them and try again.', v_documents
      using errcode = 'P0001';
  end if;

  -- ── Delete ────────────────────────────────────────────────────────────────
  -- Nothing of this workspace goes to the CRM's recycle bin (197): deleted here means no copy is kept.
  perform set_config('crm.skip_trash', 'on', true);

  -- The legal records, when the owner said so. The documents area lets an
  -- agreement or a template go only together with its workspace, so its own
  -- row for this workspace (same id) is removed: everything of it goes with
  -- that, and nothing of any other workspace.
  if v_documents <> '' and to_regclass('public.sr_workspaces') is not null then
    delete from public.sr_workspaces where id = p_workspace;
    foreach v_table in array array['sr_invoices', 'sr_agreements', 'sr_projects', 'sr_agreement_templates'] loop
      if to_regclass(format('public.%I', v_table)) is not null then
        execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_workspace;
        if v_count > 0 then
          raise exception 'This workspace could not be deleted. Nothing was changed.'
            using errcode = 'P0001', detail = v_table || ' still has rows';
        end if;
      end if;
    end loop;
  end if;

  -- The tasks of the workspace's projects, and what hangs on those tasks, the way the app removes a project.
  if v_has_tasks then
    if to_regclass('public.comments') is not null
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comments' and column_name = 'task_id') then
      execute 'delete from public.comments c where c.task_id::text in (select t.task_id::text from public.tasks t where t.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1))'
        using p_workspace;
    end if;
    if to_regclass('public.global_comments') is not null then
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'global_comments' and column_name = 'task_id') then
        execute 'delete from public.global_comments c where c.task_id::text in (select t.task_id::text from public.tasks t where t.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1))'
          using p_workspace;
      end if;
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'global_comments' and column_name = 'project_id') then
        execute 'delete from public.global_comments c where c.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1)'
          using p_workspace;
      end if;
    end if;
    execute 'delete from public.tasks t where t.project_id::text in (select p.project_id::text from public.projects p where p.workspace_id = $1)'
      using p_workspace;
  end if;

  -- Some rows can only go after the rows that point at them (a company after
  -- its leads). So: try every table; the ones that are refused are tried again
  -- in the next round, until all are empty or a round empties none.
  v_pending := v_tables;
  loop
    exit when coalesce(array_length(v_pending, 1), 0) = 0;
    v_next := '{}';
    v_progress := false;
    foreach v_table in array v_pending loop
      begin
        execute format('delete from public.%I where workspace_id = $1', v_table) using p_workspace;
        v_progress := true;
      exception when others then
        v_next := v_next || v_table;
        v_last_error := v_table || ': ' || sqlerrm;
      end;
    end loop;
    if coalesce(array_length(v_next, 1), 0) > 0 and not v_progress then
      raise exception 'This workspace could not be deleted. Nothing was changed.'
        using errcode = 'P0001', detail = coalesce(v_last_error, '');
    end if;
    v_pending := v_next;
  end loop;

  -- Deleting one thing can write another (a deleted deal leaves a line on a
  -- timeline). So sweep once more, then make sure nothing of it is left.
  foreach v_table in array v_tables loop
    execute format('delete from public.%I where workspace_id = $1', v_table) using p_workspace;
  end loop;
  foreach v_table in array v_tables loop
    execute format('select count(*) from public.%I where workspace_id = $1', v_table) into v_count using p_workspace;
    if v_count > 0 then
      raise exception 'This workspace could not be deleted. Nothing was changed.'
        using errcode = 'P0001', detail = v_table || ' still has rows';
    end if;
  end loop;

  -- The organisation's main workspace is the one every plan includes: another one takes that over.
  if v_default then
    update public.workspaces set is_default = false where workspace_id = p_workspace;
    update public.workspaces set is_default = true, updated_at = now() where workspace_id = v_other;
  end if;
  delete from public.workspaces where workspace_id = p_workspace;

  -- The documents area keeps a row of its own for each workspace (same id), with
  -- the customers and settings of that workspace. No invoice or agreement is
  -- left in it (see above), so it goes too. Never the reason the delete fails.
  if to_regclass('public.sr_workspaces') is not null then
    begin
      delete from public.sr_workspaces where id = p_workspace;
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object('deleted', true, 'name', v_name, 'counts', v_counts, 'documents', v_docs);
end;
$$;

revoke all on function public.delete_workspace_with_data(uuid, boolean, boolean) from public;
grant execute on function public.delete_workspace_with_data(uuid, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
