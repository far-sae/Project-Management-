# Billing Hub (Phase 1 + 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing per-client invoice subsystem into a top-level Xero-style **Billing** hub: org-wide dashboard + list, branded PDF download, a public hosted invoice page, and email-to-client — reusing the existing `invoices` table, editor, and the `notify-send-gmail` edge function.

**Architecture:** Phase 1 is pure surfacing — new org-wide service queries + pure aggregate/overdue helpers, a `/billing` page (KPI tiles + filters + table), the existing `InvoiceEditor` extracted to a shared location and given an optional client-picker, and a lazy-loaded `@react-pdf/renderer` document. Phase 2 adds a `public_token` column + a `get_public_invoice` SECURITY DEFINER RPC, a public `/invoice/:token` page, and a `sendInvoice` service that reuses `notify-send-gmail` to email the client a link and flips status to `sent`. **No new edge function is needed** — `notify-send-gmail` already does the send.

**Tech Stack:** React + TS + Vite, Tailwind, shadcn/ui, recharts, `date-fns`, Supabase (Postgres + RLS + RPC), `@react-pdf/renderer` (new dep, lazy-loaded), vitest.

**Reference spec:** [docs/superpowers/specs/2026-06-05-billing-hub-design.md](../specs/2026-06-05-billing-hub-design.md)

**Known facts (verified against the codebase):**
- `src/services/supabase/invoices.ts` exports: `Invoice`, `InvoiceStatus = "draft"|"sent"|"paid"|"overdue"|"void"`, `CreateInvoiceInput`, `UpdateInvoiceInput`, `mapInvoice` (module-private), `createInvoice`, `updateInvoice`, `deleteInvoice`, `listClientInvoices`. Uses `computeQuoteTotals` + `QuoteLineItem` from `./quotes`.
- `InvoiceEditor` currently lives **inside** `src/components/clients/InvoicesPanel.tsx` (not exported). Props: `{ open, onOpenChange, organizationId, client: Client, existing: Invoice|null, userId, userName, onSaved }`. `blankLine()` + the `fmtMoney` + `STATUS_TONE` helpers also live in that file.
- `getOrganizationClients(organizationId): Promise<Client[]>` in `src/services/supabase/clients.ts`. `Client` has `clientId: string`, `workspaceId: string`, `name: string`, `email?: string|null`.
- `useOrganization()` exposes `organization: Organization|null` (`organization.name` is the brand string).
- `useFormatMoney()` → `(amount, rowCurrency?) => string` (org currency + FX). `KpiTile` at `src/components/dashboards/KpiTile.tsx`: props `{ label, value, deltaPct?, hint?, sparkline?, accent? }`.
- Routes: `src/App.tsx` — authenticated routes are children of `<AppLayout />` wrapped in `<ProtectedRoute requireSubscription [requireOrgAdmin|requireFeature]>`; public routes (e.g. `/privacy`, `/forms/:slug`) are siblings BEFORE the `<AppLayout />` child, with no `ProtectedRoute`. Lazy pages declared via `React.lazy(() => import(...).then(m => ({ default: m.Name })))`, rendered through `lazyAppRoute(...)` (authed) or `lazyRoute(...)` (public, adds Suspense).
- Sidebar: `src/components/sidebar/Sidebar.tsx` — `bottomMenuItems` array; the `canSeePeopleOps` branch lists Payroll as `{ icon: Wallet, label: 'Payroll', href: '/payroll', feature: null }`. `Receipt` icon already imported.
- Email: `supabase/functions/notify-send-gmail/index.ts` accepts POST `{ toEmail, toName?, subject, body, bodyHtml?, actionUrl?, organizationId?, entityType?, entityId? }`, sends via the caller's connected Gmail (`verifyUser` + `sendViaGmail`), returns JSON. Invoke from the frontend with `supabase.functions.invoke('notify-send-gmail', { body })`.
- Latest migration is `127_crm_view_default.sql` → next is `128`.
- `@react-pdf/renderer` is NOT yet a dependency.

---

## PHASE 1 — Billing hub + dashboard + PDF

### Task 1: Service — org-wide list + pure totals/overdue helpers (TDD)

**Files:**
- Modify: `src/services/supabase/invoices.ts`
- Create: `tests/unit/invoiceTotals.test.ts`

