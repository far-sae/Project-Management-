-- _manual_test_crm_grants.sql  — run by hand against a Supabase DB (psql).
-- NOT a real migration (leading underscore → not auto-applied). Verifies
-- has_module_access() after applying 124 + 125. Replace the three UUIDs with a
-- real org id, an owner/admin user id, and a plain member user id from that org.
\set ORG    '00000000-0000-0000-0000-000000000000'
\set ADMIN  '00000000-0000-0000-0000-000000000000'
\set MEMBER '00000000-0000-0000-0000-000000000000'

-- owner/admin bypass: true regardless of grants
select 'admin view' as case, public.has_module_access(:'ADMIN', :'ORG', 'deals', false) as got, true as want;
select 'admin edit' as case, public.has_module_access(:'ADMIN', :'ORG', 'deals', true)  as got, true as want;

-- member with no grant: false
delete from public.crm_module_grants where organization_id = :'ORG' and user_id = :'MEMBER';
select 'member none view' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', false) as got, false as want;
select 'member none edit' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', true)  as got, false as want;

-- member with view grant: view true, edit false
insert into public.crm_module_grants(organization_id,user_id,module,level)
  values (:'ORG', :'MEMBER', 'deals', 'view')
  on conflict (organization_id,user_id,module) do update set level='view';
select 'member view->view' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', false) as got, true  as want;
select 'member view->edit' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', true)  as got, false as want;

-- member with edit grant: both true
update public.crm_module_grants set level='edit'
  where organization_id = :'ORG' and user_id = :'MEMBER' and module='deals';
select 'member edit->view' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', false) as got, true as want;
select 'member edit->edit' as case, public.has_module_access(:'MEMBER', :'ORG', 'deals', true)  as got, true as want;

-- cleanup
delete from public.crm_module_grants where organization_id = :'ORG' and user_id = :'MEMBER';
