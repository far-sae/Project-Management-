# Activity Hub — Phase 1 (Unified Feed + Timeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the Activities hub into a modern unified feed — notes + emails alongside tasks/meetings/calls — with a chronological **Timeline** view (Upcoming pinned + Logged grouped by day) and a Today/Overdue focus.

**Architecture:** Extend the existing `activities.ts` aggregator with `note`/`email` kinds + fetchers; add pure, testable helpers (day-bucketing, today/overdue predicates); add a `timeline` view mode + `ActivitiesTimeline` component to `ActivitiesHubPanel`; add two filter views + a header summary.

**Tech Stack:** React + TS + Vite (vitest). No DB migration (reads existing `client_notes`/`lead_notes`/`email_events`).

**Reference spec:** [docs/superpowers/specs/2026-06-04-activity-hub-modernization-design.md](../specs/2026-06-04-activity-hub-modernization-design.md).

**Branch:** `activity-hub-modernization` (off `main`).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/services/supabase/activities.ts` | note/email kinds + fetchers + pure helpers | Modify |
| `tests/unit/activities.timeline.test.ts` | helpers (mapping, bucketing, today/overdue) | Create |
| `src/components/activities/ActivitiesTimeline.tsx` | timeline renderer | Create |
| `src/components/activities/ActivitiesHubPanel.tsx` | `timeline` view + header summary | Modify |

> Confirm exact columns against the table definitions while wiring the fetchers: `client_notes`/`lead_notes` (migrations 041/100) and `email_events` (migration 116). Adjust field names if they differ from those below.

---

## Task 1: Pure helpers (TDD) — day-bucketing + today/overdue

**Files:** `src/services/supabase/activities.ts`, `tests/unit/activities.timeline.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/activities.timeline.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { dayBucket, isToday, isOverdue } from "@/services/supabase/activities";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-06-04T12:00:00Z");

describe("dayBucket", () => {
  it("buckets relative to now", () => {
    expect(dayBucket(at("2026-06-04T09:00:00Z"), NOW)).toBe("Today");
    expect(dayBucket(at("2026-06-03T09:00:00Z"), NOW)).toBe("Yesterday");
    expect(dayBucket(at("2026-05-31T09:00:00Z"), NOW)).toBe("This week");
    expect(dayBucket(at("2026-05-01T09:00:00Z"), NOW)).toBe("Earlier");
    expect(dayBucket(null, NOW)).toBe("Earlier");
  });
});