- [ ] **Step 1: Write the failing test** `tests/unit/invoiceTotals.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { invoiceTotals, isOverdue, type Invoice } from '@/services/supabase/invoices';

// Minimal Invoice factory — only the fields the helpers read.
const inv = (over: Partial<Invoice>): Invoice => ({
  invoiceId: 'i', organizationId: 'o', clientId: 'c', dealId: null, quoteId: null,
  workspaceId: null, invoiceNumber: 'INV-1', title: null, status: 'draft',
  currency: 'USD', subtotal: 0, taxRate: 0, taxAmount: 0, discount: 0, total: 0,
  amountPaid: 0, lineItems: [], notes: null, terms: null,
  issuedAt: new Date('2026-01-01'), dueAt: null, sentAt: null, paidAt: null,
  voidedAt: null, publicToken: null, createdBy: null, createdByName: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  ...over,
});

const TODAY = new Date('2026-06-05T00:00:00Z');

describe('isOverdue', () => {
  it('is true for an unpaid sent invoice past its due date', () => {
    expect(isOverdue(inv({ status: 'sent', dueAt: new Date('2026-06-01'), total: 100 }), TODAY)).toBe(true);
  });
  it('is false when paid, void, no due date, or due in the future', () => {
    expect(isOverdue(inv({ status: 'paid', dueAt: new Date('2026-06-01') }), TODAY)).toBe(false);
    expect(isOverdue(inv({ status: 'void', dueAt: new Date('2026-06-01') }), TODAY)).toBe(false);
    expect(isOverdue(inv({ status: 'sent', dueAt: null }), TODAY)).toBe(false);
    expect(isOverdue(inv({ status: 'sent', dueAt: new Date('2026-07-01') }), TODAY)).toBe(false);
  });
});

describe('invoiceTotals', () => {
  it('sums outstanding, overdue, paid-30d and status counts, ignoring void', () => {
    const list = [
      inv({ status: 'sent',  total: 100, amountPaid: 0,  dueAt: new Date('2026-06-01') }), // overdue + outstanding
      inv({ status: 'sent',  total: 200, amountPaid: 50, dueAt: new Date('2026-07-01') }), // outstanding 150, not overdue
      inv({ status: 'paid',  total: 300, amountPaid: 300, paidAt: new Date('2026-05-20') }), // paid in last 30d
      inv({ status: 'paid',  total: 300, amountPaid: 300, paidAt: new Date('2026-01-01') }), // paid long ago
      inv({ status: 'void',  total: 999, amountPaid: 0 }), // ignored
      inv({ status: 'draft', total: 80,  amountPaid: 0 }), // draft count, not outstanding
    ];
    const t = invoiceTotals(list, TODAY);
    expect(t.outstanding).toBe(250);          // 100 + 150
    expect(t.overdue).toBe(100);              // only the first
    expect(t.paidLast30).toBe(300);           // only the 2026-05-20 one
    expect(t.counts.draft).toBe(1);
    expect(t.counts.sent).toBe(2);
    expect(t.counts.paid).toBe(2);
    expect(t.counts.void).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- invoiceTotals`
Expected: FAIL (`isOverdue`/`invoiceTotals`/`publicToken` not exported).

- [ ] **Step 3: Implement in `src/services/supabase/invoices.ts`.**

3a. Add `publicToken` to the `Invoice` interface (after `voidedAt: Date | null;`):

```typescript
  publicToken: string | null;
```

3b. In `mapInvoice`, add (after the `voidedAt:` line):

```typescript
  publicToken: (r.public_token as string) ?? null,
```

3c. At the end of the file, add the pure helpers + the org-wide list:

```typescript
export interface InvoiceTotals {
  outstanding: number;
  overdue: number;
  paidLast30: number;
  counts: Record<InvoiceStatus, number>;
}

/** Display-only overdue: unpaid + not void + has a due date in the past.
 *  Never mutates the stored status. */
export const isOverdue = (i: Invoice, today: Date = new Date()): boolean => {
  if (i.status === 'paid' || i.status === 'void') return false;
  if (!i.dueAt) return false;
  return i.dueAt.getTime() < today.getTime();
};

/** Dashboard aggregates over a list of invoices. Void invoices are ignored
 *  for money totals but still counted in `counts`. */
export const invoiceTotals = (list: Invoice[], today: Date = new Date()): InvoiceTotals => {
  const counts: Record<InvoiceStatus, number> = { draft: 0, sent: 0, paid: 0, overdue: 0, void: 0 };
  let outstanding = 0, overdue = 0, paidLast30 = 0;
  const cutoff = today.getTime() - 30 * 24 * 60 * 60 * 1000;
  for (const i of list) {
    counts[i.status] = (counts[i.status] ?? 0) + 1;
    if (i.status === 'void') continue;
    const balance = Math.max(0, i.total - i.amountPaid);
    if (i.status !== 'paid') {
      outstanding += balance;
      if (isOverdue(i, today)) overdue += balance;
    }
    if (i.paidAt && i.paidAt.getTime() >= cutoff) paidLast30 += i.amountPaid;
  }
  return { outstanding, overdue, paidLast30, counts };
};

export interface OrgInvoiceFilters {
  status?: InvoiceStatus;
  clientId?: string;
}

/** All invoices for the org, newest first. Filtering by free-text/search is
 *  done client-side on the Billing page; this applies the cheap server filters. */
export const listOrgInvoices = async (
  organizationId: string,
  filters: OrgInvoiceFilters = {},
): Promise<Invoice[]> => {
  let q = supabase
    .from('invoices')
    .select('*')
    .eq('organization_id', organizationId)
    .order('issued_at', { ascending: false });
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.clientId) q = q.eq('client_id', filters.clientId);
  const { data, error } = await q;
  if (error) {
    logger.error('listOrgInvoices failed:', error);
    return [];
  }
  return (data ?? []).map(mapInvoice);
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- invoiceTotals`
Expected: PASS (both describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/services/supabase/invoices.ts tests/unit/invoiceTotals.test.ts
git commit -m "feat(billing): org-wide invoice list + totals/overdue helpers"
```

---

### Task 2: Extract `InvoiceEditor` to a shared component (refactor, no behavior change)

**Files:**
- Create: `src/components/billing/InvoiceEditor.tsx`
- Modify: `src/components/clients/InvoicesPanel.tsx`

- [ ] **Step 1: Create `src/components/billing/InvoiceEditor.tsx`** by moving the `InvoiceEditor` component + its local `blankLine` helper out of `InvoicesPanel.tsx`. Paste the EXACT `EditorProps` interface, `blankLine`, and `InvoiceEditor` implementation from `InvoicesPanel.tsx` (lines 205–434 in the current file), and add the imports it needs at the top of the new file:

```typescript
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { Client } from '@/services/supabase/clients';
import type { QuoteLineItem } from '@/services/supabase/quotes';
import { computeQuoteTotals } from '@/services/supabase/quotes';
import {
  Invoice, InvoiceStatus, createInvoice, updateInvoice,
} from '@/services/supabase/invoices';
import { toast } from 'sonner';

const fmtMoney = (n: number, c: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n);
  } catch { return `${c} ${n.toFixed(2)}`; }
};
```

Then the `EditorProps` interface, `blankLine`, and the full `InvoiceEditor` body — **but change the `const InvoiceEditor` declaration to a named export**:

```typescript
export const InvoiceEditor: React.FC<EditorProps> = ({ ... }) => { /* unchanged body */ };
```

(Keep the body byte-for-byte identical to the current implementation; only the `export` keyword and the file location change in this task.)

- [ ] **Step 2: In `src/components/clients/InvoicesPanel.tsx`**, delete the now-moved `InvoiceEditor`, its `EditorProps`, and the local `blankLine` (lines 205–434), and import the extracted component instead. Add near the other imports:

```typescript
import { InvoiceEditor } from '@/components/billing/InvoiceEditor';
```

Leave the `<InvoiceEditor ... />` usage in `InvoicesPanel` exactly as-is (same props). `fmtMoney` and `STATUS_TONE` stay in `InvoicesPanel` (still used by the list).

- [ ] **Step 3: Build to verify the refactor compiles + tests still pass**

Run: `npm run build`
Expected: success, no TS errors.
Run: `npm run test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/components/billing/InvoiceEditor.tsx src/components/clients/InvoicesPanel.tsx
git commit -m "refactor(billing): extract InvoiceEditor into shared components/billing"
```

---

### Task 3: Give `InvoiceEditor` an optional client picker (for the hub)

**Files:**
- Modify: `src/components/billing/InvoiceEditor.tsx`

Context: the client drawer passes a fixed `client`. The Billing hub's "New invoice" has no client yet, so the editor must let the user pick one. We make `client` optional and add a `clients` list; when creating without a fixed client, render a required client `<Select>`.

- [ ] **Step 1:** Change `EditorProps`:

```typescript
interface EditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Fixed account (client drawer). Omit on the hub and pass `clients` instead. */
  client?: Client | null;
  /** Selectable accounts for the hub "New invoice" flow (ignored when editing
   *  or when a fixed `client` is given). */
  clients?: Pick<Client, 'clientId' | 'name' | 'workspaceId'>[];
  existing: Invoice | null;
  userId: string | null;
  userName: string | null;
  onSaved: () => Promise<void> | void;
}
```

- [ ] **Step 2:** Add state for the picked client id and resolve the effective client. Inside the component, after the existing `useState` declarations, add:

```typescript
  const [pickedClientId, setPickedClientId] = useState('');

  // The account this invoice belongs to: the fixed prop, the existing
  // invoice's client, or the hub-picked one.
  const effectiveClientId =
    client?.clientId ?? existing?.clientId ?? pickedClientId;
  const effectiveWorkspaceId =
    client?.workspaceId ??
    clients?.find((c) => c.clientId === pickedClientId)?.workspaceId ??
    null;
