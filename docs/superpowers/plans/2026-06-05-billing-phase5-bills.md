# Billing Phase 5 — Bills / Accounts Payable

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Track money the org OWES (supplier/contractor bills) alongside the money-in invoices. A `bills` table mirrors `invoices` but is keyed to a free-text vendor (not a client). A "Bills" tab on the Billing page lists them with payable/overdue/paid tiles, create/edit, mark-paid, delete.

**Architecture:** New `bills` table (migration 130) mirroring `invoices`, with the same RLS helpers (`is_org_member` view/insert/update, `is_org_admin_or_owner` delete) and a `next_bill_number()` RPC (`BILL-000001`). A `bills.ts` service mirrors `invoices.ts` (pure `billTotals` + `isBillOverdue` helpers, CRUD). A `BillEditor` dialog mirrors `InvoiceEditor` but with a vendor name/email instead of a client picker. The Billing page gains a third tab.

**Tech Stack:** Postgres migration + RLS, React/TS, vitest. **Branch:** `billing-hub`.

**Known facts (verified):**
- `invoices` table + RLS pattern is the template (migration 099): `is_org_member(uuid)` / `is_org_admin_or_owner(uuid)` helpers; `next_invoice_number(org)` RPC parses `^INV-\d+$`, returns `INV-` + 6-pad. Unique index on `(organization_id, lower(number))`.
- `computeQuoteTotals(lineItems, taxRate, discount)` (percent tax, pre-tax discount, round2) + `QuoteLineItem = {description, qty, unitPrice, lineTotal}` from `src/services/supabase/quotes.ts`.
- `invoices.ts` exports `invoiceTotals`/`isOverdue` — mirror their shape for bills.
- `src/components/billing/InvoiceEditor.tsx` is the dialog template (line-item grid, `blankLine`, `updateLine`, totals preview, status/amountPaid edit fields).
- `src/pages/Billing.tsx` already has a tab bar (`tab: 'invoices' | 'recurring'`); extend the union to add `'bills'`. It has `fmt = useFormatMoney()`, `orgId`, `user`, `format` (date-fns), `KpiTile`, `STATUS_TONE`-style badges, and a `load()` that fetches on mount.
- Latest migration: `129`. Next: `130`.

---

## Task 1: Migration 130 — `bills` table + `next_bill_number` RPC

**Files:** Create `supabase/migrations/130_bills.sql`

- [ ] **Step 1:** Create the file:

```sql
-- Billing Phase 5: accounts-payable bills (money the org owes). Mirrors invoices
-- but keyed to a free-text vendor instead of a client. Re-runnable.

create table if not exists public.bills (
  bill_id           uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  workspace_id      uuid,

  vendor_name       text not null,
  vendor_email      text,

  bill_number       text not null,          -- per-org BILL-000001
  reference         text,                   -- the vendor's own invoice no.
  status            text not null default 'draft',
  currency          text not null default 'USD',

  subtotal          numeric(14,2) not null default 0,
  tax_rate          numeric(6,3) not null default 0,   -- percent
  tax_amount        numeric(14,2) not null default 0,
  discount          numeric(14,2) not null default 0,  -- flat, pre-tax
  total             numeric(14,2) not null default 0,
  amount_paid       numeric(14,2) not null default 0,

  line_items        jsonb not null default '[]'::jsonb,
  notes             text,

  issued_at         date not null default current_date,
  due_at            date,
  paid_at           timestamptz,
  voided_at         timestamptz,

  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (status in ('draft','open','paid','overdue','void'))
);

create unique index if not exists ux_bills_org_number
  on public.bills (organization_id, lower(bill_number));
create index if not exists idx_bills_org_status_time
  on public.bills (organization_id, status, issued_at desc);

alter table public.bills enable row level security;

drop policy if exists "anon_no_bills" on public.bills;
create policy "anon_no_bills" on public.bills for select to anon using (false);

drop policy if exists "members_view_bills" on public.bills;
create policy "members_view_bills" on public.bills for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "members_insert_bills" on public.bills;
create policy "members_insert_bills" on public.bills for insert to authenticated
  with check (public.is_org_member(organization_id) and (created_by = auth.uid() or created_by is null));

drop policy if exists "members_update_bills" on public.bills;
create policy "members_update_bills" on public.bills for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "admin_delete_bills" on public.bills;
create policy "admin_delete_bills" on public.bills for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.next_bill_number(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_seq integer;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  select coalesce(max(
           case when bill_number ~ '^BILL-\d+$'
             then substring(bill_number from '\d+')::integer
             else 0
           end), 0) + 1
    into v_seq
  from public.bills
  where organization_id = p_organization_id;
  return 'BILL-' || lpad(v_seq::text, 6, '0');
end;
$$;

grant execute on function public.next_bill_number(uuid) to authenticated;
```

