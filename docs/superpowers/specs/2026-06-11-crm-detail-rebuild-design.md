# CRM detail rebuild — account/lead record, real Notes/Email/Meetings, nav + import

**Date:** 2026-06-11
**Status:** Approved (confirmed by user, incl. A/B/C + import/export placement)
**Branch:** `crm-detail-rebuild` (off `main`)

## Context

The account detail drawer still uses the old layout (read-only left, Contacts/Hierarchy/Stage rail, generic "log" composers for Notes/Emails/Calls/Tasks/Meetings) and the CRM has a standalone Activities tab + an account-heavy create form + top-bar import/export. Rebuild it to match the lead-detail pattern and the user's screenshots. Reuse existing building blocks (no new tables/migration). Built in 4 slices, each merged + verified.

Confirmed interpretations: **(A)** "money in the right rail" = the record's **deals** (stage + value); **(B)** the send-email composer is **owner-gated** (Gmail not Google-verified) via `useEmailEnabled`; **(C)** account create = category-first minimal, rest edited on the record.

Reusable pieces (from the map): `InlineField` (`components/leads/InlineField.tsx`); `SendEmailDialog` (`components/activities/SendEmailDialog.tsx`, real Gmail send via `notify-send-gmail`, takes `SendEmailRecipient`); `EntityEmailsSection`; `CreateMeetingDialog` + `meetings.ts` (`createMeeting`, `listMeetings`); `getClientNotes`/`createNote`/`deleteNote`; `ActivitiesTimeline` + `listActivities`/`filterByEntity`; `getOrganizationDeals` (filter by clientId); `findDuplicates`+`dupDetection.ts`; `exportClientsToCsv`; `ImportLeadsDialog`+`parseLeadCsv`/`importLeadsFromCsv`; `updateClient`.

---

## SLICE CRM-1 — Account detail panel (the centerpiece, img 1–4)

**File:** `src/components/clients/ClientDetailDrawer.tsx`

1. **Left "About this company" → inline-editable.** Replace the read-only `<Field>` rows in `OverviewTab` with `<InlineField editable={canManage && canEditModule('crm')} onSave={v => onUpdate(client.clientId, { <field>: v })}>` for: email, phone, website, owner(name) , address fields, annualRevenue (number), employeeCount (number), source, industry, description (textarea). Add an `onUpdate(clientId, patch)` prop wired in `Clients.tsx` to `updateClient(orgId, clientId, patch)` + refresh the open client (local merged copy, same pattern as LeadDetailDrawer).
2. **Right rail → Deals + Activity timeline** (replace Contacts/`AccountHierarchyCard`/`AccountStageHistoryCard`):
   - **Deals card:** the account's deals (`getOrganizationDeals` filtered to `clientId`), each row = title · stage badge · **value (money via useFormatMoney)**; a "+ New deal" opens `DealFormDialog` scoped to this account. Empty state.
   - **Activity timeline:** `ActivitiesTimeline activities={filterByEntity(listActivities(...), 'client', clientId)}` — the record's notes/emails/calls/meetings/pm-tasks, read-only feed.
3. **Tabs:** remove **Activity**, **Calls**, **Tasks**. Keep **Notes · Emails · Meetings · Files · Invoices · Leads**.
4. **Notes tab → proper notes:** a clean composer (body textarea + optional subject + "Add note") and a readable, timeline-style **list** of past notes (author · relative time · body, with delete). Use `getClientNotes`/`createNote`(kind:'note')/`deleteNote`. Not the bare subject/details/Log.
5. **Emails tab → real send (owner-gated):** when `useEmailEnabled()`, render an inline email composer (To prefilled from the account email, Subject, Body) that SENDS via the activities `SendEmailDialog` path (`notify-send-gmail`) and shows `EntityEmailsSection` (entityType:'client') below as the sent/received list. When not enabled, show a small "Email sending is available once Gmail is verified" note. (Reuse `SendEmailDialog` by opening it with a `SendEmailRecipient` built from the account, plus the emails list.)
6. **Meetings tab → real scheduler:** a "Schedule meeting" button opens `CreateMeetingDialog` (reuse) prefilled `relatedToType:'client'`, `clientId`, host = current user → `createMeeting`; list this account's meetings (`listMeetings` filtered to clientId) as upcoming/past with time + attendees. (v1 "availability" = the scheduler's date/time + showing existing meetings; full free/busy is a later enhancement — note it.)