```

In the `useEffect` that resets on open, in the `else` (new-invoice) branch add `setPickedClientId('');`.

- [ ] **Step 3:** In `handleSave`, guard for a missing client and use the effective ids. Replace the start of `handleSave` validation and the `createInvoice` call:

```typescript
  const handleSave = async () => {
    const valid = lines.filter((l) => l.description.trim() && l.qty > 0);
    if (valid.length === 0) { toast.error('Add at least one line item'); return; }
    if (!existing && !effectiveClientId) { toast.error('Pick an account for this invoice'); return; }
    setBusy(true);
    try {
      if (existing) {
        await updateInvoice(organizationId, existing.invoiceId, {
          title, currency, lineItems: valid, taxRate, discount, notes, terms,
          dueAt: dueAt ? new Date(dueAt) : null, status, amountPaid,
        });
      } else {
        await createInvoice(organizationId, userId, userName, {
          clientId: effectiveClientId,
          workspaceId: effectiveWorkspaceId,
          title: title || null, currency, lineItems: valid, taxRate, discount,
          notes, terms, issuedAt: new Date(issuedAt),
          dueAt: dueAt ? new Date(dueAt) : null,
        });
      }
      toast.success(existing ? 'Invoice saved' : 'Invoice created');
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 4:** Render the picker. In the top metadata grid, when creating on the hub (no fixed `client`, not editing, and `clients` provided), show a client Select ABOVE the title row. Insert right after `<div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">`:

```tsx
          {!existing && !client && clients && (
            <div>
              <Label className="text-xs">Account</Label>
              <Select value={pickedClientId} onValueChange={setPickedClientId} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="Select an account…" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.clientId} value={c.clientId}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
```

Also make the `DialogDescription` tolerate a missing client — replace the existing description body with:

```tsx
          <DialogDescription>
            {client ? <>For account <strong>{client.name}</strong>. </> : null}
            Totals recompute from the line items.
          </DialogDescription>
```

- [ ] **Step 5: Build + test**

Run: `npm run build` → success.
Run: `npm run test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/components/billing/InvoiceEditor.tsx
git commit -m "feat(billing): optional client picker in InvoiceEditor for the hub"
```

---

### Task 4: Billing page — dashboard tiles + filters + table + actions

**Files:**
- Create: `src/pages/Billing.tsx`

- [ ] **Step 1: Create `src/pages/Billing.tsx`:**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Plus, Loader2, FileDown, Send, Trash2, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { KpiTile } from '@/components/dashboards/KpiTile';
import { InvoiceEditor } from '@/components/billing/InvoiceEditor';
import {
  Invoice, InvoiceStatus, listOrgInvoices, invoiceTotals, isOverdue,
  updateInvoice, deleteInvoice, sendInvoice,
} from '@/services/supabase/invoices';
import { getOrganizationClients, type Client } from '@/services/supabase/clients';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { downloadInvoicePdf } from '@/components/billing/invoicePdf';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft:   'bg-muted text-muted-foreground border-border',
  sent:    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  paid:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  overdue: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  void:    'bg-muted text-muted-foreground border-border line-through',
};

const STATUSES: (InvoiceStatus | 'all')[] = ['all', 'draft', 'sent', 'paid', 'overdue', 'void'];

export const Billing: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const fmt = useFormatMoney();
  const orgId = organization?.organizationId ?? '';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [openEditor, setOpenEditor] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const clientName = useMemo(() => {
    const m = new Map<string, string>();
    clients.forEach((c) => m.set(c.clientId, c.name));
    return (id: string) => m.get(id) ?? '—';
  }, [clients]);

  const load = async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [inv, cls] = await Promise.all([
        listOrgInvoices(orgId),
        getOrganizationClients(orgId),
      ]);
      setInvoices(inv);
      setClients(cls);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [orgId]);

  const totals = useMemo(() => invoiceTotals(invoices, new Date()), [invoices]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return invoices.filter((i) => {
      const effStatus = isOverdue(i) && i.status !== 'overdue' ? 'overdue' : i.status;
      if (statusFilter !== 'all') {
        if (statusFilter === 'overdue') { if (!isOverdue(i)) return false; }
        else if (i.status !== statusFilter) return false;
      }
      if (term) {
        const hay = `${i.invoiceNumber} ${i.title ?? ''} ${clientName(i.clientId)}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
      void effStatus;
    });
  }, [invoices, statusFilter, search, clientName]);

  const markPaid = async (inv: Invoice) => {
    setBusyId(inv.invoiceId);
    try {
      await updateInvoice(orgId, inv.invoiceId, { status: 'paid', amountPaid: inv.total });
      toast.success(`Marked ${inv.invoiceNumber} paid`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Update failed'); }
    finally { setBusyId(null); }
  };

  const send = async (inv: Invoice) => {
    setBusyId(inv.invoiceId);
    try {
      const url = await sendInvoice(orgId, inv.invoiceId);
      toast.success(`Sent ${inv.invoiceNumber}${url ? '' : ''}`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Send failed'); }
    finally { setBusyId(null); }
  };

  const remove = async (inv: Invoice) => {
    if (!confirm(`Delete ${inv.invoiceNumber}? This cannot be undone.`)) return;
    setBusyId(inv.invoiceId);
    try { await deleteInvoice(orgId, inv.invoiceId); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusyId(null); }
  };

  const pdf = async (inv: Invoice) => {
    try {
      await downloadInvoicePdf(inv, { name: organization?.name ?? 'Company' }, clientName(inv.clientId));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not build PDF'); }
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" /> Billing
          </h1>
          <p className="text-sm text-muted-foreground">All invoices across your accounts.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpenEditor(true); }}>
          <Plus className="w-4 h-4 mr-1.5" /> New invoice
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Outstanding" value={fmt(totals.outstanding)} accent />
        <KpiTile label="Overdue" value={fmt(totals.overdue)} />
        <KpiTile label="Paid (30d)" value={fmt(totals.paidLast30)} />
        <KpiTile label="Drafts" value={totals.counts.draft.toLocaleString()} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as InvoiceStatus | 'all')}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s === 'all' ? 'All statuses' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Search number, title, account…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      {loading ? (
        <div className="py-10 text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading invoices…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No invoices match. Create one with “New invoice”.
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Invoice</th>
                <th className="text-left font-semibold px-3 py-2">Account</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
                <th className="text-left font-semibold px-3 py-2">Issued</th>
                <th className="text-left font-semibold px-3 py-2">Due</th>
                <th className="text-right font-semibold px-3 py-2">Total</th>
                <th className="text-right font-semibold px-3 py-2">Balance</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((inv) => {
                const overdue = isOverdue(inv);
                const shownStatus: InvoiceStatus = overdue && inv.status !== 'void' && inv.status !== 'paid' ? 'overdue' : inv.status;
                const balance = Math.max(0, inv.total - inv.amountPaid);
                return (
                  <tr key={inv.invoiceId} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <button className="font-medium hover:underline" onClick={() => { setEditing(inv); setOpenEditor(true); }}>
                        {inv.invoiceNumber}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{clientName(inv.clientId)}</td>
                    <td className="px-3 py-2">
                      <Badge className={cn('text-[10px] capitalize', STATUS_TONE[shownStatus])}>{shownStatus}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{format(inv.issuedAt, 'PP')}</td>
                    <td className="px-3 py-2 text-muted-foreground">{inv.dueAt ? format(inv.dueAt, 'PP') : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(inv.total, inv.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{balance > 0 ? fmt(balance, inv.currency) : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2" title="Download PDF" onClick={() => pdf(inv)} disabled={busyId === inv.invoiceId}>
                          <FileDown className="w-3.5 h-3.5" />
                        </Button>
                        {inv.status !== 'paid' && inv.status !== 'void' && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" title="Email to client" onClick={() => send(inv)} disabled={busyId === inv.invoiceId}>
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {inv.status !== 'paid' && inv.status !== 'void' && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markPaid(inv)} disabled={busyId === inv.invoiceId}>
                            Mark paid
                          </Button>
                        )}
                        <button className="text-muted-foreground hover:text-destructive p-1" title="Delete" onClick={() => remove(inv)} disabled={busyId === inv.invoiceId}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <InvoiceEditor
        open={openEditor}
        onOpenChange={(o) => { setOpenEditor(o); if (!o) setEditing(null); }}
        organizationId={orgId}
        clients={clients}
        existing={editing}
        userId={user?.userId ?? null}
        userName={user?.displayName ?? null}
        onSaved={load}
      />
    </div>
  );
};

export default Billing;
```

NOTE: `sendInvoice` and `downloadInvoicePdf` are created in Tasks 6 + 9. To keep this task self-contained and buildable, also do Step 2 below.

- [ ] **Step 2: Add temporary stubs so the page builds before Tasks 6/9.** Append to `src/services/supabase/invoices.ts`:

```typescript
// Implemented in Task 9 (Phase 2). Stub keeps the Billing page compiling.
export const sendInvoice = async (
  _organizationId: string,
  _invoiceId: string,
): Promise<string | null> => {
  throw new Error('Sending is enabled after Phase 2 is deployed.');
};
```

And create `src/components/billing/invoicePdf.ts` with a stub (replaced in Task 6):

```typescript
import type { Invoice } from '@/services/supabase/invoices';
export const downloadInvoicePdf = async (
  _invoice: Invoice,
  _org: { name: string },
  _clientName: string,
): Promise<void> => {
  throw new Error('PDF export is wired up in Task 6.');
};
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success (page compiles against the stubs).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Billing.tsx src/services/supabase/invoices.ts src/components/billing/invoicePdf.ts
git commit -m "feat(billing): Billing hub page (dashboard, filters, table, actions)"
```

---

### Task 5: Route + sidebar nav

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1:** In `src/App.tsx`, add the lazy import alongside the others (near line 35, after `PayrollPage`):

```typescript
const BillingPage = React.lazy(() => import('@/pages/Billing').then((m) => ({ default: m.Billing })));
```

- [ ] **Step 2:** Add the route inside the `<AppLayout />` children (right after the `/payroll` route block, near line 305). Visible to org members (view), so `requireSubscription` only:

```tsx
            {
              path: '/billing',
              element: (
                <ProtectedRoute requireSubscription>
                  {lazyAppRoute(<BillingPage />)}
                </ProtectedRoute>
              ),
            },
```

- [ ] **Step 3:** In `src/components/sidebar/Sidebar.tsx`, add a Billing entry in the `canSeePeopleOps` branch of `bottomMenuItems`, right after the Payroll line (≈ line 166). `Receipt` is already imported:

```typescript
        { icon: Receipt, label: 'Billing', href: '/billing', feature: null },
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success. Manually confirm `/billing` loads the page with the dashboard tiles + (likely empty) table.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/sidebar/Sidebar.tsx
git commit -m "feat(billing): /billing route + sidebar entry"
```

---

### Task 6: Branded PDF download (lazy `@react-pdf/renderer`)

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/components/billing/InvoiceDocument.tsx`
- Replace: `src/components/billing/invoicePdf.ts` (the Task 4 stub)

- [ ] **Step 1: Add the dependency.**

Run: `npm install @react-pdf/renderer@^4.0.0`
Expected: it installs and appears under `dependencies` in `package.json`.

- [ ] **Step 2: Create `src/components/billing/InvoiceDocument.tsx`** — the PDF document component:

```tsx
import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { Invoice } from '@/services/supabase/invoices';

const money = (n: number, c: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n); }
  catch { return `${c} ${n.toFixed(2)}`; }
};
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: '#111', fontFamily: 'Helvetica' },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  brand: { fontSize: 18, fontWeight: 700, color: '#c2410c' },
  h1: { fontSize: 22, fontWeight: 700 },
  meta: { textAlign: 'right', color: '#555' },
  section: { marginBottom: 14 },
  label: { fontSize: 8, color: '#888', textTransform: 'uppercase', marginBottom: 2 },
  row: { flexDirection: 'row', borderBottom: '1px solid #eee', paddingVertical: 4 },
  thRow: { flexDirection: 'row', borderBottom: '1px solid #ccc', paddingVertical: 4, fontWeight: 700 },
  cDesc: { flex: 1 }, cQty: { width: 50, textAlign: 'right' },
  cUnit: { width: 80, textAlign: 'right' }, cTot: { width: 80, textAlign: 'right' },
  totals: { marginTop: 10, marginLeft: 'auto', width: 200 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4, marginTop: 4, borderTop: '1px solid #ccc', fontWeight: 700, fontSize: 12 },
  terms: { marginTop: 22, color: '#555' },
});

