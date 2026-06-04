# Automations Phase D — visual if/then branching

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Checkbox steps.

**Goal:** A `branch` action that evaluates conditions and runs one of two nested action lists (then/else). Backward-compatible with today's linear recipes. v1: one level deep — a branch's sub-actions may not be `branch` or `wait`.

**Architecture:** Add a `branch` action type whose `config` is `{ conditions: RecipeCondition[]; then: RecipeAction[]; else: RecipeAction[] }`. The engine handles `branch` **inline** in both action loops via a shared `runBranch` helper (evaluate conditions → run the chosen sub-list through `ACTION_REGISTRY`, sharing `aiOutputs`). The builder renders an If/Else block with nested action editors. Existing recipes (no `branch`) are unaffected.

**Tech Stack:** Deno edge fn (`deno check`/`deno test`), React/TS (vitest/build). **Branch:** `automations-extend`.

**Reference spec:** [docs/superpowers/specs/2026-06-04-automations-extend-design.md](../specs/2026-06-04-automations-extend-design.md) §D.

**Known facts:** `runRecipe` (crm-run-automations/index.ts ~L175–215) loops `recipe.actions`, calling `ACTION_REGISTRY[type](ctx, config)`; pushes `{...r, type, duration_ms}` to `results`; propagates `r.meta.ai_output*` into `aiOutputs`; breaks on `r.meta.defer` (wait) or failure. `executeActionsResume` (~L220+) has the same loop for the post-wait tail. `evaluateConditions(conditions, event, ctx)` in `conditions/evaluator.ts`. `ctx = loadEntityContext(admin, event)`. `RecipeAction = { type: ActionType; config: Record<string,unknown> }` in both engine `shared/types.ts` and frontend `automations.ts`.

---

## Task 1: Engine — `runBranch` helper + type (TDD)

**Files:** `supabase/functions/crm-run-automations/runBranch.ts` (new), `runBranch_test.ts` (new), `shared/types.ts`

- [ ] **Step 1:** Add `"branch"` to the `ActionType` union in `shared/types.ts`. Allow `RecipeAction.config` to carry nested actions (keep `config: Record<string, unknown>` — the branch reads `config.then`/`config.else` as `RecipeAction[]` at runtime; no type change needed beyond the union, but export a `BranchConfig` interface for clarity):
```typescript
export interface BranchConfig {
  conditions: RecipeCondition[];
  then: RecipeAction[];
  else: RecipeAction[];
}
```

- [ ] **Step 2: failing test** `supabase/functions/crm-run-automations/runBranch_test.ts`:
```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { chooseBranch, validBranchAction } from "./runBranch.ts";

Deno.test("chooseBranch returns 'then' when conditions pass, 'else' otherwise", () => {
  // chooseBranch takes a precomputed boolean (condition eval is injected)
  assertEquals(chooseBranch(true), "then");
  assertEquals(chooseBranch(false), "else");
});
Deno.test("validBranchAction rejects nested branch/wait, allows others", () => {
  assertEquals(validBranchAction({ type: "send_email", config: {} }), true);
  assertEquals(validBranchAction({ type: "branch", config: {} }), false);
  assertEquals(validBranchAction({ type: "wait", config: {} }), false);
});
```

- [ ] **Step 3:** Create `runBranch.ts`:
```typescript
import { ACTION_REGISTRY } from "./actions/index.ts";
import { evaluateConditions } from "./conditions/evaluator.ts";
import { ActionResult, RecipeAction, RecipeCondition } from "./shared/types.ts";

export const chooseBranch = (conditionsPass: boolean): "then" | "else" => conditionsPass ? "then" : "else";

/** v1: branches may not nest branches or waits. */
export const validBranchAction = (a: RecipeAction): boolean => a.type !== "branch" && a.type !== "wait";

/** Run a branch action inline: evaluate its conditions, run the chosen sub-list
 *  through the registry (sharing aiOutputs). Returns the sub-actions' results
 *  (each tagged with a branch path marker). Skips invalid (branch/wait) sub-
 *  actions defensively. */
export const runBranch = async (
  baseCtx: Record<string, unknown>,            // the same ctx object passed to handlers
  branchConfig: { conditions?: RecipeCondition[]; then?: RecipeAction[]; else?: RecipeAction[] },
  event: unknown,
  entityCtx: unknown,                          // ctx for condition evaluation (loadEntityContext result)
  aiOutputs: Record<string, string>,
): Promise<ActionResult[]> => {
  // deno-lint-ignore no-explicit-any
  const pass = evaluateConditions((branchConfig.conditions ?? []) as any, event as any, entityCtx as any);
  const path = chooseBranch(pass);
  const sub = (path === "then" ? branchConfig.then : branchConfig.else) ?? [];
  const out: ActionResult[] = [{ type: "branch", status: "success", message: `→ ${path}`, duration_ms: 0 } as ActionResult];
  for (const a of sub) {
    if (!validBranchAction(a)) {
      out.push({ type: a.type, status: "skipped", message: "branch/wait not allowed inside a branch", duration_ms: 0 } as ActionResult);
      continue;
    }
    const handler = ACTION_REGISTRY[a.type];
    if (!handler) { out.push({ type: a.type, status: "failure", message: "Unknown action type", duration_ms: 0 } as ActionResult); continue; }
    const t0 = Date.now();
    try {
      const r = await handler({ ...baseCtx, aiOutputs } as any, a.config ?? {});
      out.push({ ...r, type: a.type, duration_ms: Date.now() - t0 } as ActionResult);
      if (r.meta && typeof r.meta === "object") {
        for (const [k, v] of Object.entries(r.meta)) if (k.startsWith("ai_output") && typeof v === "string") aiOutputs[k] = v;
      }
      if (r.status === "failure") break; // stop this sub-list on failure
    } catch (err) {
      out.push({ type: a.type, status: "failure", message: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - t0 } as ActionResult);
      break;
    }
  }
  return out;
};
```

