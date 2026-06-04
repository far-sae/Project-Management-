# Activity hub modernization

**Date:** 2026-06-04
**Status:** Approved (design)
**Branch:** `activity-hub-modernization` (off `main`)

## Summary

Modernize the existing Activities hub into a unified **timeline/feed** that includes notes and emails (not just tasks/meetings/calls), with inline quick-logging, @mentions, a Today/Overdue focus, an AI "next best action", and an auto follow-up nudge. Built by **extending** the existing aggregator + `ActivitiesHubPanel` (not a rewrite), and reused per-record inside the client/deal/lead drawers.

Automations modernization is a **separate** spec/build (next).

## Baseline (reuse, don't rebuild)
- `src/services/supabase/activities.ts` — `listActivities(orgId, ctx)` unions **client_tasks + meetings + calls** into a sorted `Activity[]` with `ActivityKind = "task"|"meeting"|"call"`, Zoho-style `ACTIVITY_FILTERS`, `applyActivityFilter`, category kanban. Sort = open nearest-first, closed newest-first.
- `src/components/activities/ActivitiesHubPanel.tsx` — view modes `status|kind|category|list`, search, filter dropdown, quick-create dialogs (Task/Meeting/Call).
- Tables: `client_notes` (organization_id, client_id, deal_id, kind, subject, body, occurred_at, author_id, author_name), `lead_notes` (…, lead_id, …), `email_events` (organization_id, entity_type, entity_id, direction, status, subject, snippet, from_email, occurred_at) — all from existing migrations.
- `crm-assistant` edge fn (Claude) for AI; `notifications` table for @mentions; Gmail/Calendar sync functions already populate `email_events` + meetings.

## Components

### 1. Aggregator extension (`activities.ts`)
- Add `ActivityKind` members `"note"` and `"email"`.
- Add source variants to the `Activity` union: `{ kind: "note"; row: NoteRow }`, `{ kind: "email"; row: EmailEventRow }`.
- New fetchers: `listOrgNotes(orgId)` (union client_notes + lead_notes) and `listOrgEmailEvents(orgId)`; map to `Activity` (notes/emails are always **logged/closed**, `whenAt = occurred_at`, `open=false`, `overdue=false`, owner = author/sender).
- `listActivities` fetches all five sources in parallel (each `.catch(()=>[])` so one failure doesn't blank the hub). Existing sort keeps notes/emails in the "logged, newest-first" tail.

### 2. Timeline view (`ActivitiesTimeline.tsx`, new)
- New `ViewMode` `"timeline"` in `ActivitiesHubPanel`.
- Renders two zones: **Upcoming** (open && `whenAt` in the future, nearest first) pinned at top, then **Logged** (everything else) grouped by day bucket: *Today / Yesterday / This week / Earlier* (computed with the user's timezone via the existing `user_profiles.timezone`/`format` helpers where available, else local).
- Each row: kind icon, title, related-entity label, when, owner; click opens the existing detail dialog/drawer.
- **Per-record reuse:** the same component, filtered to one entity, embeds in the client/deal/lead detail drawers (an "Activity" tab) — a single `entityFilter?: {type, id}` prop.

### 3. Inline quick-log + @mentions (`QuickLogComposer.tsx`, new)
- A composer pinned above the timeline: a text box + a kind toggle (Note / Call / Meeting). Note → insert into `client_notes`/`lead_notes` (or a generic org note if no entity); Call/Meeting → reuse existing create services with minimal fields.
- `@mention`: typing `@` opens a member picker (from `organization.members`); on submit, each mentioned member gets a row in `notifications` (reuse the existing create-notification path) linking to the record.

### 4. Today / Overdue focus
- Add filter views `my_today` (open && due today) and `overdue` (open && past) to `ACTIVITY_FILTERS` + `applyActivityFilter`.
- A small header summary line in the hub: "N due today · M overdue" (counts from the loaded set).

### 5. AI next best action (`NextBestAction.tsx`, new)
- A button (hub-level and per-record) → calls `crm-assistant` with a prompt like *"Given this record's recent activity, what is the single next best action? Propose it."* → renders the agent's reply + any `proposed_action` with the existing confirm button (reuses the Phase-2 agent execution we built). Per-record passes the resolved entity id.

### 6. Auto follow-up nudge
- When a call is marked **completed** (existing call update path), show a toast/inline prompt: "Create a follow-up task?" → prefilled `CreateTaskDialog` (same client/deal, due +3 days). Pure UI; no schema change.

### 7. Auto-log email + calendar
- Emails: surfaced by #1 (email_events in the feed). Calendar: Google-Calendar-synced meetings already land in `meetings`, so they already appear; verify the sync path during the plan. No new sync code unless a gap is found.

## Permissions
Members can view + log activities (CRM is View-default). Editing/deleting someone else's activity follows the existing per-entity rules (and the #4 grants for deal/lead-linked items via RLS). The AI next-best-action respects the agent's existing gating.

## Data flow
load → `listActivities` (5 sources) → filter view → render (timeline/kanban/list). Quick-log → insert → refresh. @mention → notification row. AI → crm-assistant → proposed action → confirm → create.

## Error handling
- Each source fetch is independently caught (one failing source never blanks the hub).
- Quick-log/insert failures → toast, no partial UI state.
- AI/edge-fn failure → graceful inline error (existing pattern).
- @mention to a non-member is ignored.

## Testing
- Unit (vitest): aggregator note/email mapping shape; timeline day-bucketing (today/yesterday/this-week/earlier) as a pure helper; today/overdue filter predicates; @mention parser (extract @names → member ids).
- Build + manual: timeline shows notes+emails+tasks+meetings+calls; upcoming pinned; quick-log a note with an @mention fires a notification; AI next-best-action proposes+creates; follow-up nudge after completing a call.

## Build phasing
1. **Phase 1 — modern feed core:** aggregator (notes+email), Timeline view, Today/Overdue. *(Makes it feel modern on its own.)*
2. **Phase 2 — interaction:** QuickLogComposer + @mentions/notifications + follow-up nudge + per-record embed.
3. **Phase 3 — AI:** NextBestAction (hub + per-record).

Each phase is independently shippable and testable.

## Out of scope
Automations (separate spec); a full email *composer* in the hub (we surface email events; sending stays in the existing email flow); real-time websocket feed (refresh-on-action is enough for v1).
