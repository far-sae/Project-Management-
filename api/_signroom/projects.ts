import { AppError } from "./errors.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import type { Store } from "./store.js";
import type { AccountsOverviewData, Client, ClientProject, Invoice, OverviewRow, ProjectList, ProjectYear, Workspace } from "./shared/types.js";
import { londonToday, projectYear } from "./shared/accounts.js";
import { CURRENCIES, decimal } from "./shared/invoiceMath.js";
import { isUuid, text } from "./validate.js";

/**
 * Billing plans: what a client is billed over a year (a monthly fee, a contract
 * value, what each month brought in), and the year's overview across clients.
 * The source app calls them client "projects", and the API paths
 * (client-projects), the JSON fields (projectId, projects) and the table
 * (sr_projects) keep that name. The sentences people read say "billing plan",
 * because a TaskCalendar project is something else.
 */
type Ctx = { workspace: Workspace; role: "Owner" | "Member"; user: SignedInUser };
type Body = Record<string, unknown>;

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const STALE = "Billing plan changed. Reload before editing.";
export const PLAN_NOT_FOUND = "Billing plan not found.";

/** The client if it is in the workspace; a malformed id never reaches the store. */
async function clientOf(store: Store, ctx: Ctx, clientId: string): Promise<Client> {
  const client = isUuid(clientId) ? await store.getClient(ctx.workspace.id, clientId) : null;
  if (!client) throw new AppError("Client not found.", 404);
  return client;
}

/** The billing plan if it is a uuid, in the workspace, on that client, and (Owner or created by the user). */
export async function visibleProject(store: Store, ctx: Ctx, clientId: string, projectId: string): Promise<ClientProject> {
  const p = isUuid(projectId) ? await store.getProject(ctx.workspace.id, projectId) : null;
  if (!p || p.clientId !== clientId || (ctx.role !== "Owner" && p.createdBy !== ctx.user.id)) throw new AppError(PLAN_NOT_FOUND, 404);
  return p;
}

/** List a year, create, edit, set a month, archive, restore. */
export async function projectAction(
  store: Store,
  user: SignedInUser,
  clientId: string,
  projectId: string | undefined,
  method: string,
  b: Body,
  yearValue: string,
  now: Date = new Date(),
): Promise<ProjectList | ClientProject> {
  if (method === "GET") {
    const year = Number(yearValue || Number(londonToday(now).slice(0, 4)));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new AppError("Choose a year from 2000 to 2100.");
    const ctx = await currentWorkspace(store, user);
    const client = await clientOf(store, ctx, clientId);
    const owner = ctx.role === "Owner";
    const invoices = (await store.listInvoices(ctx.workspace.id)).filter((i) => owner || i.createdBy === user.id);
    const projects = (await store.listProjects(ctx.workspace.id, client.id)).filter((p) => owner || p.createdBy === user.id);
    return { year, clientName: client.name, projects: projects.map((p): ProjectYear => projectYear(p, invoices, year)) };
  }
  if (!["POST", "PATCH"].includes(method)) throw new AppError("Method not allowed.", 405);
  if ((method === "PATCH") !== Boolean(projectId)) throw new AppError("Use POST to create a billing plan or PATCH with a billing plan ID.", 405);

  const ctx = await currentWorkspace(store, user);
  const client = await clientOf(store, ctx, clientId);
  if (client.archived) throw new AppError("Restore this client before changing billing plans.", 409);
  const p = projectId ? await visibleProject(store, ctx, client.id, projectId) : undefined;
  if (p && Number(b.revision) !== p.revision) throw new AppError(STALE, 409);
  const wsId = ctx.workspace.id;
  const save = async (existing: ClientProject, patch: Parameters<Store["updateProject"]>[3]) => {
    const out = await store.updateProject(wsId, existing.id, existing.revision, patch);
    if (!out) throw new AppError(STALE, 409);
    return out;
  };

  if (p && (b.action === "archive" || b.action === "restore")) return save(p, { archived: b.action === "archive" });

  if (p && b.action === "month") {
    if (p.archived) throw new AppError("Restore this billing plan before editing months.", 409);
    const month = String(b.month || "");
    if (!MONTH.test(month)) throw new AppError("Choose a valid month.");
    const entries = { ...(p.monthlyEntries ?? {}) };
    if (b.reset === true) delete entries[month];
    else
      entries[month] = {
        paidMinor: decimal(b.paid, 2),
        expectedMinor: decimal(b.expected, 2),
        notes: text(b.notes, 1000),
        updated: now.toISOString(),
        updatedBy: user.id,
      };
    return save(p, { monthlyEntries: entries });
  }

  const name = text(b.name, 160),
    billingType = String(b.billingType),
    billingLabel = text(b.billingLabel, 80),
    currency = String(b.currency),
    status = String(b.status || "Active"),
    startMonth = String(b.startMonth || ""),
    endMonth = String(b.endMonth || "");
  if (
    !name ||
    !["One-off", "Monthly", "Custom"].includes(billingType) ||
    !CURRENCIES.includes(currency) ||
    !["Active", "On hold", "Completed"].includes(status)
  )
    throw new AppError("Enter a billing plan name and supported billing type, currency and status.");
  if (billingType === "Custom" && !billingLabel) throw new AppError("Describe the custom billing type.");
  if (!MONTH.test(startMonth) || (endMonth && !MONTH.test(endMonth)) || (endMonth && endMonth < startMonth))
    throw new AppError("Choose valid start/end months, with the end after the start.");
  if (p && p.currency !== currency) {
    const linked =
      (await store.listInvoices(wsId)).some((i: Invoice) => i.projectId === p.id) || Object.keys(p.monthlyEntries ?? {}).length > 0;
    if (linked) throw new AppError("Billing plan currency cannot change after invoices have been linked.", 409);
  }
  const fields = {
    name,
    billingType: billingType as ClientProject["billingType"],
    billingLabel: billingType === "Custom" ? billingLabel : "",
    currency,
    monthlyFeeMinor: decimal(b.monthlyFee || "0", 2),
    contractValueMinor: decimal(b.contractValue || "0", 2),
    annualTargetMinor: decimal(b.annualTarget || "0", 2),
    startMonth,
    endMonth,
    status: status as ClientProject["status"],
    notes: text(b.notes, 3000),
  };
  if (p) return save(p, fields);
  return store.insertProject({ ...fields, workspaceId: wsId, clientId: client.id, createdBy: user.id, archived: false, monthlyEntries: {} });
}