- [ ] **Step 2:** Applied manually at deploy. Re-read for typos. Commit:

```bash
git add supabase/migrations/130_bills.sql
git commit -m "feat(billing): migration 130 - bills (A/P) table + next_bill_number"
```

---

## Task 2: `bills.ts` service (CRUD + pure helpers, mirrors invoices.ts)

**Files:** Create `src/services/supabase/bills.ts`; Create `tests/unit/billTotals.test.ts`

- [ ] **Step 1: Write the failing test** `tests/unit/billTotals.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { billTotals, isBillOverdue, type Bill } from '@/services/supabase/bills';

const bill = (over: Partial<Bill>): Bill => ({
  billId: 'b', organizationId: 'o', workspaceId: null, vendorName: 'V', vendorEmail: null,
  billNumber: 'BILL-1', reference: null, status: 'draft', currency: 'USD',
  subtotal: 0, taxRate: 0, taxAmount: 0, discount: 0, total: 0, amountPaid: 0,
  lineItems: [], notes: null, issuedAt: new Date('2026-01-01'), dueAt: null,
  paidAt: null, voidedAt: null, createdBy: null, createdByName: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...over,
});
const TODAY = new Date('2026-06-05T00:00:00Z');

describe('isBillOverdue', () => {
  it('true for an open bill past due, false when paid/void/no-date/future', () => {
    expect(isBillOverdue(bill({ status: 'open', dueAt: new Date('2026-06-01') }), TODAY)).toBe(true);
    expect(isBillOverdue(bill({ status: 'paid', dueAt: new Date('2026-06-01') }), TODAY)).toBe(false);
    expect(isBillOverdue(bill({ status: 'void', dueAt: new Date('2026-06-01') }), TODAY)).toBe(false);
    expect(isBillOverdue(bill({ status: 'open', dueAt: null }), TODAY)).toBe(false);
    expect(isBillOverdue(bill({ status: 'open', dueAt: new Date('2026-07-01') }), TODAY)).toBe(false);
  });
});

describe('billTotals', () => {
  it('sums payable, overdue, paid-30d and counts, excluding void + draft from payable', () => {
    const list = [
      bill({ status: 'open', total: 100, amountPaid: 0,  dueAt: new Date('2026-06-01') }), // payable + overdue
      bill({ status: 'open', total: 200, amountPaid: 50, dueAt: new Date('2026-07-01') }), // payable 150
      bill({ status: 'paid', total: 300, amountPaid: 300, paidAt: new Date('2026-05-20') }), // paid 30d
      bill({ status: 'void', total: 999, amountPaid: 0 }),
      bill({ status: 'draft', total: 80, amountPaid: 0 }),
    ];
    const t = billTotals(list, TODAY);
    expect(t.payable).toBe(250);
    expect(t.overdue).toBe(100);
    expect(t.paidLast30).toBe(300);
    expect(t.counts.open).toBe(2);
    expect(t.counts.void).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npm run test -- billTotals` (module not found).

- [ ] **Step 3: Implement `src/services/supabase/bills.ts`:**

