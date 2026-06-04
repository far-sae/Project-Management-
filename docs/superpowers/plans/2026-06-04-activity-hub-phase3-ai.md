# Activity Hub — Phase 3 (AI Next Best Action) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Checkbox steps.

**Goal:** A "Next best action" button (hub-level + per-record) that asks the `crm-assistant` agent what to do next and lets the user run the suggested action in one click — reusing the existing propose→confirm executor.

**Architecture:** Extract the proposed-action executor out of `CrmAssistantChat` into a reusable hook so both the chat and the new `NextBestAction` component share one code path; `NextBestAction` calls the `crm-assistant` edge fn with a "next best action" prompt and renders the reply + any `proposed_actions` gated by `canRunAction`.

**Tech Stack:** React + TS + Vite. No DB migration. **Branch:** `activity-hub-modernization` (off main, which already has the expanded `crm-assistant` + client executor from the agent work).

**Reference spec:** [docs/superpowers/specs/2026-06-04-activity-hub-modernization-design.md](../specs/2026-06-04-activity-hub-modernization-design.md).

**Known facts:** `CrmAssistantChat.tsx` has `handleAction(action: ProposedAction)` — a switch over ~16 action types that calls the app's create/update services, gated by `canRunAction(action.type, perms)` (from `src/services/agent/agentActions.ts`), with toasts + `setLastEntity`. The edge fn is invoked via `supabase.functions.invoke('crm-assistant', { body: { organization_id, user_message, history } })` and returns `{ reply, proposed_actions }`.

---

## Task 1: Extract a shared proposed-action runner hook

**Files:** `src/services/agent/useAgentActionRunner.ts` (new), `src/components/aiAgent/CrmAssistantChat.tsx` (refactor)

- [ ] **Step 1:** Read `CrmAssistantChat.tsx`. Move the body of `handleAction` into a new hook `useAgentActionRunner()` in `src/services/agent/useAgentActionRunner.ts`:
```typescript
// Returns a runner shared by the CRM chat and the Next-Best-Action widget.
// Encapsulates: permission gate (canRunAction) → call the matching app service
// → toast. Optional onCreated lets the caller track the created record.
export interface RunResult { ok: boolean; created?: { type: string; id: string; label: string }; }
export const useAgentActionRunner = (): {
  running: string | null;
  run: (action: ProposedAction) => Promise<RunResult>;
} => { /* the switch from handleAction, returning RunResult; uses useOrganization/useAuth internally */ };
```
Keep the exact service calls + `canRunAction` gating + toasts identical. Return `{ ok, created? }` so callers can react (CrmAssistantChat uses `created` to set its `lastEntity`).

- [ ] **Step 2:** Refactor `CrmAssistantChat` to use the hook: `const { running, run } = useAgentActionRunner();` and replace its `handleAction`/`actingActionId` usage with `run(...)` + `running`. Its file-attach `lastEntity` is set from `run(...)`'s returned `created`.

- [ ] **Step 3:** Build → success (behavior unchanged for the chat). Commit:
```bash
git add src/services/agent/useAgentActionRunner.ts src/components/aiAgent/CrmAssistantChat.tsx
git commit -m "refactor(agent): extract useAgentActionRunner shared by chat + NBA"
```

## Task 2: NextBestAction component

**Files:** `src/components/activities/NextBestAction.tsx` (new)

- [ ] **Step 1:** Build the component. Props: `entity?: { type: "client" | "deal" | "lead"; id: string; label?: string }`.
```tsx
// A button that asks crm-assistant for the single next best action and renders
// the reply + any proposed actions (run via the shared runner, gated by perms).
```
Behaviour:
  - A "✨ Next best action" button. On click → `supabase.functions.invoke('crm-assistant', { body: { organization_id: orgId, user_message: prompt, history: [] } })` where `prompt` is:
    - per-record: `"For the ${entity.type} \"${entity.label ?? entity.id}\" (id ${entity.id}), look at its recent activity and propose the single next best action to move it forward. Use find_records if you need the id."`
    - hub-level: `"Across my pipeline and overdue tasks, what is the single most important next action I should take right now? Propose it."`
  - Render the returned `reply` text + each `proposed_action` as a row with a Confirm button (reuse `useAgentActionRunner().run`), hiding/disabling Confirm when `!canRunAction(a.type, perms)` (show "no access"). Loading + error states like `CrmAssistantChat`.

- [ ] **Step 2:** Build → success. Commit:
```bash
git add src/components/activities/NextBestAction.tsx
git commit -m "feat(activities): NextBestAction widget (AI suggestion + one-click run)"
```

## Task 3: Mount NextBestAction (hub + per-record)

**Files:** `src/components/activities/ActivitiesHubPanel.tsx`, the three detail drawers

- [ ] **Step 1:** Mount `<NextBestAction />` (no entity → hub-level) in the Activities hub header area, next to the existing summary/search.
- [ ] **Step 2:** Mount `<NextBestAction entity={{ type, id, label }} />` in each detail drawer's Activity section (DealDetailDrawer → deal, ClientDetailDrawer → client, LeadDetailDrawer → lead), above the timeline.
- [ ] **Step 3:** Build → success. Commit:
```bash
git add src/components/activities/ActivitiesHubPanel.tsx src/components/clients src/components/leads
git commit -m "feat(activities): surface NextBestAction in hub + record drawers"
```

## Task 4: Verify
- [ ] `npm run test` → full suite green (the extraction shouldn't change tests; `canRunAction` test still passes).
- [ ] `npm run build` → success.
- Manual (post-deploy, needs `crm-assistant` deployed + `ANTHROPIC_API_KEY`): click Next best action on a deal → AI proposes an action → Confirm runs it; member without deal-edit sees "no access" on a deal-write suggestion.

## Self-Review
**Spec coverage (Phase 3):** AI next-best-action hub + per-record (Tasks 2–3) ✓; reuses propose→confirm executor (Task 1) ✓; permission-gated via `canRunAction` ✓.
**Placeholder scan:** The hook body is "move the existing switch" (explicit refactor, not vague) — the source switch already exists and is complete. NextBestAction prompt strings given in full.
**Type consistency:** `useAgentActionRunner().run(action: ProposedAction)` consumes the existing `ProposedAction`/`AgentActionType` from `src/services/agent/agentActions.ts`; `NextBestAction` uses the same `canRunAction` + `ProposedAction`. Edge-fn invoke shape matches `CrmAssistantChat`.
