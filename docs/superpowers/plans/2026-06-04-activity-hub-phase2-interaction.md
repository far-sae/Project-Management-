# Activity Hub — Phase 2 (Quick-log + @mentions + Follow-up + Per-record) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Checkbox steps.

**Goal:** Inline quick-log a note (with @mentions → notifications), a follow-up nudge after a call is completed, and the timeline embedded per-record in the detail drawers.

**Architecture:** A `QuickLogComposer` posts notes to `client_notes`/`lead_notes` (these require a parent client/lead, so the composer takes a fixed or picked entity); `@mention` resolves against `organization.members` and fires `createNotification` per mention. The Phase-1 `ActivitiesTimeline` is embedded in the client/deal/lead drawers filtered to that entity. A follow-up nudge hooks the call-completed path.

**Tech Stack:** React + TS + Vite (vitest). No DB migration.

**Reference spec:** [docs/superpowers/specs/2026-06-04-activity-hub-modernization-design.md](../specs/2026-06-04-activity-hub-modernization-design.md). **Branch:** `activity-hub-modernization`.

**Known facts:** `createNotification(input)` lives in `src/services/supabase/database.ts` (fields: `userId, type, title, body, actorUserId?, actorDisplayName?, taskId?, projectId?`). Note creators: `createNote(orgId, clientId, userId, userName, { body, kind })` (clients.ts) and `createLeadNote(orgId, leadId, userId, userName, { body, kind })` (leads.ts) — **client_notes.client_id / lead_notes.lead_id are NOT NULL**, so a note always needs a parent entity. `organization.members` (from `useOrganization()`) has `{ userId, displayName, email, role }`.

---

## Task 1: @mention parser (TDD, pure)

**Files:** `src/services/agent/mentions.ts` (new), `tests/unit/mentions.test.ts` (new)

- [ ] **Step 1: failing test**
```typescript
import { describe, it, expect } from "vitest";
import { extractMentions } from "@/services/agent/mentions";

const members = [
  { userId: "u1", name: "Sam Lee" }, { userId: "u2", name: "Priya" }, { userId: "u3", name: "Sam" },
];
describe("extractMentions", () => {
  it("matches @name tokens to members (longest name first), de-duped", () => {
    expect(extractMentions("hey @Sam Lee and @Priya", members).map((m) => m.userId)).toEqual(["u1", "u2"]);
  });
  it("matches a single-word @Sam to the exact single-word member", () => {
    expect(extractMentions("ping @Sam", members).map((m) => m.userId)).toEqual(["u3"]);
  });
  it("returns [] when nothing matches", () => {
    expect(extractMentions("no mentions here", members)).toEqual([]);
  });
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement** `src/services/agent/mentions.ts`:
```typescript
export interface MentionMember { userId: string; name: string; }

/** Find @mentions in text and resolve to members. Tries longest member names
 *  first so "@Sam Lee" beats "@Sam". Case-insensitive; de-dupes by userId. */
