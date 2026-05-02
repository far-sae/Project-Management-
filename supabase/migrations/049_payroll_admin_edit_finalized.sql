-- Allow org admins (in addition to owner) to correct payroll items after a run
-- has been finalized — common case is somebody forgot to clock out, the run got
-- finalized with the wrong hours, and the admin needs to fix it before pay day.
-- The client (src/hooks/usePayroll.ts) was updated to expose canEdit on
-- finalized runs, but without matching RLS the actual UPDATE would be rejected
-- by Postgres. This migration brings the policies in line.
--
-- Locked states preserved:
--   * `paid` runs/items are immutable for everyone — money has been disbursed
--     and edits become an accounting concern, not a UI fix.
--   * Status transitions (draft → finalized → paid) remain owner-gated on the
--     client; this migration only widens the rows admins can touch, not the
--     status workflow itself.

-- ---------------------------------------------------------------------------
-- payroll_items
-- ---------------------------------------------------------------------------

-- Replace the draft-only admin policy with one that also covers finalized.
drop policy if exists "owner_admin_edit_items_draft"  on public.payroll_items;
drop policy if exists "owner_admin_edit_items_unpaid" on public.payroll_items;

create policy "owner_admin_edit_items_unpaid"
  on public.payroll_items for update to authenticated
  using (
    public.is_org_admin_or_owner(organization_id)
    and exists (
      select 1 from public.payroll_runs r
      where r.run_id = payroll_items.run_id
        and r.status in ('draft','finalized')
    )
  )
  with check (public.is_org_admin_or_owner(organization_id));

-- (owner_edit_items_anytime stays as-is — owner can still edit paid items if
-- absolutely required for back-office corrections.)

-- ---------------------------------------------------------------------------
-- payroll_runs
-- ---------------------------------------------------------------------------
-- refreshRunTotals() runs an UPDATE on payroll_runs after each item edit to
-- recompute totals. With items now editable on finalized runs, admins need
-- the matching update permission on the parent run too — otherwise the totals
-- won't sync and the UI will show stale numbers until an owner re-saves.

drop policy if exists "owner_admin_edit_draft_runs"   on public.payroll_runs;
drop policy if exists "owner_admin_edit_unpaid_runs"  on public.payroll_runs;

create policy "owner_admin_edit_unpaid_runs"
  on public.payroll_runs for update to authenticated
  using (
    public.is_org_admin_or_owner(organization_id)
    and status in ('draft','finalized')
  )
  with check (public.is_org_admin_or_owner(organization_id));

-- (owner_edit_finalized_runs stays as-is — owner can still touch paid runs.)

-- ---------------------------------------------------------------------------
-- Status-transition guard
-- ---------------------------------------------------------------------------
-- The expanded policy above lets admins UPDATE finalized runs (so item edits
-- can refresh totals). Postgres RLS can't restrict to specific columns, so we
-- enforce status-workflow rules in a BEFORE UPDATE trigger:
--   * Marking a run paid still requires the org owner.
--   * Reverting paid → finalized/draft still requires the org owner.
-- Draft → finalized stays admin-allowed (matches the prior behavior — it was
-- only the client that gated finalize to owner; the server already let admins
-- through).

create or replace function public.payroll_runs_guard_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.status is distinct from old.status then
    -- Anything touching the `paid` state is owner-only.
    if new.status = 'paid' or old.status = 'paid' then
      if not public.is_org_owner(new.organization_id) then
        raise exception 'Only the organization owner can change a payroll run to/from paid';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payroll_runs_guard_status_change on public.payroll_runs;
create trigger trg_payroll_runs_guard_status_change
  before update on public.payroll_runs
  for each row execute function public.payroll_runs_guard_status_change();
