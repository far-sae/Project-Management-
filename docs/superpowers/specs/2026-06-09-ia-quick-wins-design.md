# IA quick wins — sidebar cleanup, HR hub, sidebar workspace/project creation

**Date:** 2026-06-09
**Status:** Approved (design)
**Branch:** `ia-quick-wins` (off `main`)

## Context

First slice of a larger CRM/PM restructure. These three are unambiguous, low-risk, high-visibility changes that tidy navigation and consolidate people-ops/money screens. (The bigger CRM-IA redesign and the AI/Power-BI dashboard are deferred to their own design rounds.)

## 1. Sidebar cleanup — `src/components/sidebar/Sidebar.tsx`

- **Move "Team" to directly after "Reports"** in the top quick-nav: add `{ icon: Users, label: 'Team', href: '/team', feature: 'team_collaboration' }` to the END of `QUICK_ITEMS_FULL` (after Reports). Preserve its plan gate the same way CRM analytics is filtered today — in the `QuickMenu items=` prop, extend the existing `.filter` so a Team item is dropped when `!hasFeature('team_collaboration')`. Remove `Team` from the owner/admin `bottomMenuItems`.
- **Remove from the sidebar:** `Contracts` and `Files` (owner/admin branch), and `Files` from the member branch. Routes/pages stay — only the nav links go.
- **Fold into HR (remove their own sidebar entries):** remove `Time Tracking` (`/time`), `Expenses` (`/expenses`), `Payroll` (`/payroll`), `Billing` (`/billing`) from `bottomMenuItems`.
- **Resulting owner/admin `bottomMenuItems`:** `CRM`, `AI Agent`, `Timeline`, `Comments`, `HR` (in that order). Member branch: `CRM`, `AI Agent`, `Timeline` (Files removed). Viewer branch: unchanged (Timeline only).

## 2. HR hub (tabs) — `src/pages/HR.tsx`

- Wrap the page in shadcn `Tabs` with: **People** (the current employee grid, default) · **Time Tracking** · **Payroll** · **Expenses** · **Billing**.
- Each non-People tab renders the EXISTING page component as its panel: `import { TimeTracking } from '@/pages/TimeTracking'`, `{ Payroll }`, `{ Expenses }`, `{ Billing }`. (They're already standalone exported components; nesting their internal sub-tabs — e.g. Billing's Invoices/Recurring/Bills — is acceptable.)
- Keep the existing People-grid code as the People tab body (extract the current return JSX into the People tab without behavior change).
- Routes `/time`, `/payroll`, `/expenses`, `/billing` stay registered (no breakage); they're just no longer linked from the sidebar. HR stays owner/admin-gated (`requireOrgAdmin`), which matches all four embedded pages.

## 3. Create workspace / project from the sidebar — `src/components/sidebar/WorkspaceSwitcher.tsx`

- Add a **"＋"** icon-button in the WorkspaceSwitcher header (next to the switcher) that opens a small menu / two actions: **New workspace** and **New project**.
- **New workspace** → open the existing `src/components/workspace/WorkspaceModal.tsx`; on save call `useWorkspaces().addWorkspace(...)` (the same path the Dashboard uses) and refresh.
- **New project** → reuse the Dashboard's project-create flow. **Extract** the project-create dialog currently inline in `src/pages/kanban/Dashboard.tsx` into a reusable `src/components/workspace/NewProjectDialog.tsx` (props: `open`, `onOpenChange`, optional `defaultWorkspaceId`, `onCreated`), preserving its template picker + limit checks. Use it in BOTH the Dashboard (replacing the inline dialog) and the WorkspaceSwitcher.
  - **Fallback (if extracting the Dashboard dialog proves too entangled):** a minimal `NewProjectDialog` with name + workspace `<Select>` + cover color that calls the existing `createProject(...)` service and respects the limit check. Note this fallback in the commit if used.
- The Dashboard's own creation entry points stay; this only ADDS the sidebar entry point.

## Non-goals
- No CRM IA changes, no pipeline changes, no dashboard changes, no new tables. Pure navigation + composition of existing screens.

## Testing / verification
- `npm run build` clean; `npm run test` green (no logic changes to tested units).
- Manual: sidebar shows Team right under Reports; Files/Contracts/Time/Expenses/Payroll/Billing gone from the sidebar; HR shows the 5 tabs and each renders its page; the workspace switcher "＋" creates a workspace and a project (appearing in the list) just like the Dashboard does.

## Self-review
Mechanical recomposition of existing components; the only non-trivial unit is the `NewProjectDialog` extraction (with an explicit minimal fallback). Team's plan gate is preserved via the existing QuickMenu filter pattern. No data model or route removals — deep links keep working.
