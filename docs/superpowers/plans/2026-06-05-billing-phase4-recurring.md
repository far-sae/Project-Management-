# Billing Phase 4 — Recurring invoices

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Let admins set up recurring invoices (weekly/monthly/quarterly/yearly) that the cron worker auto-issues. A schedule holds an invoice template (client + line items + tax/discount/terms); on its due date the worker creates a real invoice from it and advances the next run date.

**Architecture:** A new `invoice_schedules` table (migration 129). Generation runs in the EXISTING `crm-run-automations` Deno worker (it already runs on a cron and holds an advisory lock): a new `triggers/recurringInvoices.ts` module is called once per worker tick, right after `enqueueCronEvents`. It scans due schedules, creates an invoice from each (porting `computeQuoteTotals` + inline `INV-` numbering), and advances `next_run_date`. A frontend service + a "Recurring" tab on the Billing page manage schedules.

**Tech Stack:** Postgres migration + RLS, Deno edge worker, React/TS. **Branch:** `billing-hub`.

**Known facts (verified):**
- `computeQuoteTotals(lineItems, taxRate, discount)`: `subtotal = Σ lineTotal`; `afterDiscount = max(0, subtotal - discount)`; `taxAmount = round2(afterDiscount * (taxRate/100))`; `total = round2(afterDiscount + taxAmount)`. **taxRate is a percent (e.g. 8 = 8%); discount is a flat amount applied BEFORE tax.**
- `QuoteLineItem = { description: string; qty: number; unitPrice: number; lineTotal: number }`.
- `invoices` insert columns (from `createInvoice`): organization_id, client_id, workspace_id, invoice_number, title, currency, tax_rate, discount, subtotal, tax_amount, total, line_items, notes, terms, issued_at (date 'YYYY-MM-DD'), due_at, created_by, created_by_name. Unique index `ux_invoices_org_number (organization_id, lower(invoice_number))`. Number format `INV-000001`.
- Worker: `supabase/functions/crm-run-automations/index.ts` imports `makeAdmin` from `./shared/client.ts`, builds `const admin = makeAdmin()` (line ~408) and calls `await enqueueCronEvents(admin)` (line ~428) inside an advisory-locked block. `enqueueCronEvents(admin: any)` lives in `triggers/cron.ts`.
- RLS helpers exist (migration 036): `public.is_org_member(uuid)`, `public.is_org_admin_or_owner(uuid)` (check `organizations.owner_id` + `organizations.members` jsonb). The `invoices` table uses them.
- Billing page `src/pages/Billing.tsx` currently renders a single invoices view. `getOrganizationClients(orgId): Promise<Client[]>` for the client picker. `useOrganization()` → `organization`, `useAuth()` → `user`.
- Deno binary: `$DENO` = `C:\Users\faraz\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe`.
- Latest migration: `128`. Next: `129`.

---

## Task 1: Migration 129 — `invoice_schedules` table

**Files:** Create `supabase/migrations/129_invoice_schedules.sql`

- [ ] **Step 1:** Create the file:

```sql
-- Billing Phase 4: recurring invoice schedules. The crm-run-automations worker
-- scans due schedules each tick and creates an invoice from the template.
-- Re-runnable.

create table if not exists public.invoice_schedules (
  schedule_id       uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  client_id         uuid not null references public.clients(client_id) on delete cascade,
  workspace_id      uuid,

  title             text,
  currency          text not null default 'USD',
  tax_rate          numeric(6,3) not null default 0,   -- percent, e.g. 8 = 8%
  discount          numeric(14,2) not null default 0,  -- flat, applied before tax
  line_items        jsonb not null default '[]'::jsonb,
  notes             text,
  terms             text,

  frequency         text not null default 'monthly',
  due_days          integer not null default 14,       -- due_at = issued_at + due_days
  next_run_date     date not null,
  enabled           boolean not null default true,

  last_invoice_id   uuid,
  last_run_at       timestamptz,

  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (frequency in ('weekly','monthly','quarterly','yearly'))
);

create index if not exists idx_invoice_schedules_org
  on public.invoice_schedules (organization_id, enabled, next_run_date);
create index if not exists idx_invoice_schedules_due
  on public.invoice_schedules (next_run_date) where enabled;

alter table public.invoice_schedules enable row level security;

drop policy if exists "anon_no_invoice_schedules" on public.invoice_schedules;
create policy "anon_no_invoice_schedules"
  on public.invoice_schedules for select to anon using (false);

drop policy if exists "members_view_invoice_schedules" on public.invoice_schedules;
create policy "members_view_invoice_schedules"
  on public.invoice_schedules for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "admins_insert_invoice_schedules" on public.invoice_schedules;
create policy "admins_insert_invoice_schedules"
  on public.invoice_schedules for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "admins_update_invoice_schedules" on public.invoice_schedules;
create policy "admins_update_invoice_schedules"
  on public.invoice_schedules for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "admins_delete_invoice_schedules" on public.invoice_schedules;
create policy "admins_delete_invoice_schedules"
  on public.invoice_schedules for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));
```

