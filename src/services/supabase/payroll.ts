import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { EmployeeProfile, PayPeriod, PayType } from "./employees";

export type PayrollStatus = "draft" | "finalized" | "paid";

export interface PayrollRun {
  runId: string;
  organizationId: string;
  periodStart: Date;
  periodEnd: Date;
  payDate?: Date | null;
  status: PayrollStatus;
  currency: string;
  notes?: string | null;
  totalGross: number;
  totalReimbursement: number;
  totalDeduction: number;
  totalNet: number;
  createdBy?: string | null;
  createdByName?: string | null;
  finalizedAt?: Date | null;
  finalizedBy?: string | null;
  finalizedByName?: string | null;
  paidAt?: Date | null;
  paidBy?: string | null;
  paidByName?: string | null;
  paidMethod?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayrollItem {
  itemId: string;
  runId: string;
  organizationId: string;
  userId: string;
  userName?: string | null;
  jobTitle?: string | null;
  payType: PayType;
  hourlyRate: number;
  salaryAmount: number;
  regularHours: number;
  overtimeHours: number;
  overtimeMultiplier: number;
  grossPay: number;
  expenseReimbursementTotal: number;
  bonus: number;
  deduction: number;
  taxWithholding: number;
  netPay: number;
  currency: string;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");
const runsKey = (orgId: string) => `pm_payroll_runs_${orgId}`;
const itemsKey = (runId: string) => `pm_payroll_items_${runId}`;

const mapRun = (row: Record<string, unknown>): PayrollRun => ({
  runId: row.run_id as string,
  organizationId: row.organization_id as string,
  periodStart: new Date(row.period_start as string),
  periodEnd: new Date(row.period_end as string),
  payDate: row.pay_date ? new Date(row.pay_date as string) : null,
  status: ((row.status as string) || "draft") as PayrollStatus,
  currency: ((row.currency as string) || "USD").toUpperCase(),
  notes: (row.notes as string) ?? null,
  totalGross: Number(row.total_gross ?? 0),
  totalReimbursement: Number(row.total_reimbursement ?? 0),
  totalDeduction: Number(row.total_deduction ?? 0),
  totalNet: Number(row.total_net ?? 0),
  createdBy: (row.created_by as string) ?? null,
  createdByName: (row.created_by_name as string) ?? null,
  finalizedAt: row.finalized_at ? new Date(row.finalized_at as string) : null,
  finalizedBy: (row.finalized_by as string) ?? null,
  finalizedByName: (row.finalized_by_name as string) ?? null,
  paidAt: row.paid_at ? new Date(row.paid_at as string) : null,
  paidBy: (row.paid_by as string) ?? null,
  paidByName: (row.paid_by_name as string) ?? null,
  paidMethod: (row.paid_method as string) ?? null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const mapItem = (row: Record<string, unknown>): PayrollItem => ({
  itemId: row.item_id as string,
  runId: row.run_id as string,
  organizationId: row.organization_id as string,
  userId: row.user_id as string,
  userName: (row.user_name as string) ?? null,
  jobTitle: (row.job_title as string) ?? null,
  payType: ((row.pay_type as string) || "hourly") as PayType,
  hourlyRate: Number(row.hourly_rate ?? 0),
  salaryAmount: Number(row.salary_amount ?? 0),
  regularHours: Number(row.regular_hours ?? 0),
  overtimeHours: Number(row.overtime_hours ?? 0),
  overtimeMultiplier: Number(row.overtime_multiplier ?? 1.5),
  grossPay: Number(row.gross_pay ?? 0),
  expenseReimbursementTotal: Number(row.expense_reimbursement_total ?? 0),
  bonus: Number(row.bonus ?? 0),
  deduction: Number(row.deduction ?? 0),
  taxWithholding: Number(row.tax_withholding ?? 0),
  netPay: Number(row.net_pay ?? 0),
  currency: ((row.currency as string) || "USD").toUpperCase(),
  notes: (row.notes as string) ?? null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const readLocalRuns = (orgId: string): PayrollRun[] => {
  try {
    const raw = localStorage.getItem(runsKey(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as PayrollRun[]).map((r) => ({
      ...r,
      periodStart: new Date(r.periodStart),
      periodEnd: new Date(r.periodEnd),
      payDate: r.payDate ? new Date(r.payDate) : null,
      finalizedAt: r.finalizedAt ? new Date(r.finalizedAt) : null,
      paidAt: r.paidAt ? new Date(r.paidAt) : null,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    }));
  } catch {
    return [];
  }
};
const writeLocalRuns = (orgId: string, runs: PayrollRun[]) =>
  localStorage.setItem(runsKey(orgId), JSON.stringify(runs));

const readLocalItems = (runId: string): PayrollItem[] => {
  try {
    const raw = localStorage.getItem(itemsKey(runId));
    if (!raw) return [];
    return (JSON.parse(raw) as PayrollItem[]).map((i) => ({
      ...i,
      createdAt: new Date(i.createdAt),
      updatedAt: new Date(i.updatedAt),
    }));
  } catch {
    return [];
  }
};
const writeLocalItems = (runId: string, items: PayrollItem[]) =>
  localStorage.setItem(itemsKey(runId), JSON.stringify(items));

// ---------------------------------------------------------------------------
// Pure helpers (used by the build-draft flow + UI to recompute)
// ---------------------------------------------------------------------------

export const computeGrossForItem = (
  item: Pick<
    PayrollItem,
    | "payType"
    | "hourlyRate"
    | "salaryAmount"
    | "regularHours"
    | "overtimeHours"
    | "overtimeMultiplier"
  >,
): number => {
  if (item.payType === "salary") return Number(item.salaryAmount) || 0;
  const reg = (item.regularHours || 0) * (item.hourlyRate || 0);
  const ot =
    (item.overtimeHours || 0) *
    (item.hourlyRate || 0) *
    (item.overtimeMultiplier || 1.5);
  return Math.max(0, reg + ot);
};

export const computeNetForItem = (
  item: Pick<
    PayrollItem,
    | "payType"
    | "hourlyRate"
    | "salaryAmount"
    | "regularHours"
    | "overtimeHours"
    | "overtimeMultiplier"
    | "expenseReimbursementTotal"
    | "bonus"
    | "deduction"
    | "taxWithholding"
  >,
): { gross: number; net: number } => {
  const gross = computeGrossForItem(item);
  const net =
    gross +
    (item.expenseReimbursementTotal || 0) +
    (item.bonus || 0) -
    (item.deduction || 0) -
    (item.taxWithholding || 0);
  return { gross, net };
};

const periodFraction = (
  payPeriod: PayPeriod,
  periodStart: Date,
  periodEnd: Date,
): number => {
  // Days inclusive of both ends
  const ms = periodEnd.getTime() - periodStart.getTime();
  const days = Math.max(1, Math.round(ms / 86_400_000) + 1);
  const periodDays =
    payPeriod === "weekly"
      ? 7
      : payPeriod === "biweekly"
        ? 14
        : payPeriod === "semimonthly"
          ? 15
          : 30; // monthly
  return days / periodDays;
};

/**
 * Build the line items for a draft run by pulling time + reimbursable expenses.
 * Time entries: sum durations whose clock_in is within the period; >40h/week
 * folds into overtime against `defaultWeeklyHours` from the profile.
 * Expenses: sum *approved* amounts whose `incurred_on` is within the period.
 */
export const buildDraftItemsForRun = async (
  organizationId: string,
  periodStart: Date,
  periodEnd: Date,
  employees: EmployeeProfile[],
): Promise<PayrollItem[]> => {
  const startIso = periodStart.toISOString();
  const endIso = new Date(
    periodEnd.getFullYear(),
    periodEnd.getMonth(),
    periodEnd.getDate(),
    23,
    59,
    59,
  ).toISOString();
  const startDate = periodStart.toISOString().split("T")[0];
  const endDate = periodEnd.toISOString().split("T")[0];

  // Aggregate time per user
  const hoursByUser = new Map<string, number>();
  if (!isLocalOrg(organizationId)) {
    const { data: timeRows, error: timeErr } = await supabase
      .from("time_entries")
      .select("user_id, duration_seconds, clocked_in_at, clocked_out_at")
      .eq("organization_id", organizationId)
      .gte("clocked_in_at", startIso)
      .lte("clocked_in_at", endIso)
      .not("clocked_out_at", "is", null);

    if (timeErr) {
      logger.warn("Failed to load time entries for payroll draft:", timeErr);
    }
    (timeRows || []).forEach((r: Record<string, unknown>) => {
      const uid = r.user_id as string;
      const seconds = Number(r.duration_seconds ?? 0);
      hoursByUser.set(uid, (hoursByUser.get(uid) ?? 0) + seconds / 3600);
    });
  }

  // Aggregate approved expenses per user (currency-aware later)
  const reimbursementByUser = new Map<string, number>();
  if (!isLocalOrg(organizationId)) {
    const { data: expRows, error: expErr } = await supabase
      .from("expenses")
      .select("user_id, amount, currency, status, incurred_on")
      .eq("organization_id", organizationId)
      .eq("status", "approved")
      .gte("incurred_on", startDate)
      .lte("incurred_on", endDate);

    if (expErr) {
      logger.warn("Failed to load expenses for payroll draft:", expErr);
    }
    (expRows || []).forEach((r: Record<string, unknown>) => {
      const uid = r.user_id as string;
      const amt = Number(r.amount ?? 0);
      reimbursementByUser.set(uid, (reimbursementByUser.get(uid) ?? 0) + amt);
    });
  }

  const items: PayrollItem[] = employees
    .filter((e) => e.status !== "terminated")
    .map((emp) => {
      const totalHours = hoursByUser.get(emp.userId) ?? 0;
      const weeklyCap = emp.defaultWeeklyHours || 40;
      // Number of full weeks (and partial) in the period:
      const days = Math.max(
        1,
        Math.round(
          (periodEnd.getTime() - periodStart.getTime()) / 86_400_000,
        ) + 1,
      );
      const weeks = days / 7;
      const regCap = weeklyCap * weeks;
      const regular = Math.min(totalHours, regCap);
      const overtime = Math.max(0, totalHours - regCap);

      const salaryForPeriod =
        emp.payType === "salary"
          ? Number(emp.payRate) *
            periodFraction(emp.payPeriod, periodStart, periodEnd)
          : 0;

      const base: PayrollItem = {
        itemId: crypto.randomUUID(),
        runId: "",
        organizationId,
        userId: emp.userId,
        userName: emp.displayName ?? null,
        jobTitle: emp.jobTitle ?? null,
        payType: emp.payType,
        hourlyRate: emp.payType === "hourly" ? Number(emp.payRate) : 0,
        salaryAmount: emp.payType === "salary" ? salaryForPeriod : 0,
        regularHours: emp.payType === "hourly" ? regular : 0,
        overtimeHours: emp.payType === "hourly" ? overtime : 0,
        overtimeMultiplier: emp.overtimeMultiplier || 1.5,
        grossPay: 0,
        expenseReimbursementTotal: reimbursementByUser.get(emp.userId) ?? 0,
        bonus: 0,
        deduction: 0,
        taxWithholding: 0,
        netPay: 0,
        currency: emp.currency || "USD",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { gross, net } = computeNetForItem(base);
      base.grossPay = round2(gross);
      base.netPay = round2(net);
      return base;
    });

  return items;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const getPayrollRuns = async (
  organizationId: string,
): Promise<PayrollRun[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocalRuns(organizationId).sort(
      (a, b) => b.periodEnd.getTime() - a.periodEnd.getTime(),
    );
  }
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("period_end", { ascending: false });
  if (error) {
    logger.error("Failed to load payroll runs:", error);
    return [];
  }
  return (data || []).map(mapRun);
};

export const getPayrollRun = async (
  organizationId: string,
  runId: string,
): Promise<{ run: PayrollRun | null; items: PayrollItem[] }> => {
  if (isLocalOrg(organizationId)) {
    const run =
      readLocalRuns(organizationId).find((r) => r.runId === runId) ?? null;
    return { run, items: readLocalItems(runId) };
  }
  const [{ data: runRow, error: runErr }, { data: itemRows, error: itemErr }] =
    await Promise.all([
      supabase
        .from("payroll_runs")
        .select("*")
        .eq("run_id", runId)
        .maybeSingle(),
      supabase
        .from("payroll_items")
        .select("*")
        .eq("run_id", runId)
        .order("user_name", { ascending: true }),
    ]);
  if (runErr) logger.error("Failed to load payroll run:", runErr);
  if (itemErr) logger.error("Failed to load payroll items:", itemErr);
  return {
    run: runRow ? mapRun(runRow) : null,
    items: (itemRows || []).map(mapItem),
  };
};

export interface CreatePayrollRunInput {
  periodStart: Date;
  periodEnd: Date;
  payDate?: Date | null;
  notes?: string | null;
  currency?: string;
  employees: EmployeeProfile[];
}

export const createPayrollRun = async (
  organizationId: string,
  createdBy: string,
  createdByName: string,
  input: CreatePayrollRunInput,
): Promise<{ run: PayrollRun; items: PayrollItem[] }> => {
  const items = await buildDraftItemsForRun(
    organizationId,
    input.periodStart,
    input.periodEnd,
    input.employees,
  );

  const totals = computeRunTotals(items);
  const currency = (input.currency || items[0]?.currency || "USD").toUpperCase();

  if (isLocalOrg(organizationId)) {
    const run: PayrollRun = {
      runId: crypto.randomUUID(),
      organizationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payDate: input.payDate ?? null,
      status: "draft",
      currency,
      notes: input.notes ?? null,
      ...totals,
      createdBy,
      createdByName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    writeLocalRuns(organizationId, [run, ...readLocalRuns(organizationId)]);
    const itemsWithRun = items.map((i) => ({ ...i, runId: run.runId }));
    writeLocalItems(run.runId, itemsWithRun);
    return { run, items: itemsWithRun };
  }

  const runRow = {
    organization_id: organizationId,
    period_start: input.periodStart.toISOString().split("T")[0],
    period_end: input.periodEnd.toISOString().split("T")[0],
    pay_date: input.payDate
      ? input.payDate.toISOString().split("T")[0]
      : null,
    status: "draft",
    currency,
    notes: input.notes ?? null,
    total_gross: totals.totalGross,
    total_reimbursement: totals.totalReimbursement,
    total_deduction: totals.totalDeduction,
    total_net: totals.totalNet,
    created_by: createdBy,
    created_by_name: createdByName,
  };

  const { data: insertedRun, error: runErr } = await supabase
    .from("payroll_runs")
    .insert(runRow)
    .select()
    .single();
  if (runErr) {
    logger.error("Failed to create payroll run:", runErr);
    throw runErr;
  }
  const created = mapRun(insertedRun);

  if (items.length > 0) {
    const itemRows = items.map((i) => ({
      run_id: created.runId,
      organization_id: organizationId,
      user_id: i.userId,
      user_name: i.userName,
      job_title: i.jobTitle,
      pay_type: i.payType,
      hourly_rate: i.hourlyRate,
      salary_amount: i.salaryAmount,
      regular_hours: i.regularHours,
      overtime_hours: i.overtimeHours,
      overtime_multiplier: i.overtimeMultiplier,
      gross_pay: i.grossPay,
      expense_reimbursement_total: i.expenseReimbursementTotal,
      bonus: i.bonus,
      deduction: i.deduction,
      tax_withholding: i.taxWithholding,
      net_pay: i.netPay,
      currency: i.currency,
    }));
    const { error: itemErr } = await supabase
      .from("payroll_items")
      .insert(itemRows);
    if (itemErr) {
      logger.error("Failed to create payroll items:", itemErr);
      throw itemErr;
    }
  }

  const detail = await getPayrollRun(organizationId, created.runId);
  return { run: detail.run ?? created, items: detail.items };
};

export const computeRunTotals = (
  items: PayrollItem[],
): {
  totalGross: number;
  totalReimbursement: number;
  totalDeduction: number;
  totalNet: number;
} => {
  let g = 0;
  let r = 0;
  let d = 0;
  let n = 0;
  items.forEach((i) => {
    g += i.grossPay || 0;
    r += i.expenseReimbursementTotal || 0;
    d += (i.deduction || 0) + (i.taxWithholding || 0);
    n += i.netPay || 0;
  });
  return {
    totalGross: round2(g),
    totalReimbursement: round2(r),
    totalDeduction: round2(d),
    totalNet: round2(n),
  };
};

export interface UpdatePayrollItemInput {
  hourlyRate?: number;
  salaryAmount?: number;
  regularHours?: number;
  overtimeHours?: number;
  overtimeMultiplier?: number;
  bonus?: number;
  deduction?: number;
  taxWithholding?: number;
  expenseReimbursementTotal?: number;
  notes?: string | null;
}

export const updatePayrollItem = async (
  organizationId: string,
  runId: string,
  itemId: string,
  input: UpdatePayrollItemInput,
): Promise<PayrollItem> => {
  if (isLocalOrg(organizationId)) {
    const items = readLocalItems(runId);
    const idx = items.findIndex((i) => i.itemId === itemId);
    if (idx === -1) throw new Error("Item not found");
    const merged: PayrollItem = {
      ...items[idx],
      ...(input.hourlyRate !== undefined ? { hourlyRate: input.hourlyRate } : {}),
      ...(input.salaryAmount !== undefined
        ? { salaryAmount: input.salaryAmount }
        : {}),
      ...(input.regularHours !== undefined
        ? { regularHours: input.regularHours }
        : {}),
      ...(input.overtimeHours !== undefined
        ? { overtimeHours: input.overtimeHours }
        : {}),
      ...(input.overtimeMultiplier !== undefined
        ? { overtimeMultiplier: input.overtimeMultiplier }
        : {}),
      ...(input.bonus !== undefined ? { bonus: input.bonus } : {}),
      ...(input.deduction !== undefined ? { deduction: input.deduction } : {}),
      ...(input.taxWithholding !== undefined
        ? { taxWithholding: input.taxWithholding }
        : {}),
      ...(input.expenseReimbursementTotal !== undefined
        ? { expenseReimbursementTotal: input.expenseReimbursementTotal }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    };
    const { gross, net } = computeNetForItem(merged);
    merged.grossPay = round2(gross);
    merged.netPay = round2(net);
    items[idx] = merged;
    writeLocalItems(runId, items);

    // Recompute run totals
    const runs = readLocalRuns(organizationId);
    const ridx = runs.findIndex((r) => r.runId === runId);
    if (ridx >= 0) {
      const totals = computeRunTotals(items);
      runs[ridx] = { ...runs[ridx], ...totals, updatedAt: new Date() };
      writeLocalRuns(organizationId, runs);
    }
    return merged;
  }

  const update: Record<string, unknown> = {};
  if (input.hourlyRate !== undefined) update.hourly_rate = input.hourlyRate;
  if (input.salaryAmount !== undefined) update.salary_amount = input.salaryAmount;
  if (input.regularHours !== undefined) update.regular_hours = input.regularHours;
  if (input.overtimeHours !== undefined) update.overtime_hours = input.overtimeHours;
  if (input.overtimeMultiplier !== undefined)
    update.overtime_multiplier = input.overtimeMultiplier;
  if (input.bonus !== undefined) update.bonus = input.bonus;
  if (input.deduction !== undefined) update.deduction = input.deduction;
  if (input.taxWithholding !== undefined)
    update.tax_withholding = input.taxWithholding;
  if (input.expenseReimbursementTotal !== undefined)
    update.expense_reimbursement_total = input.expenseReimbursementTotal;
  if (input.notes !== undefined) update.notes = input.notes;

  // Recompute gross + net from the merged values
  const { data: existing, error: getErr } = await supabase
    .from("payroll_items")
    .select("*")
    .eq("item_id", itemId)
    .single();
  if (getErr) throw getErr;
  const currentItem = mapItem(existing);
  const merged = {
    ...currentItem,
    ...input,
  } as PayrollItem;
  const { gross, net } = computeNetForItem(merged);
  update.gross_pay = round2(gross);
  update.net_pay = round2(net);

  const { data, error } = await supabase
    .from("payroll_items")
    .update(update)
    .eq("item_id", itemId)
    .select()
    .single();
  if (error) {
    logger.error("Failed to update payroll item:", error);
    throw error;
  }

  // Refresh totals on the parent run
  await refreshRunTotals(organizationId, runId);
  return mapItem(data);
};

const refreshRunTotals = async (organizationId: string, runId: string) => {
  if (isLocalOrg(organizationId)) return;
  const { data: itemRows, error } = await supabase
    .from("payroll_items")
    .select("*")
    .eq("run_id", runId);
  if (error) {
    logger.warn("Failed to refresh payroll totals:", error);
    return;
  }
  const items = (itemRows || []).map(mapItem);
  const totals = computeRunTotals(items);
  await supabase
    .from("payroll_runs")
    .update({
      total_gross: totals.totalGross,
      total_reimbursement: totals.totalReimbursement,
      total_deduction: totals.totalDeduction,
      total_net: totals.totalNet,
    })
    .eq("run_id", runId);
};

export interface UpdatePayrollRunInput {
  notes?: string | null;
  payDate?: Date | null;
  status?: PayrollStatus;
  paidMethod?: string | null;
}

export const updatePayrollRun = async (
  organizationId: string,
  runId: string,
  input: UpdatePayrollRunInput,
  actor?: { userId: string; displayName: string },
): Promise<PayrollRun> => {
  if (isLocalOrg(organizationId)) {
    const runs = readLocalRuns(organizationId);
    const idx = runs.findIndex((r) => r.runId === runId);
    if (idx === -1) throw new Error("Run not found");
    const cur = runs[idx];
    const next: PayrollRun = {
      ...cur,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.payDate !== undefined ? { payDate: input.payDate } : {}),
      ...(input.paidMethod !== undefined ? { paidMethod: input.paidMethod } : {}),
      ...(input.status
        ? input.status === "finalized"
          ? {
              status: "finalized",
              finalizedAt: new Date(),
              finalizedBy: actor?.userId ?? null,
              finalizedByName: actor?.displayName ?? null,
            }
          : input.status === "paid"
            ? {
                status: "paid",
                paidAt: new Date(),
                paidBy: actor?.userId ?? null,
                paidByName: actor?.displayName ?? null,
              }
            : { status: input.status }
        : {}),
      updatedAt: new Date(),
    };
    runs[idx] = next;
    writeLocalRuns(organizationId, runs);
    return next;
  }

  const update: Record<string, unknown> = {};
  if (input.notes !== undefined) update.notes = input.notes;
  if (input.payDate !== undefined)
    update.pay_date = input.payDate
      ? input.payDate.toISOString().split("T")[0]
      : null;
  if (input.paidMethod !== undefined) update.paid_method = input.paidMethod;
  if (input.status) {
    update.status = input.status;
    if (input.status === "finalized") {
      update.finalized_at = new Date().toISOString();
      update.finalized_by = actor?.userId ?? null;
      update.finalized_by_name = actor?.displayName ?? null;
    }
    if (input.status === "paid") {
      update.paid_at = new Date().toISOString();
      update.paid_by = actor?.userId ?? null;
      update.paid_by_name = actor?.displayName ?? null;
    }
  }

  const { data, error } = await supabase
    .from("payroll_runs")
    .update(update)
    .eq("run_id", runId)
    .select()
    .single();
  if (error) {
    logger.error("Failed to update payroll run:", error);
    throw error;
  }
  return mapRun(data);
};

export const deletePayrollRun = async (
  organizationId: string,
  runId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const runs = readLocalRuns(organizationId).filter((r) => r.runId !== runId);
    writeLocalRuns(organizationId, runs);
    localStorage.removeItem(itemsKey(runId));
    return;
  }
  const { error } = await supabase
    .from("payroll_runs")
    .delete()
    .eq("run_id", runId);
  if (error) {
    logger.error("Failed to delete payroll run:", error);
    throw error;
  }
};

export const subscribeToPayrollRuns = (
  organizationId: string,
  callback: (runs: PayrollRun[]) => void,
): (() => void) => {
  getPayrollRuns(organizationId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};

  const channelName = `payroll-runs-${organizationId}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "payroll_runs",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getPayrollRuns(organizationId).then(callback);
      },
    )
    .subscribe();
  return () => {
    channel.unsubscribe();
  };
};

export const formatMoney = (amount: number, currency: string = "USD"): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};
