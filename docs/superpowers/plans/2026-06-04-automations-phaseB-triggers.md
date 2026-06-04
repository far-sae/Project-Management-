# Automations Phase B — date_relative + deal_inactive triggers

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Checkbox steps.

**Goal:** Two new cron-enqueued triggers — `date_relative` (fire N days before/after a deal date field) and `deal_inactive` (fire when a deal has had no activity for N days).

**Architecture:** Mirror the existing `enqueueScheduledRecipes` pattern in `triggers/cron.ts` — per enabled recipe of the type, scan matching deals, dedup against a prior event in the last ~20h, insert an `automation_events` row. Add the types to the unions, a permissive `triggerConfigMatches` case, and builder options/panels. A pure date-offset helper is unit-tested.

**Tech Stack:** Deno edge fn (`deno check`), React/TS (`npm run build`). No DB migration. **Branch:** `automations-extend`.

**Reference spec:** [docs/superpowers/specs/2026-06-04-automations-extend-design.md](../specs/2026-06-04-automations-extend-design.md) §B.

**Known facts:** `triggers/cron.ts` exports `enqueueCronEvents(admin)` which calls `enqueueTaskOverdue` + `enqueueScheduledRecipes`; each scans, dedups via `automation_events` (event_type + source_id + enqueued_at > since), inserts `{ organization_id, event_type, payload, source_table, source_id }`. `TriggerType` union in `crm-run-automations/shared/types.ts` (engine) AND `src/services/supabase/automations.ts` (frontend, derived from a `TRIGGER_TYPES` const). `triggerConfigMatches` in `triggers/matchers.ts`. Deals have `expected_close_date` (date), `updated_at` (timestamptz), `organization_id`, `deal_id`, `title`, `client_id`.

---

## Task 1: Pure date-offset helper (TDD)

**Files:** `supabase/functions/crm-run-automations/triggers/dateMatch.ts` (new), and a test runnable with `deno test`.

- [ ] **Step 1:** Create `triggers/dateMatch.ts`:
```typescript
// Returns the YYYY-MM-DD a date_relative recipe should match TODAY: a recipe
// with offset_days = -3 fires for deals whose date_field is 3 days in the
// FUTURE (i.e. target date = today + 3). offset_days = +2 → today - 2 (past).
export const targetDateFor = (offsetDays: number, now: Date = new Date()): string => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - offsetDays); // -offset: negative offset → future date
  return d.toISOString().slice(0, 10);
};
```
- [ ] **Step 2:** Create `supabase/functions/crm-run-automations/triggers/dateMatch_test.ts`:
```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { targetDateFor } from "./dateMatch.ts";
const NOW = new Date("2026-06-04T12:00:00Z");
Deno.test("targetDateFor: -3 (3 days before close) targets a future date", () => {
  assertEquals(targetDateFor(-3, NOW), "2026-06-07");
});
Deno.test("targetDateFor: +2 (2 days after) targets a past date", () => {
  assertEquals(targetDateFor(2, NOW), "2026-06-02");
});
Deno.test("targetDateFor: 0 is today", () => {
  assertEquals(targetDateFor(0, NOW), "2026-06-04");
});
```
- [ ] **Step 3:** `"$DENO" test supabase/functions/crm-run-automations/triggers/dateMatch_test.ts` → PASS. Commit:
```bash
git add supabase/functions/crm-run-automations/triggers/dateMatch.ts supabase/functions/crm-run-automations/triggers/dateMatch_test.ts
git commit -m "feat(automations): targetDateFor helper for date-relative trigger"
```

## Task 2: Enqueue the two triggers

**Files:** `supabase/functions/crm-run-automations/triggers/cron.ts`

