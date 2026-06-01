# Bot Phase 1 — Per-User Timezone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse and display dates in each user's real timezone instead of hardcoded UTC.

**Architecture:** Add a `timezone` column to `public.user_profiles`; surface a timezone picker in the web app's Profile settings; have the bot load the linked user's timezone and pass it to the intent parser and to a new shared `format.ts` for rendering dates back to the user.

**Tech Stack:** Supabase Postgres migration; React + TypeScript + Vite (web); Deno edge functions (bot). Web tests via `vitest`; bot tests via `deno test`. Date formatting uses built-in `Intl.DateTimeFormat` (Deno + browsers support IANA `timeZone`); no new dependency.

**Reference spec:** [docs/superpowers/specs/2026-06-01-bot-power-expansion-design.md](../specs/2026-06-01-bot-power-expansion-design.md) §7 (Timezone).

**Depends on:** nothing (independent of Phase 0).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/123_user_profiles_timezone.sql` | Add `timezone` column | Create |
| `supabase/functions/_shared/agent/format.ts` | `formatLocal(iso, tz)` + `loadUserTimezone(admin, userId)` | Create |
| `supabase/functions/_shared/agent/format_test.ts` | Tests for `formatLocal` | Create |
| `supabase/functions/whatsapp-webhook/handlers.ts` | Load tz, pass to parser | Modify |
| `supabase/functions/telegram-webhook/handlers.ts` | Load tz, pass to parser | Modify |
| `src/types/user.ts` | Add `timezone?` to `User` | Modify |
| `src/lib/timezones.ts` | IANA timezone option list | Create |
| `src/services/supabase/auth.ts` | Map `timezone` in get/update profile | Modify |
| `src/pages/Settings.tsx` | Timezone `<Select>` in Profile tab | Modify |

---

## Task 1: Migration — add `user_profiles.timezone`

**Files:**
- Create: `supabase/migrations/123_user_profiles_timezone.sql`

> Confirm the next migration number first: `ls supabase/migrations | sort | tail -3`. If a `123_*` already exists, use the next free integer and rename accordingly.

- [ ] **Step 1: Create the migration**

```sql
-- 123_user_profiles_timezone.sql
-- Per-user IANA timezone (e.g. 'Europe/London'). Null is treated as 'UTC' by
-- readers. Used by the Telegram/WhatsApp bot to parse relative dates
-- ("tomorrow 3pm") and to render dates back to the user in their local time.

alter table public.user_profiles
  add column if not exists timezone text;

comment on column public.user_profiles.timezone is
  'IANA timezone name (e.g. America/New_York). Null = UTC.';
```

- [ ] **Step 2: Apply locally and verify the column exists**

Run: `npx supabase db push` (or apply via your migration runner).
Then verify:

```bash
npx supabase db query "select column_name, data_type from information_schema.columns where table_name='user_profiles' and column_name='timezone';"
```
Expected: one row — `timezone | text`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/123_user_profiles_timezone.sql
git commit -m "feat(db): add user_profiles.timezone column"
```

---

## Task 2: Shared `format.ts` — tz-aware date rendering + timezone loader

**Files:**
- Create: `supabase/functions/_shared/agent/format.ts`
- Test: `supabase/functions/_shared/agent/format_test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/agent/format_test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatLocal } from "./format.ts";

// 2026-06-01T15:00:00Z is 16:00 in London (BST) and 11:00 in New York (EDT).
Deno.test("formatLocal renders an ISO instant in the given IANA zone", () => {
  const iso = "2026-06-01T15:00:00Z";
  assertEquals(formatLocal(iso, "Europe/London"), "1 Jun 2026, 16:00");
  assertEquals(formatLocal(iso, "America/New_York"), "1 Jun 2026, 11:00");
});

Deno.test("formatLocal falls back to UTC when tz is null/empty", () => {
  const iso = "2026-06-01T15:00:00Z";
  assertEquals(formatLocal(iso, null), "1 Jun 2026, 15:00");
  assertEquals(formatLocal(iso, ""), "1 Jun 2026, 15:00");
});

Deno.test("formatLocal returns the raw string when it is not a valid date", () => {
  assertEquals(formatLocal("not-a-date", "UTC"), "not-a-date");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/agent/format_test.ts`
Expected: FAIL — `format.ts` does not exist.

- [ ] **Step 3: Implement `format.ts`**

Create `supabase/functions/_shared/agent/format.ts`:

```typescript
// supabase/functions/_shared/agent/format.ts
// Timezone-aware helpers for the chat bot. formatLocal renders a UTC ISO
// instant in the user's IANA timezone; loadUserTimezone fetches that zone
// from user_profiles (null => "UTC").

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Render an ISO-8601 instant in the given IANA timezone as
 *  "1 Jun 2026, 16:00". Falls back to UTC for null/empty tz, and returns the
 *  input unchanged if it is not a parseable date. */
export const formatLocal = (iso: string, tz: string | null | undefined): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const zone = tz && tz.trim() ? tz.trim() : "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
  } catch {
    // Invalid tz name → fall back to UTC formatting.
    return formatLocal(iso, "UTC");
  }
};

/** Look up a linked user's IANA timezone. Returns "UTC" when unset. */
export const loadUserTimezone = async (
  admin: SupabaseClient,
  userId: string,
): Promise<string> => {
  const { data } = await admin
    .from("user_profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  const tz = (data as { timezone?: string | null } | null)?.timezone;
  return tz && tz.trim() ? tz.trim() : "UTC";
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/agent/format_test.ts`
Expected: PASS (3 tests).

> If the month abbreviation differs by Deno/ICU version (e.g. "Jun" vs "Jun."), adjust the expected strings in the test to match the actual `deno test` output — the format is locale/ICU-driven. Keep the day/year/time assertions exact.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agent/format.ts supabase/functions/_shared/agent/format_test.ts
git commit -m "feat(bot): add formatLocal + loadUserTimezone helpers"
```

---

## Task 3: Bot reads the user's timezone

Replace the hardcoded `timezone: "UTC"` in both webhooks' `handleNaturalLanguage` with the loaded value.

**Files:**
- Modify: `supabase/functions/whatsapp-webhook/handlers.ts`
- Modify: `supabase/functions/telegram-webhook/handlers.ts`

- [ ] **Step 1: WhatsApp — import the loader**

In `whatsapp-webhook/handlers.ts`, add to the imports near the top:

```typescript
import { loadUserTimezone } from "../_shared/agent/format.ts";
```

- [ ] **Step 2: WhatsApp — load and pass the timezone**

In `handleNaturalLanguage`, the parser context currently passes `timezone: "UTC"`. Change the block that builds context so the four lookups run together:

```typescript
  const [{ data: wsData }, { data: projData }, { data: clData }, tz] = await Promise.all([
    admin.from("workspaces").select("name").eq("organization_id", account.current_org_id).limit(50),
    admin.from("projects").select("name").eq("organization_id", account.current_org_id).limit(50),
    admin.from("clients").select("name").eq("organization_id", account.current_org_id).limit(50),
    loadUserTimezone(admin, account.user_id),
  ]);
  const intent = await parseIntent(text, {
    workspaces: (wsData ?? []).map((r) => (r as { name: string }).name),
    projects: (projData ?? []).map((r) => (r as { name: string }).name),
    clients: (clData ?? []).map((r) => (r as { name: string }).name),
    nowIso: new Date().toISOString(),
    timezone: tz,
  });
```

- [ ] **Step 3: Telegram — import the loader**

In `telegram-webhook/handlers.ts`, add:

```typescript
import { loadUserTimezone } from "../_shared/agent/format.ts";
```

- [ ] **Step 4: Telegram — load and pass the timezone**

In `handleNaturalLanguage`, replace the context-building block (the `Promise.all` of workspaces/projects/clients and the `parseIntent` call with `timezone: "UTC"`) with:

```typescript
  const [{ data: wsData }, { data: projData }, { data: clData }, tz] = await Promise.all([
    admin.from("workspaces").select("name").eq("organization_id", account.current_org_id).limit(50),
    admin.from("projects").select("name").eq("organization_id", account.current_org_id).limit(50),
    admin.from("clients").select("name").eq("organization_id", account.current_org_id).limit(50),
    loadUserTimezone(admin, account.user_id),
  ]);
  const intent = await parseIntent(text, {
    workspaces: (wsData ?? []).map((r) => (r as { name: string }).name),
    projects: (projData ?? []).map((r) => (r as { name: string }).name),
    clients: (clData ?? []).map((r) => (r as { name: string }).name),
    nowIso: new Date().toISOString(),
    timezone: tz,
  });
```

- [ ] **Step 5: Type-check both functions**

Run: `deno check supabase/functions/whatsapp-webhook/index.ts supabase/functions/telegram-webhook/index.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/whatsapp-webhook/handlers.ts supabase/functions/telegram-webhook/handlers.ts
git commit -m "feat(bot): parse dates in the linked user's timezone"
```

---

## Task 4: Web — timezone picker in Profile settings

**Files:**
- Modify: `src/types/user.ts`
- Create: `src/lib/timezones.ts`
- Modify: `src/services/supabase/auth.ts`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add `timezone` to the `User` type**

In `src/types/user.ts`, inside the `User` interface (after `country: string;`), add:

```typescript
  timezone?: string;            // IANA timezone, e.g. "Europe/London"