```typescript
import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { computeQuoteTotals, type QuoteLineItem } from "./quotes";

export type BillStatus = "draft" | "open" | "paid" | "overdue" | "void";

export interface Bill {
  billId: string;
  organizationId: string;
  workspaceId: string | null;
  vendorName: string;
  vendorEmail: string | null;
  billNumber: string;
  reference: string | null;
  status: BillStatus;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  lineItems: QuoteLineItem[];
  notes: string | null;
  issuedAt: Date;
  dueAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBillInput {
  vendorName: string;
  vendorEmail?: string | null;
  workspaceId?: string | null;
  reference?: string | null;
  currency?: string;
  taxRate?: number;
  discount?: number;
  lineItems: QuoteLineItem[];
  notes?: string | null;
  issuedAt?: Date;
  dueAt?: Date | null;
}

export type UpdateBillInput = Partial<CreateBillInput> & {
  status?: BillStatus;
  amountPaid?: number;
};

const mapBill = (r: Record<string, unknown>): Bill => ({
  billId: r.bill_id as string,
  organizationId: r.organization_id as string,
  workspaceId: (r.workspace_id as string) ?? null,
  vendorName: (r.vendor_name as string) ?? "",
  vendorEmail: (r.vendor_email as string) ?? null,
  billNumber: r.bill_number as string,
  reference: (r.reference as string) ?? null,
  status: ((r.status as string) || "draft") as BillStatus,
  currency: ((r.currency as string) || "USD").toUpperCase(),
  subtotal: Number(r.subtotal ?? 0),
  taxRate: Number(r.tax_rate ?? 0),
  taxAmount: Number(r.tax_amount ?? 0),
  discount: Number(r.discount ?? 0),
  total: Number(r.total ?? 0),
  amountPaid: Number(r.amount_paid ?? 0),
  lineItems: Array.isArray(r.line_items) ? (r.line_items as QuoteLineItem[]) : [],
  notes: (r.notes as string) ?? null,
  issuedAt: new Date(r.issued_at as string),
  dueAt: r.due_at ? new Date(r.due_at as string) : null,
  paidAt: r.paid_at ? new Date(r.paid_at as string) : null,
  voidedAt: r.voided_at ? new Date(r.voided_at as string) : null,
  createdBy: (r.created_by as string) ?? null,
  createdByName: (r.created_by_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

export interface BillTotals {
  payable: number;
  overdue: number;
  paidLast30: number;
  counts: Record<BillStatus, number>;
}

export const isBillOverdue = (b: Bill, today: Date = new Date()): boolean => {
  if (b.status === "paid" || b.status === "void") return false;
  if (!b.dueAt) return false;
  return b.dueAt.getTime() < today.getTime();
};

export const billTotals = (list: Bill[], today: Date = new Date()): BillTotals => {
  const counts: Record<BillStatus, number> = { draft: 0, open: 0, paid: 0, overdue: 0, void: 0 };
  let payable = 0, overdue = 0, paidLast30 = 0;
  const cutoff = today.getTime() - 30 * 24 * 60 * 60 * 1000;
  for (const b of list) {
    counts[b.status] = (counts[b.status] ?? 0) + 1;
    if (b.status === "void") continue;
    const balance = Math.max(0, b.total - b.amountPaid);
    if (b.status !== "paid" && b.status !== "draft") {
      payable += balance;
      if (isBillOverdue(b, today)) overdue += balance;
    }
    if (b.paidAt && b.paidAt.getTime() >= cutoff) paidLast30 += b.amountPaid;
  }
  return { payable, overdue, paidLast30, counts };
};

const nextBillNumber = async (organizationId: string): Promise<string> => {
  const { data, error } = await supabase.rpc("next_bill_number", { p_organization_id: organizationId });
  if (error) { logger.warn("next_bill_number rpc failed, falling back:", error); return `BILL-${Date.now()}`; }
  return String(data);
};

export const listOrgBills = async (organizationId: string): Promise<Bill[]> => {
  const { data, error } = await supabase
    .from("bills").select("*")
    .eq("organization_id", organizationId)
    .order("issued_at", { ascending: false });
  if (error) { logger.error("listOrgBills failed:", error); return []; }
  return (data ?? []).map(mapBill);
};

export const createBill = async (
  organizationId: string, userId: string | null, userName: string | null, input: CreateBillInput,
): Promise<Bill> => {
  const taxRate = input.taxRate ?? 0;
  const discount = input.discount ?? 0;
  const totals = computeQuoteTotals(input.lineItems, taxRate, discount);
  const number = await nextBillNumber(organizationId);
  const { data, error } = await supabase.from("bills").insert({
    organization_id: organizationId,
    workspace_id: input.workspaceId ?? null,
    vendor_name: input.vendorName,
    vendor_email: input.vendorEmail ?? null,
    bill_number: number,
    reference: input.reference ?? null,
    status: "open",
    currency: (input.currency ?? "USD").toUpperCase(),
    tax_rate: taxRate, discount,
    subtotal: totals.subtotal, tax_amount: totals.taxAmount, total: totals.total,
    line_items: input.lineItems,
    notes: input.notes ?? null,
    issued_at: (input.issuedAt ?? new Date()).toISOString().slice(0, 10),
    due_at: input.dueAt ? input.dueAt.toISOString().slice(0, 10) : null,
    created_by: userId, created_by_name: userName,
  }).select().single();
  if (error) { logger.error("createBill failed:", error); throw error; }
  return mapBill(data);
};

export const updateBill = async (
  organizationId: string, billId: string, input: UpdateBillInput,
): Promise<Bill> => {
  const patch: Record<string, unknown> = {};
  if (input.vendorName !== undefined) patch.vendor_name = input.vendorName;
  if (input.vendorEmail !== undefined) patch.vendor_email = input.vendorEmail;
  if (input.reference !== undefined) patch.reference = input.reference;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === "paid") patch.paid_at = new Date().toISOString();
    if (input.status === "void") patch.voided_at = new Date().toISOString();
  }
  if (input.amountPaid !== undefined) patch.amount_paid = input.amountPaid;
  if (input.currency !== undefined) patch.currency = input.currency.toUpperCase();
  if (input.taxRate !== undefined) patch.tax_rate = input.taxRate;
  if (input.discount !== undefined) patch.discount = input.discount;
  if (input.lineItems !== undefined) {
    patch.line_items = input.lineItems;
    const totals = computeQuoteTotals(input.lineItems, input.taxRate ?? 0, input.discount ?? 0);
    patch.subtotal = totals.subtotal; patch.tax_amount = totals.taxAmount; patch.total = totals.total;
  }
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.dueAt !== undefined) patch.due_at = input.dueAt ? input.dueAt.toISOString().slice(0, 10) : null;
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("bills").update(patch)
    .eq("organization_id", organizationId).eq("bill_id", billId).select().single();
  if (error) { logger.error("updateBill failed:", error); throw error; }
  return mapBill(data);
};

export const deleteBill = async (organizationId: string, billId: string): Promise<void> => {
  const { error } = await supabase.from("bills").delete()
    .eq("organization_id", organizationId).eq("bill_id", billId);
  if (error) { logger.error("deleteBill failed:", error); throw error; }
};
```

