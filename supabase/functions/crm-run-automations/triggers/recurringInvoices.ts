// Billing Phase 4: turn due invoice_schedules into real invoices. Called once
// per worker tick (after enqueueCronEvents), under the worker's advisory lock.

interface Line { description?: string; qty?: number; unitPrice?: number; lineTotal?: number }

// Port of computeQuoteTotals (src/services/supabase/quotes.ts) — keep in sync.
// Use toFixed (not Math.round) to match computeQuoteTotals' rounding exactly,
// so a generated invoice's totals equal the preview the user saw.
const round2 = (n: number) => +n.toFixed(2);
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
      // ADVANCE FIRST (idempotency): claim this period by moving next_run_date
      // forward before creating the invoice. If the insert below fails or the
      // worker dies, the next tick won't re-select this schedule for the same
      // period, so we never auto-issue a DUPLICATE invoice. The .lte() guard
      // means only a still-due row is claimed (defensive vs. replay).
      const nextRun = advance(new Date(s.next_run_date + "T00:00:00Z"), s.frequency);
      const { data: claimed, error: claimErr } = await admin
        .from("invoice_schedules")
        .update({
          next_run_date: ymd(nextRun),
          last_run_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("schedule_id", s.schedule_id)
        .lte("next_run_date", today)
        .select("schedule_id");
      if (claimErr || !claimed || claimed.length === 0) continue; // not ours / already advanced

      const lines: Line[] = Array.isArray(s.line_items) ? s.line_items : [];
      const t = totalsFor(lines, Number(s.tax_rate ?? 0), Number(s.discount ?? 0));
      const issued = new Date();
      const dueAt = new Date(issued);
      dueAt.setUTCDate(dueAt.getUTCDate() + Number(s.due_days ?? 14));

      const insertRow = (number: string) => admin.from("invoices").insert({
        organization_id: s.organization_id,
        client_id: s.client_id,
        workspace_id: s.workspace_id,
        project_id: s.project_id,
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

      // Insert with one retry: ux_invoices_org_number (23505) can collide with
      // a concurrent manual invoice using the same INV- number; recompute + retry.
      let inv: { invoice_id?: string } | null = null;
      for (let attempt = 0; attempt < 2 && !inv; attempt++) {
        const number = await nextNumber(admin, s.organization_id);
        const { data, error } = await insertRow(number);
        if (!error) { inv = data; break; }
        if (attempt === 0 && (error as { code?: string }).code === "23505") continue;
        console.error("recurring invoice insert failed:", error);
        break;
      }
      if (!inv) continue; // period already advanced; admin can create manually if needed

      await admin.from("invoice_schedules")
        .update({ last_invoice_id: inv.invoice_id ?? null })
        .eq("schedule_id", s.schedule_id);
      created++;
    } catch (err) {
      console.error("runDueInvoiceSchedules error for schedule", s.schedule_id, err);
    }
  }
  return created;
};
