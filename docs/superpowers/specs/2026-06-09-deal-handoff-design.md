# Deal won → PM handoff task → CRM activity (workstreams #4 + #5)

**Date:** 2026-06-09
**Status:** Approved (design)
**Branch:** `deal-handoff` (off `main`)

## Context

When a deal is won, sales should hand the work to a delivery (PM) team — creating a real project task on their board — and when that task is completed, it should surface back in the CRM record's activity (done only). Today PM `tasks` have **no link to a CRM deal/client**, so neither half is possible. This adds that link and the two flows.

## Schema — migration 132 (`supabase/migrations/132_task_crm_source.sql`)

Add to `public.tasks` (re-runnable):
```sql
alter table public.tasks
  add column if not exists source_deal_id   uuid references public.deals(deal_id)   on delete set null,
  add column if not exists source_client_id uuid references public.clients(client_id) on delete set null;
create index if not exists idx_tasks_source_deal   on public.tasks (source_deal_id)   where source_deal_id   is not null;
create index if not exists idx_tasks_source_client on public.tasks (source_client_id) where source_client_id is not null;
```
Also append to `supabase/deploy/2026-06-05_billing_deploy.sql`? No — this isn't billing. It's applied standalone in the SQL editor at deploy time.

## PM task layer — carry the CRM link

- `src/types/task.ts`: add `sourceDealId?: string | null` + `sourceClientId?: string | null` to `Task` and `CreateTaskInput`.
- `src/services/supabase/database.ts`:
  - `TASKS_SAFE_SELECT`: append `, source_deal_id, source_client_id`.
  - `createTask`: insert `source_deal_id: input.sourceDealId ?? null, source_client_id: input.sourceClientId ?? null`.
  - The row→`Task` mapper: map `sourceDealId: row.source_deal_id ?? null, sourceClientId: row.source_client_id ?? null`. (Find the existing mapper used by `getUserProjects`/`mapTask`; add the two fields.)
- No other create call sites need the fields (they default null).

## #4 — Deal won → handoff dialog

**Component:** `src/components/deals/DealHandoffDialog.tsx` (new)
- Props: `{ open, onOpenChange, deal: Deal | null, onCreated?: () => void }`.
- Fields: **Workspace** `<Select>` (from `useWorkspaces()`), **Project** `<Select>` (from `useProjects()` filtered to the chosen workspace; include a **"＋ New project"** entry that opens the existing `src/components/workspace/NewProjectDialog.tsx`, defaulting its workspace, and selects the new project on create), **Assignee** `<Select>` (org members via `useOrganization()` members / the existing member source used elsewhere; optional), **Title** (default `deal.title`), optional **Note** (description) + optional **Due date**.
- Submit → `createTask(user.userId, { projectId, title, description, dueDate, assignees: assignee ? [assignee] : [], sourceDealId: deal.dealId, sourceClientId: deal.clientId ?? null }, orgId)` → toast "Handed off to <project>" → `onCreated?.()` → close. Validates project + title required.
- Header reads like a celebratory handoff ("Deal won — hand it to delivery"). Skippable via Cancel/"Not now".

**Trigger wiring (centralized in `src/pages/Clients.tsx`):**
- Add `onDealWon?: (deal: Deal) => void` to `DealsKanban` and `DealDetailView`; each calls it AFTER a successful transition to a won stage (DealsKanban: in the `pendingWonStage` confirm path once `updateDeal({stage: won})` resolves; DealDetailView: in `handleVerifyConfirm` after the won update resolves).
- `Clients.tsx` owns one `DealHandoffDialog`, opened by `onDealWon` (stores the won deal in state). This avoids duplicate dialogs and keeps the win-update logic untouched.
- The dialog is purely additive — if the user cancels, nothing else changes; the deal is already won.

## #5 — Completed handoff task → CRM activity (done only)

**`src/services/supabase/activities.ts`:**
- Extend `ActivityKind` with `"pm_task"`; add a source variant `{ kind: "pm_task"; row: PmTaskRow }` where `PmTaskRow = { task_id, title, source_deal_id, source_client_id, completed_at, project_id }`.
- New `listDoneHandoffTasks(organizationId)`: `select task_id, title, source_deal_id, source_client_id, completed_at, project_id from tasks where organization_id = orgId and status = 'done' and (source_deal_id is not null or source_client_id is not null)`.
- New `pmTaskToActivity(row)`: `{ kind: 'pm_task', open: false, whenAt: completed_at, title: 'Delivery task completed: ' + title, category: 'task', ... }`.
- In `listActivities`, add `listDoneHandoffTasks` to the `Promise.all` and `...pmTasks.map(pmTaskToActivity)` to `out`.
- In `filterByEntity`: for `type === 'deal'` also match `s.kind === 'pm_task' && s.row.source_deal_id === id`; for `type === 'client'` also match `s.kind === 'pm_task' && s.row.source_client_id === id`. (Leads: N/A — a won deal belongs to an account, not a lead.)
- The ActivitiesTimeline renderer already keys on `kind`; add an icon/label case for `pm_task` (reuse the task icon, e.g. a check) so it renders cleanly. Only DONE handoff tasks are ever returned, so nothing in-progress or unrelated leaks in.

## Non-goals
- Not auto-creating the task (handoff is an explicit, skippable prompt). Not syncing non-handoff PM tasks. Not changing the kanban/board behavior. No recurring/automation tie-in.

## Testing / verification
- `npm run build` + `npm run test` green. Add a small unit test for `filterByEntity` matching a `pm_task` source onto a deal + client (mirror the existing activities test).
- `"$DENO"` n/a (no edge fn changes).
- Manual (post-migration 132): move a deal to Won → confirm win → handoff dialog opens → pick workspace/project (or create one) + assignee + title → a task appears on that project's board with the deal link; mark it Done on the board → it appears in the deal's and the account's Activity timeline as "Delivery task completed: …"; an in-progress handoff task does NOT appear in CRM activity; cancelling the handoff leaves the deal won with no task.

## Self-review
One link (`source_deal_id`/`source_client_id` on `tasks`) powers both halves. Handoff reuses `createTask` + `NewProjectDialog`; win-detection reuses the existing won-confirmation paths (additive callback, no change to the update itself). Activity surfacing reuses the unified `listActivities`/`filterByEntity` pattern with one new source. Migration is the only deploy step.
