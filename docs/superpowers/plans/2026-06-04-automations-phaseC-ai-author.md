# Automations Phase C — AI-authored recipes

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Checkbox steps.

**Goal:** Let a user describe an automation in plain English and have AI draft a `RecipeDraft` they review in the existing builder (never auto-saved).

**Architecture:** A small new edge fn `automation-author` calls Claude with a strict JSON system prompt (valid trigger/action catalog + RecipeDraft schema) and returns a draft. The frontend validates/sanitizes the draft against the known unions, then opens `RecipeBuilder` pre-filled via the existing `initialDraft` + `editing="new"` mechanism.

**Tech Stack:** Deno edge fn (Anthropic SDK), React/TS (vitest/build). **Branch:** `automations-extend`.

**Reference spec:** [docs/superpowers/specs/2026-06-04-automations-extend-design.md](../specs/2026-06-04-automations-extend-design.md) §C.

**Known facts:** `crm-assistant/index.ts` shows the auth + Anthropic pattern (env `ANTHROPIC_KEY`, model `claude-sonnet-4-6`, `authorizeOrgRequest`, corsHeaders/json helpers). `RecipeDraft` (from `automations.ts`): `{ name, description?, enabled, trigger: { type: TriggerType; config }, conditions: RecipeCondition[], actions: RecipeAction[], sendWindow? }`. `TRIGGER_TYPES`/`ACTION_TYPES` consts export the valid unions. `AutomationsSettingsTab` already has `initialDraft` state and `setEditing("new")` opens the builder pre-filled (used by the template gallery).

---

## Task 1: Draft sanitizer (TDD, pure)

**Files:** `src/services/supabase/automationDraft.ts` (new), `tests/unit/automationDraft.test.ts` (new)

- [ ] **Step 1: failing test**
```typescript
import { describe, it, expect } from "vitest";
import { sanitizeDraft } from "@/services/supabase/automationDraft";

describe("sanitizeDraft", () => {
  it("keeps a valid draft and drops unknown action types", () => {
    const d = sanitizeDraft({
      name: "Welcome", enabled: true,
      trigger: { type: "client_created", config: {} },
      conditions: [],
      actions: [{ type: "send_email", config: { to: "client_email", subject: "Hi", body_html: "Welcome" } },
                 { type: "teleport", config: {} }],
    });
    expect(d).not.toBeNull();
    expect(d!.actions.map((a) => a.type)).toEqual(["send_email"]);
  });
  it("returns null for an unknown trigger type", () => {
    expect(sanitizeDraft({ name: "x", enabled: true, trigger: { type: "telepathy", config: {} }, conditions: [], actions: [{ type: "notify", config: {} }] })).toBeNull();
  });
  it("returns null when no valid actions remain", () => {
    expect(sanitizeDraft({ name: "x", enabled: true, trigger: { type: "client_created", config: {} }, conditions: [], actions: [{ type: "nope", config: {} }] })).toBeNull();
  });
  it("returns null for non-object input", () => {
    expect(sanitizeDraft(null)).toBeNull();
    expect(sanitizeDraft("oops")).toBeNull();
  });
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement** `src/services/supabase/automationDraft.ts`:
```typescript
import { TRIGGER_TYPES, ACTION_TYPES, type RecipeDraft, type TriggerType, type ActionType } from "./automations";

const TRIGGERS = new Set<string>(TRIGGER_TYPES as readonly string[]);
const ACTIONS = new Set<string>(ACTION_TYPES as readonly string[]);

/** Validate + clean an AI-produced draft. Drops unknown action types; returns
 *  null if the trigger is unknown or no valid actions remain. Defensive against
 *  arbitrary JSON. */
