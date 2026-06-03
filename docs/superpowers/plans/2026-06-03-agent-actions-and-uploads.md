# Agent Actions + 500 MB Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The in-app CRM assistant can create/edit records across CRM + PM, assign tasks to org members, and attach files up to 500 MB — proposed → confirmed → executed client-side (inheriting RLS + the #4 module grants).

**Architecture:** Extend the `crm-assistant` edge fn with resolution reads + `propose_*` tools (it still only proposes). The chat's `handleAction` executes each confirmed action via the app's **existing services** (no new write paths). A new TUS `resumableUpload` powers 500 MB uploads in the chat and the normal attachment UI.

**Tech Stack:** React + TS + Vite (vitest); Deno edge fn (`deno test`/`deno check`); `tus-js-client` (new dep); Supabase Storage resumable endpoint. Deno binary: `C:\Users\faraz\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe`.

**Reference spec:** [docs/superpowers/specs/2026-06-03-agent-actions-and-uploads-design.md](../specs/2026-06-03-agent-actions-and-uploads-design.md).

**Branch:** `agent-everything-uploads` (off `crm-module-permissions`; uses `canEditModule` from #4).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `package.json` | add `tus-js-client` | Modify |
| `src/services/supabase/resumableUpload.ts` | TUS upload + `MAX_ATTACHMENT_BYTES` | Create |
| `tests/unit/resumableUpload.test.ts` | TUS call construction test | Create |
| `supabase/migrations/126_attachments_bucket_limit.sql` | bucket 500 MB limit | Create |
| `src/services/supabase/attachments.ts` | use resumableUpload + onProgress | Modify |
| `supabase/functions/crm-assistant/index.ts` | resolution + propose_* tools + read-gating | Modify |
| `supabase/functions/crm-assistant/actions.ts` | shared action/tool definitions | Create |
| `src/services/agent/agentActions.ts` | `ProposedAction` union + `canRunAction` | Create |
| `tests/unit/canRunAction.test.ts` | gating logic test | Create |
| `src/components/aiAgent/CrmAssistantChat.tsx` | execute all actions + file attach | Modify |

---

# UNIT 1 — 500 MB resumable upload infra

## Task 1: Add tus-js-client + the resumableUpload helper (TDD)

**Files:** `package.json`, `src/services/supabase/resumableUpload.ts`, `tests/unit/resumableUpload.test.ts`

- [ ] **Step 1: Install the dependency**

Run: `npm install tus-js-client@^4`
Expected: adds `tus-js-client` to `dependencies`.

- [ ] **Step 2: Write the failing test**

`tests/unit/resumableUpload.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const startSpy = vi.fn();
const findPrev = vi.fn().mockResolvedValue([]);
const UploadMock = vi.fn().mockImplementation((_file, opts) => ({
  options: opts,
  start: startSpy,
  findPreviousUploads: findPrev,
  resumeFromPreviousUpload: vi.fn(),
}));
vi.mock("tus-js-client", () => ({ Upload: UploadMock }));
vi.mock("@/services/supabase/config", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok-123" } } }) } },
}));

import { resumableUpload } from "@/services/supabase/resumableUpload";

describe("resumableUpload", () => {
  beforeEach(() => { UploadMock.mockClear(); startSpy.mockClear(); });

  it("configures the TUS upload with the Supabase resumable endpoint, bearer token, and 6MB chunks", async () => {
    const file = new File([new Uint8Array(10)], "x.pdf", { type: "application/pdf" });
    // Resolve onSuccess immediately
    UploadMock.mockImplementationOnce((_f, opts) => {
      queueMicrotask(() => opts.onSuccess());
      return { options: opts, start: startSpy, findPreviousUploads: findPrev, resumeFromPreviousUpload: vi.fn() };
    });
    await resumableUpload({ bucket: "attachments", path: "org/deal/d1/x.pdf", file });
    const opts = UploadMock.mock.calls[0][1];
    expect(opts.endpoint).toContain("/storage/v1/upload/resumable");
    expect(opts.headers.authorization).toBe("Bearer tok-123");
    expect(opts.chunkSize).toBe(6 * 1024 * 1024);
    expect(opts.metadata.bucketName).toBe("attachments");
    expect(opts.metadata.objectName).toBe("org/deal/d1/x.pdf");
    expect(startSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it → FAIL** (`npm run test -- resumableUpload`; module missing).

- [ ] **Step 4: Implement `src/services/supabase/resumableUpload.ts`**

```typescript
// src/services/supabase/resumableUpload.ts
// Resumable (TUS) uploads to Supabase Storage — reliable for large files
// (up to 500 MB) where a single-request .upload() would time out.
import * as tus from "tus-js-client";
import { supabase } from "./config";

export const MAX_ATTACHMENT_BYTES = 500 * 1024 * 1024; // 500 MB

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface ResumableUploadOpts {
  bucket: string;
  path: string;
  file: File;
  contentType?: string;
  onProgress?: (pct: number) => void;
}

/** Upload a file to Supabase Storage via the resumable (TUS) protocol.
 *  Resolves when the object is fully stored; rejects on unrecoverable error. */
export const resumableUpload = async (opts: ResumableUploadOpts): Promise<void> => {
  if (opts.file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit`);
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(opts.file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      // Supabase requires exactly 6MB chunks for resumable uploads.
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: opts.bucket,
        objectName: opts.path,
        contentType: opts.contentType || opts.file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      onProgress: (sent, total) => opts.onProgress?.(total ? Math.round((sent / total) * 100) : 0),
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((prev) => {
      if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    }).catch(() => upload.start());
  });
};
```

- [ ] **Step 5: Run it → PASS** (`npm run test -- resumableUpload`).

- [ ] **Step 6: Commit**
```bash
git add package.json package-lock.json src/services/supabase/resumableUpload.ts tests/unit/resumableUpload.test.ts
git commit -m "feat(web): resumable (TUS) upload helper + 500MB constant"
```

## Task 2: Bucket size limit migration

**Files:** `supabase/migrations/126_attachments_bucket_limit.sql`

- [ ] **Step 1: Create the migration** (next free number; renumber if a collision appears at merge)
```sql
-- 126_attachments_bucket_limit.sql
-- Allow up to 500 MB objects in the attachments bucket (resumable uploads).
update storage.buckets set file_size_limit = 524288000 where id = 'attachments';
```

- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/126_attachments_bucket_limit.sql
git commit -m "feat(db): raise attachments bucket file size limit to 500MB"
```

## Task 3: Switch uploadAttachment to resumable + progress

**Files:** `src/services/supabase/attachments.ts`

- [ ] **Step 1: Import + use the resumable helper**

Add the import:
```typescript
import { resumableUpload, MAX_ATTACHMENT_BYTES } from "./resumableUpload";
```
Add `onProgress?: (pct: number) => void;` to the `uploadAttachment` params type. Replace the existing `supabase.storage.from(BUCKET).upload(storagePath, file, {...})` block (the `uploadErr` block) with:
```typescript
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit`);
  }
  try {
    await resumableUpload({
      bucket: BUCKET, path: storagePath, file,
      contentType: file.type || undefined, onProgress: params.onProgress,
    });
  } catch (uploadErr) {
    logger.error("attachment upload failed:", uploadErr);
    throw new Error(uploadErr instanceof Error ? uploadErr.message : "Upload failed");
  }
```
(Keep the metadata insert + orphan-rollback exactly as-is below it.)

- [ ] **Step 2: Build** → `npm run build` (success; errors confined to this file).

- [ ] **Step 3: Commit**
```bash
git add src/services/supabase/attachments.ts
git commit -m "feat(web): uploadAttachment uses resumable upload + progress"
```

---

# UNIT 2 — Edge-fn resolution + propose tools

## Task 4: Expand the crm-assistant tool set + read-gating

**Files:** `supabase/functions/crm-assistant/index.ts`

> The spec lists the full tool set. Implement the tools below. Each `propose_*` tool returns `{ result: { status }, proposed: { type, label, payload } }`; payloads carry **resolved ids** (the agent calls the resolution reads first).

- [ ] **Step 1: Expand the `ProposedAction` type** (lines 42–46):
```typescript
interface ProposedAction {
  type:
    | "draft_email" | "move_deal_stage"
    | "create_client" | "create_lead" | "create_contact" | "create_deal"
    | "create_meeting" | "create_call" | "log_note"
    | "update_deal" | "update_lead_status"
    | "create_client_task" | "create_pm_task" | "assign_task"
    | "create_project" | "create_workspace";
  label: string;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 2: Add a module-read guard helper** (above `runTool`):
```typescript
// Gate Deals/Leads READ tools by the #4 module grant (the admin client bypasses
// RLS, so we must check explicitly). owner/admin pass via the helper.
const canRead = async (admin: SupabaseClient, userId: string | undefined, orgId: string, module: "deals" | "leads") => {
  if (!userId) return true; // service-role caller
  const { data } = await admin.rpc("has_module_access", {
    p_user_id: userId, p_org_id: orgId, p_module: module, p_need_edit: false,
  });
  return data === true;
};
```

- [ ] **Step 3: Add the new tool definitions** to the `TOOLS` array (after `propose_move_deal_stage`):
```typescript
  { name: "list_org_members", description: "List org members (user_id + name + role) so you can resolve 'assign to <name>'. Read-only.",
    input_schema: { type: "object", properties: {}, required: [] } },
  { name: "find_records", description: "Find clients/deals/leads/projects/contacts by name. Returns up to 6 {id,label}. If more than one matches, ask the user which one. Read-only.",
    input_schema: { type: "object", properties: {
      entity: { type: "string", enum: ["client","deal","lead","project","contact"] },
      query: { type: "string" } }, required: ["entity","query"] } },
  { name: "propose_create_client", description: "Propose creating a client/account.",
    input_schema: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, industry: { type: "string" } }, required: ["name"] } },
  { name: "propose_create_lead", description: "Propose creating a lead.",
    input_schema: { type: "object", properties: { first_name: { type: "string" }, last_name: { type: "string" }, company: { type: "string" }, email: { type: "string" }, phone: { type: "string" } }, required: ["last_name","company"] } },
  { name: "propose_create_contact", description: "Propose adding a contact under a client (use find_records to get client_id).",
    input_schema: { type: "object", properties: { client_id: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" }, email: { type: "string" }, phone: { type: "string" } }, required: ["client_id","last_name"] } },
  { name: "propose_create_deal", description: "Propose creating a deal.",
    input_schema: { type: "object", properties: { title: { type: "string" }, client_id: { type: "string" }, value: { type: "number" }, currency: { type: "string" }, stage: { type: "string", enum: ["lead","qualified","proposal","negotiation","won","lost"] } }, required: ["title"] } },
  { name: "propose_create_meeting", description: "Propose scheduling a meeting (ISO start).",
    input_schema: { type: "object", properties: { title: { type: "string" }, start_at: { type: "string" }, client_id: { type: "string" } }, required: ["title","start_at"] } },
  { name: "propose_create_call", description: "Propose logging a call.",
    input_schema: { type: "object", properties: { subject: { type: "string" }, client_id: { type: "string" }, outcome: { type: "string" } }, required: ["subject"] } },
  { name: "propose_log_note", description: "Propose a note on a client (use find_records for client_id).",
    input_schema: { type: "object", properties: { client_id: { type: "string" }, body: { type: "string" } }, required: ["client_id","body"] } },
  { name: "propose_update_deal", description: "Propose editing a deal's value/currency/close date.",
    input_schema: { type: "object", properties: { deal_id: { type: "string" }, value: { type: "number" }, currency: { type: "string" }, expected_close_date: { type: "string" } }, required: ["deal_id"] } },
  { name: "propose_update_lead_status", description: "Propose changing a lead's status.",
    input_schema: { type: "object", properties: { lead_id: { type: "string" }, lead_status: { type: "string" } }, required: ["lead_id","lead_status"] } },
  { name: "propose_create_client_task", description: "Propose a CRM follow-up task; optional assignee_id (use list_org_members).",
    input_schema: { type: "object", properties: { title: { type: "string" }, client_id: { type: "string" }, due_at: { type: "string" }, assignee_id: { type: "string" }, assignee_name: { type: "string" } }, required: ["title"] } },
  { name: "propose_create_pm_task", description: "Propose a project task (needs project_id via find_records); optional assignee.",
    input_schema: { type: "object", properties: { title: { type: "string" }, project_id: { type: "string" }, due_date: { type: "string" }, assignee_id: { type: "string" }, assignee_name: { type: "string" } }, required: ["title","project_id"] } },
  { name: "propose_assign_task", description: "Propose assigning an existing task to a member.",
    input_schema: { type: "object", properties: { task_kind: { type: "string", enum: ["client","pm"] }, task_id: { type: "string" }, assignee_id: { type: "string" }, assignee_name: { type: "string" } }, required: ["task_kind","task_id","assignee_id"] } },
  { name: "propose_create_project", description: "Propose creating a project.",
    input_schema: { type: "object", properties: { name: { type: "string" }, workspace_id: { type: "string" } }, required: ["name"] } },
  { name: "propose_create_workspace", description: "Propose creating a workspace.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
```

- [ ] **Step 4: Add `runTool` cases.** Update `runTool`'s signature to accept the caller's `userId` (thread `auth.userId` from the request handler into `runTool`). Add read-gating to the existing deals/leads reads and add the new cases. Read cases:
```typescript
    case "list_org_members": {
      const { data: org } = await admin.from("organizations").select("owner_id, members").eq("organization_id", orgId).maybeSingle();
      const members = (Array.isArray(org?.members) ? org!.members : []) as Array<Record<string, unknown>>;
      return { result: members.map((m) => ({ user_id: m.userId ?? m.user_id, name: m.displayName ?? m.email, role: m.role ?? "member" })) };
    }
    case "find_records": {
      const entity = String(input.entity ?? ""); const q = `%${String(input.query ?? "").trim()}%`;
      const cfg: Record<string, { table: string; pk: string; col: string }> = {
        client: { table: "clients", pk: "client_id", col: "name" },
        deal: { table: "deals", pk: "deal_id", col: "title" },
        lead: { table: "leads", pk: "lead_id", col: "last_name" },
        project: { table: "projects", pk: "project_id", col: "name" },
        contact: { table: "client_contacts", pk: "contact_id", col: "last_name" },
      }[entity] ?? null as never;
      if (!cfg) return { result: { error: "bad entity" } };
      if ((entity === "deal") && !(await canRead(admin, userId, orgId, "deals"))) return { result: { error: "no access" } };
      if ((entity === "lead") && !(await canRead(admin, userId, orgId, "leads"))) return { result: { error: "no access" } };
      const { data } = await admin.from(cfg.table).select(`${cfg.pk}, ${cfg.col}`).eq("organization_id", orgId).ilike(cfg.col, q).limit(6);
      return { result: (data ?? []).map((r) => ({ id: (r as Record<string,string>)[cfg.pk], label: (r as Record<string,string>)[cfg.col] })) };
    }
```
For each `propose_*` case, return the proposed action verbatim from input, e.g.:
```typescript
    case "propose_create_deal":
      return { result: { status: "proposed" }, proposed: { type: "create_deal", label: `Create deal "${String(input.title ?? "")}"`, payload: input } };
    case "propose_create_client":
      return { result: { status: "proposed" }, proposed: { type: "create_client", label: `Create client "${String(input.name ?? "")}"`, payload: input } };
    case "propose_create_lead":
      return { result: { status: "proposed" }, proposed: { type: "create_lead", label: `Create lead ${String(input.last_name ?? "")} (${String(input.company ?? "")})`, payload: input } };
    case "propose_create_contact":
      return { result: { status: "proposed" }, proposed: { type: "create_contact", label: `Add contact ${String(input.last_name ?? "")}`, payload: input } };
    case "propose_create_meeting":
      return { result: { status: "proposed" }, proposed: { type: "create_meeting", label: `Schedule "${String(input.title ?? "")}"`, payload: input } };
    case "propose_create_call":
      return { result: { status: "proposed" }, proposed: { type: "create_call", label: `Log call "${String(input.subject ?? "")}"`, payload: input } };
    case "propose_log_note":
      return { result: { status: "proposed" }, proposed: { type: "log_note", label: `Add note`, payload: input } };
    case "propose_update_deal":
      return { result: { status: "proposed" }, proposed: { type: "update_deal", label: `Update deal`, payload: input } };
    case "propose_update_lead_status":
      return { result: { status: "proposed" }, proposed: { type: "update_lead_status", label: `Set lead status → ${String(input.lead_status ?? "")}`, payload: input } };
    case "propose_create_client_task":
      return { result: { status: "proposed" }, proposed: { type: "create_client_task", label: `Task "${String(input.title ?? "")}"${input.assignee_name ? ` → ${String(input.assignee_name)}` : ""}`, payload: input } };
    case "propose_create_pm_task":
      return { result: { status: "proposed" }, proposed: { type: "create_pm_task", label: `Project task "${String(input.title ?? "")}"`, payload: input } };
    case "propose_assign_task":
      return { result: { status: "proposed" }, proposed: { type: "assign_task", label: `Assign → ${String(input.assignee_name ?? input.assignee_id)}`, payload: input } };
    case "propose_create_project":
      return { result: { status: "proposed" }, proposed: { type: "create_project", label: `Create project "${String(input.name ?? "")}"`, payload: input } };
    case "propose_create_workspace":
      return { result: { status: "proposed" }, proposed: { type: "create_workspace", label: `Create workspace "${String(input.name ?? "")}"`, payload: input } };
```
Also gate the existing reads: at the top of `summarize_pipeline` and `deal_detail` add `if (!(await canRead(admin, userId, orgId, "deals"))) return { result: { error: "no access" } };`; in `list_hot_leads` add the `"leads"` guard.

- [ ] **Step 5: Thread `userId` into `runTool`.** In the `Deno.serve` handler, change the call `runTool(admin, body.organization_id, t.name, t.input ...)` to pass `auth.userId`: `runTool(admin, body.organization_id, auth.userId, t.name, ...)` and update the `runTool` signature `(admin, orgId, userId, name, input)`.

- [ ] **Step 6: Update the system prompt** (lines 260–268) — append:
```
- You can create and edit records (clients, leads, contacts, deals, meetings, calls, notes, tasks, projects, workspaces) and assign tasks. ALWAYS resolve ids first with find_records / list_org_members, then call the matching propose_* tool. Never invent an id. If find_records returns more than one match, ask the user which one. Propose only — the user confirms in the UI before anything is written.
```

- [ ] **Step 7: Type-check** → `"$DENO" check supabase/functions/crm-assistant/index.ts` (clean).

- [ ] **Step 8: Commit**
```bash
git add supabase/functions/crm-assistant/index.ts
git commit -m "feat(agent): resolution reads + propose_* tools for all CRM/PM actions + read-gating"
```

---

# UNIT 3 — Client execution + permission gating

## Task 5: ProposedAction union + canRunAction (TDD)

**Files:** `src/services/agent/agentActions.ts`, `tests/unit/canRunAction.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/unit/canRunAction.test.ts`):
```typescript
import { describe, it, expect } from "vitest";
import { canRunAction } from "@/services/agent/agentActions";

const perms = (over: Partial<{ isAdmin: boolean; deals: boolean; leads: boolean }> = {}) => ({
  isAdmin: over.isAdmin ?? false,
  canEditModule: (m: "deals" | "leads") => (m === "deals" ? !!over.deals : !!over.leads),
});

describe("canRunAction", () => {
  it("deal actions require deals edit grant", () => {
    expect(canRunAction("create_deal", perms({ deals: false }))).toBe(false);
    expect(canRunAction("update_deal", perms({ deals: true }))).toBe(true);
    expect(canRunAction("move_deal_stage", perms({ deals: true }))).toBe(true);
  });
  it("lead actions require leads edit grant", () => {
    expect(canRunAction("create_lead", perms({ leads: false }))).toBe(false);
    expect(canRunAction("update_lead_status", perms({ leads: true }))).toBe(true);
  });
  it("non-CRM-module actions require admin", () => {
    expect(canRunAction("create_project", perms({ isAdmin: false }))).toBe(false);
    expect(canRunAction("create_project", perms({ isAdmin: true }))).toBe(true);
    expect(canRunAction("create_client", perms({ isAdmin: true }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/services/agent/agentActions.ts`:**
```typescript
// src/services/agent/agentActions.ts
// Shared types + the pure permission gate for AI-proposed actions executed
// client-side. Keeps the gating logic testable and in one place.
export type AgentActionType =
  | "draft_email" | "move_deal_stage"
  | "create_client" | "create_lead" | "create_contact" | "create_deal"
  | "create_meeting" | "create_call" | "log_note"
  | "update_deal" | "update_lead_status"
  | "create_client_task" | "create_pm_task" | "assign_task"
  | "create_project" | "create_workspace";

export interface ProposedAction {
  type: AgentActionType;
  label: string;
  payload: Record<string, unknown>;
}

export interface ActionPerms {
  isAdmin: boolean;
  canEditModule: (m: "deals" | "leads") => boolean;
}

const DEAL_ACTIONS = new Set<AgentActionType>(["create_deal", "update_deal", "move_deal_stage"]);
const LEAD_ACTIONS = new Set<AgentActionType>(["create_lead", "update_lead_status"]);

/** Whether the current user may run a proposed action. deal_*/lead_* need the
 *  #4 module edit grant; everything else needs admin/owner (matching how those
 *  entities gate in the manual UI). draft_email is always allowed (no write). */
export const canRunAction = (type: AgentActionType, perms: ActionPerms): boolean => {
  if (type === "draft_email") return true;
  if (DEAL_ACTIONS.has(type)) return perms.canEditModule("deals");
  if (LEAD_ACTIONS.has(type)) return perms.canEditModule("leads");
  return perms.isAdmin;
};
```

- [ ] **Step 4: Run → PASS** (`npm run test -- canRunAction`).

- [ ] **Step 5: Commit**
```bash
git add src/services/agent/agentActions.ts tests/unit/canRunAction.test.ts
git commit -m "feat(agent): ProposedAction union + canRunAction gate"
```

## Task 6: Wire handleAction to execute every action

**Files:** `src/components/aiAgent/CrmAssistantChat.tsx`

- [ ] **Step 1: Imports + context.** Add:
```tsx
import { canRunAction, type ProposedAction, type AgentActionType } from "@/services/agent/agentActions";
import { createDeal, updateDeal } from "@/services/supabase/deals";
import { createLead, updateLead, createLeadNote } from "@/services/supabase/leads";
import { createClient as createCrmClient, createContact, createNote } from "@/services/supabase/clients";
import { createClientTask, updateClientTask } from "@/services/supabase/clientTasks";
import { createTask } from "@/services/supabase/database";
import { createProject } from "@/services/supabase/database";
import { createWorkspace } from "@/services/supabase/workspaces";
import { createMeeting } from "@/services/supabase/meetings";
import { createCall } from "@/services/supabase/calls";
```
Replace the local `ProposedAction` interface (lines 22–26) with the imported type. In the component, pull from context: `const { organization, isOwner, isAdmin, canEditModule } = useOrganization();` and derive `const perms = { isAdmin, canEditModule };` and `const uid = user?.userId ?? ""; const uname = user?.displayName ?? "";`.

- [ ] **Step 2: Replace `handleAction`** with a full dispatch (uses the exact service signatures):
```tsx
  const handleAction = async (action: ProposedAction) => {
    const id = `${action.type}-${JSON.stringify(action.payload)}`;
    const orgId = organization?.organizationId;
    if (!orgId) { toast.error("No organization"); return; }
    if (!canRunAction(action.type, perms)) { toast.error("You don't have access to do that"); return; }
    const p = action.payload as Record<string, any>;
    setActingActionId(id);
    try {
      switch (action.type) {
        case "move_deal_stage":
          await updateDeal(orgId, String(p.deal_id), { stage: p.new_stage });
          toast.success("Deal moved"); break;
        case "update_deal":
          await updateDeal(orgId, String(p.deal_id), { value: p.value, currency: p.currency, expectedCloseDate: p.expected_close_date ? new Date(p.expected_close_date) : undefined });
          toast.success("Deal updated"); break;
        case "create_deal":
          await createDeal(orgId, uid, uname, { title: String(p.title), clientId: p.client_id ?? null, value: p.value, currency: p.currency, stage: p.stage });
          toast.success("Deal created"); break;
        case "create_lead":
          await createLead(orgId, uid, uname, { firstName: p.first_name ?? null, lastName: p.last_name ?? null, company: p.company ?? null, email: p.email ?? null, phone: p.phone ?? null });
          toast.success("Lead created"); break;
        case "update_lead_status":
          await updateLead(orgId, String(p.lead_id), { leadStatus: p.lead_status });
          toast.success("Lead updated"); break;
        case "create_client":
          await createCrmClient(orgId, uid, uname, { name: String(p.name), email: p.email ?? null, phone: p.phone ?? null, industry: p.industry ?? null });
          toast.success("Client created"); break;
        case "create_contact":
          await createContact(orgId, String(p.client_id), uid, { firstName: p.first_name ?? null, lastName: p.last_name ?? null, email: p.email ?? null, phone: p.phone ?? null });
          toast.success("Contact added"); break;
        case "log_note":
          await createNote(orgId, String(p.client_id), uid, uname, { body: String(p.body) });
          toast.success("Note added"); break;
        case "create_meeting":
          await createMeeting({ organizationId: orgId, title: String(p.title), startAt: new Date(p.start_at), endAt: new Date(new Date(p.start_at).getTime() + 30 * 60000), clientId: p.client_id ?? null, hostUserId: uid, hostName: uname, createdBy: uid, createdByName: uname });
          toast.success("Meeting scheduled"); break;
        case "create_call":
          await createCall({ organizationId: orgId, subject: String(p.subject), clientId: p.client_id ?? null, outcome: p.outcome ?? null, callerUserId: uid, callerName: uname, createdBy: uid, createdByName: uname });
          toast.success("Call logged"); break;
        case "create_client_task":
          await createClientTask(orgId, uid, uname, { title: String(p.title), clientId: p.client_id ?? null, dueAt: p.due_at ? new Date(p.due_at) : null, assignedTo: p.assignee_id ?? null, assignedToName: p.assignee_name ?? null });
          toast.success("Task created"); break;
        case "create_pm_task":
          await createTask(uid, { projectId: String(p.project_id), title: String(p.title), dueDate: p.due_date ? new Date(p.due_date) : null, assignees: p.assignee_id ? [{ userId: String(p.assignee_id), displayName: String(p.assignee_name ?? "") }] : [] }, orgId);
          toast.success("Task created"); break;
        case "assign_task":
          if (p.task_kind === "client") await updateClientTask(orgId, String(p.task_id), { assignedTo: String(p.assignee_id), assignedToName: p.assignee_name ?? null });
          else { toast.info("Reassigning project tasks from chat isn't supported yet."); break; }
          toast.success("Task assigned"); break;
        case "create_project":
          await createProject(uid, user?.email ?? "", uname, user?.photoURL ?? "", { name: String(p.name), workspaceId: p.workspace_id ?? null }, orgId);
          toast.success("Project created"); break;
        case "create_workspace":
          await createWorkspace({ name: String(p.name), organizationId: orgId });
          toast.success("Workspace created"); break;
        case "draft_email": {
          const summary = `Draft email goal:\n${String(p.goal ?? "")}`;
          try { await navigator.clipboard.writeText(summary); } catch { /* ignore */ }
          toast.info("Draft prompt copied to your clipboard."); break;
        }
        default:
          toast.info(`Action "${action.type}" not handled.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActingActionId(null);
    }
  };
```
(Confirm the exact `UpdateDealInput`/`updateLead` field names while wiring — the Explore summary lists `stage`, `value`, `currency`, `expectedCloseDate`, `leadStatus`. If a service requires more required args than shown, fill from `user`/context.)

- [ ] **Step 2b: Gate the Confirm button** — replace the `writeAction`/`disabled` logic (lines ~199–200) so the button is gated by `canRunAction`:
```tsx
                      const allowed = canRunAction(a.type, perms);
                      const disabled = !allowed;
```
and keep the existing "admin only" → change the label to "no access" when `!allowed`.

- [ ] **Step 3: Build** → `npm run build` (success).

- [ ] **Step 4: Commit**
```bash
git add src/components/aiAgent/CrmAssistantChat.tsx
git commit -m "feat(agent): execute all proposed CRM/PM actions client-side, gated by permission"
```

---

# UNIT 4 — Attach files from chat

## Task 7: File-attach control in the chat

**Files:** `src/components/aiAgent/CrmAssistantChat.tsx`

- [ ] **Step 1: Imports + state**
```tsx
import { uploadAttachment, type AttachmentEntityType } from "@/services/supabase/attachments";
import { Paperclip } from "lucide-react";
```
```tsx
const [uploadPct, setUploadPct] = useState<number | null>(null);
const fileRef = useRef<HTMLInputElement | null>(null);
```

- [ ] **Step 2: Attach handler.** v1: the file attaches to the chat's "current target" — the most recent record the agent created/edited this session (tracked in a `lastEntity` state set inside `handleAction` after a successful create), else prompt the user to say which record. Add:
```tsx
const [lastEntity, setLastEntity] = useState<{ type: AttachmentEntityType; id: string; label: string } | null>(null);
// (in each successful create case above, set e.g. setLastEntity({ type: "deal", id: created.dealId, label: created.title }))

const onPickFile = async (file: File) => {
  if (!organization?.organizationId) return;
  if (!lastEntity) { toast.info("Create or open a record first (e.g. 'create deal Acme'), then attach the file to it."); return; }
  setUploadPct(0);
  try {
    await uploadAttachment({
      organizationId: organization.organizationId,
      entityType: lastEntity.type, entityId: lastEntity.id,
      file, uploadedBy: user?.userId ?? null, uploadedByName: user?.displayName ?? null,
      onProgress: setUploadPct,
    });
    toast.success(`Attached ${file.name} to ${lastEntity.type} "${lastEntity.label}"`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Upload failed");
  } finally { setUploadPct(null); }
};
```
(For the `setLastEntity` calls: have the create cases capture the returned record id/title. The services return the created object — e.g. `const d = await createDeal(...); setLastEntity({ type: "deal", id: d.dealId, label: d.title });`.)

- [ ] **Step 3: Render the attach button + progress** next to the Send button:
```tsx
<input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.currentTarget.value = ""; }} />
<Button type="button" size="sm" variant="outline" disabled={busy || uploadPct !== null} onClick={() => fileRef.current?.click()} title="Attach a file to the last record">
  {uploadPct !== null ? <span className="text-[11px]">{uploadPct}%</span> : <Paperclip className="w-4 h-4" />}
</Button>
```

- [ ] **Step 4: Build** → `npm run build` (success).

- [ ] **Step 5: Commit**
```bash
git add src/components/aiAgent/CrmAssistantChat.tsx
git commit -m "feat(agent): attach files (resumable, up to 500MB) to the last record from chat"
```

## Task 8: Full verification

- [ ] `npm run test` → all vitest pass (incl. `resumableUpload`, `canRunAction`).
- [ ] `npm run build` → success.
- [ ] `"$DENO" check supabase/functions/crm-assistant/index.ts` → clean.

---

## Manual verification (post-deploy)
- [ ] Deploy `crm-assistant`; apply migration 126. In chat: "create a deal called Acme Q3 for 20000" → Confirm → deal appears.
- [ ] "assign a follow-up to call Acme to Sarah tomorrow" → agent resolves Sarah via list_org_members → Confirm → client task assigned.
- [ ] "create a project Website Revamp" → Confirm → project created.
- [ ] As a member with **no** Deals grant: "create a deal…" → Confirm button shows "no access"; even if forced, the service fails (RLS). The agent's "summarize my pipeline" returns no access.
- [ ] Attach a ~500 MB file in chat after creating a record → progress bar → file appears on the record.

## Self-Review
**Spec coverage:** resumable uploads + 500MB (U1) ✓; edge-fn resolution + propose_* tools for all groups + read-gating (U2) ✓; client execution via existing services + canRunAction gating reusing #4 (U3) ✓; chat attach (U4) ✓; client-side execution / no server writes ✓; read-leak fix via `canRead`+`has_module_access` ✓.
**Placeholder scan:** Service calls use the exact signatures from the code map. Two "confirm exact field names while wiring" notes (UpdateDealInput, lastEntity capture) are real code-dependent checks, called out explicitly. No TBD.
**Type consistency:** `ProposedAction`/`AgentActionType` defined once in `src/services/agent/agentActions.ts`, imported by the chat; the edge-fn `ProposedAction.type` union matches it exactly. `canRunAction(type, perms)` signature matches its test + the Confirm-gating call. `resumableUpload(opts)` matches its test + the `uploadAttachment` call. Service signatures (`createDeal(orgId,uid,uname,input)`, `createTask(uid,input,orgId)`, etc.) match the code map.