- [ ] **Step 1:** Add to `enqueueCronEvents`:
```typescript
export const enqueueCronEvents = async (admin: any): Promise<void> => {
  await enqueueTaskOverdue(admin);
  await enqueueScheduledRecipes(admin);
  await enqueueDateRelative(admin);
  await enqueueDealInactive(admin);
};
```
- [ ] **Step 2:** Implement both (mirror `enqueueScheduledRecipes`'s recipe-driven scan + the `enqueueTaskOverdue` dedup):
```typescript
import { targetDateFor } from "./dateMatch.ts";

const alreadyEnqueued = async (admin: any, eventType: string, sourceId: string): Promise<boolean> => {
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { data } = await admin.from("automation_events").select("event_id")
    .eq("event_type", eventType).eq("source_id", sourceId).gt("enqueued_at", since).maybeSingle();
  return !!data;
};

const enqueueDateRelative = async (admin: any): Promise<void> => {
  const { data: recipes } = await admin.from("automation_recipes")
    .select("recipe_id, organization_id, trigger_config")
    .eq("trigger_type", "date_relative").eq("enabled", true);
  for (const r of recipes ?? []) {
    const cfg = (r.trigger_config ?? {}) as { date_field?: string; offset_days?: number };
    const field = cfg.date_field || "expected_close_date";
    if (field !== "expected_close_date") continue; // v1: deals.expected_close_date only
    const target = targetDateFor(Number(cfg.offset_days ?? 0));
    const { data: deals } = await admin.from("deals")
      .select("deal_id, organization_id, title, client_id, expected_close_date")
      .eq("organization_id", r.organization_id).eq("expected_close_date", target).limit(500);
    for (const d of deals ?? []) {
      if (await alreadyEnqueued(admin, "date_relative", d.deal_id)) continue;
      await admin.from("automation_events").insert({
        organization_id: d.organization_id, event_type: "date_relative",
        payload: { deal_id: d.deal_id, client_id: d.client_id, title: d.title, recipe_id: r.recipe_id, date_field: field },
        source_table: "deals", source_id: d.deal_id,
      });
    }
  }
};

const enqueueDealInactive = async (admin: any): Promise<void> => {
  const { data: recipes } = await admin.from("automation_recipes")
    .select("recipe_id, organization_id, trigger_config")
    .eq("trigger_type", "deal_inactive").eq("enabled", true);
  for (const r of recipes ?? []) {
    const days = Number((r.trigger_config as { days?: number })?.days ?? 14);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    // v1 staleness proxy: deals.updated_at older than the cutoff (the deal row
    // updates on stage/field/note changes). A true last-activity join is a
    // future refinement.
    const { data: deals } = await admin.from("deals")
      .select("deal_id, organization_id, title, client_id, updated_at")
      .eq("organization_id", r.organization_id).lt("updated_at", cutoff).limit(500);
    for (const d of deals ?? []) {
      if (await alreadyEnqueued(admin, "deal_inactive", d.deal_id)) continue;
      await admin.from("automation_events").insert({
        organization_id: d.organization_id, event_type: "deal_inactive",
        payload: { deal_id: d.deal_id, client_id: d.client_id, title: d.title, recipe_id: r.recipe_id, inactive_days: days },
        source_table: "deals", source_id: d.deal_id,
      });
    }
  }
};
```
- [ ] **Step 3:** `"$DENO" check supabase/functions/crm-run-automations/index.ts` → no NEW errors beyond the pre-existing `ActionResult.type` set. Commit:
```bash
git add supabase/functions/crm-run-automations/triggers/cron.ts
git commit -m "feat(automations): enqueue date_relative + deal_inactive cron triggers"
```

## Task 3: Types + matcher + builder

**Files:** `crm-run-automations/shared/types.ts`, `triggers/matchers.ts`, `src/services/supabase/automations.ts`, `src/components/settings/RecipeBuilder.tsx`

- [ ] **Step 1:** Add `"date_relative"` and `"deal_inactive"` to the `TriggerType` union in `shared/types.ts` and to `TRIGGER_TYPES` in `automations.ts`.
- [ ] **Step 2:** In `triggers/matchers.ts`, add cases returning `true` (events are pre-filtered at enqueue time): `case "date_relative": return true; case "deal_inactive": return true;`.
- [ ] **Step 3:** In `RecipeBuilder.tsx`: add trigger labels (`date_relative → "a date is N days away (deal)"`, `deal_inactive → "a deal goes quiet for N days"`), add to the trigger picker, and config panels:
  - `date_relative`: a Select for `date_field` (currently just "Expected close date" → `expected_close_date`) + a number input `offset_days` (hint: "negative = before the date, positive = after").
  - `deal_inactive`: a number input `days` (default 14).
- [ ] **Step 4:** `npm run build` → success; `npm run test` → green. Commit:
```bash
git add src/services/supabase/automations.ts src/components/settings/RecipeBuilder.tsx supabase/functions/crm-run-automations/triggers/matchers.ts supabase/functions/crm-run-automations/shared/types.ts
git commit -m "feat(automations): date_relative + deal_inactive triggers in builder"
```

## Task 4: Verify
- [ ] `"$DENO" test supabase/functions/crm-run-automations/triggers/dateMatch_test.ts` → pass.
- [ ] `"$DENO" check supabase/functions/crm-run-automations/index.ts` → only pre-existing errors.
- [ ] `npm run build` + `npm run test` → green.
- Manual (post-deploy): a `date_relative` recipe (offset −3) enqueues an event for a deal closing in 3 days; a `deal_inactive` recipe (14d) fires for a deal whose `updated_at` is >14 days old; both dedup within a day.

## Self-Review
**Spec coverage (§B):** date_relative + deal_inactive cron-enqueued triggers (Tasks 1–2) ✓; unions + matcher + builder (Task 3) ✓; v1 staleness proxy (updated_at) documented ✓.
**Placeholder scan:** The updated_at staleness proxy + expected_close_date-only limitation are explicit v1 scope notes, not vague. Enqueue code shown in full; `targetDateFor` has tests.
**Type consistency:** `TriggerType` extended identically engine + frontend; `targetDateFor(offsetDays, now)` matches its tests + the enqueue call; payloads include `deal_id`/`recipe_id` consistent with other deal-context events the action handlers read.