- [ ] **Step 2:** Applied manually in the SQL editor at deploy time. Re-read once for typos. Commit:

```bash
git add supabase/migrations/129_invoice_schedules.sql
git commit -m "feat(billing): migration 129 - invoice_schedules table + RLS"
```

---

## Task 2: Worker — generate due recurring invoices

**Files:** Create `supabase/functions/crm-run-automations/triggers/recurringInvoices.ts`; Modify `supabase/functions/crm-run-automations/index.ts`

- [ ] **Step 1:** Create `triggers/recurringInvoices.ts`:

```typescript
// Billing Phase 4: turn due invoice_schedules into real invoices. Called once
// per worker tick (after enqueueCronEvents), under the worker's advisory lock.

interface Line { description?: string; qty?: number; unitPrice?: number; lineTotal?: number }

// Port of computeQuoteTotals (src/services/supabase/quotes.ts) — keep in sync.
const round2 = (n: number) => Math.round(n * 100) / 100;
const totalsFor = (lines: Line[], taxRate: number, discount: number) => {
  const subtotal = lines.reduce((s, li) => s + (Number(li.lineTotal) || 0), 0);
  const afterDiscount = Math.max(0, subtotal - (discount || 0));
  const taxAmount = round2(afterDiscount * ((taxRate || 0) / 100));
  const total = round2(afterDiscount + taxAmount);
  return { subtotal: round2(subtotal), taxAmount, total };
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Advance a date by one cadence, preserving day-of-month where possible.
const advance = (from: Date, frequency: string): Date => {
  const d = new Date(from);
  if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (frequency === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (frequency === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

// Replicate next_invoice_number for the service-role worker (the RPC checks
// is_org_member against auth.uid(), which is null here).
const nextNumber = async (admin: any, orgId: string): Promise<string> => {
  const { data } = await admin.from("invoices").select("invoice_number").eq("organization_id", orgId);
  let max = 0;
  for (const r of data ?? []) {
    const m = /^INV-(\d+)$/.exec(String(r.invoice_number ?? ""));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return "INV-" + String(max + 1).padStart(6, "0");
};

export const runDueInvoiceSchedules = async (admin: any): Promise<number> => {
  const today = ymd(new Date());
  const { data: due } = await admin
    .from("invoice_schedules")
    .select("*")
    .eq("enabled", true)
    .lte("next_run_date", today)
    .limit(200);

  let created = 0;
  for (const s of due ?? []) {
    try {
      const lines: Line[] = Array.isArray(s.line_items) ? s.line_items : [];
      const t = totalsFor(lines, Number(s.tax_rate ?? 0), Number(s.discount ?? 0));
      const number = await nextNumber(admin, s.organization_id);
      const issued = new Date();
      const dueAt = new Date(issued);
      dueAt.setUTCDate(dueAt.getUTCDate() + Number(s.due_days ?? 14));

      const { data: inv, error } = await admin.from("invoices").insert({
        organization_id: s.organization_id,
        client_id: s.client_id,
        workspace_id: s.workspace_id,
        invoice_number: number,
        title: s.title,
        status: "sent", // auto-issued recurring invoices go out as sent
        currency: s.currency,
        tax_rate: s.tax_rate,
        discount: s.discount,
        subtotal: t.subtotal,
        tax_amount: t.taxAmount,
        total: t.total,
        line_items: lines,
        notes: s.notes,
        terms: s.terms,
        issued_at: ymd(issued),
        due_at: ymd(dueAt),
        sent_at: new Date().toISOString(),
        created_by: s.created_by,
        created_by_name: s.created_by_name,
      }).select("invoice_id").single();
      if (error) { console.error("recurring invoice insert failed:", error); continue; }

      const nextRun = advance(new Date(s.next_run_date + "T00:00:00Z"), s.frequency);
      await admin.from("invoice_schedules").update({
        next_run_date: ymd(nextRun),
        last_invoice_id: inv?.invoice_id ?? null,
        last_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("schedule_id", s.schedule_id);
      created++;
    } catch (err) {
      console.error("runDueInvoiceSchedules error for schedule", s.schedule_id, err);
    }
  }
  return created;
};
```

