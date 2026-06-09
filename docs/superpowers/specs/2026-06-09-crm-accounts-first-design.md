# CRM redesign #6 — Accounts-first leads + simplified pipeline

**Date:** 2026-06-09
**Status:** Approved (design)
**Branch:** `crm-accounts-first` (off `main`)

## Context

Reshape the CRM so the **Account** is the entry point: inside an account you add a **category**, then add **leads** under it. The standalone **Leads tab is removed** — leads only live inside accounts. The **pipeline** becomes a stage-dropdown board (all stages: Lead/Qualified/Proposal/Negotiation/Won/Lost) with an Assign-task action. Built in two slices; **6a first**, then **6b**.

Confirmed decisions: **(A)** leads with no account show under an "Unassigned leads" group (never deleted); **(B)** in-account "convert lead" becomes "promote to a deal under this account" (no new account created).

---

## SLICE 6a — Accounts-first leads (remove Leads tab)

### Schema — migration 133 (`supabase/migrations/133_account_leads.sql`)
```sql
alter table public.leads
  add column if not exists account_id uuid references public.clients(client_id) on delete set null,
  add column if not exists category   text;
create index if not exists idx_leads_account on public.leads (account_id) where account_id is not null;

alter table public.clients
  add column if not exists lead_categories text[] not null default '{}';
```
- `leads.account_id` = the owning account (null = unassigned). `leads.category` = the lead's category label within that account. `clients.lead_categories` = the account's category list (lets you create an empty category before adding leads).

### Leads service — `src/services/supabase/leads.ts`
- Add `accountId: string | null` + `category: string | null` to `Lead`, `CreateLeadInput`, `UpdateLeadInput`, the mapper, and create/update patches (`account_id`, `category`).
- `listAccountLeads(orgId, accountId)` and `listUnassignedLeads(orgId)` helpers (filter by `account_id` = id / is null).

### Accounts service — `src/services/supabase/clients.ts`
- Add `leadCategories: string[]` to `Client` + mapper. `addLeadCategory(orgId, clientId, name)` / `removeLeadCategory(orgId, clientId, name)` (append/remove on the array via update). Renaming a category also updates the matching `leads.category` (optional; v1 can skip rename).

### Account detail — `src/components/clients/ClientDetailDrawer.tsx`
- Add a **"Leads"** tab to the account drawer (alongside activity/notes/.../invoices). It shows the account's `leadCategories` as collapsible groups; under each, the leads where `account_id = this account AND category = group`.
- **"＋ Add category"** → `addLeadCategory`. **"＋ Add lead"** within a category → opens the reused `LeadFormDialog` prefilled with `accountId = this account`, `category = group`, `workspaceId = account.workspaceId`; on save refresh.
- Clicking a lead row opens the inline-editable `LeadDetailDrawer` (it already exists; ensure it can be opened from here, and that its inline edits + custom props still work — they save via `updateLead`).
- A lead row also offers **"Promote to deal"** (Decision B) → opens a deal-create scoped to this account (reuse `DealFormDialog`/create with `clientId = account`, prefilled title from the lead, optional contact). Does NOT create a new account.

### Remove the Leads tab + handle unassigned — `src/pages/Clients.tsx`
- Remove the top-level **Leads** `TabsTrigger` + its panel (LeadsLanding/LeadsTable/LeadsHubCard) and the `'leads'` value from the CRM tab union/default.
- **Keep** the lead components/services (LeadDetailDrawer, LeadFormDialog, leads.ts) — still used inside accounts.
- Add an **"Unassigned leads"** affordance in the **Accounts** tab (a collapsible section or a card at the top): lists leads with `account_id IS NULL`, each with a **"Move to account"** action (pick an account + category → `updateLead(..., { accountId, category })`). This keeps bot/agent/CSV-created leads (which land with no account) reachable.
- Lead creation now happens inside an account; the agent/bot/import paths still create leads (they'll be unassigned until moved — fine).

### Gating / non-goals (6a)
- Edit/create gated by `canEditModule('leads')` (unchanged perm model). No change to lead scoring / pipeline-enrollment internals. Conversion-to-new-account path (`convertLead`) stays available for unassigned leads; inside an account, "Promote to deal" is the path.

---

## SLICE 6b — Simplified pipeline (stage dropdown + assign task)

**Build after 6a is merged.** `src/components/clients/DealsKanban.tsx` (+ DealsListView / DealDetailView):
- Primary interaction becomes a **stage `<Select>`** on each deal listing all the pipeline's stages (Lead/Qualified/Proposal/Negotiation/Won/Lost, read from `pipeline_stages`); choosing a stage calls `updateDeal({ stage, stageId, probability })` (won/lost still trigger the existing won-confirm + handoff). Keep a board/list grouped by stage but driven by the dropdown rather than drag (drag can remain as a nicety, not required).
- **"＋ Add deal"** readily available; an **"Assign task"** action on any deal opens the existing `DealHandoffDialog` (generalize it slightly so it's not won-only — same dialog, available any time).
- Forecast + the won→handoff flow keep working.

---

## Testing / verification
- `npm run build` + `npm run test` green each slice. Unit-test the new pure-ish bits (e.g. grouping leads by category; `listUnassignedLeads` filter). 
- Manual (post-migration 133): open an account → add a category → add a lead under it → it appears in that group; edit the lead inline; the top CRM nav has no Leads tab; bot/CSV-created leads appear under "Unassigned leads" and can be moved into an account; "Promote to deal" creates a deal under the account (no new account). 6b: a deal's stage dropdown changes its stage; moving to Won still triggers the handoff; Assign-task opens the handoff dialog.

## Self-review
6a is the heavy slice: a migration + leads/accounts service fields + a Leads section in the account drawer + removing the Leads tab + an unassigned-leads escape hatch + promote-to-deal. The escape hatch + keeping `convertLead` mean no leads are lost and existing create paths (bot/agent/import) still function. 6b reshapes the pipeline interaction to a dropdown while preserving forecast + handoff. Both reuse existing dialogs (LeadFormDialog, DealFormDialog, DealHandoffDialog, LeadDetailDrawer).
