# Billing: workspace + project scoping + invoice Edit button

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Scope the whole Billing page (Invoices, Recurring, Bills) by **Workspace** and **Project** via two in-page dropdowns, and let each invoice/bill/schedule be assigned to a workspace+project. Also add an explicit **Edit** button to invoice rows.

**Context:** Invoices/bills/schedules already carry `workspace_id` but have NO project link. This adds `project_id` to all three, threads it through services + the recurring worker + the three editors, and adds page-level Workspace/Project filters. Frontend filters client-side on the already-loaded rows.

**Tech stack:** React/TS, Supabase. **Branch:** `billing-scope`. Latest migration: `130` → next `131`. Deno path: `$DENO = C:\Users\faraz\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe`.

**Reuse:** `useWorkspaces()` → `{ workspaces: Workspace[] }` (each `{ workspaceId, name, isDefault }`). `useProjects()` → `{ projects }` (each has `projectId`, `name`, `workspaceId`). `computeQuoteTotals`. Existing editor patterns.

---

## Task 1: Migration 131 — add `project_id`

**Files:** Create `supabase/migrations/131_billing_project_scope.sql`; also append the same SQL (between a `begin;`/`commit;` or standalone) to `supabase/deploy/2026-06-05_billing_deploy.sql` so the one-shot deploy file stays complete.

```sql
-- Billing: scope invoices / bills / recurring schedules to a project (optional).
-- workspace_id already exists on all three. Re-runnable.
alter table public.invoices          add column if not exists project_id uuid references public.projects(project_id) on delete set null;
alter table public.bills             add column if not exists project_id uuid references public.projects(project_id) on delete set null;
alter table public.invoice_schedules add column if not exists project_id uuid references public.projects(project_id) on delete set null;

create index if not exists idx_invoices_project          on public.invoices (project_id)          where project_id is not null;
create index if not exists idx_bills_project             on public.bills (project_id)             where project_id is not null;
create index if not exists idx_invoice_schedules_project on public.invoice_schedules (project_id) where project_id is not null;
```

Commit: `feat(billing): migration 131 - project_id on invoices/bills/schedules`.

---

## Task 2: Thread `projectId` through services + worker

**Files:** `src/services/supabase/invoices.ts`, `bills.ts`, `invoiceSchedules.ts`, `supabase/functions/crm-run-automations/triggers/recurringInvoices.ts`

For EACH of the three services, mirror the existing `workspaceId` handling and add `projectId`:
- **Type** (`Invoice`/`Bill`/`InvoiceSchedule`): add `projectId: string | null;`.
- **Create input** (`CreateInvoiceInput`/`CreateBillInput`/`CreateScheduleInput`): add `projectId?: string | null;`.
- **Mapper** (`mapInvoice`/`mapBill`/`map`): add `projectId: (r.project_id as string) ?? null,`.
- **create…**: add `project_id: input.projectId ?? null,` to the insert object.
- **update…**: add `if (input.projectId !== undefined) patch.project_id = input.projectId;`.
  - (Bills also already accept `workspaceId` via CreateBillInput; ensure `updateBill` patches `workspace_id` too: add `if (input.workspaceId !== undefined) patch.workspace_id = input.workspaceId;` and that `createBill` inserts `workspace_id: input.workspaceId ?? null` — verify it does; the invoices/schedules create already insert workspace_id.)

**Worker** `recurringInvoices.ts`: the schedule row is selected with `*`, so add `project_id: s.project_id` to the `admin.from("invoices").insert({...})` object (alongside `workspace_id: s.workspace_id`).

Verify: `npm run build` clean; `"$DENO" check supabase/functions/crm-run-automations/index.ts` (no NEW errors). Commit: `feat(billing): carry projectId through invoice/bill/schedule services + worker`.

---

## Task 3: Editors — workspace/project pickers

**Files:** `src/components/billing/InvoiceEditor.tsx`, `BillEditor.tsx`, `RecurringScheduleDialog.tsx`

Common new props for all three (add to each `Props`):
```ts
  projects?: { projectId: string; name: string; workspaceId: string }[];
  defaultProjectId?: string | null;
```
BillEditor additionally:
```ts
  workspaces?: { workspaceId: string; name: string }[];
  defaultWorkspaceId?: string | null;
```

