// Metric registry — the single safe data layer powering catalog widgets
// (and, in 7b, AI-picked widgets). Every metric reuses an EXISTING list
// service and aggregates client-side. No new Supabase queries live here.
//
// A metric's `compute` returns one of three shapes, matched to the chart it
// feeds (see InsightsDashboard for the chart mapping):
//   - number              → KpiTile
//   - DataPoint[]         → bar / donut / funnel (categorical)
//   - SeriesPoint[]       → line (time series)
//
// `compute` is resilient: any thrown/rejected service call is caught and the
// metric returns an empty result so one bad metric never breaks the grid.

import { getOrganizationDeals, OPEN_STAGES, DEAL_STAGES } from "@/services/supabase/deals";
import { getOrganizationLeads, listUnassignedLeads, LEAD_STATUS_OPTIONS } from "@/services/supabase/leads";
import { getOrganizationClientTasks } from "@/services/supabase/clientTasks";
import { listOrgInvoices, invoiceTotals } from "@/services/supabase/invoices";
import { getOrganizationExpenses } from "@/services/supabase/expenses";
import { listOrgBills, billTotals } from "@/services/supabase/bills";
import { logger } from "@/lib/logger";

export type ChartType = "kpi" | "bar" | "line" | "donut" | "funnel";

/** Categorical / single-value row (bar, donut, funnel, kpi source). */
export type DataPoint = { label: string; value: number };
/** Time-series point (line). */
export type SeriesPoint = { date: string; value: number };

export type MetricResult = DataPoint[] | SeriesPoint[] | number;