export const extractMentions = (text: string, members: MentionMember[]): MentionMember[] => {
  const byLongest = [...members].sort((a, b) => b.name.length - a.name.length);
  const low = text.toLowerCase();
  const hit = new Map<string, MentionMember>();
  for (const m of byLongest) {
    const needle = `@${m.name.toLowerCase()}`;
    if (low.includes(needle)) hit.set(m.userId, m);
  }
  // Preserve members[] order in the result.
  return members.filter((m) => hit.has(m.userId)).map((m) => hit.get(m.userId)!);
};
```

- [ ] **Step 4: run → PASS.** Commit:
```bash
git add src/services/agent/mentions.ts tests/unit/mentions.test.ts
git commit -m "feat(activities): @mention extractor"
```

## Task 2: QuickLogComposer (inline note + @mention)

**Files:** `src/components/activities/QuickLogComposer.tsx` (new)

- [ ] **Step 1: build the component.** Props: `entity?: { type: "client" | "lead"; id: string; label?: string }`, `onPosted: () => void`. Behaviour:
  - A textarea + a small "related to" indicator. If `entity` is provided (per-record use), it's fixed and shown as a chip. If not (hub use), render a required client/lead picker (search `getOrganizationClients` + leads); a note can't be posted without a parent.
  - A Post button: on submit, call `createNote(orgId, entity.id, user.userId, user.displayName, { body, kind: "note" })` when `entity.type === "client"`, else `createLeadNote(...)`.
  - After insert, resolve `extractMentions(body, members.map(m => ({ userId: m.userId, name: m.displayName || m.email })))` and for each mentioned member (excluding self) call `createNotification({ userId, type: <existing mention/comment type>, title: \`${user.displayName} mentioned you\`, body: body.slice(0,140), actorUserId: user.userId, actorDisplayName: user.displayName })`. Use the SAME notification `type` the app already uses for comment mentions (grep the codebase for an existing mention/comment notification type; if none, use `"mention"`).
  - On success: toast, clear the box, call `onPosted()`.
  - `@` typing: when the user types `@`, show a dropdown of `organization.members` filtered by the text after `@`; clicking inserts `@<displayName> `. (A lightweight popover is fine.)
- [ ] **Step 2: mount it** at the top of the Timeline view in `ActivitiesHubPanel` (hub use → no fixed entity) and pass `onPosted={() => reload()}` (reuse the existing reload trigger). Build → success.
- [ ] **Step 3: commit**
```bash
git add src/components/activities/QuickLogComposer.tsx src/components/activities/ActivitiesHubPanel.tsx
git commit -m "feat(activities): inline quick-log note composer with @mentions"
```

## Task 3: Follow-up nudge after a completed call

**Files:** wherever a call's status is set to `completed` (grep `callStatus`/`"completed"` in `src/components/activities/` — likely `ActivityDetailDialog.tsx`)

- [ ] **Step 1:** After a successful call-status update to `completed`, show a toast with an action button: `toast("Call done — create a follow-up?", { action: { label: "Create task", onClick: () => openCreateTaskPrefilled(...) } })` (use the existing `sonner` toast API used in the file). The prefilled `CreateTaskDialog` opens with the same `clientId`/`dealId` and `dueAt = now + 3 days`, title `Follow up: <call subject>`. Reuse the existing `CreateTaskDialog` + its open-state.
- [ ] **Step 2:** Build → success. Commit:
```bash
git add src/components/activities/ActivityDetailDialog.tsx
git commit -m "feat(activities): follow-up nudge after a call is completed"
```

## Task 4: Per-record timeline embed

**Files:** the client/deal/lead detail drawers (grep for `DealDetailDrawer.tsx`, `LeadDetailDrawer.tsx`, and the client drawer/detail component), `src/services/supabase/activities.ts`

- [ ] **Step 1:** Add a pure helper to `activities.ts`:
```typescript
/** Filter loaded activities to those linked to a specific entity. */
export const filterByEntity = (
  activities: Activity[], type: "client" | "deal" | "lead", id: string,
): Activity[] => activities.filter((a) => {
  const s = a.source;
  if (type === "deal") return (s.kind === "task" || s.kind === "meeting" || s.kind === "call") && (s.row as { dealId?: string }).dealId === id
    || (s.kind === "note") && s.row.deal_id === id
    || (s.kind === "email") && s.row.entity_type === "deal" && s.row.entity_id === id;
  if (type === "client") return (s.kind === "task" || s.kind === "meeting" || s.kind === "call") && (s.row as { clientId?: string }).clientId === id
    || (s.kind === "note") && s.row.client_id === id
    || (s.kind === "email") && s.row.entity_type === "client" && s.row.entity_id === id;
  // lead
  return (s.kind === "note") && s.row.lead_id === id
    || (s.kind === "email") && s.row.entity_type === "lead" && s.row.entity_id === id;
});
```
(Add a vitest case to `activities.timeline.test.ts` for `filterByEntity` with a couple of fixture activities.)

- [ ] **Step 2:** In each detail drawer, add an **Activity** tab/section that: loads `listActivities(orgId, ctx)` once, runs `filterByEntity(...)`, renders `<ActivitiesTimeline activities={...} onOpen={...} />`, and mounts `<QuickLogComposer entity={{type, id, label}} onPosted={reload} />` at the top. Match each drawer's existing tab pattern. (If a client detail drawer doesn't exist, add the section to wherever client details render.)

- [ ] **Step 3:** Build → success. Commit:
```bash
git add src/services/supabase/activities.ts tests/unit/activities.timeline.test.ts src/components
git commit -m "feat(activities): per-record activity timeline + quick-log in detail drawers"
```

## Task 5: Verify
- [ ] `npm run test` (incl. `mentions`, `activities.timeline`) → green.
- [ ] `npm run build` → success.
- Manual: jot a note with `@name` from the hub → it appears in the feed + the mentioned member gets a notification; complete a call → follow-up toast; open a client/deal/lead → Activity tab shows its timeline + a quick-log box.

## Self-Review
**Spec coverage (Phase 2):** inline quick-log note (Task 2) ✓; @mentions→notifications (Tasks 1–2) ✓; follow-up nudge (Task 3) ✓; per-record embed (Task 4) ✓. Calls/meetings keep their existing quick-create dialogs (not re-inlined — documented scope).
**Placeholder scan:** Drawer file locations + the existing mention notification type are "grep to confirm" (real, code-dependent), called out. Pure pieces (`extractMentions`, `filterByEntity`) have full code + tests.
**Type consistency:** `extractMentions(text, {userId,name}[])` matches its test + the composer call. `filterByEntity(activities,type,id)` uses the Phase-1 `Activity.source` union variants (note/email/task/meeting/call). `createNotification` field names match database.ts.