- [ ] **Step 2:** In `supabase/functions/crm-run-automations/index.ts`, import + call it. Add the import near the others (after line 6):

```typescript
import { runDueInvoiceSchedules } from "./triggers/recurringInvoices.ts";
```

Right after `await enqueueCronEvents(admin);` (≈ line 428), add:

```typescript
    try {
      const made = await runDueInvoiceSchedules(admin);
      if (made > 0) console.log(`recurring invoices created: ${made}`);
    } catch (err) {
      console.error("runDueInvoiceSchedules failed:", err);
    }
```

- [ ] **Step 3: Type-check.**

Run: `& "$DENO" check supabase/functions/crm-run-automations/index.ts`
Expected: no NEW errors beyond the pre-existing `ActionResult.type` set the repo already has.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-run-automations/triggers/recurringInvoices.ts supabase/functions/crm-run-automations/index.ts
git commit -m "feat(billing): worker generates due recurring invoices"
```

---

## Task 3: Frontend service for schedules

**Files:** Create `src/services/supabase/invoiceSchedules.ts`

- [ ] **Step 1:** Create the file:

```typescript
import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { computeQuoteTotals, type QuoteLineItem } from "./quotes";

export type ScheduleFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

export interface InvoiceSchedule {
  scheduleId: string;
  organizationId: string;
  clientId: string;
  workspaceId: string | null;
  title: string | null;
  currency: string;
  taxRate: number;
  discount: number;
  lineItems: QuoteLineItem[];
  notes: string | null;
  terms: string | null;
  frequency: ScheduleFrequency;
  dueDays: number;
  nextRunDate: Date;
  enabled: boolean;
  lastInvoiceId: string | null;
  lastRunAt: Date | null;
  createdAt: Date;
}

export interface CreateScheduleInput {
  clientId: string;
  workspaceId?: string | null;
  title?: string | null;
  currency?: string;
  taxRate?: number;
  discount?: number;
  lineItems: QuoteLineItem[];
  notes?: string | null;
  terms?: string | null;
  frequency: ScheduleFrequency;
  dueDays?: number;
  nextRunDate: Date;
}

export type UpdateScheduleInput = Partial<CreateScheduleInput> & { enabled?: boolean };

const map = (r: Record<string, unknown>): InvoiceSchedule => ({
  scheduleId: r.schedule_id as string,
  organizationId: r.organization_id as string,
  clientId: r.client_id as string,
  workspaceId: (r.workspace_id as string) ?? null,
  title: (r.title as string) ?? null,
  currency: ((r.currency as string) || "USD").toUpperCase(),
  taxRate: Number(r.tax_rate ?? 0),
  discount: Number(r.discount ?? 0),
  lineItems: Array.isArray(r.line_items) ? (r.line_items as QuoteLineItem[]) : [],
  notes: (r.notes as string) ?? null,
  terms: (r.terms as string) ?? null,
  frequency: ((r.frequency as string) || "monthly") as ScheduleFrequency,
  dueDays: Number(r.due_days ?? 14),
  nextRunDate: new Date(r.next_run_date as string),
  enabled: !!r.enabled,
  lastInvoiceId: (r.last_invoice_id as string) ?? null,
  lastRunAt: r.last_run_at ? new Date(r.last_run_at as string) : null,
  createdAt: new Date(r.created_at as string),
});