- [ ] **Step 4:** Register `branch` in `ACTION_REGISTRY` as a no-op placeholder so the `Record<ActionType, ActionHandler>` stays exhaustive (the real handling is inline; this guards the type): in `actions/index.ts` add `branch: async () => ({ status: "success" }),` with a comment that branch is handled inline in `runRecipe`.

- [ ] **Step 5:** `"$DENO" test supabase/functions/crm-run-automations/runBranch_test.ts` → PASS. Commit:
```bash
git add supabase/functions/crm-run-automations/runBranch.ts supabase/functions/crm-run-automations/runBranch_test.ts supabase/functions/crm-run-automations/shared/types.ts supabase/functions/crm-run-automations/actions/index.ts
git commit -m "feat(automations): branch action engine helper (chooseBranch/runBranch)"
```

## Task 2: Wire `runBranch` into both action loops

**Files:** `supabase/functions/crm-run-automations/index.ts`

- [ ] **Step 1:** Import `runBranch` at the top. In `runRecipe`'s `for` loop, at the very start of the loop body (before fetching the handler), handle branch inline:
```typescript
    const actionSpec = recipe.actions[i];
    if (actionSpec.type === "branch") {
      const baseCtx = { admin, orgId: event.organization_id, event, recipeId: recipe.recipe_id, recipeName: recipe.name, runStartedAt: started, recipeRunId, nextActionIndex: i };
      const subResults = await runBranch(baseCtx, (actionSpec.config ?? {}) as any, event, ctx, aiOutputs);
      results.push(...subResults);
      if (subResults.some((r) => r.status === "failure")) break;
      continue;
    }
    const handler = ACTION_REGISTRY[actionSpec.type];
    // …existing handler path…
```
- [ ] **Step 2:** Apply the **same** inline branch block at the start of the `executeActionsResume` loop body (so branches in a post-wait tail also run). Use that function's equivalent `ctx`/`aiOutputs`/`results` variables.
- [ ] **Step 3:** `"$DENO" check supabase/functions/crm-run-automations/index.ts` → no NEW errors beyond the pre-existing `ActionResult.type` set. Commit:
```bash
git add supabase/functions/crm-run-automations/index.ts
git commit -m "feat(automations): execute branch actions inline in run + resume loops"
```

## Task 3: Frontend type + validation

**Files:** `src/services/supabase/automations.ts`

- [ ] **Step 1:** Add `"branch"` to `ACTION_TYPES`. Add a `BranchConfig` type mirroring the engine. Add to `ACTION_LABELS`: `branch: "If / Else"`.
- [ ] **Step 2:** In `validateRecipeDraft`, validate branches: a `branch` action needs ≥1 condition and at least one action in `then` or `else`; **reject** any `then`/`else` child whose type is `branch` or `wait` (v1) with a clear message; validate child actions' required fields recursively (reuse the per-action validation).
- [ ] **Step 3:** `npm run build` → success. Commit:
```bash
git add src/services/supabase/automations.ts
git commit -m "feat(automations): branch action type + validation (frontend)"
```

## Task 4: Builder UI for the branch block

**Files:** `src/components/settings/RecipeBuilder.tsx`

- [ ] **Step 1:** Add `branch` to the action picker. When an action is a `branch`, its config editor renders:
  - a **condition editor** (reuse the existing condition-row component used for recipe-level `conditions`) bound to `config.conditions`;
  - a **"Then" list** and an **"Else" list**, each an array of `RecipeAction` rendered with the existing action-row + per-action config editor (recursively, but only offering non-branch, non-wait action types in the nested picker), with add/remove buttons. Drag-drop within nested lists is NOT required for v1.
- [ ] **Step 2:** Ensure the recipe summary (`summarizeRecipe`) handles a `branch` action gracefully (e.g. "If … then N actions, else M actions").
- [ ] **Step 3:** `npm run build` + `npm run test` → green. Commit:
```bash
git add src/components/settings/RecipeBuilder.tsx
git commit -m "feat(automations): visual if/else branch block in the recipe builder"
```

> **If the nested builder UI becomes too risky/large**, deliver Tasks 1–3 (engine + type + validation — branches authored via AI/JSON already work end-to-end) and report Task 4 as DONE_WITH_CONCERNS with what remains, rather than destabilizing the builder.

## Task 5: Verify
- [ ] `"$DENO" test supabase/functions/crm-run-automations/` (runBranch + dateMatch pass).
- [ ] `"$DENO" check supabase/functions/crm-run-automations/index.ts` (only pre-existing errors).
- [ ] `npm run build` + `npm run test` → green.
- Manual (post-deploy): a recipe with a branch (`if deal.value > 5000 → notify owner, else → create_task`) routes correctly; run history shows the branch path + sub-action results; a branch containing a `wait` is rejected in the builder.

## Self-Review
**Spec coverage (§D):** `branch` action, engine inline execution in both loops, backward-compatible, v1 no nested branch/wait (Tasks 1–2) ✓; type + validation (Task 3) ✓; builder block (Task 4) ✓.
**Placeholder scan:** The "skip if risky" guidance on Task 4 is an explicit fallback, not a vague placeholder; engine helper + tests fully coded.
**Type consistency:** `branch` added to `ActionType` engine + frontend; `runBranch`/`chooseBranch`/`validBranchAction` signatures match the test; `BranchConfig` mirrored both sides; the inline loop block reuses the same handler-ctx shape the existing loop builds.
