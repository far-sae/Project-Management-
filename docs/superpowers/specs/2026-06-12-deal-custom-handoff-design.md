# Won-deal workspace+project, two-button add (pipeline deal / custom item), pipeline tab money

**Date:** 2026-06-12
**Status:** Approved (user confirmed: two separate create buttons for custom)
**Branch:** `crm-deal-custom-handoff` (off `main`)

## Context
Three CRM refinements. No migration (deals already have `dealType` + `customFields` jsonb). Reuse existing components.

## S-A — Won-deal dialog creates workspace + project — img 1
`DealWonModal` ("Create project from won deal"): add a **Workspace** control — a `<Select>` of existing workspaces (from `useWorkspaces`) + a "＋ New workspace" option (inline name input, or open `WorkspaceModal`). On **Create project**: if "new workspace", create it first (`useWorkspaces().addWorkspace`/`createWorkspace`), then create the delivery project with that `workspaceId` (the existing project-create path) + the existing `source_deal_id`/`source_client_id` handoff link. Keep "Skip" (mark won, no project). Default the workspace to the deal's account workspace if known, else the default workspace.

## S-B — Add to pipeline = two buttons (Pipeline deal / Custom item)
Everywhere a deal is added — the right-rail pipeline in `ClientDetailDrawer`/`LeadDetailDrawer`, and the Pipeline board's add entry (`DealsKanban` column footers + the top "Create Deal") — replace the single add with **two actions**:
- **＋ Pipeline deal** → the existing `DealFormDialog` (unchanged standard staged deal).
- **＋ Custom item** → a new `src/components/deals/CustomItemDialog.tsx`: minimal form — **Title** (required), optional **Value**+currency, optional **Stage** (defaults to first stage), and a **CustomPropertiesEditor** (reuse `src/components/leads/CustomPropertiesEditor.tsx` + `src/lib/customFields.ts`) for arbitrary name/value fields. On save → `createDeal(..., { title, clientId: <record account>, value, currency, stage, dealType: 'custom', customFields })`. It's stored as a deal so it shows in the pipeline/rail; tag it visually (a small "Custom" badge) using `dealType === 'custom'`.
- Custom items render in the rail/board like deals (title + value + stage dropdown). Opening a custom item (clicking it) opens `CustomItemDialog` in edit mode so its custom fields can be edited (reuse for create + edit). Standard deals keep opening `DealFormDialog`/detail.
- Where two buttons don't fit (kanban column footer), use a small split/menu ("Add ▾ → Pipeline deal / Custom item").

## S-C — Pipeline tab shows the money — img 3
In `ClientDetailDrawer` (and `LeadDetailDrawer` where applicable) **Pipeline** tab: above the existing Stage History, add a **Deals** list — each of the record's deals (via `getOrganizationDeals` filtered to the account, incl. custom items) showing title + stage badge + **value** (`useFormatMoney`, display currency), and a row total. So the Pipeline tab shows money per deal/project, then the stage-change history below. Empty state when none.

## Non-goals
No migration; custom items reuse the deals table (`dealType='custom'` + `customFields`). Reuse DealFormDialog/DealWonModal/CustomPropertiesEditor/getOrganizationDeals/useFormatMoney/useWorkspaces. Don't change the deal SEND/won-confirm mechanics beyond adding the workspace field.

## Testing / verification
- `npm run build` + `npm run test` green.
- Manual: winning a deal lets you pick/create a workspace + create the project in it; the pipeline add shows two buttons, "Custom item" creates a freeform record (title + custom fields) that appears in the rail/board with a Custom tag and is editable; the Pipeline tab lists deals with their values + total alongside stage history.

## Self-review
S-A adds a workspace step to the won handoff (reuses workspace + project create). S-B adds a second, schema-free create path stored as a deal (dealType custom + customFields, reusing CustomPropertiesEditor) so it lives in the same pipeline. S-C enriches the Pipeline tab with per-deal value. All reuse; no new tables.