export const listOrgSchedules = async (organizationId: string): Promise<InvoiceSchedule[]> => {
  const { data, error } = await supabase
    .from("invoice_schedules")
    .select("*")
    .eq("organization_id", organizationId)
    .order("next_run_date", { ascending: true });
  if (error) { logger.error("listOrgSchedules failed:", error); return []; }
  return (data ?? []).map(map);
};

export const createSchedule = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateScheduleInput,
): Promise<InvoiceSchedule> => {
  // Validate totals compute (keeps the same math the worker uses).
  computeQuoteTotals(input.lineItems, input.taxRate ?? 0, input.discount ?? 0);
  const { data, error } = await supabase.from("invoice_schedules").insert({
    organization_id: organizationId,
    client_id: input.clientId,
    workspace_id: input.workspaceId ?? null,
    title: input.title ?? null,
    currency: (input.currency ?? "USD").toUpperCase(),
    tax_rate: input.taxRate ?? 0,
    discount: input.discount ?? 0,
    line_items: input.lineItems,
    notes: input.notes ?? null,
    terms: input.terms ?? null,
    frequency: input.frequency,
    due_days: input.dueDays ?? 14,
    next_run_date: input.nextRunDate.toISOString().slice(0, 10),
    created_by: userId,
    created_by_name: userName,
  }).select().single();
  if (error) { logger.error("createSchedule failed:", error); throw error; }
  return map(data);
};

export const updateSchedule = async (
  organizationId: string,
  scheduleId: string,
  input: UpdateScheduleInput,
): Promise<void> => {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.currency !== undefined) patch.currency = input.currency.toUpperCase();
  if (input.taxRate !== undefined) patch.tax_rate = input.taxRate;
  if (input.discount !== undefined) patch.discount = input.discount;
  if (input.lineItems !== undefined) patch.line_items = input.lineItems;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.terms !== undefined) patch.terms = input.terms;
  if (input.frequency !== undefined) patch.frequency = input.frequency;
  if (input.dueDays !== undefined) patch.due_days = input.dueDays;
  if (input.nextRunDate !== undefined) patch.next_run_date = input.nextRunDate.toISOString().slice(0, 10);
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  patch.updated_at = new Date().toISOString();
  const { error } = await supabase.from("invoice_schedules").update(patch)
    .eq("organization_id", organizationId).eq("schedule_id", scheduleId);
  if (error) { logger.error("updateSchedule failed:", error); throw error; }
};

export const deleteSchedule = async (organizationId: string, scheduleId: string): Promise<void> => {
  const { error } = await supabase.from("invoice_schedules").delete()
    .eq("organization_id", organizationId).eq("schedule_id", scheduleId);
  if (error) { logger.error("deleteSchedule failed:", error); throw error; }
};
```

- [ ] **Step 2: Build.** `npm run build` → success. Commit:

```bash
git add src/services/supabase/invoiceSchedules.ts
git commit -m "feat(billing): invoice schedule service (recurring CRUD)"
```

---

## Task 4: Billing page — tabs + Recurring panel + schedule dialog

**Files:** Modify `src/pages/Billing.tsx`; Create `src/components/billing/RecurringScheduleDialog.tsx`

- [ ] **Step 1: Create `src/components/billing/RecurringScheduleDialog.tsx`.** Model the line-item grid + currency/tax/discount/title inputs on the existing `src/components/billing/InvoiceEditor.tsx` (READ it first for the exact grid markup, `blankLine`, and `updateLine` pattern, and reuse the same Dialog/Input/Label/Select primitives). The dialog captures: **Account** (a `<Select>` from a `clients` prop — required on create), **Frequency** (`weekly|monthly|quarterly|yearly`), **Next run date** (`type="date"`, required), **Due days** (number, default 14), **Currency**, **Title**, the **line-item grid** (same as InvoiceEditor), **Tax %**, **Discount**, **Notes**, **Terms**. Props:

```tsx
interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
  clients: { clientId: string; name: string; workspaceId: string }[];
  existing: InvoiceSchedule | null;
  userId: string | null;
  userName: string | null;
  onSaved: () => Promise<void> | void;
}
```

On save: validate ≥1 line item with a description+qty and (on create) a chosen client and a next-run date; call `createSchedule`/`updateSchedule` from `@/services/supabase/invoiceSchedules`; toast; `onSaved()`; close. Use the same `computeQuoteTotals` preview box as InvoiceEditor. Reset state on open from `existing` (or blank). Keep it a single focused component (~200 lines).

- [ ] **Step 2: Add tabs + a Recurring panel to `src/pages/Billing.tsx`.**

2a. Add imports:
```tsx
import { listOrgSchedules, deleteSchedule, updateSchedule, type InvoiceSchedule } from '@/services/supabase/invoiceSchedules';
import { RecurringScheduleDialog } from '@/components/billing/RecurringScheduleDialog';
```

2b. Add a tab state + schedules state near the other `useState`s:
```tsx
  const [tab, setTab] = useState<'invoices' | 'recurring'>('invoices');
  const [schedules, setSchedules] = useState<InvoiceSchedule[]>([]);
  const [openSchedule, setOpenSchedule] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<InvoiceSchedule | null>(null);
