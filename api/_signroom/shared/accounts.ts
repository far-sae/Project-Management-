// Pure project-year, payment-status and statement maths, ported from the
// Signroom app. Used by both the server and the browser.
import type {
  AccountEntry,
  AccountSummary,
  ClientProject,
  Invoice,
  ProjectYear,
  Statement,
} from "./types.js";

/** London calendar date (YYYY-MM-DD) at the given instant. */
export function londonToday(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function projectYear(
  project: ClientProject,
  invoices: Invoice[],
  year: number,
): ProjectYear {
  const linked = invoices.filter(
    (i) =>
      i.projectId === project.id &&
      i.currency === project.currency &&
      !["Draft", "Voided"].includes(i.status),
  );
  const months = Array.from({ length: 12 }, () => 0);
  for (const i of linked)
    for (const p of i.payments)
      if (p.paidOn.startsWith(String(year) + "-"))
        months[Number(p.paidOn.slice(5, 7)) - 1] += p.amountMinor;
  const invoiceMonths = [...months];
  const expectedMonths = months.map((_, n) => {
    const key = `${year}-${String(n + 1).padStart(2, "0")}`;
    const entry = project.monthlyEntries?.[key];
    months[n] += entry?.paidMinor || 0;
    return (
      entry?.expectedMinor ??
      (project.billingType === "Monthly" &&
      key >= project.startMonth &&
      (!project.endMonth || key <= project.endMonth)
        ? project.monthlyFeeMinor
        : 0)
    );
  });
  const upcomingMonths = expectedMonths.map((n, m) =>
    Math.max(0, n - months[m]),
  );
  const activeMonths = Array.from(
    { length: 12 },
    (_, n) => `${year}-${String(n + 1).padStart(2, "0")}`,
  ).filter(
    (m) =>
      m >= project.startMonth && (!project.endMonth || m <= project.endMonth),
  ).length;
  const target =
    project.annualTargetMinor ||
    (project.billingType === "Monthly"
      ? project.monthlyFeeMinor * activeMonths
      : project.startMonth.startsWith(String(year))
        ? project.contractValueMinor
        : 0);
  const received = months.reduce((s, n) => s + n, 0),
    invoiced = linked.reduce((s, i) => s + i.totalMinor, 0),
    outstanding = linked.reduce(
      (s, i) =>
        s + i.totalMinor - i.payments.reduce((t, p) => t + p.amountMinor, 0),
      0,
    );
  return {
    ...project,
    months,
    invoiceMonths,
    expectedMonths,
    upcomingMonths,
    upcomingMinor: upcomingMonths.reduce((sum, n) => sum + n, 0),
    targetMinor: target,
    receivedMinor: received,
    invoicedMinor: invoiced,
    outstandingMinor: outstanding,
    remainingTargetMinor: Math.max(0, target - received),
  };
}

/** Monthly plans fall overdue after the end of their calendar month. */
export function projectPaymentStatus(
  paid: number,
  remaining: number,
  year: number,
  month: number,
  currentMonth: string,
): "overdue" | "upcoming" | "paid" | "neutral" {
  if (remaining > 0) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    return key < currentMonth ? "overdue" : "upcoming";
  }
  return paid > 0 ? "paid" : "neutral";
}

export function buildStatement(
  invoices: Invoice[],
  from: string,
  to: string,
  today: string,
): Statement {
  const valid = invoices.filter((i) => !["Draft", "Voided"].includes(i.status));
  const summaries: Record<string, AccountSummary> = {};
  const entries: AccountEntry[] = [];
  for (const i of valid) {
    if (i.issueDate <= today) {
      const x = (summaries[i.currency] ||= {
        currency: i.currency,
        invoicedMinor: 0,
        receivedMinor: 0,
        outstandingMinor: 0,
        overdueMinor: 0,
        currentMinor: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        over90: 0,
      });
      const received = i.payments
          .filter((p) => p.paidOn <= today)
          .reduce((s, p) => s + p.amountMinor, 0),
        balance = i.totalMinor - received;
      x.invoicedMinor += i.totalMinor;
      x.receivedMinor += received;
      x.outstandingMinor += balance;
      const age = Math.floor(
        (Date.parse(today + "T00:00:00Z") -
          Date.parse(i.dueDate + "T00:00:00Z")) /
          86400000,
      );
      if (age <= 0) x.currentMinor += balance;
      else {
        x.overdueMinor += balance;
        if (age <= 30) x.days1to30 += balance;
        else if (age <= 60) x.days31to60 += balance;
        else if (age <= 90) x.days61to90 += balance;
        else x.over90 += balance;
      }
    }
    entries.push({
      id: i.id,
      date: i.issueDate,
      kind: "Invoice",
      reference: i.number,
      invoiceId: i.id,
      invoiceNumber: i.number,
      currency: i.currency,
      chargeMinor: i.totalMinor,
      paymentMinor: 0,
      balanceMinor: 0,
    });
    for (const p of i.payments)
      entries.push({
        id: p.id,
        date: p.paidOn,
        kind: "Payment",
        reference: p.receiptNumber,
        invoiceId: i.id,
        invoiceNumber: i.number,
        currency: i.currency,
        chargeMinor: 0,
        paymentMinor: p.amountMinor,
        balanceMinor: 0,
      });
  }
  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === b.kind
        ? a.reference.localeCompare(b.reference)
        : a.kind === "Invoice"
          ? -1
          : 1),
  );
  const running: Record<string, number> = {},
    opening: Record<string, number> = {};
  const shown: AccountEntry[] = [];
  for (const e of entries) {
    if (e.date > (to || today)) continue;
    running[e.currency] =
      (running[e.currency] || 0) + e.chargeMinor - e.paymentMinor;
    e.balanceMinor = running[e.currency];
    if (from && e.date < from) opening[e.currency] = e.balanceMinor;
    else shown.push(e);
  }
  return {
    asOf: today,
    summaries: Object.values(summaries).sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
    entries: shown,
    opening,
    closing: running,
  };
}