- **InvoiceEditor**: workspace is derived from the chosen client (`effectiveWorkspaceId`, already computed). Add a `projectId` state (init: `existing?.projectId ?? defaultProjectId ?? ''` on open). Render a **Project** `<Select>` (placeholder "No project") listing `projects` filtered to `effectiveWorkspaceId` (when known) — an "— None —" option (value `''`) plus matches. Include `projectId: projectId || null` in both `createInvoice` and `updateInvoice` calls.
- **RecurringScheduleDialog**: same as InvoiceEditor (workspace from client; add a Project select filtered by the picked client's workspace; thread `projectId`).
- **BillEditor**: bills have no client, so add BOTH a **Workspace** `<Select>` (from `workspaces`, "— None —" + each) and a **Project** `<Select>` (from `projects` filtered to the chosen workspace). Add `workspaceId` + `projectId` state (init from `existing` or the `default*` props). Include `workspaceId: workspaceId || null` and `projectId: projectId || null` in `createBill`/`updateBill`. Put the two selects in the top grid near vendor/currency.

Reset all new state in the `useEffect(..., [open, existing])` (existing → from the row; new → from `default*`).

Verify `npm run build`. Commit: `feat(billing): workspace/project pickers in invoice, bill & recurring editors`.

---

## Task 4: Billing page — in-page Workspace + Project dropdowns + filtering + Edit button

**Files:** `src/pages/Billing.tsx`, `src/components/billing/tabs/InvoicesTab.tsx`

In **`Billing.tsx`**:
- `import { useWorkspaces } from '@/hooks/useWorkspaces'; import { useProjects } from '@/hooks/useProjects';` and read `{ workspaces }` + `{ projects }`.
- State: `const [wsFilter, setWsFilter] = useState<string>('all');` and `const [projFilter, setProjFilter] = useState<string>('all');`.
- The **project options** depend on `wsFilter`: when a workspace is selected, only its projects; when 'all', all projects. When `wsFilter` changes, reset `projFilter` to 'all'.
- **Filter helpers** applied before passing data to tabs:
  ```ts
  const matchScope = (row: { workspaceId: string | null; projectId: string | null }) =>
    (wsFilter === 'all' || row.workspaceId === wsFilter) &&
    (projFilter === 'all' || row.projectId === projFilter);
  ```
  Apply to `invoices`, `schedules`, `bills` (all have `workspaceId` + `projectId` now) → pass the filtered arrays to the tabs.
- Render the two dropdowns (shadcn `Select`) in a row directly under the tab bar, before the tab panels, e.g. "Workspace: [All workspaces ▾]" and "Project: [All projects ▾]". Use the same `Select` primitives already imported elsewhere.
- Pass to the dialogs: `workspaces`, `projects`, and defaults derived from the current filter — `defaultWorkspaceId={wsFilter === 'all' ? null : wsFilter}`, `defaultProjectId={projFilter === 'all' ? null : projFilter}` (InvoiceEditor/RecurringScheduleDialog take `projects` + `defaultProjectId`; BillEditor also takes `workspaces` + `defaultWorkspaceId`).

In **`InvoicesTab.tsx`**: add an explicit **Edit** button to each row's action group (mirroring BillsTab), e.g. before the delete button:
```tsx
<Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(inv)} disabled={busy}>Edit</Button>
```
(Keep the clickable invoice-number too.)

Verify `npm run build` + `npm run test`. Commit: `feat(billing): in-page workspace/project filters + invoice Edit button`.

---

## Task 5: Verify
- `"$DENO" check supabase/functions/crm-run-automations/index.ts` → only pre-existing errors.
- `npm run build` + `npm run test` → green.
- Manual (post-deploy of migration 131): pick a Workspace then a Project at the top of Billing → all three tabs show only matching rows + their tiles reflect the filtered set; New invoice/bill/recurring defaults to the selected workspace/project and lets you change them; an invoice row's Edit button opens the editor.

## Self-review
Threading is uniform (`projectId` mirrors `workspaceId` everywhere). Bills get an explicit workspace selector since they have no client to derive it from. Filtering is client-side on already-loaded rows, so tiles (totals) reflect the active scope. Edit button reuses the existing `onEdit` callback.
