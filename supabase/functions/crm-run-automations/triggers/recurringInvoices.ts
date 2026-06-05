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