- [ ] **Step 4: Run → PASS.** `npm run test -- billTotals`. Commit:

```bash
git add src/services/supabase/bills.ts tests/unit/billTotals.test.ts
git commit -m "feat(billing): bills (A/P) service + totals/overdue helpers (TDD)"
```

---

## Task 3: `BillEditor` dialog

**Files:** Create `src/components/billing/BillEditor.tsx`

- [ ] **Step 1:** READ `src/components/billing/InvoiceEditor.tsx` first. Create `BillEditor.tsx` modeled on it, with these differences:
  - Instead of a client (`client`/`clients`/picker): a **Vendor name** text `<Input>` (required) and an optional **Vendor email** `<Input>`. Also an optional **Reference** input (the vendor's own invoice number).
  - Status options on edit: `draft | open | paid | overdue | void` (use `BillStatus`).
  - No `issued_at` lock difference needed beyond what InvoiceEditor does; keep issued editable on create, locked on edit (mirror InvoiceEditor).
  - Reuse the SAME line-item grid (`blankLine`, `updateLine`, the `grid-cols-[1fr_60px_100px_100px_30px]` markup), the discount/tax inputs, and the `computeQuoteTotals` preview box.
  - On save: validate ≥1 line item (desc+qty) and a non-empty vendor name; call `createBill`/`updateBill` from `@/services/supabase/bills`; toast; `onSaved()`; close.

Props:
```tsx
interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
  existing: Bill | null;
  userId: string | null;
  userName: string | null;
  onSaved: () => Promise<void> | void;
}
```

- [ ] **Step 2: Build.** `npm run build` → success. Commit:

```bash
git add src/components/billing/BillEditor.tsx
git commit -m "feat(billing): BillEditor dialog (A/P bill create/edit)"
```

---

## Task 4: Bills tab on the Billing page

**Files:** Modify `src/pages/Billing.tsx`

- [ ] **Step 1:** READ the current `src/pages/Billing.tsx`. Add imports:

```tsx
import { listOrgBills, billTotals, isBillOverdue, updateBill, deleteBill, type Bill, type BillStatus } from '@/services/supabase/bills';
import { BillEditor } from '@/components/billing/BillEditor';
```

- [ ] **Step 2:** Extend the tab union and state:

```tsx
  const [tab, setTab] = useState<'invoices' | 'recurring' | 'bills'>('invoices');
  const [bills, setBills] = useState<Bill[]>([]);
  const [openBill, setOpenBill] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
```

- [ ] **Step 3:** In `load()`, also `setBills(await listOrgBills(orgId));`.

- [ ] **Step 4:** Add `'bills'` to the tab bar array and label it "Bills". Add a "New bill" button in the header when `tab === 'bills'` (opens `BillEditor` with `existing=null`).

- [ ] **Step 5:** Add a `{tab === 'bills' && ( … )}` panel mirroring the invoices panel:
  - A `useMemo` `bTotals = billTotals(bills, new Date())`.
  - KPI tiles: **Payable** (`fmt(bTotals.payable)`, `accent`), **Overdue** (`fmt(bTotals.overdue)`), **Paid (30d)** (`fmt(bTotals.paidLast30)`), **Drafts** (`bTotals.counts.draft`).
  - A table: Bill # (click → edit), Vendor (`b.vendorName`), Status badge (show "overdue" when `isBillOverdue(b)` and not paid/void — reuse the same STATUS_TONE map; note bill statuses include `open` which isn't in the invoice STATUS_TONE, so add a local `BILL_STATUS_TONE` with `open: 'bg-sky-500/15 …'` and the rest the same), Issued, Due, Total (`fmt(b.total, b.currency)`), Balance, actions: Mark paid (`updateBill(orgId, b.billId, { status: 'paid', amountPaid: b.total })` → load), edit, delete (`deleteBill` → load). Empty state when none.

- [ ] **Step 6:** Mount the editor alongside the others:

```tsx
      <BillEditor
        open={openBill}
        onOpenChange={(o) => { setOpenBill(o); if (!o) setEditingBill(null); }}
        organizationId={orgId}
        existing={editingBill}
        userId={user?.userId ?? null}
        userName={user?.displayName ?? null}
        onSaved={load}
      />
```

- [ ] **Step 7:** Update the page subtitle to reflect both money-in and money-out (e.g. "Invoices, recurring billing, and bills you owe."). Build + test:

```bash
npm run build   # success
npm run test    # green
git add src/pages/Billing.tsx
git commit -m "feat(billing): Bills (A/P) tab on the Billing page"
```

---

## Task 5: Verify

- [ ] `npm run test` → green (incl. `billTotals`).
- [ ] `npm run build` → success.
- [ ] **Manual (post-deploy — needs migration 130 applied):** Bills tab shows Payable/Overdue/Paid tiles; "New bill" → vendor + line items → creates a `BILL-000001` bill (status open); mark-paid moves it to paid + Payable drops; a bill past its due date shows the Overdue badge; delete works (admin/owner).

## Self-Review
**Spec coverage (Phase 5):** `bills` table + RLS + numbering (Task 1) ✓; service + pure helpers with tests (Task 2) ✓; create/edit dialog (Task 3) ✓; Bills tab with dashboard + actions (Task 4) ✓.
**Placeholder scan:** Task 3 + Task 4 reference the existing InvoiceEditor / invoices panel to mirror, with the concrete deltas (vendor vs client, `open` status, `BILL_STATUS_TONE`) spelled out — not vague. Migration SQL + service code are complete.
**Type consistency:** `billTotals`/`isBillOverdue`/`Bill`/`BillStatus` defined in Task 2 and consumed identically in Tasks 3–4; `createBill`/`updateBill`/`deleteBill`/`listOrgBills` signatures match their call sites; `next_bill_number` RPC name matches the migration; tax/discount math reuses `computeQuoteTotals` (consistent with invoices).