```

- [ ] **Step 2: Create the timezone option list**

Create `src/lib/timezones.ts`:

```typescript
// A curated IANA timezone list for the profile picker. Kept short and
// practical rather than exhaustive; "UTC" is always first as the default.
export const TIMEZONES: string[] = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];
```

- [ ] **Step 3: Map `timezone` in the profile service**

In `src/services/supabase/auth.ts`, in `updateUserProfile`, add the mapping alongside the existing fields:

```typescript
    if (data.timezone) updateData.timezone = data.timezone;
```

In `getUserProfile`, where the returned `User` object is assembled, add:

```typescript
      timezone: (data as { timezone?: string }).timezone || "UTC",
```

(Place it next to the existing `country`/`organizationId` mappings; match the surrounding style and the actual `data` row variable name used in that function.)

- [ ] **Step 4: Add the Select to the Profile tab**

In `src/pages/Settings.tsx`:

1. Add the imports (if not already present):

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIMEZONES } from "@/lib/timezones";
```

2. Add state next to the existing `displayName` state:

```tsx
const [timezone, setTimezone] = useState(user?.timezone || "UTC");
```

3. In the `useEffect` that resets profile fields when `user` changes, add:

```tsx
    setTimezone(user?.timezone || "UTC");
```

4. In the Profile tab grid (next to Display Name), add a field:

```tsx
<div className="space-y-2">
  <Label>Timezone</Label>
  <Select value={timezone} onValueChange={setTimezone}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {TIMEZONES.map((tz) => (
        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

5. In `handleSaveProfile`, include timezone in the update call:

```tsx
await updateUserProfile(user.userId, { displayName, timezone });
```

- [ ] **Step 5: Write a web test for the service mapping**

Create `src/services/supabase/__tests__/auth.timezone.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the object passed to .update(...) so we can assert the mapping.
const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
vi.mock("../client", () => ({
  supabase: { from: () => ({ update: updateSpy }) },
}));

import { updateUserProfile } from "../auth";

describe("updateUserProfile timezone mapping", () => {
  beforeEach(() => updateSpy.mockClear());

  it("maps the timezone field to the update payload", async () => {
    await updateUserProfile("user-1", { timezone: "Asia/Tokyo" });
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ timezone: "Asia/Tokyo" }));
  });
});
```

> Adjust the `vi.mock` path (`../client`) to match how `auth.ts` actually imports the supabase client (check the import at the top of `auth.ts` — it may be `./client` or `@/services/supabase/client`).

- [ ] **Step 6: Run the web test**

Run: `npm run test -- auth.timezone`
Expected: PASS.

- [ ] **Step 7: Build to catch type errors**

Run: `npm run build`
Expected: build succeeds (tsc finds no type errors from the new `timezone` field).

- [ ] **Step 8: Commit**

```bash
git add src/types/user.ts src/lib/timezones.ts src/services/supabase/auth.ts src/pages/Settings.tsx src/services/supabase/__tests__/auth.timezone.test.ts
git commit -m "feat(web): timezone picker in profile settings"
```

---

## Task 5: Verify end to end

- [ ] **Step 1: Set your timezone in the web app**

Open Settings → Profile, choose `Asia/Kolkata` (UTC+5:30), Save. Reload and confirm it persists.

- [ ] **Step 2: Deploy the bot functions**

```bash
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

- [ ] **Step 3: Confirm relative-date parsing uses your zone**

From the bot, send `task: call vendor tomorrow 3pm in <some project>`. Confirm the create. In the app, open the task and check the due time is 3pm **Kolkata** time (i.e. 09:30Z), not 3pm UTC.

- [ ] **Step 4: Confirm the fallback**

In the web app, clear/leave timezone as `UTC` for a second test user, repeat — the due time should be 3pm UTC.

---

## Self-Review

**Spec coverage (§7):** migration adds `user_profiles.timezone` (Task 1) ✓; frontend picker (Task 4) ✓; bot reads it for parsing (Task 3) ✓; `format.ts` for display (Task 2 — consumed by Phases 2/3) ✓.

**Placeholder scan:** Two intentional "adjust to match your codebase" notes (the `data` row variable in `getUserProfile`, the supabase client import path in the test) — these are real-code-dependent and called out explicitly, not silent TODOs. All code shown in full.

**Type consistency:** `loadUserTimezone` returns `string`, consumed as `timezone:` in both handlers. `formatLocal(iso, tz)` signature matches its tests and will be the import used by Phases 2–3. `User.timezone?: string` matches the `updateUserProfile({ timezone })` call and the test assertion.
