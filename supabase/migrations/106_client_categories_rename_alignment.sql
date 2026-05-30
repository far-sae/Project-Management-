-- 106_client_categories_rename_alignment.sql
-- Aligns client_categories UPDATE/DELETE privileges with clients UPDATE so a
-- category rename and its companion clients.category cascade succeed or fail
-- as one. Before this change, migration 105's "author_or_admin" policy let a
-- plain member rename their own category, but migration 041 restricts clients
-- UPDATE to owner/admin only. The cascade was silently filtered to zero rows
-- by RLS, leaving every tagged account orphaned with no error surfaced.

-- Drop both the OLD policy names (replaced by this migration) AND the
-- NEW ones (so re-running the migration is a no-op, not a 42710 error).
drop policy if exists "author_or_admin_update_client_categories" on public.client_categories;
drop policy if exists "author_or_admin_delete_client_categories" on public.client_categories;
drop policy if exists "admin_update_client_categories"           on public.client_categories;
drop policy if exists "admin_delete_client_categories"           on public.client_categories;

create policy "admin_update_client_categories"
  on public.client_categories for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

create policy "admin_delete_client_categories"
  on public.client_categories for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));
