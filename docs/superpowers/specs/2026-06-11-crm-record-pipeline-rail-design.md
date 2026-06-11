# CRM record: pipeline-in-rail, tab reorder, email dialog, forecast

**Date:** 2026-06-11
**Status:** Approved (user confirmed layout = pipeline in rail, no Leads tab)
**Branch:** `crm-record-pipeline-rail` (off `main`)

## Context

Follow-up corrections on the CRM record + two page fixes. No migration (reuse tables/services). 5 slices.

## S1 — Right rail = interactive pipeline (account + lead) — img 1
In BOTH `ClientDetailDrawer.tsx` and `LeadDetailDrawer.tsx` right rail, the Deals card becomes a **working pipeline**:
- **＋ Add deal** → `DealFormDialog` scoped to the record (account → clientId; lead → its `accountId`, else prompt). 
- Each deal row: title + value (`useFormatMoney`) + a **stage `<Select>`** listing all pipeline stages (reuse the pipeline's `resolveStageChange` helper from `deals.ts` + the existing won-confirm `DealWonModal` so picking Won still confirms + fires the handoff). Changing stage calls `updateDeal({ stage, stageId, probability })`.
- Reuse the per-deal stage-dropdown logic already built for the Pipeline board (slice 6b) — factor a small shared `<DealStagePicker deal onChanged>` if helpful, used by both the board and the rail.

## S2 — Account record tabs reorder + remove Leads — img 3
`ClientDetailDrawer.tsx` center tabs become, in order: **Activity · Notes · Pipeline · Emails · Meetings · Files · Invoices** (remove **Leads** tab + its leads-by-category panel/imports).
- **Activity** (first) = the record's `ActivitiesTimeline` (`filterByEntity(listActivities, 'client', id)`) — moved from the rail into this tab (the rail now holds the pipeline).
- **Pipeline** (after Notes) = the record's deal **stage-change history** (reuse `listAccountStageHistory`/`AccountStageHistoryCard` content rendered as a tab) — "timeline activity of the pipeline".
- Keep Notes/Emails/Meetings/Files/Invoices as built. Apply the equivalent ordering to `LeadDetailDrawer` where it has tabs (Activity timeline first; remove any leads-internal bits that don't apply).

## S3 — Remove the "All workspaces" pill — img 2
In `Clients.tsx` CRM header, remove the **"All workspaces"** badge next to the "CRM" title (and any duplicate workspace-scope indicator there). Workspace scoping still works via the sidebar; just drop the header pill.

## S4 — Send Email dialog redesign + templates — img 4
`src/components/activities/SendEmailDialog.tsx`:
- **Redesign** the dialog: cleaner header, clear To row, a proper Subject + a larger Body, primary Send. Keep the real Gmail send (`notify-send-gmail`) + mailto fallback.
- **Templates path:** when there are no templates, the dropdown's empty state becomes an actionable **"＋ New template"** / **"Manage templates"** link that routes to Settings → Email templates (find the existing email-templates settings location; if `listEmailTemplates` exists there's a management surface — link to it). When templates exist, picking one expands tokens (existing behavior). Optionally add a "Save current as template" affordance if the templates service supports create.
- Make sure send works with OR without a template.

## S5 — Forecast page redesign — img 4 comment
`src/components/.../ForecastTab.tsx` (find it under deals/clients): modern redesign **wired to real pipeline data** (`getOrganizationDeals` + the pipeline stages):
- KPI tiles (open pipeline, weighted forecast, won this period, etc.) + a chart of **weighted forecast by stage and/or by expected-close month** using existing recharts components (`KpiTile`, `StackedBar`/`BarHorizontal`/`TrendArea`, `PipelineFunnel`). Respect the display-currency (`useFormatMoney`). Replace any placeholder/empty look with a real, connected, modern view.

## Non-goals
No migration; reuse DealFormDialog/DealWonModal/resolveStageChange/ActivitiesTimeline/listAccountStageHistory/SendEmailDialog send path/recharts. Don't change the pipeline board itself (S1 reuses its stage logic). Email send stays owner-gated where it already is.

## Testing / verification
- `npm run build` + `npm run test` green per slice. 
- Manual: account/lead rail lets you add a deal + change stage via dropdown (Won confirms + hands off); account tabs are Activity·Notes·Pipeline·Emails·Meetings·Files·Invoices with no Leads tab; no "All workspaces" pill; Send Email dialog looks modern, send works, and the no-templates state links to create one; Forecast shows real, modern, connected numbers/charts.

## Self-review
S1 reuses the slice-6b stage-dropdown/won-confirm logic in the rail. S2 is a tab reshuffle + moving the timeline into a tab. S3 trivial. S4 is a dialog restyle + a real templates entry point. S5 rewires Forecast to real data with existing charts. All reuse; no new tables.
