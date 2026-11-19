import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import { brandingOf } from "./branding.js";
import { dealOf, listFilter } from "./crmLinks.js";
import { visibleProject } from "./projects.js";
import { financialPdf } from "./financialPdf.js";
import type { BlobLoader } from "./pdf.js";
import type { Store } from "./store.js";
import type { Client, Invoice, InvoiceEvent, Payment, Workspace } from "./shared/types.js";
import { londonToday } from "./shared/accounts.js";
import { balance, CURRENCIES, decimal, money, totals } from "./shared/invoiceMath.js";
import { email, isUuid, text } from "./validate.js";
import { canSend, deliveryAddress, sendMail, type MailDeps } from "./mail.js";
import { minutes, spend as realSpend, UNAVAILABLE_MESSAGE } from "./host/rateLimit.js";

type Body = Record<string, unknown>;
type Ctx = { workspace: Workspace; role: "Owner" | "Member"; user: SignedInUser };

const today = () => londonToday(new Date());

/** A YYYY-MM-DD date plus whole days, by UTC date arithmetic. */
const addDays = (ymd: string, days: number) => new Date(Date.parse(ymd + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

/** SR's date rule: a real calendar date as YYYY-MM-DD. */
function date(value: unknown): string {
  const s = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s)
    throw new AppError("Enter a valid date.");
  return s;
}

const event = (type: string, actor: string): InvoiceEvent => ({ at: new Date().toISOString(), type, actor });

function customerOf(c: Client): NonNullable<Invoice["customer"]> {
  return {
    name: c.name,
    contactName: c.contactName,
    email: c.email,
    companyNumber: c.companyNumber,
    billingAddress: c.billingAddress,
  };
}

/** The invoice if it is in the user's workspace and visible to them (Members see only their own). */
async function visibleInvoice(store: Store, ctx: Ctx, id: string): Promise<Invoice> {
  const i = isUuid(id) ? await store.getInvoice(ctx.workspace.id, id) : null;
  if (!i || (ctx.role !== "Owner" && i.createdBy !== ctx.user.id)) throw new AppError("Invoice not found.", 404);
  return i;
}

async function reload(store: Store, ctx: Ctx, id: string): Promise<Invoice> {
  const i = await store.getInvoice(ctx.workspace.id, id);
  if (!i) throw new AppError("Invoice not found.", 404);
  return i;
}

/**
 * Port of Signroom's billingAction: create, list, get, save, issue, payment,
 * void. `query` narrows the list (?companyId, ?dealId). A new invoice may name
 * the CRM deal it bills for (`dealId`), which then never changes.
 */
export async function billingAction(
  store: Store,
  user: SignedInUser,
  method: string,
  identifier: string | undefined,
  action: string | undefined,
  body: Body,
  query: { companyId?: string; dealId?: string } = {},
): Promise<Invoice | Invoice[]> {
  const ctx = await currentWorkspace(store, user);
  const { workspace } = ctx;

  if (!identifier) {
    if (method === "GET") {
      const filter = await listFilter(store, workspace.id, query);
      const all = filter ? await store.listInvoices(workspace.id, filter) : [];
      // The list never carries the logo (up to ~400 KB per invoice): the screens read it from the workspace.
      return all
        .filter((i) => ctx.role === "Owner" || i.createdBy === user.id)
        .map((i) => {
          if (!i.branding || i.branding.logo === undefined) return i;
          const { logo: _logo, ...branding } = i.branding;
          return { ...i, branding };
        });
    }
    const client = method === "POST" && isUuid(body.clientId) ? await store.getClient(workspace.id, String(body.clientId)) : null;
    if (method !== "POST" || !client || client.archived) throw new AppError("Choose an existing client.");
    // Checked before a number is taken, so a refused deal uses none up.
    const dealId = await dealOf(store, workspace.id, body.dealId);
    const now = new Date();
    const number = await store.takeInvoiceNumber(workspace.id, now.getUTCFullYear());
    const t = now.toISOString();
    const issued = londonToday(now);
    return store.insertInvoice(
      {
        workspaceId: workspace.id,
        clientId: client.id,
        dealId,
        createdBy: user.id,
        revision: 1,
        status: "Draft",
        number,
        currency: client.account?.currency || "GBP",
        issueDate: issued,
        dueDate: addDays(issued, client.account?.paymentTermsDays ?? 30),
        lines: [],
        taxBps: 0,
        subtotalMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
        notes: "",
        created: t,
        updated: t,
      } as Omit<Invoice, "id" | "payments" | "events">,
      event("Draft created", user.email),
    );
  }

  if (action && method !== "POST") throw new AppError("Method not allowed.", 405);
  const i = await visibleInvoice(store, ctx, identifier);
  if (method === "GET" && !action) return i;

  if (action === "save") {
    if (i.status !== "Draft" || i.revision !== Number(body.revision))
      throw new AppError("Only the current draft can be edited. Reload this invoice.", 409);
    const currency = String(body.currency);
    if (!CURRENCIES.includes(currency)) throw new AppError("Choose a supported two-decimal currency.");
    const issueDate = date(body.issueDate),
      dueDate = date(body.dueDate);
    if (dueDate < issueDate) throw new AppError("The due date cannot precede the invoice date.");
    const patch: Record<string, unknown> = {
      ...totals(body.lines, body.taxPercent),
      currency,
      issueDate,
      dueDate,
      notes: text(body.notes, 5000),
      project: text(body.project ?? i.project ?? "", 200),
    };
    // A Draft save sets, keeps or clears the billing plan link (the source's "project"; the field stays projectId).
    // An empty value on an invoice with no link changes nothing, so it writes nothing: the column arrives with migration 186.
    if (body.projectId || i.projectId) {
      const selected = body.projectId === undefined ? i.projectId : body.projectId;
      if (selected) {
        const project = await visibleProject(store, ctx, i.clientId, String(selected));
        if (project.archived) throw new AppError("Restore the billing plan before linking invoices.", 409);
        if (project.currency !== currency) throw new AppError("Invoice currency must match the linked billing plan.");
        patch.projectId = project.id;
      } else patch.projectId = "";
    }
    if (body.receiptDraft !== undefined) {
      if (body.receiptDraft === null) patch.receiptDraft = null;
      else {
        const draft = body.receiptDraft as Record<string, unknown>;
        if (typeof draft.enabled !== "boolean") throw new AppError("Invalid receipt draft option.");
        if (!draft.enabled) patch.receiptDraft = null;
        else {
          const rd = {
            enabled: true,
            amount: text(draft.amount, 30),
            paidOn: text(draft.paidOn, 10),
            method: text(draft.method, 100),
            reference: text(draft.reference, 200),
          };
          if (rd.amount) decimal(rd.amount, 2);
          if (rd.paidOn) date(rd.paidOn);
          patch.receiptDraft = rd;
        }
      }
    }
    const out = await store.updateDraft(workspace.id, i.id, i.revision, patch as Partial<Invoice>, event("Draft updated", user.email));
    if (!out) throw new AppError("Only the current draft can be edited. Reload this invoice.", 409);
    return out;
  }

  if (action === "issue") {
    if (i.status !== "Draft" || i.revision !== Number(body.revision) || !i.lines.length || !i.totalMinor)
      throw new AppError("Save a non-zero invoice draft before issuing it.", 409);
    if (body.createReceipt !== undefined && typeof body.createReceipt !== "boolean")
      throw new AppError("Choose whether to create a receipt.");
    let initial: Payment | null = null;
    if (body.createReceipt) {
      const p = body.payment as Record<string, unknown> | undefined;
      if (!p || p.confirmed !== true)
        throw new AppError("Confirm the payment has been received before creating its receipt.");
      const amountMinor = decimal(p.amount, 2),
        paidOn = date(p.paidOn);
      if (!amountMinor || amountMinor > i.totalMinor)
        throw new AppError("Receipt amount must be positive and no larger than the invoice total.");
      if (paidOn > today()) throw new AppError("A received payment cannot have a future date.");
      initial = {
        id: randomUUID(),
        amountMinor,
        paidOn,
        method: text(p.method, 100) || "Bank transfer",
        reference: text(p.reference, 200),
        receiptNumber: i.number + "-R01",
        receiptHash: "",
        recordedAt: new Date().toISOString(),
      };
    }
    const client = await store.getClient(workspace.id, i.clientId);
    if (!client) throw new AppError("Client not found.", 404);
    const snapshot: Invoice = {
      ...i,
      status: "Issued",
      branding: brandingOf(workspace),
      customer: customerOf(client),
      issuedAt: new Date().toISOString(),
    };
    const invoiceHash = await store.putBlob(workspace.id, await financialPdf(snapshot, undefined, loader(store)));
    if (initial) initial.receiptHash = await store.putBlob(workspace.id, await financialPdf(snapshot, initial, loader(store)));
    const status: Invoice["status"] = initial ? (initial.amountMinor === i.totalMinor ? "Paid" : "Part paid") : "Issued";
    const events = [event("Invoice issued; PDF and details frozen", user.email)];
    if (initial) events.push(event("Payment received and optional receipt created", user.email));
    const ok = await store.issueInvoice(
      i.id,
      i.revision,
      {
        status,
        branding: snapshot.branding,
        customer: snapshot.customer,
        invoiceHash,
        issuedAt: snapshot.issuedAt,
        receiptDraft: null as unknown as undefined,
      },
      initial,
      events,
    );
    if (!ok) throw new AppError("The invoice changed during PDF generation.", 409);
    return reload(store, ctx, i.id);
  }

  if (action === "payment") {
    if (!["Issued", "Part paid"].includes(i.status) || i.revision !== Number(body.revision))
      throw new AppError("Reload the issued invoice before recording a payment.", 409);
    const amountMinor = decimal(body.amount, 2),
      paidOn = date(body.paidOn);
    if (!amountMinor || amountMinor > balance(i))
      throw new AppError("Payment must be positive and no larger than the outstanding balance.");
    if (paidOn > today()) throw new AppError("A received payment cannot have a future date.");
    const payment: Payment = {
      id: randomUUID(),
      amountMinor,
      paidOn,
      reference: text(body.reference, 200),
      method: text(body.method, 100) || "Bank transfer",
      receiptNumber: i.number + "-R" + String(i.payments.length + 1).padStart(2, "0"),
      receiptHash: "",
      recordedAt: new Date().toISOString(),
    };
    payment.receiptHash = await store.putBlob(workspace.id, await financialPdf(i, payment, loader(store)));
    const status: Invoice["status"] = balance(i) - amountMinor === 0 ? "Paid" : "Part paid";
    const ok = await store.recordPayment(
      i.id,
      i.revision,
      payment,
      status,
      event("Payment received and immutable receipt created", user.email),
    );
    if (!ok) throw new AppError("The invoice changed. Check the balance before recording again.", 409);
    return reload(store, ctx, i.id);
  }

  if (action === "void") {
    if (i.status !== "Issued" || i.payments.length)
      throw new AppError("Only an unpaid issued invoice can be voided. Paid records must be retained.");
    const out = await store.setInvoiceState(workspace.id, i.id, i.revision, { status: "Voided" }, event("Invoice voided", user.email));
    if (!out) throw new AppError("The invoice changed. Reload it and try again.", 409);
    await store.revokeInvoiceTokens(i.id);
    return out;
  }

  throw new AppError("Billing action not found.", 404);
}

/** How a PDF draws a stored letterhead: straight from this store. */
const loader = (store: Store): BlobLoader => (w, h) => store.getBlob(w, h);

/** A draft's PDF, rendered on the spot and never stored. Other states return the stored artifact. */
export async function billingPreview(store: Store, user: SignedInUser, id: string): Promise<Uint8Array> {
  const ctx = await currentWorkspace(store, user);
  const i = await visibleInvoice(store, ctx, id);
  if (i.status !== "Draft") return artifactBytes(store, i);
  const client = await store.getClient(ctx.workspace.id, i.clientId);
  if (!client) throw new AppError("Client not found.", 404);
  return financialPdf({ ...i, branding: brandingOf(ctx.workspace), customer: customerOf(client) }, undefined, loader(store));
}

export async function billingArtifact(store: Store, user: SignedInUser, id: string, paymentId?: string): Promise<Uint8Array> {
  const ctx = await currentWorkspace(store, user);
  return artifactBytes(store, await visibleInvoice(store, ctx, id), paymentId);
}

/**
 * The stored PDF of an invoice, or of one of its receipts. A moved invoice or
 * payment with no hash yet is rendered from its snapshots, stored, and its hash
 * saved the first time; after that the stored copy is always served.
 */
export async function artifactBytes(store: Store, invoice: Invoice, paymentId?: string): Promise<Uint8Array> {
  const payment = paymentId ? invoice.payments.find((p) => p.id === paymentId) : undefined;
  const hash = paymentId ? payment?.receiptHash : invoice.invoiceHash;
  if (hash) return store.getBlob(invoice.workspaceId, hash);
  if (paymentId ? !payment : invoice.status === "Draft") throw new AppError("This PDF is not ready.", 409);

  // A receipt shows what had been received before it, so it sees only the payments recorded before it.
  const upTo = payment ? { ...invoice, payments: invoice.payments.slice(0, invoice.payments.indexOf(payment)) } : invoice;
  const bytes = await financialPdf(upTo, payment, loader(store));
  const stored = await store.putBlob(invoice.workspaceId, bytes);
  const won = payment ? await store.setReceiptHash(payment.id, stored) : await store.setInvoiceHash(invoice.id, stored);
  if (won) return bytes;
  // Another request stored its PDF first: serve that one so every viewer sees the same bytes.
  const now = await store.getInvoice(invoice.workspaceId, invoice.id);
  const winner = payment ? now?.payments.find((p) => p.id === payment.id)?.receiptHash : now?.invoiceHash;
  if (!winner) throw new AppError("This PDF is not ready.", 409);
  return store.getBlob(invoice.workspaceId, winner);
}

/** Signroom's token(): a random secret for the link, and its sha256 digest, the only form stored. */
export const newSecret = () => randomBytes(32).toString("base64url");
export const sha = (v: string) => createHash("sha256").update(v).digest("hex");

export const SEND_TOOL = "signroom-email";
export const SEND_LIMIT = 5;

/**
 * Port of Signroom's billing send and send-receipt: issues a private link
 * (7 days, digest only stored), emails it, then stamps the invoice as sent.
 * `origin` is the request's origin, already checked by the entry with
 * allowedOrigin.
 */
export async function billingSend(
  deps: MailDeps,
  user: SignedInUser,
  id: string,
  action: "send" | "send-receipt",
  body: Body,
  origin: string,
): Promise<Invoice> {
  const { store } = deps;
  const ctx = await currentWorkspace(store, user);
  let i = await visibleInvoice(store, ctx, id);
  if (["Draft", "Voided"].includes(i.status)) throw new AppError("Issue the invoice before sending it.");
  const wanted = action === "send-receipt" ? i.payments.find((p) => p.id === body.paymentId) : undefined;
  if (action === "send-receipt" && !wanted) throw new AppError("Receipt not found.");
  // A moved invoice or receipt has no stored PDF yet: make it now, so the link is bound to the document's own hash.
  await artifactBytes(store, i);
  if (wanted) await artifactBytes(store, i, wanted.id);
  i = await reload(store, ctx, i.id);
  if (!i.invoiceHash) throw new AppError("Issue the invoice before sending it.");
  const verdict = await (deps.spend ?? realSpend)(deps.sb, SEND_TOOL, "invoice:" + i.id, SEND_LIMIT, 60);
  if (verdict.ok === false) {
    if (verdict.unavailable) throw new AppError(UNAVAILABLE_MESSAGE, 503);
    throw new AppError(
      `This ${action === "send" ? "invoice" : "receipt"} has been sent ${SEND_LIMIT} times this hour. Try again in ${minutes(verdict.minutesLeft)}.`,
      429,
    );
  }
  const payment = wanted ? i.payments.find((p) => p.id === wanted.id) : undefined;
  if (wanted && !payment?.receiptHash) throw new AppError("This receipt is not ready.", 409);
  const to = email(i.customer?.email);
  const raw = newSecret();
  const issued = await store.insertToken({
    digest: sha(raw),
    purpose: "billing",
    workspaceId: i.workspaceId,
    invoiceId: i.id,
    ...(payment ? { paymentId: payment.id } : {}),
    artifactHash: payment ? payment.receiptHash : i.invoiceHash,
    email: to,
    expires: Date.now() + 7 * 86400000,
    revoked: false,
    attempts: 0,
    codeSends: 0,
  });
  const company = i.branding?.companyName || ctx.workspace.name;
  const text = [
    `${payment ? "Your payment receipt" : "Your invoice"} from ${company}.`,
    `${i.number} · Invoice total: ${money(i.totalMinor, i.currency)}.`,
    payment ? "Payment received: " + money(payment.amountMinor, i.currency) : "Status: " + i.status,
    `Recorded outstanding balance: ${money(balance(i), i.currency)}.`,
    "Open this private link and verify your email to view the PDF:",
    `${origin.replace(/\/+$/, "")}/invoice#billing=${raw}`,
  ].join("\n");
  try {
    await sendMail(deps, ctx.workspace, {
      to,
      subject: payment ? `Receipt ${payment.receiptNumber}` : `Invoice ${i.number}`,
      text,
      purpose: payment ? "receipt" : "invoice",
      invoiceId: i.id,
    });
  } catch (e) {
    // The link was never delivered: it must not stay usable.
    await store.updateToken(issued.id, { revoked: true });
    throw e;
  }
  const current = await reload(store, ctx, i.id);
  const out = await store.setInvoiceState(
    ctx.workspace.id,
    current.id,
    current.revision,
    { sentAt: new Date().toISOString() },
    event(payment ? "Receipt emailed" : "Invoice emailed", user.email),
  );
  return out ?? reload(store, ctx, i.id);
}

/**
 * GET billing/delivery: how this workspace's email goes out, and the address
 * it will really go from. "live" is the workspace's own verified mailbox (SMTP,
 * Google or Microsoft); "securovix" (that route's name in the delivery log) is
 * the platform's own address, and there `ready` is false until the Resend key
 * and a from address are configured.
 */
export async function billingDelivery(
  deps: MailDeps,
  user: SignedInUser,
): Promise<{ mode: "live" | "securovix"; sender: string; ready: boolean }> {
  const { workspace } = await currentWorkspace(deps.store, user);
  const own = await deliveryAddress(deps, workspace.id);
  if (own) return { mode: "live", sender: own, ready: true };
  return { mode: "securovix", sender: deps.from ?? "", ready: canSend(deps) };
}
