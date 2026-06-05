# Billing hub — Xero-style invoicing (design)

**Date:** 2026-06-05
**Status:** Approved (design)
**Branch:** `billing-hub` (off `main`)

## Summary

TaskCalendar already has a working **sales-invoice** subsystem (migration `099_invoices.sql`): an `invoices` table with line items, `tax_rate`/`tax_amount`, `discount`, partial payments (`amount_paid`), statuses (`draft|sent|paid|overdue|void`), and auto-numbering via `next_invoice_number()`. Today it is **only reachable inside the Client detail drawer** (`InvoicesPanel`), with **no standalone page, no dashboard, no PDF, and no email**.

This effort builds a top-level **Billing** hub that surfaces and completes that subsystem into a Xero-style experience. The full vision is a billing hub covering both **Sales invoices (A/R, money in)** and **Bills (A/P, money out)** with PDF, email, dashboard, recurring invoices, and online payment links. It is delivered in phases; **this spec covers Phase 1 + Phase 2**, which together form a usable Xero-style invoicing experience. Phases 3–5 (Stripe pay-now, recurring, A/P bills) are scoped at the end as follow-ups, each to get its own spec.

## Goals (Phase 1 + 2)

- A top-level **Billing** page listing **all** org invoices (not just per-client), with filters and a dashboard.
- Accurate **overdue** state (auto-flag invoices past `due_at` that aren't paid/void).
- **PDF download** of an invoice — branded with the org name/logo, line items, totals, terms.
- A **public hosted invoice page** at `/invoice/:token` — read-only, branded, with Download PDF (the foundation for email + later pay-now).
- **Email the invoice to the client** as a link to the hosted page, auto-advancing status to `sent`.
- Reuse the existing `invoices` table, `InvoiceEditor`, and totals math — no schema churn beyond an access token + a couple of nullable columns.

## Non-goals (this spec)

- Stripe / online payments (Phase 3).
- Recurring invoices (Phase 4).
- Bills / accounts-payable + payroll tie-in (Phase 5).
- Multi-currency conversion changes (invoices keep their stored currency; display uses existing `useFormatMoney`).

## Baseline (reuse, don't rebuild)

- **DB:** `invoices` (see migration `099_invoices.sql`): `invoice_id, organization_id, client_id, deal_id?, quote_id?, workspace_id?, invoice_number (UNIQUE per org), title?, status, currency, subtotal, tax_rate, tax_amount, discount, total, amount_paid, line_items (jsonb), notes?, terms?, issued_at, due_at?, sent_at?, paid_at?, voided_at?, created_by, created_by_name, timestamps`.
- **Service:** `src/services/supabase/invoices.ts` — `createInvoice`, `updateInvoice`, `deleteInvoice`, `listClientInvoices`, `computeQuoteTotals`, RPC `next_invoice_number`.
- **UI:** `src/components/clients/InvoicesPanel.tsx` (contains `InvoiceEditor` dialog with the line-item grid, discount/tax, status, amount-paid).
- **Money:** `useFormatMoney()` (org currency + FX), `formatMoney()`.
- **Email:** the existing Gmail send path (`sendViaGmail` / the `send_email` action infra) used by automations + the client Email composer.
- **Org branding:** organization name + logo (from the organizations row / org context) for PDF + hosted-page headers.

## Phase 1 — Billing hub + sales dashboard + PDF

### 1A. Service additions (`invoices.ts`)
- `listOrgInvoices(organizationId, opts?: { status?; clientId?; search? })` — all invoices for the org, newest first, joined with client name (for the list). Mirrors `listClientInvoices` but org-scoped with optional filters.
- `invoiceTotals(invoices)` — pure helper computing dashboard aggregates: `outstanding` (sum of `total - amount_paid` for non-paid/non-void), `overdue` (same but only where `due_at < today`), `paidLast30` (sum of `amount_paid` where `paid_at` within 30d), counts per status. Unit-tested.
- `isOverdue(invoice, today)` — pure predicate (`status` not in paid/void AND `due_at` present AND `due_at < today`). Unit-tested. Used for the auto-flag badge in the list **without** mutating the stored status (display-only); an optional `markOverdue` server step can be added later, but v1 infers it at read time.

### 1B. Billing page + route + nav
- New page `src/pages/Billing.tsx` at route `/billing` (in `App.tsx`), behind `ProtectedRoute` (`requireSubscription`; visible to org members — view).
- Sidebar entry **Billing** (icon `Receipt` or `FileText`), placed near Payroll.
- Page layout:
  - **Dashboard tiles** (reuse `KpiTile`): Outstanding, Overdue, Paid (30d), Draft count.
  - **Filters:** status dropdown (all/draft/sent/paid/overdue/void), client filter, text search (number/title/client).
  - **Invoice table:** number (click → editor), client, status badge (with inferred Overdue), issued, due, total, amount paid / balance, row actions (Mark paid, PDF, Send — Send wired in Phase 2). `New invoice` button opens the editor (reused).
- Refactor: extract the `InvoiceEditor` dialog out of `InvoicesPanel.tsx` into `src/components/billing/InvoiceEditor.tsx` so both the client drawer and the new Billing page use one component. `InvoicesPanel` imports it from the new location (no behavior change for the drawer).

### 1C. PDF download
- `src/components/billing/InvoicePdf.tsx` using `@react-pdf/renderer`: a branded document (org name/logo header, bill-to client block, invoice number + dates, line-item table, subtotal/discount/tax/total, amount paid + balance, notes + terms).
- `downloadInvoicePdf(invoice, org, client)` helper triggers a client-side download (`INV-000007.pdf`). Wired to the PDF row action + an editor button.

## Phase 2 — Hosted invoice page + email

### 2A. Schema (small migration, next sequential number)
- Add to `invoices`: `public_token uuid` (nullable; a `gen_random_uuid()` default is fine, or set on first send), and optionally `last_sent_at timestamptz`. Re-runnable migration (`ADD COLUMN IF NOT EXISTS`).
- A SECURITY DEFINER RPC `get_public_invoice(p_token uuid)` returning the invoice + org branding + client display fields for the **public** page (no auth) — read-only, only non-void invoices, only the fields needed to render (no internal notes beyond `terms`). This keeps RLS closed while allowing the tokenized public view.

### 2B. Public hosted page
- Public route `src/pages/public/PublicInvoice.tsx` at `/invoice/:token` (outside the auth shell, like the public/legal pages). Renders the branded invoice read-only via `get_public_invoice`, with **Download PDF** (reusing `InvoicePdf`). A "Pay now" button placeholder is present but hidden until Phase 3.

### 2C. Email to client
- Edge function `supabase/functions/invoice-send/index.ts`: body `{ organization_id, invoice_id }`. Auth: valid org-member bearer. It (1) ensures the invoice has a `public_token`, (2) builds the hosted-page URL, (3) sends an email to the client's email via the existing Gmail send path with a short templated body + the link, (4) sets `status='sent'`, `sent_at=now()`, `last_sent_at=now()`. Returns `{ ok, url }`. Gracefully errors if the client has no email or Gmail isn't connected (clear message, no status change).
- Service: `sendInvoice(organizationId, invoiceId)` in `invoices.ts` invoking the edge fn; surfaced as the **Send** row action + an editor button. After send, the list refreshes to show `sent`.

## Data flow
1. **List/dashboard:** Billing page → `listOrgInvoices` → `invoiceTotals` for tiles + `isOverdue` for badges.
2. **Create/edit:** reused `InvoiceEditor` → `createInvoice`/`updateInvoice` (unchanged).
3. **PDF:** in-browser render of `InvoicePdf` from the invoice + org + client → file download.
4. **Send:** Billing/editor → `sendInvoice` → `invoice-send` edge fn → Gmail link email + `status=sent`.
5. **Public view:** client opens `/invoice/:token` → `get_public_invoice` RPC → branded read-only page + PDF.

## Permissions
- Billing page + list + PDF: any org member (view), matching today's invoices RLS.
- Create/edit/delete/send: same as the current invoices RLS (members create/update; delete owner/admin).
- Public page: unauthenticated, token-scoped, read-only via the SECURITY DEFINER RPC; non-void only.

## Error handling
- Empty/zero invoices → friendly empty state on the Billing page.
- PDF render failure → toast, no crash (wrap in error boundary / try-catch on the download path).
- `invoice-send`: no client email or no Gmail connection → clear non-fatal toast; status unchanged.
- Public page: unknown/void token → a neutral "invoice not available" page (no data leak).
- Overdue is inferred at read time; never silently mutates stored status.

## Testing
- **Frontend (vitest):** `invoiceTotals` aggregates (outstanding/overdue/paid30/counts) and `isOverdue` predicate across statuses + due dates; light render test of the Billing list (filters narrow the rows); `InvoiceEditor` still mounts after the extraction refactor.
- **Edge (Deno):** `invoice-send` returns the right shape, sets `sent`, and gracefully skips when no client email (mock admin + send).
- **Build:** `npm run build` + `npm run test` green each phase; `deno check` on the edge fn.
- **Manual (post-deploy):** create an invoice → see it on the Billing dashboard (outstanding tile updates) → download a branded PDF → Send → client receives a link → opens `/invoice/:token` and downloads the PDF; an invoice past its due date shows the Overdue badge.

## Build phasing
- **Phase 1** — hub + dashboard + list/filters + editor extraction + PDF download (no schema change; pure surfacing + PDF).
- **Phase 2** — `public_token` migration + `get_public_invoice` RPC + public page + `invoice-send` email.

## Follow-up phases (separate specs, not built here)
- **Phase 3 — Pay now (Stripe):** `invoice-pay` edge fn → Stripe Checkout link on the hosted page; `stripe-webhook` marks paid + records `amount_paid`. Gated behind `STRIPE_SECRET_KEY` (same optional-env pattern as the Twilio SMS gate).
- **Phase 4 — Recurring invoices:** `invoice_schedules` table; the existing automations cron clones a template invoice on a cadence.
- **Phase 5 — Bills / A/P:** new `bills` table (vendor, line items, due date, open/paid) + a Bills tab in the hub, surfaced alongside Payroll.
