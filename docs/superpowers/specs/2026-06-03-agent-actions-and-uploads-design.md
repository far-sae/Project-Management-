# In-app AI agent: do-everything actions + 500 MB uploads

**Date:** 2026-06-03
**Status:** Approved (design)
**Branch:** `agent-everything-uploads` (stacked on `crm-module-permissions`; uses `canEditModule` + the grant-gated RLS. Rebase order: bot/quick-wins → permissions → this.)

## Summary

Turn the existing in-app CRM assistant (`CrmAssistantChat` → `crm-assistant` edge fn, Claude tool-use) from "read + propose a couple of writes" into a **do-everything assistant**: it can create and edit records across CRM **and** PM, assign tasks to org members, and attach files (any type, up to **500 MB** via resumable upload) — all **proposed → confirmed → executed client-side** so it inherits the app's RLS and the #4 module grants automatically.

This is one combined spec covering (A) agent actions and (B) 500 MB resumable uploads, because the chat's file-attach capability depends on the upload infra.

## Existing baseline (do not rebuild)
- `crm-assistant/index.ts`: Claude `claude-sonnet-4-6` tool loop (cap 4). Reads via service-role admin client; returns `{ reply, proposed_actions }`. Auth: user Bearer token → role. Current tools: `summarize_pipeline`, `list_overdue_tasks`, `list_hot_leads`, `deal_detail`, `propose_draft_email`, `propose_move_deal_stage`.
- `CrmAssistantChat.tsx`: renders proposed actions as Confirm buttons; `handleAction` executes **client-side** (`move_deal_stage` → `useDeals().update` → `crm_update_deal` RPC). `create_task`/`classify_lead` are proposed but unwired.
- `attachments.ts`: `uploadAttachment` uses single-request `supabase.storage.upload()` (unreliable at 500 MB); `attachToEntity` pattern + orphan rollback already exist.

## Core principle
**The edge fn only proposes; the client executes via the app's own services.** This means: no permission logic is duplicated server-side; every executed write goes through the same RLS/RPCs as a manual UI action, so the #4 Deals/Leads grants and existing role rules are enforced for free.

## A. Agent actions

### A1. New edge-fn tools
Read/resolution (so the agent turns names → ids before proposing; never invents ids):
- `list_org_members()` → `[{ user_id, name, role }]` (for assignment).
- `find_records(entity, query)` → up to 6 `{ id, label }` for `client|deal|lead|project|contact`. If >1, the agent asks the user which one (conversational disambiguation) instead of guessing.

Propose tools (each returns a `proposed_action`; payloads carry resolved ids):
- **CRM create:** `propose_create_client`, `propose_create_lead`, `propose_create_contact`, `propose_create_deal`, `propose_create_meeting`, `propose_create_call`, `propose_log_note`.
- **CRM edit:** `propose_move_deal_stage` (exists), `propose_update_deal` (value / currency / expected_close_date), `propose_update_lead_status`.
- **Tasks + assign:** `propose_create_client_task` and `propose_create_pm_task` (both accept optional `assignee_id`); `propose_assign_task` (set assignee on an existing task).
- **PM create:** `propose_create_project`, `propose_create_workspace`.

System-prompt rules added: resolve ids via the read tools first; propose, never claim done; respect the caller's role; if a `find_records` lookup is ambiguous, ask.

