-- Lift the "paid runs are immutable" lock so owner + admin can:
--   1. Correct payslip values on a run that's already marked paid.
--   2. Revert a paid run back to finalized (the new "Unmark as paid" action),
--      so the next round of corrections happens against an editable run.
--
-- 049_payroll_admin_edit_finalized.sql widened admin edits to draft+finalized.
-- This migration goes one step further: admins can also touch paid items, and
-- the BEFORE-UPDATE trigger now allows both owner and admin to move a run
-- between paid/finalized. Plain members still can't see payroll at all.
--
-- The audit story is unchanged: payroll_items.updated_at and
-- payroll_runs.updated_at advance on each write, and `paid_at` / `paid_by`
-- on payroll_runs preserve who originally marked the run paid.

-- ---------------------------------------------------------------------------
-- payroll_items: owner + admin can edit on ANY non-deleted run, including paid.
-- ---------------------------------------------------------------------------

drop policy if exists "owner_admin_edit_items_unpaid" on public.payroll_items;
drop policy if exists "owner_admin_edit_items_anytime" on public.payroll_items;

create policy "owner_admin_edit_items_anytime"
  on public.payroll_items for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- ---------------------------------------------------------------------------
-- payroll_runs: owner + admin can update any run (status workflow restrictions
-- are now enforced exclusively by the trigger below — RLS just grants the row).
-- ---------------------------------------------------------------------------

drop policy if exists "owner_admin_edit_unpaid_runs" on public.payroll_runs;
drop policy if exists "owner_admin_edit_runs_anytime" on public.payroll_runs;
drop policy if exists "owner_edit_finalized_runs" on public.payroll_runs;

create policy "owner_admin_edit_runs_anytime"
  on public.payroll_runs for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- ---------------------------------------------------------------------------
-- Status-transition trigger: replace the owner-only paid guard with one that
-- allows owner+admin transitions between finalized ↔ paid, and tracks who
-- did the unmark for the audit log.
-- ---------------------------------------------------------------------------

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
    -- Any change involving the paid state requires admin or owner.
    if new.status = 'paid' or old.status = 'paid' then
      if not public.is_org_admin_or_owner(new.organization_id) then
        raise exception 'Only owner or admin can change a payroll run to/from paid';
      end if;
    end if;

    -- When reverting paid → finalized, clear the paid-stamp so the next
    -- "Mark as paid" overwrites it cleanly. paid_at/paid_by represent the
    -- *current* paid state, not the most-recent attempt.
    if old.status = 'paid' and new.status = 'finalized' then
      new.paid_at := null;
      new.paid_by := null;
      new.paid_by_name := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payroll_runs_guard_status_change on public.payroll_runs;
create trigger trg_payroll_runs_guard_status_change
  before update on public.payroll_runs
  for each row execute function public.payroll_runs_guard_status_change();