describe("isToday / isOverdue", () => {
  it("isToday is true only for same calendar day", () => {
    expect(isToday(at("2026-06-04T23:00:00Z"), NOW)).toBe(true);
    expect(isToday(at("2026-06-05T01:00:00Z"), NOW)).toBe(false);
  });
  it("isOverdue is past + open", () => {
    expect(isOverdue(at("2026-06-03T09:00:00Z"), true, NOW)).toBe(true);
    expect(isOverdue(at("2026-06-05T09:00:00Z"), true, NOW)).toBe(false); // future
    expect(isOverdue(at("2026-06-03T09:00:00Z"), false, NOW)).toBe(false); // closed
    expect(isOverdue(null, true, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npm run test -- activities.timeline`).

- [ ] **Step 3: Implement the helpers** in `activities.ts` (append, exported):
```typescript
export type DayBucket = "Today" | "Yesterday" | "This week" | "Earlier";

const startOfDayLocal = (d: Date): Date => {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
};

/** Coarse day bucket of `when` relative to `now` (local time). Null → "Earlier". */
export const dayBucket = (when: Date | null, now: Date = new Date()): DayBucket => {
  if (!when) return "Earlier";
  const day = startOfDayLocal(now).getTime();
  const w = startOfDayLocal(when).getTime();
  const DAY = 86400000;
  if (w === day) return "Today";
  if (w === day - DAY) return "Yesterday";
  if (w < day && w >= day - 6 * DAY) return "This week";
  return "Earlier";
};

export const isToday = (when: Date | null, now: Date = new Date()): boolean =>
  !!when && startOfDayLocal(when).getTime() === startOfDayLocal(now).getTime();

export const isOverdue = (when: Date | null, open: boolean, now: Date = new Date()): boolean =>
  !!when && open && when.getTime() < now.getTime();
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/services/supabase/activities.ts tests/unit/activities.timeline.test.ts
git commit -m "feat(activities): pure day-bucket + today/overdue helpers"
```

## Task 2: Aggregator — add note + email sources

**Files:** `src/services/supabase/activities.ts`, `tests/unit/activities.timeline.test.ts`

- [ ] **Step 1: Add the failing test** (append):
```typescript
import { noteToActivity, emailToActivity } from "@/services/supabase/activities";

describe("note/email mapping", () => {
  it("maps a note to a logged activity", () => {
    const a = noteToActivity({
      id: "n1", organization_id: "o1", client_id: "c1", lead_id: null, deal_id: null,
      kind: "note", subject: null, body: "Called, will renew", occurred_at: "2026-06-03T10:00:00Z",
      author_id: "u1", author_name: "Sam",
    });
    expect(a.kind).toBe("note");
    expect(a.open).toBe(false);
    expect(a.title).toContain("Called");
    expect(a.ownerUserId).toBe("u1");
  });
  it("maps an email event to a logged activity", () => {
    const a = emailToActivity({
      event_id: "e1", organization_id: "o1", entity_type: "deal", entity_id: "d1",
      direction: "outbound", subject: "Proposal", snippet: "Here it is", from_email: "me@x.com",
      occurred_at: "2026-06-02T10:00:00Z",
    });
    expect(a.kind).toBe("email");
    expect(a.open).toBe(false);
    expect(a.title).toContain("Proposal");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** In `activities.ts`:

Extend the kind union:
```typescript
export type ActivityKind = "task" | "meeting" | "call" | "note" | "email";
```
Add row types + map functions (place near the other `*ToActivity` fns):
```typescript
export interface NoteRow {
  id: string; organization_id: string;
  client_id: string | null; lead_id: string | null; deal_id: string | null;
  kind: string | null; subject: string | null; body: string | null;
  occurred_at: string; author_id: string | null; author_name: string | null;
}
export interface EmailEventRow {
  event_id: string; organization_id: string;
  entity_type: string | null; entity_id: string | null;
  direction: string; subject: string | null; snippet: string | null;
  from_email: string | null; occurred_at: string;
}

const trim = (s: string | null, n = 80) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export const noteToActivity = (r: NoteRow): Activity => ({
  id: `note:${r.id}`,
  kind: "note",
  organizationId: r.organization_id,
  workspaceId: null,
  title: trim(r.subject || r.body) || "Note",
  description: r.body ?? null,
  whenAt: r.occurred_at ? new Date(r.occurred_at) : null,
  overdue: false,
  open: false,
  ownerUserId: r.author_id ?? null,
  ownerName: r.author_name ?? null,
  priority: "normal",
  category: "others",
  relatedToLabel: null,
  // NoteRow isn't one of the original source variants; widen `source` (below).
  source: { kind: "note", row: r },
});

export const emailToActivity = (r: EmailEventRow): Activity => ({
  id: `email:${r.event_id}`,
  kind: "email",
  organizationId: r.organization_id,
  workspaceId: null,
  title: `${r.direction === "inbound" ? "📥" : "📤"} ${trim(r.subject) || "Email"}`,
  description: r.snippet ?? null,
  whenAt: r.occurred_at ? new Date(r.occurred_at) : null,
  overdue: false,
  open: false,
  ownerUserId: null,
  ownerName: r.from_email ?? null,
  priority: "normal",
  category: "others",
  relatedToLabel: null,
  source: { kind: "email", row: r },
});
```
Widen the `Activity.source` union to include the two new variants:
```typescript
  source:
    | { kind: "task";    row: ClientTask }
    | { kind: "meeting"; row: Meeting }
    | { kind: "call";    row: Call }
    | { kind: "note";    row: NoteRow }
    | { kind: "email";   row: EmailEventRow };
```
Add fetchers (use `supabase` from `./config`; verify column names against migrations 041/100/116):
```typescript
import { supabase } from "./config";

const listOrgNotes = async (orgId: string): Promise<NoteRow[]> => {
  const [clientNotes, leadNotes] = await Promise.all([
    supabase.from("client_notes").select("note_id, organization_id, client_id, deal_id, kind, subject, body, occurred_at, author_id, author_name").eq("organization_id", orgId).order("occurred_at", { ascending: false }).limit(200),
    supabase.from("lead_notes").select("note_id, organization_id, lead_id, kind, subject, body, occurred_at, author_id, author_name").eq("organization_id", orgId).order("occurred_at", { ascending: false }).limit(200),
  ]);
  const c = (clientNotes.data ?? []).map((r) => ({ ...(r as Record<string, unknown>), id: (r as Record<string,string>).note_id, lead_id: null } as unknown as NoteRow));
  const l = (leadNotes.data ?? []).map((r) => ({ ...(r as Record<string, unknown>), id: (r as Record<string,string>).note_id, client_id: null, deal_id: null } as unknown as NoteRow));
  return [...c, ...l];
};

const listOrgEmailEvents = async (orgId: string): Promise<EmailEventRow[]> => {
  const { data } = await supabase.from("email_events")
    .select("event_id, organization_id, entity_type, entity_id, direction, subject, snippet, from_email, occurred_at")
    .eq("organization_id", orgId).order("occurred_at", { ascending: false }).limit(200);
  return (data ?? []) as EmailEventRow[];
};
```
Extend `listActivities` to include them (each guarded):
```typescript
  const [tasks, meetings, calls, notes, emails] = await Promise.all([
    getOrganizationClientTasks(organizationId).catch(() => [] as ClientTask[]),
    listMeetings(organizationId).catch(() => [] as Meeting[]),
    listCalls(organizationId).catch(() => [] as Call[]),
    listOrgNotes(organizationId).catch(() => [] as NoteRow[]),
    listOrgEmailEvents(organizationId).catch(() => [] as EmailEventRow[]),
  ]);
  const out: Activity[] = [
    ...tasks.map((t) => taskToActivity(t, ctx)),
    ...meetings.map((m) => meetingToActivity(m, ctx)),
    ...calls.map((c) => callToActivity(c, ctx)),
    ...notes.map((n) => noteToActivity(n)),
    ...emails.map((e) => emailToActivity(e)),
  ];
```
(Keep the existing sort.)

- [ ] **Step 4: Run → PASS.** Then `npm run build` → success (the widened `source` union may surface exhaustive-switch spots in existing components — handle new kinds with a sensible default; fix any build errors in `ActivitiesKanban`/`List`/etc. by adding `note`/`email` icon cases or a fallback).

- [ ] **Step 5: Commit**
```bash
git add src/services/supabase/activities.ts tests/unit/activities.timeline.test.ts
git commit -m "feat(activities): include notes + email events in the unified feed"
```

## Task 3: Today / Overdue filter views

**Files:** `src/services/supabase/activities.ts`

- [ ] **Step 1: Add the views** to `ActivityFilterView`, `ACTIVITY_FILTERS`, and `applyActivityFilter`:
```typescript
// type: add  | "my_today" | "overdue"
// ACTIVITY_FILTERS: add near the top
  { value: "my_today", label: "Due Today", group: "all" },
  { value: "overdue",  label: "Overdue",   group: "all" },
// applyActivityFilter: add cases
    case "my_today":
      return activities.filter((a) => mine(a) && a.open && isToday(a.whenAt));
    case "overdue":
      return activities.filter((a) => a.open && a.overdue);
```

- [ ] **Step 2: Build** → success. Commit:
```bash
git add src/services/supabase/activities.ts
git commit -m "feat(activities): add Today + Overdue filter views"
```

## Task 4: Timeline view component

**Files:** `src/components/activities/ActivitiesTimeline.tsx` (new), `src/components/activities/ActivitiesHubPanel.tsx`

- [ ] **Step 1: Create `ActivitiesTimeline.tsx`**
```tsx
import React, { useMemo } from "react";
import { Phone, Calendar, ListTodo, StickyNote, Mail } from "lucide-react";
import { dayBucket, type Activity, type DayBucket, type ActivityKind } from "@/services/supabase/activities";

const KIND_ICON: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
  task: ListTodo, meeting: Calendar, call: Phone, note: StickyNote, email: Mail,
};
const fmt = (d: Date | null) => d ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export const ActivitiesTimeline: React.FC<{
  activities: Activity[];
  onOpen?: (a: Activity) => void;
}> = ({ activities, onOpen }) => {
  const now = new Date();
  const { upcoming, logged } = useMemo(() => {
    const upcoming = activities.filter((a) => a.open && a.whenAt && a.whenAt.getTime() >= now.getTime());
    const logged = activities.filter((a) => !(a.open && a.whenAt && a.whenAt.getTime() >= now.getTime()));
    return { upcoming, logged };
  }, [activities]);

  const buckets = useMemo(() => {
    const order: DayBucket[] = ["Today", "Yesterday", "This week", "Earlier"];
    const map = new Map<DayBucket, Activity[]>(order.map((b) => [b, []]));
    for (const a of logged) map.get(dayBucket(a.whenAt, now))!.push(a);
    return order.filter((b) => map.get(b)!.length > 0).map((b) => ({ bucket: b, items: map.get(b)! }));
  }, [logged]);

  const Row: React.FC<{ a: Activity }> = ({ a }) => {
    const Icon = KIND_ICON[a.kind];
    return (
      <button onClick={() => onOpen?.(a)} className="w-full flex items-start gap-3 text-left rounded-md px-2 py-2 hover:bg-muted/50">
        <span className={`mt-0.5 ${a.overdue ? "text-red-500" : "text-muted-foreground"}`}><Icon className="w-4 h-4" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm truncate">{a.title}</span>
          <span className="block text-xs text-muted-foreground">
            {a.kind}{a.relatedToLabel ? ` · ${a.relatedToLabel}` : ""}{a.whenAt ? ` · ${fmt(a.whenAt)}` : ""}{a.ownerName ? ` · ${a.ownerName}` : ""}
          </span>
        </span>
      </button>
    );
  };

  if (activities.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No activity yet.</div>;
  }
  return (
    <div className="space-y-5">
      {upcoming.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">Upcoming</h4>
          <div className="space-y-0.5">{upcoming.map((a) => <Row key={a.id} a={a} />)}</div>
        </section>
      )}
      {buckets.map(({ bucket, items }) => (
        <section key={bucket}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{bucket}</h4>
          <div className="space-y-0.5">{items.map((a) => <Row key={a.id} a={a} />)}</div>
        </section>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Wire into `ActivitiesHubPanel`** — read the file, then:
  - Extend `type ViewMode = 'status' | 'kind' | 'category' | 'list' | 'timeline';`.
  - Import `ActivitiesTimeline`. Default `viewMode` to `'timeline'` (the modern default).
  - Add a Timeline toggle button to the existing view switcher (use a `Clock`/`AlignLeft` icon).
  - Render `<ActivitiesTimeline activities={filtered} onOpen={openDetail} />` when `viewMode === 'timeline'` (reuse the existing detail-open handler the cards use).
  - Add the header summary line near the search bar:
    ```tsx
    <span className="text-xs text-muted-foreground">
      {filtered.filter((a) => a.open && isToday(a.whenAt)).length} due today · {filtered.filter((a) => a.open && a.overdue).length} overdue
    </span>
    ```
    (import `isToday` from the activities service).

- [ ] **Step 3: Build** → success.

- [ ] **Step 4: Commit**
```bash
git add src/components/activities/ActivitiesTimeline.tsx src/components/activities/ActivitiesHubPanel.tsx
git commit -m "feat(activities): timeline view (upcoming + day-grouped logged) + today/overdue summary"
```

## Task 5: Verify

- [ ] `npm run test -- activities.timeline` → pass.
- [ ] `npm run test` → full suite green.
- [ ] `npm run build` → success.

Manual (post-deploy): the Activities hub defaults to Timeline; notes + emails appear alongside tasks/meetings/calls; future open items sit under "Upcoming"; the rest group by day; the "due today · overdue" counts are correct; "Due Today"/"Overdue" filter views work.

---

## Self-Review

**Spec coverage (Phase 1):** notes+email in aggregator (Task 2) ✓; Timeline view = upcoming + day-grouped (Task 4) ✓; Today/Overdue views + summary (Tasks 3/4) ✓; per-source `.catch` resilience ✓. (Quick-log/@mentions/AI are Phases 2/3.)

**Placeholder scan:** Column-name verification against migrations is called out explicitly (real, code-dependent). All code shown.

**Type consistency:** `ActivityKind` widened consistently; `Activity.source` union extended with `note`/`email` variants used by `noteToActivity`/`emailToActivity` and the timeline's `KIND_ICON`. `dayBucket`/`isToday`/`isOverdue` signatures match tests + the component + filter views.