**Read-tool gating (closes a #4 leak):** because the edge fn reads with the service-role client (bypassing RLS), any Deals/Leads-touching read tool (`summarize_pipeline`, `deal_detail`, `find_records` for `deal`/`lead`, plus the existing `list_hot_leads`) must first call `has_module_access(auth.userId, org, '<module>', false)` (the #4 helper, via the admin client) and return `{ error: "no access" }` when false. Owner/admin pass (the helper bypasses). Without this, a member with no Deals grant could still ask the agent to summarize the pipeline and get the data. Non-CRM-module reads (members, tasks, projects) keep their existing behavior.

### A2. Client execution (`handleAction`)
`ProposedAction.type` expands to the union above. `handleAction` maps each type to an **existing app service/hook** (exact functions confirmed in the plan — e.g. deals service, CRM client/lead/contact services, client-task service, PM task + project services). No new write paths are invented; we call what the manual UI calls.

### A3. Permission gating (reuses #4)
A pure `canRunAction(type, perms)` decides whether a Confirm button renders:
- `deal_*` → `canEditModule('deals')`; `lead_*` → `canEditModule('leads')` (from #4 `OrganizationContext`).
- `client/contact/meeting/call/note/project/workspace/task_*` → existing role rules (`canManage`/admin), matching how those entities gate in the manual UI.
- Blocked → "You don't have access to do that" line instead of a Confirm button. Defense in depth: even if triggered, the underlying service hits RLS and fails safely.

## B. 500 MB resumable uploads

### B1. Infra
- Add `tus-js-client`. New `src/services/supabase/resumableUpload.ts`: `resumableUpload({ file, path, contentType, onProgress })` → uploads to Supabase Storage's resumable (TUS) endpoint with the user's access token, retries on transient failure, reports progress. Returns when complete.
- Migration `<next>_attachments_bucket_limit.sql`: `update storage.buckets set file_size_limit = 524288000 where id = 'attachments';` (500 MB). (Numbering: next free after the permissions branch's `125`; renumber if collision at merge.)
- `attachments.ts.uploadAttachment` switches its blob PUT to `resumableUpload` (keeping the metadata insert + orphan rollback), and accepts an `onProgress` callback. A shared 500 MB client-side size check (`MAX_ATTACHMENT_BYTES`) is applied in all upload entry points (TaskModal already has a 500 MB constant — consolidate to the shared one).

### B2. Attach from chat
`CrmAssistantChat` gets a file-attach control. Flow: user attaches a file → names/confirms the target record (the agent can resolve "attach to the Acme deal" via `find_records`, or the user picks) → on Confirm, the client runs `resumableUpload` + `attachToEntity` against that entity, with a progress bar in the chat. Any file type; 500 MB cap.

## Data flow
1. User message → edge fn → Claude calls read tools to resolve ids → returns `reply` + `proposed_actions`.
2. Client renders actions; Confirm gated by `canRunAction`.
3. On Confirm → existing service call (RLS/#4 enforced) → toast + the agent can be told the result on the next turn.
4. File attach → `resumableUpload` (progress) → `attachToEntity`.

## Error handling
- LLM/tool error → graceful chat error (existing pattern).
- Ambiguous/missing resolution → the agent asks; it does not fabricate ids.
- Upload failure/timeout → TUS retry; on give-up, a clear error and no orphan (rollback exists).
- Permission denial → friendly message; never a silent write (RLS backstop).
- Edge-fn tool loop stays capped (no infinite tool calls).

## Testing
- **Edge fn (Deno):** unit-test each new tool handler's returned `proposed_action` shape + `find_records`/`list_org_members` query construction, with a mocked admin client + mocked Anthropic.
- **Client (vitest):** pure `canRunAction(type, perms)` table (deal/lead need grants; others need role); `resumableUpload` calls the TUS client with the right path/headers/token (mocked tus-js-client); `handleAction` dispatches each type to the right service (mocked services).
- **Manual:** create one of each entity via chat; assign a task to a named member; move a deal stage; a 500 MB upload showing progress then appearing on the record; a Deals-no-grant member is refused a deal-create via the agent.

## Build order
Stacks on `crm-module-permissions`. Order:
1. **Uploads infra** (B1: `resumableUpload` + bucket limit + `uploadAttachment` switch + shared size constant).
2. **Edge-fn tools** (A1: read/resolution + propose_* tools + prompt rules).
3. **Client execution + gating** (A2/A3: expand `ProposedAction`, `handleAction`, `canRunAction`).
4. **Chat attach** (B2: file control + resolve target + resumable upload + progress).

## Out of scope
Server-side autonomous execution (kept client-side); record- and field-level permissions (module-level only, per #4); editing arbitrary fields beyond those listed; uploads larger than 500 MB.