export const sanitizeDraft = (raw: unknown): RecipeDraft | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const triggerType = r.trigger?.type;
  if (typeof triggerType !== "string" || !TRIGGERS.has(triggerType)) return null;
  const actions = Array.isArray(r.actions) ? r.actions : [];
  const cleanActions = actions
    .filter((a: any) => a && typeof a.type === "string" && ACTIONS.has(a.type))
    .map((a: any) => ({ type: a.type as ActionType, config: (a.config && typeof a.config === "object") ? a.config : {} }));
  if (cleanActions.length === 0) return null;
  const conditions = Array.isArray(r.conditions)
    ? r.conditions.filter((c: any) => c && typeof c.field === "string" && typeof c.operator === "string")
    : [];
  return {
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : "AI-drafted automation",
    description: typeof r.description === "string" ? r.description : null,
    enabled: false, // drafts start disabled until the user reviews + saves
    trigger: { type: triggerType as TriggerType, config: (r.trigger?.config && typeof r.trigger.config === "object") ? r.trigger.config : {} },
    conditions,
    actions: cleanActions,
    sendWindow: null,
  };
};
```

- [ ] **Step 4: run → PASS.** Commit:
```bash
git add src/services/supabase/automationDraft.ts tests/unit/automationDraft.test.ts
git commit -m "feat(automations): AI-draft sanitizer"
```

## Task 2: `automation-author` edge function

**Files:** `supabase/functions/automation-author/index.ts` (new)

- [ ] **Step 1:** Create the function modeled on `crm-assistant` (copy its corsHeaders/json helpers + `authorizeOrgRequest` + Anthropic setup). Body `{ organization_id, description }`. System prompt: explain it outputs ONLY a JSON `RecipeDraft` (no prose), give the exact valid `trigger.type` values and `action.type` values (hardcode the lists — keep in sync with the unions), the condition operator list, and an example. Single Claude call (no tool loop), `max_tokens` ~1500, `temperature: 0`. Parse the reply as JSON (strip code fences); return `{ draft }` (raw — the frontend sanitizes) or `{ error }` on parse failure.
```typescript
// key bits:
const SYSTEM = `You convert a plain-English description into a CRM/PM automation recipe.
Output ONLY minified JSON matching: {"name","description","trigger":{"type","config"},"conditions":[{"field","operator","value"}],"actions":[{"type","config"}]}.
Valid trigger.type: deal_stage_entered, deal_field_changed, deal_score_band_changed, form_submitted, client_created, client_tagged, workspace_created, project_created, task_created, task_assigned, task_status_changed, task_overdue, scheduled, date_relative, deal_inactive.
Valid action.type: create_task, create_project_task, assign_task, create_project, create_workspace, add_note, tag, set_field, change_owner, move_deal_stage, send_email, send_sms, notify, slack_post, webhook, ai_summarize, ai_classify_lead, ai_draft_email, wait.
Valid condition.operator: eq, neq, gt, gte, lt, lte, in, contains, exists.
No prose, no markdown — JSON only.`;
```
Auth: require a valid user bearer (reuse `authorizeOrgRequest`); reject if not an org member.

- [ ] **Step 2:** `"$DENO" check supabase/functions/automation-author/index.ts` → clean. Commit:
```bash
git add supabase/functions/automation-author/index.ts
git commit -m "feat(automations): automation-author edge fn (NL -> RecipeDraft)"
```

## Task 3: Frontend wiring

**Files:** `src/services/supabase/automations.ts`, `src/components/settings/AutomationsSettingsTab.tsx`

- [ ] **Step 1:** Add a service fn to `automations.ts`:
```typescript
import { sanitizeDraft } from "./automationDraft";
export const draftAutomationFromText = async (organizationId: string, description: string): Promise<RecipeDraft> => {
  const { data, error } = await supabase.functions.invoke("automation-author", { body: { organization_id: organizationId, description } });
  if (error) throw error;
  const draft = sanitizeDraft((data as { draft?: unknown })?.draft);
  if (!draft) throw new Error("Couldn't turn that into a valid automation — try describing the trigger and the action(s).");
  return draft;
};
```

- [ ] **Step 2:** In `AutomationsSettingsTab`, add a "✨ Describe an automation" input + button near the "New recipe" button. On submit: `const d = await draftAutomationFromText(orgId, text); setInitialDraft(d); setEditing("new");` (opens the builder pre-filled). Loading + error toast states. Admin-only (same gate as "New recipe").

- [ ] **Step 3:** `npm run build` + `npm run test` → green. Commit:
```bash
git add src/services/supabase/automations.ts src/components/settings/AutomationsSettingsTab.tsx
git commit -m "feat(automations): describe-an-automation (AI author) entry point"
```

## Task 4: Verify
- [ ] `npm run test -- automationDraft` (pass) + full `npm run test` (green).
- [ ] `"$DENO" check supabase/functions/automation-author/index.ts` (clean).
- [ ] `npm run build` (success).
- Manual (post-deploy, needs `automation-author` deployed + `ANTHROPIC_API_KEY`): type "when a new client is created, send them a welcome email and notify the deal owner" → a pre-filled recipe opens in the builder with a `client_created` trigger + `send_email` + `notify` actions to review and save.

## Self-Review
**Spec coverage (§C):** NL→RecipeDraft via a dedicated edge fn (Task 2) ✓; client-side sanitize against the unions (Task 1) ✓; opens in the builder pre-filled, never auto-saved (Task 3, `enabled:false` + review) ✓.
**Placeholder scan:** The system-prompt trigger/action lists are hardcoded and must be kept in sync with the unions — noted explicitly. Sanitizer fully coded + tested.
**Type consistency:** `sanitizeDraft(raw) → RecipeDraft | null` uses `TRIGGER_TYPES`/`ACTION_TYPES` + `RecipeDraft` from `automations.ts`; `draftAutomationFromText` returns `RecipeDraft` consumed by the existing `setInitialDraft`/`RecipeBuilder` path.
