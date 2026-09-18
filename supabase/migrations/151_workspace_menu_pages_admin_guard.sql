-- 151_workspace_menu_pages_admin_guard.sql
--
-- Server-side gate for the per-workspace Quick Menu (migration 150).
--
-- The Dashboard only shows "Edit workspace → Quick Menu" to the org owner and
-- admins, but `workspaces` has no RLS policies, so any member could PATCH
-- /rest/v1/workspaces?workspace_id=eq.<id> with a `menu_pages` body and change
-- what every teammate in that workspace sees in the sidebar.
--
-- Migration 042 (amended by 140) already guards INSERT/DELETE on `workspaces`
-- via workspaces_enforce_admin_create_delete. That trigger is left untouched;
-- this adds a second, narrower trigger for UPDATEs that touch `menu_pages`,
-- using the same helper (`is_org_admin_or_owner(uuid)` from migration 036) and
-- the same bypasses (no org id, no auth context = service role / migrations).
--
-- Other columns (name, is_default, …) keep their current behaviour.

create or replace function public.workspaces_enforce_menu_pages_admin()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_org uuid;
begin
  -- `before update of menu_pages` fires whenever the column is in the SET
  -- list, even when the value is unchanged — that isn't a menu change.
  if new.menu_pages is not distinct from old.menu_pages then
    return new;
  end if;

  v_org := old.organization_id;

  -- No org id (legacy / local-only rows) — let it through, as the
  -- create/delete trigger does.
  if v_org is null then
    return new;
  end if;

  -- No auth context (service role, migrations, seed scripts). Real client
  -- calls always carry auth.uid().
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_org_admin_or_owner(v_org) then
    raise exception
      'Only the organization owner or an admin can change a workspace Quick Menu.'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

drop trigger if exists workspaces_enforce_menu_pages_admin_trg on public.workspaces;
create trigger workspaces_enforce_menu_pages_admin_trg
  before update of menu_pages on public.workspaces
  for each row
  execute function public.workspaces_enforce_menu_pages_admin();

notify pgrst, 'reload schema';