export interface MetricDef {
  id: string;
  label: string;
  group: "Sales" | "Leads" | "Tasks" | "Money";
  chartTypes: ChartType[];
  defaultChart: ChartType;
  dimensions?: { id: string; label: string }[];
  timeframe?: boolean;
  compute: (
    orgId: string,
    opts: { dimension?: string; timeframe?: string },
  ) => Promise<MetricResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

export type Timeframe = "30d" | "90d" | "qtd" | "ytd";

/** Start of the supplied window. Defaults to 90d when unset/unknown. */
const windowStart = (timeframe?: string): Date => {
  const now = new Date();
  switch (timeframe) {
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "qtd": {
      const q = Math.floor(now.getMonth() / 3);
      return new Date(now.getFullYear(), q * 3, 1);
    }
    case "ytd":
      return new Date(now.getFullYear(), 0, 1);
    case "90d":
    default:
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  }
};

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const monthLabel = (d: Date) => `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;

/** Empty buckets for each month from `start` through now, as a stable series. */
const monthSeries = (start: Date): { key: string; point: SeriesPoint }[] => {
  const out: { key: string; point: SeriesPoint }[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date();
  while (cursor <= end) {
    out.push({ key: monthKey(cursor), point: { date: monthLabel(cursor), value: 0 } });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
};

/** Wrap a compute body so any failure yields the supplied empty fallback. */
const safe = async <T extends MetricResult>(
  fallback: T,
  body: () => Promise<T>,
): Promise<T> => {
  try {
    return await body();
  } catch (e) {
    logger.warn("metric compute failed:", e);
    return fallback;
  }
};

const STAGE_LABEL = Object.fromEntries(DEAL_STAGES.map((s) => [s.id, s.label]));
const FUNNEL_ORDER: Array<"lead" | "qualified" | "proposal" | "negotiation" | "won"> = [
  "lead", "qualified", "proposal", "negotiation", "won",
];

// ─────────────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────────────

export const METRICS: MetricDef[] = [
  // ── Sales ──────────────────────────────────────────────────────────────────
  {
    id: "deals_by_stage",
    label: "Deals by stage",
    group: "Sales",
    chartTypes: ["bar", "donut", "funnel"],
    defaultChart: "bar",
    compute: (orgId) =>
      safe<DataPoint[]>([], async () => {
        const deals = await getOrganizationDeals(orgId);
        const counts = new Map<string, number>();
        for (const d of deals) counts.set(d.stage, (counts.get(d.stage) ?? 0) + 1);
        return DEAL_STAGES.filter((s) => (counts.get(s.id) ?? 0) > 0).map((s) => ({
          label: s.label,
          value: counts.get(s.id) ?? 0,
        }));
      }),
  },
  {
    id: "deal_value_by_stage",
    label: "Deal value by stage",
    group: "Sales",
    chartTypes: ["bar", "funnel"],
    defaultChart: "bar",
    compute: (orgId) =>
      safe<DataPoint[]>([], async () => {
        const deals = await getOrganizationDeals(orgId);
        const sums = new Map<string, number>();
        for (const d of deals) sums.set(d.stage, (sums.get(d.stage) ?? 0) + (d.value || 0));
        return DEAL_STAGES.filter((s) => (sums.get(s.id) ?? 0) > 0).map((s) => ({
          label: s.label,
          value: Math.round(sums.get(s.id) ?? 0),
        }));
      }),
  },
  {
    id: "won_value_by_month",
    label: "Won value by month",
    group: "Sales",
    chartTypes: ["line", "bar"],
    defaultChart: "line",
    timeframe: true,
    compute: (orgId, opts) =>
      safe<SeriesPoint[]>([], async () => {
        const deals = await getOrganizationDeals(orgId);
        const start = windowStart(opts.timeframe);
        const buckets = monthSeries(start);
        const byKey = new Map(buckets.map((b) => [b.key, b.point]));
        for (const d of deals) {
          if (d.stage !== "won") continue;
          const when = d.closedAt ?? d.actualCloseDate ?? d.updatedAt;
          if (!when || when < start) continue;
          const pt = byKey.get(monthKey(when));
          if (pt) pt.value += Math.round(d.value || 0);
        }
        return buckets.map((b) => b.point);
      }),
  },
  {
    id: "open_pipeline_value",
    label: "Open pipeline value",
    group: "Sales",
    chartTypes: ["kpi"],
    defaultChart: "kpi",
    compute: (orgId) =>
      safe<number>(0, async () => {
        const deals = await getOrganizationDeals(orgId);
        const open = new Set<string>(OPEN_STAGES);
        return Math.round(
          deals.filter((d) => open.has(d.stage)).reduce((s, d) => s + (d.value || 0), 0),
        );
      }),
  },
  {
    id: "win_rate",
    label: "Win rate",
    group: "Sales",
    chartTypes: ["kpi"],
    defaultChart: "kpi",
    timeframe: true,
    compute: (orgId, opts) =>
      safe<number>(0, async () => {
        const deals = await getOrganizationDeals(orgId);
        const start = windowStart(opts.timeframe);
        const closed = deals.filter(
          (d) =>
            (d.stage === "won" || d.stage === "lost") &&
            (d.closedAt ?? d.actualCloseDate) &&
            (d.closedAt ?? d.actualCloseDate)! >= start,
        );
        if (closed.length === 0) return 0;
        const won = closed.filter((d) => d.stage === "won").length;
        return Math.round((won / closed.length) * 100);
      }),
  },

  // ── Leads ────────────────────────────────────────────────────────────────
  {
    id: "leads_by_category",
    label: "Leads by category",
    group: "Leads",
    chartTypes: ["bar", "donut"],
    defaultChart: "bar",
    compute: (orgId) =>
      safe<DataPoint[]>([], async () => {
        const leads = await getOrganizationLeads(orgId);
        const counts = new Map<string, number>();
        for (const l of leads) {
          const key = l.category?.trim() || "Uncategorized";
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return Array.from(counts.entries())
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 12);
      }),
  },
  {
    id: "leads_by_status",
    label: "Leads by status",
    group: "Leads",
    chartTypes: ["donut", "bar"],
    defaultChart: "donut",
    compute: (orgId) =>
      safe<DataPoint[]>([], async () => {
        const leads = await getOrganizationLeads(orgId);
        const counts = new Map<string, number>();
        for (const l of leads) counts.set(l.leadStatus, (counts.get(l.leadStatus) ?? 0) + 1);
        return LEAD_STATUS_OPTIONS.filter((o) => (counts.get(o.value) ?? 0) > 0).map((o) => ({
          label: o.label,
          value: counts.get(o.value) ?? 0,
        }));
      }),
  },
  {
    id: "unassigned_leads",
    label: "Unassigned leads",
    group: "Leads",
    chartTypes: ["kpi"],
    defaultChart: "kpi",
    compute: (orgId) =>
      safe<number>(0, async () => {
        const leads = await listUnassignedLeads(orgId);
        return leads.length;
      }),
  },

  // ── Tasks ────────────────────────────────────────────────────────────────
  {
    id: "tasks_by_status",
    label: "Client tasks by status",
    group: "Tasks",
    chartTypes: ["donut", "bar"],
    defaultChart: "donut",
    compute: (orgId) =>
      safe<DataPoint[]>([], async () => {
        const tasks = await getOrganizationClientTasks(orgId);
        const counts = new Map<string, number>();
        for (const t of tasks) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
        const labels: Record<string, string> = {
          pending: "Pending",
          done: "Done",
          snoozed: "Snoozed",
        };
        return Object.keys(labels)
          .filter((k) => (counts.get(k) ?? 0) > 0)
          .map((k) => ({ label: labels[k], value: counts.get(k) ?? 0 }));
      }),
  },
  {
    id: "overdue_tasks",
    label: "Overdue client tasks",
    group: "Tasks",
    chartTypes: ["kpi"],
    defaultChart: "kpi",
    compute: (orgId) =>
      safe<number>(0, async () => {
        const tasks = await getOrganizationClientTasks(orgId);
        const now = Date.now();
        return tasks.filter(
          (t) => t.status === "pending" && t.dueAt && t.dueAt.getTime() < now,
        ).length;
      }),
  },

  // ── Money ────────────────────────────────────────────────────────────────
  {
    id: "invoices_outstanding",
    label: "Invoices outstanding",
    group: "Money",
    chartTypes: ["kpi"],
    defaultChart: "kpi",
    compute: (orgId) =>
      safe<number>(0, async () => {
        const invoices = await listOrgInvoices(orgId);
        return Math.round(invoiceTotals(invoices).outstanding);
      }),
  },
  {
    id: "invoices_paid_by_month",
    label: "Invoices paid by month",
    group: "Money",
    chartTypes: ["line", "bar"],
    defaultChart: "line",
    timeframe: true,
    compute: (orgId, opts) =>
      safe<SeriesPoint[]>([], async () => {
        const invoices = await listOrgInvoices(orgId);
        const start = windowStart(opts.timeframe);
        const buckets = monthSeries(start);
        const byKey = new Map(buckets.map((b) => [b.key, b.point]));
        for (const inv of invoices) {
          if (inv.status === "void" || !inv.paidAt || inv.paidAt < start) continue;
          const pt = byKey.get(monthKey(inv.paidAt));
          if (pt) pt.value += Math.round(Math.min(inv.amountPaid, inv.total));
        }
        return buckets.map((b) => b.point);
      }),
  },
  {
    id: "expenses_by_month",
    label: "Expenses by month",
    group: "Money",
    chartTypes: ["line", "bar"],
    defaultChart: "line",
    timeframe: true,
    dimensions: [
      { id: "expenses", label: "Expenses" },
      { id: "bills", label: "Vendor bills" },
    ],
    compute: (orgId, opts) =>
      safe<SeriesPoint[]>([], async () => {
        const start = windowStart(opts.timeframe);
        const buckets = monthSeries(start);
        const byKey = new Map(buckets.map((b) => [b.key, b.point]));
        if (opts.dimension === "bills") {
          const bills = await listOrgBills(orgId);
          for (const b of bills) {
            if (b.status === "void" || b.issuedAt < start) continue;
            const pt = byKey.get(monthKey(b.issuedAt));
            if (pt) pt.value += Math.round(b.total || 0);
          }
        } else {
          const expenses = await getOrganizationExpenses(orgId);
          for (const e of expenses) {
            const when = e.incurredOn ?? e.createdAt;
            if (!when || when < start) continue;
            const pt = byKey.get(monthKey(when));
            if (pt) pt.value += Math.round(e.amount || 0);
          }
        }
        return buckets.map((b) => b.point);
      }),
  },
  {
    id: "bills_payable",
    label: "Bills payable",
    group: "Money",
    chartTypes: ["kpi"],
    defaultChart: "kpi",
    compute: (orgId) =>
      safe<number>(0, async () => {
        const bills = await listOrgBills(orgId);
        return Math.round(billTotals(bills).payable);
      }),
  },
];

export const getMetric = (id: string): MetricDef | undefined =>
  METRICS.find((m) => m.id === id);

// Re-exported so the page can build a friendly funnel for the funnel chart
// without duplicating the canonical stage order.
export { FUNNEL_ORDER, STAGE_LABEL };