Verify build+test. Commit.

## SLICE CRM-2 — CRM nav + Accounts top bar + account create (img 5, 6)

**File:** `src/pages/Clients.tsx`, `src/components/clients/ClientFormDialog.tsx`
- **Remove the Activities tab** from the CRM tab bar + its panel + the `'activities'` value (Home · Accounts · Pipeline · Forecast remain). (The timeline now lives in each record's right rail.)
- **Accounts top bar:** remove the **Activities**, **Export CSV**, and **Import** buttons; keep only the account-add button **renamed to "Add account"**. (Lead import/export move into the account — slice CRM-3.)
- **Account create → category-first minimal:** in `ClientFormDialog` create mode, show only **Name** + **Category** (+ Type, Status). Hide the rest of the fields in create mode (they stay in EDIT mode and are now inline-editable on the record per CRM-1). Keep the live `findDuplicates`/`DuplicateBanner`. Edit mode unchanged.

Verify build+test. Commit.

## SLICE CRM-3 — Leads inside the account: import / export / add single + dedupe

**Files:** `src/components/clients/ClientDetailDrawer.tsx` (Leads tab), `src/services/supabase/leads.ts`, a lead-import entry.
- In the account drawer's **Leads** tab header (no "All workspaces" control there), add three actions: **Import leads**, **Export leads**, **Add single lead**.
  - **Add single lead** → `LeadFormDialog` prefilled `defaultAccountId=client.clientId`, category picker (existing flow).
  - **Export leads** → new `exportLeadsToCsv(leads)` (mirror `exportClientsToCsv`) over this account's leads; download.
  - **Import leads** → `ImportLeadsDialog` scoped to this account (prefill accountId so imported rows attach to the account), with **dedupe**: add `findLeadDuplicates(orgId, { email, lastName, company })` in `leads.ts` (mirror `dupDetection.findDuplicates`) and surface matches in the import preview (HubSpot/Salesforce style — mark a row "matches existing lead <name>" and let the user skip it; default skip-or-import choice). Imported leads attach to this account (account_id set).
- Remove any workspace selector/"All workspaces" affordance shown inside the account leads area.

Verify build+test (unit-test `findLeadDuplicates` + `exportLeadsToCsv`). Commit.

## SLICE CRM-4 — Lead detail right-rail parity

**File:** `src/components/leads/LeadDetailDrawer.tsx`
- Give the lead detail the same **right rail**: the record's **deals (stage + value)** + **activity timeline** (`filterByEntity(..., 'lead', leadId)`), matching the account. Ensure no Calls/Tasks tabs leak in (tasks only post-win). The lead's inline-edit + custom properties (already shipped) stay.

Verify build+test. Commit.

---

## Non-goals
- No new tables/migration (reuse clients/leads/deals/meetings/client_notes/email_events). No rich-text WYSIWYG for notes (clean plain composer + list is enough). No full free/busy availability engine in v1 (scheduler + existing-meeting list). Email send stays owner-gated until Gmail verification.

## Testing / verification
- `npm run build` + `npm run test` green per slice. New unit tests: `findLeadDuplicates`, `exportLeadsToCsv`.
- Manual: account record left fields edit inline + persist; right rail shows the account's deals (with value) + a live activity timeline; Notes/Emails(send, owner)/Meetings(schedule) work for real; Activity/Calls/Tasks tabs gone; CRM nav has no Activities tab; top bar shows only "Add account"; account create asks for category first; inside an account, Import/Export/Add-single-lead work and import flags duplicates; lead detail rail mirrors the account.

## Self-review
Almost entirely rewiring existing components into the account drawer (InlineField, SendEmailDialog, CreateMeetingDialog, ActivitiesTimeline, deals-by-account) + two small new utilities (lead dedupe + lead CSV export). No data-model change. Each slice is independently shippable; CRM-1 is the centerpiece and gets a review pass.