/** Every client's plan months and issued invoices for a year. */
export async function accountsOverview(store: Store, user: SignedInUser, yearValue: string, now: Date = new Date()): Promise<AccountsOverviewData> {
  const today = londonToday(now);
  const year = Number(yearValue || Number(today.slice(0, 4)));
  if (!Number.isInteger(year) || year < 2000 || year > 2099) throw new AppError("Choose a year from 2000 to 2099.");
  const ctx = await currentWorkspace(store, user);
  const owner = ctx.role === "Owner";
  const clients = await store.listClients(ctx.workspace.id, true);
  // Oldest first: listInvoices is newest first.
  const invoices = (await store.listInvoices(ctx.workspace.id))
    .filter((i) => owner || i.createdBy === user.id)
    .sort((a, b) => a.created.localeCompare(b.created));
  const rows: OverviewRow[] = [];
  for (const p of (await store.listProjects(ctx.workspace.id)).filter((p) => owner || p.createdBy === user.id)) {
    const c = clients.find((c) => c.id === p.clientId);
    if (!c) continue;
    const data = projectYear(p, invoices, year);
    for (let m = 0; m < 12; m++) {
      const paid = data.months[m],
        remaining = data.upcomingMonths[m];
      if (!paid && !remaining) continue;
      const period = `${year}-${String(m + 1).padStart(2, "0")}`;
      rows.push({
        id: p.id + period,
        clientId: c.id,
        clientName: c.name,
        archived: c.archived || p.archived,
        reference: p.name,
        source: "Project plan",
        period,
        currency: p.currency,
        paidMinor: paid,
        remainingMinor: remaining,
        status: remaining > 0 ? (period < today.slice(0, 7) ? "overdue" : "upcoming") : "paid",
      });
    }
  }
  for (const i of invoices) {
    if (["Draft", "Voided"].includes(i.status) || !i.issueDate.startsWith(String(year))) continue;
    const c = clients.find((c) => c.id === i.clientId);
    if (!c) continue;
    const paid = i.payments.filter((p) => p.paidOn <= today).reduce((n, p) => n + p.amountMinor, 0),
      remaining = i.totalMinor - paid;
    rows.push({
      id: i.id,
      clientId: c.id,
      clientName: c.name,
      archived: c.archived,
      reference: i.number,
      source: "Invoice",
      period: i.dueDate,
      currency: i.currency,
      paidMinor: paid,
      remainingMinor: remaining,
      status: remaining > 0 ? (i.dueDate < today ? "overdue" : "upcoming") : "paid",
    });
  }
  return { year, today, rows };
}