export const InvoiceDocument: React.FC<{ invoice: Invoice; orgName: string; clientName: string }> = ({ invoice, orgName, clientName }) => {
  const c = invoice.currency;
  return (
    <Document title={invoice.invoiceNumber}>
      <Page size="A4" style={s.page}>
        <View style={s.brandRow}>
          <Text style={s.brand}>{orgName}</Text>
          <View style={s.meta}>
            <Text style={s.h1}>INVOICE</Text>
            <Text>{invoice.invoiceNumber}</Text>
          </View>
        </View>

        <View style={[s.section, { flexDirection: 'row', justifyContent: 'space-between' }]}>
          <View>
            <Text style={s.label}>Bill to</Text>
            <Text>{clientName}</Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={s.label}>Issued</Text>
            <Text>{ymd(invoice.issuedAt)}</Text>
            <Text style={[s.label, { marginTop: 4 }]}>Due</Text>
            <Text>{ymd(invoice.dueAt)}</Text>
          </View>
        </View>

        <View style={s.thRow}>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cUnit}>Unit</Text>
          <Text style={s.cTot}>Amount</Text>
        </View>
        {invoice.lineItems.map((li, i) => (
          <View style={s.row} key={i}>
            <Text style={s.cDesc}>{li.description}</Text>
            <Text style={s.cQty}>{li.qty}</Text>
            <Text style={s.cUnit}>{money(li.unitPrice, c)}</Text>
            <Text style={s.cTot}>{money(li.lineTotal, c)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.tRow}><Text>Subtotal</Text><Text>{money(invoice.subtotal, c)}</Text></View>
          {invoice.discount > 0 && <View style={s.tRow}><Text>Discount</Text><Text>-{money(invoice.discount, c)}</Text></View>}
          {invoice.taxAmount > 0 && <View style={s.tRow}><Text>Tax</Text><Text>{money(invoice.taxAmount, c)}</Text></View>}
          <View style={s.grand}><Text>Total</Text><Text>{money(invoice.total, c)}</Text></View>
          {invoice.amountPaid > 0 && <View style={s.tRow}><Text>Paid</Text><Text>{money(invoice.amountPaid, c)}</Text></View>}
          {invoice.amountPaid > 0 && invoice.amountPaid < invoice.total && (
            <View style={s.tRow}><Text>Balance</Text><Text>{money(invoice.total - invoice.amountPaid, c)}</Text></View>
          )}
        </View>

        {invoice.terms ? <Text style={s.terms}>{invoice.terms}</Text> : null}
        {invoice.notes ? <Text style={[s.terms, { marginTop: 6 }]}>{invoice.notes}</Text> : null}
      </Page>
    </Document>
  );
};
```

- [ ] **Step 3: Replace `src/components/billing/invoicePdf.ts`** with the real lazy implementation:

```typescript
import type { Invoice } from '@/services/supabase/invoices';

/** Build + download an invoice PDF in the browser. `@react-pdf/renderer` is
 *  dynamically imported so it stays out of the main bundle until used. */
export const downloadInvoicePdf = async (
  invoice: Invoice,
  org: { name: string },
  clientName: string,
): Promise<void> => {
  const [{ pdf }, { InvoiceDocument }, React] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./InvoiceDocument'),
    import('react'),
  ]);
  const blob = await pdf(
    React.createElement(InvoiceDocument, { invoice, orgName: org.name, clientName }),
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${invoice.invoiceNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success; the PDF lib should land in a separate async chunk (you'll see a new chunk in the build output). Manually confirm clicking the PDF icon on a Billing row downloads `INV-…pdf`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/billing/InvoiceDocument.tsx src/components/billing/invoicePdf.ts
git commit -m "feat(billing): branded invoice PDF download (lazy @react-pdf/renderer)"
```

---

## PHASE 2 — Public hosted page + email

### Task 7: Migration 128 — `public_token` + `get_public_invoice` RPC

**Files:**
- Create: `supabase/migrations/128_invoice_public_token.sql`

- [ ] **Step 1: Create `supabase/migrations/128_invoice_public_token.sql`:**

```sql
-- Billing Phase 2: a tokenized public view of an invoice (hosted page + email link).
-- Re-runnable.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS public_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

-- Backfill any pre-existing rows that somehow lack a token (defensive; the
-- DEFAULT covers new rows and the ADD COLUMN populates existing ones).
UPDATE public.invoices SET public_token = gen_random_uuid() WHERE public_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_public_token ON public.invoices (public_token);

-- Public, unauthenticated, read-only view of a single non-void invoice by token.
-- SECURITY DEFINER so it bypasses RLS, but it ONLY returns the fields needed to
-- render the hosted page and ONLY for non-void invoices.
CREATE OR REPLACE FUNCTION public.get_public_invoice(p_token uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'invoice_number', i.invoice_number,
    'status', i.status,
    'currency', i.currency,
    'subtotal', i.subtotal,
    'tax_rate', i.tax_rate,
    'tax_amount', i.tax_amount,
    'discount', i.discount,
    'total', i.total,
    'amount_paid', i.amount_paid,
    'line_items', i.line_items,
    'notes', i.notes,
    'terms', i.terms,
    'issued_at', i.issued_at,
    'due_at', i.due_at,
    'org_name', o.name,
    'client_name', c.name
  )
  FROM public.invoices i
  JOIN public.organizations o ON o.id = i.organization_id
  LEFT JOIN public.clients c ON c.client_id = i.client_id
  WHERE i.public_token = p_token
    AND i.status <> 'void'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_invoice(uuid) TO anon, authenticated;
```

> **Note for the implementer:** confirm the `organizations` PK column name. If the table's primary key is `organization_id` (not `id`), change the join to `o.organization_id = i.organization_id`. Check `supabase/migrations` for the `organizations` table definition before applying.

- [ ] **Step 2:** This migration is applied manually in the Supabase SQL editor at deploy time (the repo's convention — integer-named migrations are NOT run via `supabase db push`). No automated test here. Verify the SQL parses by reading it once more for typos.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/128_invoice_public_token.sql
git commit -m "feat(billing): migration 128 - invoice public_token + get_public_invoice RPC"
```

---

### Task 8: Public hosted invoice page `/invoice/:token`

**Files:**
- Create: `src/pages/public/PublicInvoice.tsx`
- Modify: `src/App.tsx`
- Modify: `src/services/supabase/invoices.ts` (add `getPublicInvoice`)

- [ ] **Step 1:** Add a fetch helper to `src/services/supabase/invoices.ts`:

```typescript
export interface PublicInvoiceView {
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  lineItems: QuoteLineItem[];
  notes: string | null;
  terms: string | null;
  issuedAt: Date;
  dueAt: Date | null;
  orgName: string;
  clientName: string;
}

export const getPublicInvoice = async (token: string): Promise<PublicInvoiceView | null> => {
  const { data, error } = await supabase.rpc('get_public_invoice', { p_token: token });
  if (error || !data) {
    if (error) logger.warn('get_public_invoice failed:', error);
    return null;
  }
  const r = data as Record<string, unknown>;
  return {
    invoiceNumber: r.invoice_number as string,
    status: ((r.status as string) || 'sent') as InvoiceStatus,
    currency: ((r.currency as string) || 'USD').toUpperCase(),
    subtotal: Number(r.subtotal ?? 0),
    taxRate: Number(r.tax_rate ?? 0),
    taxAmount: Number(r.tax_amount ?? 0),
    discount: Number(r.discount ?? 0),
    total: Number(r.total ?? 0),
    amountPaid: Number(r.amount_paid ?? 0),
    lineItems: Array.isArray(r.line_items) ? (r.line_items as QuoteLineItem[]) : [],
    notes: (r.notes as string) ?? null,
    terms: (r.terms as string) ?? null,
    issuedAt: new Date(r.issued_at as string),
    dueAt: r.due_at ? new Date(r.due_at as string) : null,
    orgName: (r.org_name as string) ?? 'Company',
    clientName: (r.client_name as string) ?? '',
  };
};
```

- [ ] **Step 2: Create `src/pages/public/PublicInvoice.tsx`:**

```tsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, FileDown } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { getPublicInvoice, type PublicInvoiceView, type Invoice } from '@/services/supabase/invoices';
import { downloadInvoicePdf } from '@/components/billing/invoicePdf';

const money = (n: number, c: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n); }
  catch { return `${c} ${n.toFixed(2)}`; }
};

export const PublicInvoice: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [inv, setInv] = useState<PublicInvoiceView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const v = token ? await getPublicInvoice(token) : null;
      if (alive) { setInv(v); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [token]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (!inv) {
    return <div className="min-h-screen grid place-items-center p-6 text-center text-muted-foreground">This invoice is not available.</div>;
  }

  const downloadPdf = () => {
    // Adapt the public view to the shape downloadInvoicePdf reads.
    const asInvoice = {
      invoiceNumber: inv.invoiceNumber, currency: inv.currency, subtotal: inv.subtotal,
      taxAmount: inv.taxAmount, discount: inv.discount, total: inv.total, amountPaid: inv.amountPaid,
      lineItems: inv.lineItems, notes: inv.notes, terms: inv.terms, issuedAt: inv.issuedAt, dueAt: inv.dueAt,
    } as unknown as Invoice;
    void downloadInvoicePdf(asInvoice, { name: inv.orgName }, inv.clientName);
  };

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-card rounded-xl border shadow-sm p-8">
        <div className="flex items-start justify-between mb-8">
          <div className="text-xl font-bold text-primary">{inv.orgName}</div>
          <div className="text-right">
            <div className="text-2xl font-bold">INVOICE</div>
            <div className="text-muted-foreground">{inv.invoiceNumber}</div>
          </div>
        </div>

        <div className="flex justify-between mb-6 text-sm">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Bill to</div>
            <div>{inv.clientName}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-muted-foreground">Issued</div>
            <div>{format(inv.issuedAt, 'PP')}</div>
            {inv.dueAt && <><div className="text-xs uppercase text-muted-foreground mt-1">Due</div><div>{format(inv.dueAt, 'PP')}</div></>}
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr><th className="text-left py-1.5">Description</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr>
          </thead>
          <tbody className="divide-y">
            {inv.lineItems.map((li, i) => (
              <tr key={i}><td className="py-1.5">{li.description}</td><td className="text-right">{li.qty}</td><td className="text-right">{money(li.unitPrice, inv.currency)}</td><td className="text-right">{money(li.lineTotal, inv.currency)}</td></tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-56 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(inv.subtotal, inv.currency)}</span></div>
          {inv.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{money(inv.discount, inv.currency)}</span></div>}
          {inv.taxAmount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{money(inv.taxAmount, inv.currency)}</span></div>}
          <div className="flex justify-between font-bold border-t pt-1 text-base"><span>Total</span><span>{money(inv.total, inv.currency)}</span></div>
          {inv.amountPaid > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span>{money(inv.amountPaid, inv.currency)}</span></div>}
        </div>

        {inv.terms && <p className="text-xs text-muted-foreground mt-8">{inv.terms}</p>}

        <div className="mt-8 flex justify-end gap-2">
          <Button variant="outline" onClick={downloadPdf}><FileDown className="w-4 h-4 mr-1.5" /> Download PDF</Button>
          {/* Pay now button is added in Phase 3 (Stripe). */}
        </div>
      </div>
    </div>
  );
};

export default PublicInvoice;
```

- [ ] **Step 3:** Register the public route in `src/App.tsx`. Add the lazy import near the other public-page lazies (≈ line 49):

```typescript
const PublicInvoicePage = React.lazy(() => import('@/pages/public/PublicInvoice').then((m) => ({ default: m.PublicInvoice })));
```

Add the route to the PUBLIC sibling list (next to `/forms/:slug`, BEFORE the `<AppLayout />` child, ≈ line 168):

```tsx
        { path: '/invoice/:token', element: lazyRoute(<PublicInvoicePage />) },
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/pages/public/PublicInvoice.tsx src/App.tsx src/services/supabase/invoices.ts
git commit -m "feat(billing): public hosted invoice page /invoice/:token"
```

---

### Task 9: `sendInvoice` (reuse `notify-send-gmail`) + wire the Send action

**Files:**
- Modify: `src/services/supabase/invoices.ts` (replace the Task 4 `sendInvoice` stub)

- [ ] **Step 1:** Replace the `sendInvoice` stub at the end of `src/services/supabase/invoices.ts` with the real implementation. It loads the invoice (to get token + client), fetches the client's email, emails a link via `notify-send-gmail`, then flips the status to `sent`:

```typescript
/** Email the client a link to the hosted invoice page and mark it `sent`.
 *  Reuses the notify-send-gmail edge function (sends from the caller's
 *  connected Gmail). Returns the public URL on success. Throws a friendly
 *  error if the client has no email or Gmail isn't connected. */
export const sendInvoice = async (
  organizationId: string,
  invoiceId: string,
): Promise<string> => {
  // Load invoice (token + number + client + currency + total).
  const { data: invRow, error: invErr } = await supabase
    .from('invoices')
    .select('public_token, invoice_number, client_id, currency, total')
    .eq('organization_id', organizationId)
    .eq('invoice_id', invoiceId)
    .single();
  if (invErr || !invRow) throw invErr ?? new Error('Invoice not found');

  const token = invRow.public_token as string | null;
  if (!token) throw new Error('This invoice has no shareable link yet. Apply migration 128 and try again.');

  // Client email + name.
  const { data: clientRow } = await supabase
    .from('clients')
    .select('name, email')
    .eq('organization_id', organizationId)
    .eq('client_id', invRow.client_id)
    .single();
  const toEmail = (clientRow?.email as string) ?? '';
  if (!toEmail) throw new Error('This account has no email address — add one to send the invoice.');

  const url = `${window.location.origin}/invoice/${token}`;
  const number = invRow.invoice_number as string;
  const body =
    `Hi ${clientRow?.name ?? ''},\n\n` +
    `Please find invoice ${number} for ${formatMoney(Number(invRow.total ?? 0), String(invRow.currency ?? 'USD'))}.\n` +
    `You can view and download it here: ${url}\n\nThank you.`;

  const { error: sendErr } = await supabase.functions.invoke('notify-send-gmail', {
    body: {
      toEmail,
      toName: clientRow?.name ?? undefined,
      subject: `Invoice ${number}`,
      body,
      actionUrl: url,
      organizationId,
      entityType: 'client',
      entityId: invRow.client_id,
    },
  });
  if (sendErr) {
    throw new Error('Could not send the email. Connect Gmail in Settings, or download the PDF and send it manually.');
  }

  // Mark sent + stamp last_sent_at.
  await supabase
    .from('invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString(), last_sent_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('invoice_id', invoiceId);

  return url;
};
```

> `formatMoney` is already exported from this module (used elsewhere). If it is NOT, replace the `formatMoney(...)` call with `new Intl.NumberFormat(undefined, { style: 'currency', currency: String(invRow.currency ?? 'USD') }).format(Number(invRow.total ?? 0))`.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/services/supabase/invoices.ts
git commit -m "feat(billing): send invoice via Gmail link + mark sent (reuses notify-send-gmail)"
```

---

### Task 10: Verify (whole feature)

- [ ] **Step 1:** `npm run test` → all green (incl. `invoiceTotals`).
- [ ] **Step 2:** `npm run build` → success; confirm a separate async chunk for `@react-pdf/renderer` (not in the main bundle).
- [ ] **Step 3: Manual (post-deploy — needs migration 128 applied + a Gmail-connected user):**
  - `/billing` lists all org invoices; tiles show Outstanding / Overdue / Paid (30d) / Drafts; status filter + search narrow the table; an invoice past its due date shows the **Overdue** badge (without changing its stored status).
  - "New invoice" → pick an account → add lines → create → it appears in the list and the Outstanding tile updates.
  - PDF icon downloads a branded `INV-…pdf`.
  - Send icon emails the client a link and flips the row to **Sent**; opening `/invoice/:token` (logged out / incognito) shows the branded read-only page with a working Download PDF; a void/unknown token shows "not available".

---

## Self-Review

**Spec coverage (Phase 1+2):**
- Top-level Billing page listing all org invoices + dashboard → Tasks 4, 5 ✓
- Overdue auto-flag (display-only) → Task 1 (`isOverdue`), Task 4 (badge) ✓
- PDF download, branded → Task 6 ✓
- Public hosted page `/invoice/:token` → Tasks 7, 8 ✓
- Email to client (link) + auto `sent` → Task 9 ✓ (reuses `notify-send-gmail`, so the spec's separate `invoice-send` edge fn is intentionally dropped — simpler/DRY; noted here)
- Reuse existing table/editor/totals, minimal schema (token + last_sent_at) → Tasks 1–3, 7 ✓
- Permissions: Billing page `requireSubscription` (members view); create/edit/delete unchanged RLS; public RPC token-scoped non-void → Tasks 5, 7 ✓

**Placeholder scan:** Task 4 ships temporary stubs (`sendInvoice`, `downloadInvoicePdf`) that are explicitly REPLACED in Tasks 6 + 9 — intentional, called out at the task boundary, not vague TODOs. The migration has one verify-the-PK note (organizations `id` vs `organization_id`) — an explicit confirmation step, not a placeholder.

**Type consistency:** `Invoice` gains `publicToken` (Task 1) used by `sendInvoice` via a fresh DB select (Task 9 reads `public_token` directly, not the mapped field — consistent). `downloadInvoicePdf(invoice, { name }, clientName)` signature is identical in the stub (Task 4), the real impl (Task 6), and both call sites (Billing Task 4, PublicInvoice Task 8). `listOrgInvoices`, `invoiceTotals`, `isOverdue`, `InvoiceTotals`, `OrgInvoiceFilters`, `PublicInvoiceView`, `getPublicInvoice`, `sendInvoice` are all defined once and referenced with matching names/shapes. `InvoiceEditor` props are widened (client optional + clients added) in Task 3 before the hub (Task 4) relies on them.