```

2c. In `load()`, also fetch schedules (add to the `Promise.all` or a second call):
```tsx
      const sched = await listOrgSchedules(orgId);
      setSchedules(sched);
```

2d. Render a simple tab bar under the page header (two buttons toggling `tab`), e.g.:
```tsx
      <div className="flex gap-1 border-b">
        {(['invoices','recurring'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-3 py-2 text-sm font-medium border-b-2 -mb-px capitalize',
              tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t === 'invoices' ? 'Invoices' : 'Recurring'}
          </button>
        ))}
      </div>
```
Wrap the existing tiles + filters + invoice table in `{tab === 'invoices' && ( … )}`. When `tab === 'recurring'`, render a panel: a "New recurring invoice" button (opens the dialog with `existing=null`), and a list/table of `schedules` showing client name, frequency, next run date, enabled toggle (calls `updateSchedule(orgId, id, { enabled: !s.enabled })` then `load()`), edit (opens dialog), delete (`deleteSchedule` then `load()`). Use `clientName(s.clientId)` and `fmt`/`format` already in the file. Empty state when none.

2e. Mount the dialog (alongside the existing `<InvoiceEditor .../>`):
```tsx
      <RecurringScheduleDialog
        open={openSchedule}
        onOpenChange={(o) => { setOpenSchedule(o); if (!o) setEditingSchedule(null); }}
        organizationId={orgId}
        clients={clients}
        existing={editingSchedule}
        userId={user?.userId ?? null}
        userName={user?.displayName ?? null}
        onSaved={load}
      />
```

- [ ] **Step 3: Build + test.** `npm run build` → success; `npm run test` → green. Commit:

```bash
git add src/pages/Billing.tsx src/components/billing/RecurringScheduleDialog.tsx
git commit -m "feat(billing): Recurring tab + schedule editor on the Billing page"
```

---

## Task 5: Verify

- [ ] `& "$DENO" check supabase/functions/crm-run-automations/index.ts` → only pre-existing errors.
- [ ] `npm run build` + `npm run test` → green.
- [ ] **Manual (post-deploy — needs migration 129 + the crm-run-automations worker redeployed):** create a monthly recurring schedule with next-run = today → on the next worker tick an invoice appears on the Invoices tab (status `sent`), and the schedule's next run advances by one month; disabling a schedule stops generation; editing changes the next generated invoice.

## Self-Review
**Spec coverage (Phase 4):** `invoice_schedules` table (Task 1) ✓; worker auto-issues due schedules + advances cadence, reusing the automations cron (Task 2) ✓; CRUD service (Task 3) ✓; Recurring management UI (Task 4) ✓.
**Placeholder scan:** Task 4 Step 1 references the existing InvoiceEditor for the grid markup rather than repeating ~80 lines — that file is in-repo and stable; the props + behavior are fully specified. Not a vague placeholder.
**Type consistency:** worker `totalsFor` mirrors `computeQuoteTotals` exactly (percent tax, pre-tax discount, round2); the service `map`/inputs use the same column names the migration defines and the worker reads; `RecurringScheduleDialog` consumes `createSchedule`/`updateSchedule` signatures from Task 3; `clients` prop shape matches what `getOrganizationClients` returns and what `InvoiceEditor` already uses on the hub.
