import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, StoreError } from "./errors.js";
import type {
  Agreement,
  AgreementSummary,
  AgreementTemplate,
  AgreementTemplateSummary,
  BillingToken,
  Client,
  ClientAccountSettings,
  Delivery,
  GuestSession,
  Invoice,
  InvoiceEvent,
  Job,
  NewJob,
  Payment,
  SignSession,
  SignToken,
  TemplateFile,
  UploadTicket,
  Workspace,
} from "./shared/types.js";
import { orgRoleOf, type OrgRole } from "./context.js";

/** An agreement plus the server-only compare-and-set counter (never sent to the browser). */
export type StoredAgreement = Agreement & { rowVersion: number };

/** What an update may change. The deal link (dealId) is set when the agreement is created and never afterwards. */
export type AgreementPatch = Partial<Omit<Agreement, "id" | "workspaceId" | "created" | "updated" | "deliveries" | "dealId">>;

/**
 * Everything the Signroom server reads or writes goes through this interface,
 * so the logic can be tested against fakeStore.ts and run against Supabase
 * (supabaseStore below, service role only). Methods that take a workspace id
 * only ever touch that workspace's rows.
 */
/** A CRM company as the documents server reads it: only what a client record is made from. */
export type CrmCompany = {
  id: string;
  name: string;
  email: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  /** The company's contacts that have an email, oldest first. */
  contacts: { name: string; email: string }[];
};

/** Narrows a list to one client and/or one CRM deal. */
export type ListFilter = { clientId?: string; dealId?: string };

export interface Store {
  /**
   * The TaskCalendar workspace with this id and the person's role in the
   * organisation that owns it, read fresh on every call; null when there is no
   * such workspace or they are not an active member of that organisation.
   * `workspaceId` is the stored id (so a differently-cased header maps to one row).
   */
  workspaceAccess(workspaceId: string, userId: string): Promise<{ workspaceId: string; name: string; role: OrgRole } | null>;
  /**
   * The Signroom row for a TaskCalendar workspace (same id), created on first
   * use with that name. Call it only after workspaceAccess allowed the caller.
   */
  ensureWorkspace(workspaceId: string, name: string, userId: string): Promise<Workspace>;
  getWorkspace(id: string): Promise<Workspace | null>;
  updateWorkspace(id: string, patch: Partial<Workspace>): Promise<Workspace>;
  listClients(workspaceId: string, includeArchived: boolean): Promise<Client[]>;
  getClient(workspaceId: string, id: string): Promise<Client | null>;
  /**
   * Adds a client. One made from a CRM company (crmCompanyId) is unique per
   * workspace: when another request added it first, that row is returned.
   */
  insertClient(c: Omit<Client, "id" | "created">): Promise<Client>;
  /** Never changes the workspace or the CRM company link. */
  updateClient(workspaceId: string, id: string, patch: Partial<Client>): Promise<Client>;
  /** The workspace's client made from this CRM company, or null. */
  getClientByCompany(workspaceId: string, companyId: string): Promise<Client | null>;
  /** True once the client has an invoice that is not a draft or an agreement that is not a draft: its details are then on record. */
  clientHasDocuments(workspaceId: string, clientId: string): Promise<boolean>;
  /** The CRM company, only when it belongs to this workspace (crm_companies.workspace_id); null otherwise. */
  crmCompany(workspaceId: string, companyId: string): Promise<CrmCompany | null>;
  /** The CRM deal, only when it belongs to this workspace (crm_deals.workspace_id); null otherwise. */
  crmDeal(workspaceId: string, dealId: string): Promise<{ id: string; companyId: string | null } | null>;
  /** Saves the account settings only while the stored revision (0 when none) is the one given; null otherwise. */
  setClientAccount(workspaceId: string, clientId: string, revision: number, account: ClientAccountSettings): Promise<ClientAccountSettings | null>;
  /** Newest first. */
  listInvoices(workspaceId: string, filter?: ListFilter): Promise<Invoice[]>;
  getInvoice(workspaceId: string, id: string): Promise<Invoice | null>;
  takeInvoiceNumber(workspaceId: string, year: number): Promise<string>;
  insertInvoice(i: Omit<Invoice, "id" | "payments" | "events">, event: InvoiceEvent): Promise<Invoice>;
  /** null = the revision moved (or the invoice is no longer a draft). The deal link (dealId) is never changed. */
  updateDraft(workspaceId: string, id: string, revision: number, patch: Partial<Invoice>, event: InvoiceEvent): Promise<Invoice | null>;
  issueInvoice(id: string, revision: number, patch: Partial<Invoice>, payment: Payment | null, events: InvoiceEvent[]): Promise<boolean>;
  recordPayment(id: string, revision: number, payment: Payment, status: Invoice["status"], event: InvoiceEvent): Promise<boolean>;
  setInvoiceState(
    workspaceId: string,
    id: string,
    revision: number,
    patch: Pick<Partial<Invoice>, "status" | "sentAt" | "invoiceHash">,
    event: InvoiceEvent,
  ): Promise<Invoice | null>;
  /** Only while the payment's receipt hash is still empty. True only if this call set it. No revision change, no event. */
  setReceiptHash(paymentId: string, hash: string): Promise<boolean>;
  /** Only while the invoice's hash is still empty. True only if this call set it. No revision change, no event. */
  setInvoiceHash(invoiceId: string, hash: string): Promise<boolean>;
  insertToken(t: Omit<BillingToken, "id">): Promise<BillingToken>;
  findToken(digest: string): Promise<BillingToken | null>;
  getToken(id: string): Promise<BillingToken | null>;
  updateToken(id: string, patch: Partial<BillingToken>): Promise<void>;
  /** Atomic compare-and-set: applies the patch only while every `expected` field still holds. True when it did. */
  updateTokenIf(id: string, expected: Pick<BillingToken, "attempts" | "codeSends">, patch: Partial<BillingToken>): Promise<boolean>;
  revokeInvoiceTokens(invoiceId: string): Promise<void>;
  insertSession(s: GuestSession): Promise<void>;
  findSession(digest: string): Promise<GuestSession | null>;
  insertDelivery(d: Omit<Delivery, "id" | "created">): Promise<Delivery>;
  finishDelivery(id: string, status: "sent" | "failed", error?: string): Promise<void>;
  /** Marks the job's delivery rows failed with `error`. False when the job has none. */
  holdJobDelivery(jobId: string, error: string): Promise<boolean>;
  listDeliveries(workspaceId: string, limit: number): Promise<Delivery[]>;
  /** Returns the sha256 hex; stored at <workspaceId>/<hash> in the private "signroom" bucket. */
  putBlob(workspaceId: string, bytes: Uint8Array): Promise<string>;
  getBlob(workspaceId: string, hash: string): Promise<Uint8Array>;
  /** A signed Storage URL for <workspaceId>/<hash>, good for `seconds`. With a name, Storage sends it as an attachment. */
  signedBlobUrl(workspaceId: string, hash: string, seconds: number, downloadName?: string): Promise<string>;
  /** The workspace's uploaded letterhead templates, oldest first. */
  listTemplateFiles(workspaceId: string): Promise<TemplateFile[]>;
  /** Upserts on (workspace, hash) refreshing created_at and name, then keeps only the newest 20 rows. Blobs are not deleted. */
  addTemplateFile(f: TemplateFile & { sizeBytes: number; scanEngine: string }): Promise<void>;

  /** Summaries (no content, events, branding, frozen or fields), newest update first. `null` sender = everyone's. */
  listAgreements(workspaceId: string, senderId: string | null, filter?: ListFilter): Promise<AgreementSummary[]>;
  getAgreement(workspaceId: string, id: string): Promise<StoredAgreement | null>;
  insertAgreement(a: Omit<Agreement, "id" | "created" | "updated" | "deliveries">): Promise<StoredAgreement>;
  /** Compare-and-set on the row version. null = the row moved. The database refuses forbidden changes (StoreError). */
  updateAgreement(workspaceId: string, id: string, rowVersion: number, patch: AgreementPatch): Promise<StoredAgreement | null>;
  /** Drafts that are not in the bin. */
  countDrafts(workspaceId: string): Promise<number>;
  listAgreementTemplates(workspaceId: string): Promise<AgreementTemplateSummary[]>;
  getAgreementTemplate(workspaceId: string, id: string): Promise<AgreementTemplate | null>;
  /** Version = highest for (workspace, name) + 1; retries once on a clash, then 409. */
  insertAgreementTemplate(t: Omit<AgreementTemplate, "id" | "version" | "created">): Promise<AgreementTemplate>;
  insertSignToken(t: Omit<SignToken, "id" | "attempts" | "codeSends">): Promise<SignToken>;
  /** Revokes the agreement's live links; narrowed to one participant and, with a purpose, to that purpose. */
  revokeSignTokens(agreementId: string, participantId?: string, purpose?: "sign" | "complete"): Promise<void>;
  listSignTokens(agreementId: string): Promise<SignToken[]>;
  findSignToken(digest: string): Promise<SignToken | null>;
  getSignToken(id: string): Promise<SignToken | null>;
  /** Atomic compare-and-set on the code counters. True when the patch applied. */
  updateSignTokenIf(id: string, expected: Pick<SignToken, "attempts" | "codeSends">, patch: Partial<SignToken>): Promise<boolean>;
  updateSignToken(id: string, patch: Partial<SignToken>): Promise<void>;
  insertSignSession(s: SignSession): Promise<void>;
  findSignSession(digest: string): Promise<SignSession | null>;
  /** Removes sessions that expired before `before` (epoch ms). */
  deleteSignSessions(before: number): Promise<void>;
  /** A duplicate `dedupe` returns the existing job. */
  insertJob(j: NewJob): Promise<Job>;
  /** Takes up to `limit` due jobs under a lease of `leaseSeconds`, optionally only those ids. Counts the attempt. */
  claimJobs(limit: number, leaseSeconds: number, ids?: string[]): Promise<Job[]>;
  getJob(id: string): Promise<Job | null>;
  updateJob(id: string, patch: Partial<Pick<Job, "status" | "available" | "payload" | "error" | "manualReview">>): Promise<void>;
  /**
   * Back to queued, due now and with no error, only while the job is still
   * `from` (a compare-and-set on its status). With `resetAttempts` its attempt
   * count starts again at 0. True when this call moved it.
   */
  requeueJob(id: string, from: "failed" | "suppressed", opts?: { resetAttempts?: boolean }): Promise<boolean>;
  /** Stamps live_attempted_at and manual_review where it was never stamped. True when this call did. */
  markLiveAttempt(id: string): Promise<boolean>;
  /** Empties the payload of every job of the agreement except one; those still queued are suppressed (never run). */
  clearJobPayloads(agreementId: string, exceptId: string): Promise<void>;
  /** Deletes done and suppressed jobs last updated before `before` (ISO time). */
  purgeJobs(before: string): Promise<void>;
  /** Across every workspace; used only by guest recovery, which has no workspace. */
  getAgreementById(id: string): Promise<StoredAgreement | null>;
  /**
   * Every workspace, earliest due first, at most `limit`: Awaiting signatures
   * with the deadline passed or an automatic reminder due (SR maintain's rule),
   * and Expired without its "Expiry notification queued" event.
   */
  listDueAgreements(limit: number): Promise<StoredAgreement[]>;
  /**
   * Every workspace, earliest deletion date first, at most `limit`: past the
   * date, no legal hold, not Awaiting signatures or Finalising, and no delete
   * job other than a suppressed one (a hold released since).
   */
  listDeletionsDue(limit: number): Promise<StoredAgreement[]>;
  /**
   * Every workspace, oldest update first, at most `limit`: Finalising with no
   * finalise job, or only a failed one whose wait has passed: an hour after
   * its fifth attempt, doubling with each attempt after that, at most a day.
   */
  listStrandedFinalising(limit: number): Promise<StoredAgreement[]>;
  /**
   * Every workspace, oldest failure first, at most `limit`: completion emails
   * refused before sending (failed, never held for review, never attempted
   * live, payload kept) whose last failure was over a day ago, with fewer than
   * MAX_ATTEMPTS + COMPLETION_REQUEUES attempts (12).
   */
  listRefusedCompletionMail(limit: number): Promise<Job[]>;
  /** False when the database guard refuses (retention not over, legal hold, still being signed) or no row matched. */
  deleteAgreement(workspaceId: string, id: string): Promise<boolean>;
  /** True while anything in the workspace still refers to the stored file. */
  blobInUse(workspaceId: string, hash: string): Promise<boolean>;
  /** A missing object is not an error. */
  removeBlob(workspaceId: string, hash: string): Promise<void>;
  /** Records a public key once; throws if the key id already holds a different one. */
  registerEvidenceKey(keyId: string, publicKeyPem: string): Promise<void>;
  /** Oldest first. */
  listAgreementDeliveries(agreementId: string): Promise<Delivery[]>;
  /** Records a ticket for <workspaceId>/quarantine/<id>.pdf and returns it with a Storage signed-upload token. */
  createUpload(workspaceId: string, agreementId: string): Promise<UploadTicket & { token: string }>;
  /** Marks an unused ticket under 2 hours old as used. null otherwise (including another workspace or a bad id). */
  takeUpload(workspaceId: string, id: string): Promise<UploadTicket | null>;
  /** The uploaded object, or null when it does not exist. Any other Storage error throws. */
  readQuarantine(path: string): Promise<Uint8Array | null>;
  /** Never throws. */
  removeQuarantine(path: string): Promise<void>;
  /** Removes the objects of, and deletes, the workspace's tickets created before `before` (ISO time). */
  sweepUploads(workspaceId: string, before: string): Promise<void>;
}

/** An upload ticket is good for this long. */
export const UPLOAD_TICKET_MS = 2 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many uploaded letterhead templates a workspace keeps. */
export const TEMPLATE_FILE_LIMIT = 20;

export const BUCKET = "signroom";

// ------------------------------------------------------------------ helpers

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());
const ms = (s: unknown) => (typeof s === "string" ? Date.parse(s) : undefined);
const num = (v: unknown) => Number(v ?? 0);

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new StoreError(r.error.message);
  return r.data as T;
}

function workspaceFrom(r: Row): Workspace {
  const branding = r.branding && Object.keys(r.branding).length ? r.branding : undefined;
  return {
    id: r.id,
    owner: r.owner ?? "",
    name: r.name ?? "",
    replyTo: r.reply_to ?? "",
    ...(r.sender_name ? { senderName: r.sender_name } : {}),
    ...(r.sender_email ? { senderEmail: r.sender_email } : {}),
    ...(r.logo ? { logo: r.logo } : {}),
    ...(branding ? { branding } : {}),
    retentionDays: num(r.retention_days),
    suspended: false,
    created: r.created_at,
  };
}

function clientFrom(r: Row): Client {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    contactName: r.contact_name ?? "",
    email: r.email ?? "",
    companyNumber: r.company_number ?? "",
    notes: r.notes ?? "",
    ...(r.billing_address ? { billingAddress: r.billing_address } : {}),
    ...(r.account ? { account: r.account } : {}),
    crmCompanyId: r.crm_company_id ?? null,
    created: r.created_at,
    archived: !!r.archived,
  };
}

function clientRow(c: Partial<Client>): Row {
  const o: Row = {};
  if (c.workspaceId !== undefined) o.workspace_id = c.workspaceId;
  if (c.name !== undefined) o.name = c.name;
  if (c.contactName !== undefined) o.contact_name = c.contactName;
  if (c.email !== undefined) o.email = c.email;
  if (c.companyNumber !== undefined) o.company_number = c.companyNumber;
  if (c.notes !== undefined) o.notes = c.notes;
  if (c.billingAddress !== undefined) o.billing_address = c.billingAddress;
  if (c.account !== undefined) o.account = c.account;
  if (c.archived !== undefined) o.archived = c.archived;
  return o;
}

function paymentFrom(r: Row): Payment {
  return {
    id: r.id,
    amountMinor: num(r.amount_minor),
    paidOn: r.paid_on,
    reference: r.reference ?? "",
    method: r.method ?? "",
    receiptNumber: r.receipt_number,
    receiptHash: r.receipt_hash ?? "",
    recordedAt: r.recorded_at,
  };
}

function paymentRow(p: Payment): Row {
  return {
    id: p.id,
    amount_minor: p.amountMinor,
    paid_on: p.paidOn,
    reference: p.reference,
    method: p.method,
    receipt_number: p.receiptNumber,
    receipt_hash: p.receiptHash || null,
    recorded_at: p.recordedAt,
  };
}

const eventRow = (e: InvoiceEvent): Row => ({ at: e.at, type: e.type, actor: e.actor });

function invoiceFrom(r: Row): Invoice {
  const payments = ((r.sr_payments ?? []) as Row[])
    .slice()
    .sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)))
    .map(paymentFrom);
  const events = ((r.sr_invoice_events ?? []) as Row[])
    .slice()
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((e) => ({ at: e.at as string, type: e.type as string, actor: (e.actor ?? "") as string }));
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    clientId: r.client_id ?? "",
    createdBy: r.created_by ?? "",
    revision: num(r.revision),
    status: r.status,
    number: r.number ?? "",
    currency: r.currency ?? "",
    issueDate: r.issue_date ?? "",
    dueDate: r.due_date ?? "",
    lines: r.lines ?? [],
    taxBps: num(r.tax_bps),
    subtotalMinor: num(r.subtotal_minor),
    taxMinor: num(r.tax_minor),
    totalMinor: num(r.total_minor),
    notes: r.notes ?? "",
    ...(r.project ? { project: r.project } : {}),
    dealId: r.crm_deal_id ?? null,
    ...(r.receipt_draft ? { receiptDraft: r.receipt_draft } : {}),
    ...(r.branding ? { branding: r.branding } : {}),
    ...(r.customer ? { customer: r.customer } : {}),
    ...(r.invoice_hash ? { invoiceHash: r.invoice_hash } : {}),
    ...(r.issued_at ? { issuedAt: r.issued_at } : {}),
    ...(r.sent_at ? { sentAt: r.sent_at } : {}),
    created: r.created_at,
    updated: r.updated_at,
    payments,
    events,
  };
}

/** Invoice fields -> sr_invoices columns. Only keys that are present are mapped; null clears. The deal link is written at insert only. */
function invoiceRow(i: Partial<Invoice>): Row {
  const o: Row = {};
  const set = (col: string, v: unknown) => {
    if (v !== undefined) o[col] = v;
  };
  set("client_id", i.clientId);
  set("status", i.status);
  // Empty text becomes NULL: number is unique per workspace (so "" would collide
  // on the second draft) and date columns reject "".
  const blank = (v: string | undefined) => (v === "" ? null : v);
  set("number", blank(i.number));
  set("currency", blank(i.currency));
  set("issue_date", blank(i.issueDate));
  set("due_date", blank(i.dueDate));
  set("lines", i.lines);
  set("tax_bps", i.taxBps);
  set("subtotal_minor", i.subtotalMinor);
  set("tax_minor", i.taxMinor);
  set("total_minor", i.totalMinor);
  set("notes", i.notes);
  set("project", i.project);
  set("receipt_draft", i.receiptDraft);
  set("branding", i.branding);
  set("customer", i.customer);
  set("invoice_hash", i.invoiceHash);
  set("issued_at", i.issuedAt);
  set("sent_at", i.sentAt);
  return o;
}

function tokenFrom(r: Row): BillingToken {
  return {
    id: r.id,
    digest: r.digest,
    purpose: "billing",
    workspaceId: r.workspace_id,
    ...(r.invoice_id ? { invoiceId: r.invoice_id } : {}),
    ...(r.payment_id ? { paymentId: r.payment_id } : {}),
    ...(r.artifact_hash ? { artifactHash: r.artifact_hash } : {}),
    email: r.email ?? "",
    expires: ms(r.expires_at) ?? 0,
    revoked: !!r.revoked,
    ...(r.code_digest ? { codeDigest: r.code_digest } : {}),
    ...(r.code_expires_at ? { codeExpires: ms(r.code_expires_at) } : {}),
    ...(r.code_sent_at ? { codeSent: ms(r.code_sent_at) } : {}),
    attempts: num(r.attempts),
    codeSends: num(r.code_sends),
    ...(r.code_window_start ? { codeWindowStart: ms(r.code_window_start) } : {}),
  };
}

function tokenRow(t: Partial<BillingToken>): Row {
  const o: Row = {};
  if (t.digest !== undefined) o.digest = t.digest;
  if (t.purpose !== undefined) o.purpose = t.purpose;
  if (t.workspaceId !== undefined) o.workspace_id = t.workspaceId;
  if (t.invoiceId !== undefined) o.invoice_id = t.invoiceId;
  if (t.paymentId !== undefined) o.payment_id = t.paymentId;
  if (t.artifactHash !== undefined) o.artifact_hash = t.artifactHash;
  if (t.email !== undefined) o.email = t.email;
  if (t.expires !== undefined) o.expires_at = iso(t.expires);
  if (t.revoked !== undefined) o.revoked = t.revoked;
  if (t.codeDigest !== undefined) o.code_digest = t.codeDigest;
  if (t.codeExpires !== undefined) o.code_expires_at = iso(t.codeExpires);
  if (t.codeSent !== undefined) o.code_sent_at = iso(t.codeSent);
  if (t.attempts !== undefined) o.attempts = t.attempts;
  if (t.codeSends !== undefined) o.code_sends = t.codeSends;
  if (t.codeWindowStart !== undefined) o.code_window_start = iso(t.codeWindowStart);
  return o;
}

function deliveryFrom(r: Row): Delivery {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ...(r.invoice_id ? { invoiceId: r.invoice_id } : {}),
    ...(r.agreement_id ? { agreementId: r.agreement_id } : {}),
    ...(r.participant_id ? { participantId: r.participant_id } : {}),
    ...(r.job_id ? { jobId: r.job_id } : {}),
    recipient: r.recipient ?? "",
    subject: r.subject ?? "",
    purpose: r.purpose ?? "",
    ...(r.route ? { route: r.route } : {}),
    status: r.status,
    ...(r.error ? { error: r.error } : {}),
    created: r.created_at,
  };
}

// ---------------------------------------------------------------- agreements

/** The sr_agreements columns a summary needs (no content, fields, events, branding, frozen, final_snapshot or link_origin). */
const AGREEMENT_SUMMARY_COLUMNS = [
  "id", "workspace_id", "sender_id", "client_id", "type", "title", "status", "revision", "row_version", "source_kind",
  "document_hash", "pages", "participants", "sequential", "sender_first", "sender_release_pending", "sender_signed_hash",
  "deadline", "reminder_days", "subject", "message", "send_key", "template_version_id", "legal_hold", "archived_at",
  "trashed_at", "sent_at", "completed_at", "last_reminder_at", "created_at", "updated_at", "artifacts", "exported_at", "deletion_at", "crm_deal_id",
].join(", ");

function agreementSummaryFrom(r: Row): AgreementSummary & { rowVersion: number } {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    senderId: r.sender_id ?? "",
    clientId: r.client_id,
    dealId: r.crm_deal_id ?? null,
    type: r.type,
    title: r.title ?? "",
    status: r.status,
    revision: num(r.revision),
    rowVersion: num(r.row_version),
    sourceKind: r.source_kind ?? "authored",
    ...(r.document_hash ? { documentHash: r.document_hash } : {}),
    pages: r.pages ?? [],
    participants: r.participants ?? [],
    sequential: !!r.sequential,
    ...(r.sender_first ? { senderFirst: true } : {}),
    ...(r.sender_release_pending ? { senderReleasePending: true } : {}),
    ...(r.sender_signed_hash ? { senderSignedHash: r.sender_signed_hash } : {}),
    deadline: r.deadline ?? "",
    reminderDays: num(r.reminder_days),
    subject: r.subject ?? "",
    message: r.message ?? "",
    ...(r.send_key ? { sendKey: r.send_key } : {}),
    ...(r.template_version_id ? { templateVersionId: r.template_version_id } : {}),
    legalHold: !!r.legal_hold,
    ...(r.archived_at ? { archivedAt: r.archived_at } : {}),
    ...(r.trashed_at ? { trashedAt: r.trashed_at } : {}),
    ...(r.sent_at ? { sentAt: r.sent_at } : {}),
    ...(r.completed_at ? { completedAt: r.completed_at } : {}),
    ...(r.last_reminder_at ? { lastReminderAt: r.last_reminder_at } : {}),
    ...(r.artifacts ? { artifacts: r.artifacts } : {}),
    ...(r.exported_at ? { exportedAt: r.exported_at } : {}),
    ...(r.deletion_at ? { deletionAt: r.deletion_at } : {}),
    created: r.created_at,
    updated: r.updated_at,
  };
}

function agreementFrom(r: Row): StoredAgreement {
  return {
    ...agreementSummaryFrom(r),
    content: r.content ?? "",
    fields: r.fields ?? [],
    events: r.events ?? [],
    ...(r.branding ? { branding: r.branding } : {}),
    ...(r.frozen ? { frozen: r.frozen } : {}),
    ...(r.final_snapshot ? { finalSnapshot: r.final_snapshot } : {}),
    ...(r.link_origin ? { linkOrigin: r.link_origin } : {}),
  };
}

/** Agreement fields -> sr_agreements columns. Only keys that are present are mapped; "" clears dates, hashes and ids. The deal link is written at insert only. */
function agreementRow(a: AgreementPatch & { workspaceId?: string }): Row {
  const o: Row = {};
  const set = (col: string, v: unknown) => {
    if (v !== undefined) o[col] = v;
  };
  const blank = (v: string | undefined) => (v === "" ? null : v);
  set("workspace_id", a.workspaceId);
  set("sender_id", blank(a.senderId));
  set("client_id", a.clientId);
  set("type", a.type);
  set("title", a.title);
  set("status", a.status);
  set("revision", a.revision);
  set("content", a.content);
  set("source_kind", a.sourceKind);
  set("document_hash", blank(a.documentHash));
  set("pages", a.pages);
  set("participants", a.participants);
  set("fields", a.fields);
  set("events", a.events);
  set("sequential", a.sequential);
  set("sender_first", a.senderFirst);
  set("sender_release_pending", a.senderReleasePending);
  set("sender_signed_hash", blank(a.senderSignedHash));
  set("deadline", blank(a.deadline));
  set("reminder_days", a.reminderDays);
  set("subject", a.subject);
  set("message", a.message);
  set("branding", a.branding);
  set("frozen", a.frozen);
  set("send_key", blank(a.sendKey));
  set("template_version_id", blank(a.templateVersionId));
  set("legal_hold", a.legalHold);
  set("archived_at", blank(a.archivedAt));
  set("trashed_at", blank(a.trashedAt));
  set("sent_at", blank(a.sentAt));
  set("completed_at", blank(a.completedAt));
  set("last_reminder_at", blank(a.lastReminderAt));
  set("artifacts", a.artifacts);
  set("final_snapshot", a.finalSnapshot);
  set("exported_at", blank(a.exportedAt));
  set("deletion_at", blank(a.deletionAt));
  set("link_origin", blank(a.linkOrigin));
  return o;
}

const TEMPLATE_SUMMARY_COLUMNS = "id, name, type, version, created_at";

function templateFrom(r: Row): AgreementTemplate {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    type: r.type,
    version: num(r.version),
    content: r.content ?? "",
    roles: r.roles ?? [],
    fields: r.fields ?? [],
    ...(r.branding ? { branding: r.branding } : {}),
    ...(r.document_hash ? { documentHash: r.document_hash } : {}),
    ...(r.pages ? { pages: r.pages } : {}),
    ...(r.source_kind ? { sourceKind: r.source_kind } : {}),
    created: r.created_at,
  };
}

function signTokenFrom(r: Row): SignToken {
  return {
    id: r.id,
    digest: r.digest,
    purpose: r.purpose,
    workspaceId: r.workspace_id,
    agreementId: r.agreement_id,
    participantId: r.participant_id,
    email: r.email ?? "",
    version: num(r.version),
    expires: ms(r.expires_at) ?? 0,
    revoked: !!r.revoked,
    ...(r.code_digest ? { codeDigest: r.code_digest } : {}),
    ...(r.code_expires_at ? { codeExpires: ms(r.code_expires_at) } : {}),
    ...(r.code_sent_at ? { codeSent: ms(r.code_sent_at) } : {}),
    attempts: num(r.attempts),
    codeSends: num(r.code_sends),
    ...(r.code_window_start ? { codeWindowStart: ms(r.code_window_start) } : {}),
  };
}

/** Only the columns a patch may change; identity columns are never rewritten. */
function signTokenRow(t: Partial<SignToken>): Row {
  const o: Row = {};
  if (t.revoked !== undefined) o.revoked = t.revoked;
  if (t.expires !== undefined) o.expires_at = iso(t.expires);
  if (t.version !== undefined) o.version = t.version;
  if (t.codeDigest !== undefined) o.code_digest = t.codeDigest;
  if (t.codeExpires !== undefined) o.code_expires_at = iso(t.codeExpires);
  if (t.codeSent !== undefined) o.code_sent_at = iso(t.codeSent);
  if (t.attempts !== undefined) o.attempts = t.attempts;
  if (t.codeSends !== undefined) o.code_sends = t.codeSends;
  if (t.codeWindowStart !== undefined) o.code_window_start = iso(t.codeWindowStart);
  return o;
}

function jobFrom(r: Row): Job {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ...(r.agreement_id ? { agreementId: r.agreement_id } : {}),
    ...(r.participant_id ? { participantId: r.participant_id } : {}),
    kind: r.kind,
    purpose: r.purpose,
    dedupe: r.dedupe,
    status: r.status,
    attempts: num(r.attempts),
    available: ms(r.available_at) ?? 0,
    ...(r.lease_until ? { leaseUntil: ms(r.lease_until) } : {}),
    payload: r.payload ?? "",
    ...(r.error ? { error: r.error } : {}),
    ...(r.live_attempted_at ? { liveAttemptedAt: r.live_attempted_at } : {}),
    manualReview: !!r.manual_review,
    created: r.created_at,
  };
}

function uploadFrom(r: Row): UploadTicket {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agreementId: r.agreement_id,
    path: r.path,
    created: r.created_at,
    ...(r.used_at ? { used: r.used_at } : {}),
  };
}

const INVOICE_SELECT = "*, sr_payments(*), sr_invoice_events(*)";

// ------------------------------------------------------------------- Supabase

export function supabaseStore(sb: SupabaseClient): Store {
  async function invoiceById(workspaceId: string, id: string): Promise<Invoice | null> {
    const r = await sb.from("sr_invoices").select(INVOICE_SELECT).eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
    const data = must(r) as Row | null;
    return data ? invoiceFrom(data) : null;
  }

  async function addEvent(invoiceId: string, event: InvoiceEvent) {
    const r = await sb.from("sr_invoice_events").insert({ invoice_id: invoiceId, ...eventRow(event) });
    if (r.error) throw new StoreError(r.error.message);
  }

  async function workspaceRow(id: string): Promise<Workspace | null> {
    const data = must(await sb.from("sr_workspaces").select("*").eq("id", id).maybeSingle()) as Row | null;
    return data ? workspaceFrom(data) : null;
  }

  async function clientByCompany(workspaceId: string, companyId: string): Promise<Client | null> {
    const r = await sb.from("sr_clients").select("*").eq("workspace_id", workspaceId).eq("crm_company_id", companyId).maybeSingle();
    const data = must(r) as Row | null;
    return data ? clientFrom(data) : null;
  }

  return {
    async workspaceAccess(workspaceId, userId) {
      // TaskCalendar's own tables, read with the service role: the workspace, then the organisation that owns it.
      const w = must(await sb.from("workspaces").select("workspace_id, organization_id, name").eq("workspace_id", workspaceId).maybeSingle()) as Row | null;
      if (!w || !w.organization_id) return null;
      const o = must(await sb.from("organizations").select("owner_id, members").eq("organization_id", w.organization_id).maybeSingle()) as Row | null;
      if (!o) return null;
      const role = orgRoleOf(o, userId);
      return role ? { workspaceId: w.workspace_id as string, name: (w.name ?? "") as string, role } : null;
    },

    async ensureWorkspace(workspaceId, name, userId) {
      const found = await workspaceRow(workspaceId);
      if (found) return found;
      const r = await sb.from("sr_workspaces").insert({ id: workspaceId, owner: UUID.test(userId) ? userId : null, name }).select("*").single();
      if (!r.error) return workspaceFrom(r.data as Row);
      // The primary key: a parallel first call won. Use its row.
      const existing = (r.error as { code?: string }).code === "23505" ? await workspaceRow(workspaceId) : null;
      if (!existing) throw new StoreError(r.error.message);
      return existing;
    },

    getWorkspace: workspaceRow,

    async updateWorkspace(id, patch) {
      const o: Row = { updated_at: new Date().toISOString() };
      if (patch.name !== undefined) o.name = patch.name;
      if (patch.replyTo !== undefined) o.reply_to = patch.replyTo;
      if (patch.senderName !== undefined) o.sender_name = patch.senderName;
      if (patch.senderEmail !== undefined) o.sender_email = patch.senderEmail;
      if (patch.logo !== undefined) o.logo = patch.logo;
      if (patch.branding !== undefined) o.branding = patch.branding;
      if (patch.retentionDays !== undefined) o.retention_days = patch.retentionDays;
      const r = await sb.from("sr_workspaces").update(o).eq("id", id).select("*").single();
      return workspaceFrom(must(r) as Row);
    },

    async listClients(workspaceId, includeArchived) {
      let q = sb.from("sr_clients").select("*").eq("workspace_id", workspaceId);
      if (!includeArchived) q = q.eq("archived", false);
      const data = must(await q.order("created_at", { ascending: true })) as Row[] | null;
      return (data ?? []).map(clientFrom);
    },

    async getClient(workspaceId, id) {
      const r = await sb.from("sr_clients").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      const data = must(r) as Row | null;
      return data ? clientFrom(data) : null;
    },

    async insertClient(c) {
      const r = await sb
        .from("sr_clients")
        .insert({ ...clientRow(c), ...(c.crmCompanyId ? { crm_company_id: c.crmCompanyId } : {}) })
        .select("*")
        .single();
      if (!r.error) return clientFrom(r.data as Row);
      // unique (workspace, CRM company): a parallel request made this client first. Use its row.
      const existing = c.crmCompanyId && (r.error as { code?: string }).code === "23505" ? await clientByCompany(c.workspaceId, c.crmCompanyId) : null;
      if (!existing) throw new StoreError(r.error.message);
      return existing;
    },

    getClientByCompany: clientByCompany,

    async clientHasDocuments(workspaceId, clientId) {
      const inv = await sb
        .from("sr_invoices")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("client_id", clientId)
        .neq("status", "Draft");
      if (inv.error) throw new StoreError(inv.error.message);
      if ((inv.count ?? 0) > 0) return true;
      const agr = await sb
        .from("sr_agreements")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("client_id", clientId)
        .neq("status", "Draft");
      if (agr.error) throw new StoreError(agr.error.message);
      return (agr.count ?? 0) > 0;
    },

    async crmCompany(workspaceId, companyId) {
      // select("*"): state and postal_code are newer columns and may not exist on an older database.
      const c = must(await sb.from("crm_companies").select("*").eq("id", companyId).eq("workspace_id", workspaceId).maybeSingle()) as Row | null;
      if (!c) return null;
      const got = await sb
        .from("crm_contacts")
        .select("first_name, last_name, email, created_at")
        .eq("company_id", c.id)
        .not("email", "is", null)
        .order("created_at", { ascending: true })
        .limit(50);
      const contacts = ((must(got) as Row[] | null) ?? [])
        .map((x) => ({ name: [x.first_name, x.last_name].map((v) => String(v ?? "").trim()).filter(Boolean).join(" "), email: String(x.email ?? "").trim() }))
        .filter((x) => x.email);
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      return {
        id: c.id as string,
        name: str(c.name),
        email: str(c.email),
        address: str(c.address),
        city: str(c.city),
        state: str(c.state),
        postalCode: str(c.postal_code),
        country: str(c.country),
        contacts,
      };
    },

    async crmDeal(workspaceId, dealId) {
      const d = must(await sb.from("crm_deals").select("id, company_id").eq("id", dealId).eq("workspace_id", workspaceId).maybeSingle()) as Row | null;
      return d ? { id: d.id as string, companyId: (d.company_id ?? null) as string | null } : null;
    },

    async updateClient(workspaceId, id, patch) {
      const r = await sb
        .from("sr_clients")
        .update({ ...clientRow({ ...patch, workspaceId: undefined }), updated_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      const data = must(r) as Row | null;
      if (!data) throw new AppError("Client not found.", 404);
      return clientFrom(data);
    },

    async setClientAccount(workspaceId, clientId, revision, account) {
      const r = await sb.rpc("sr_set_client_account", { p_workspace: workspaceId, p_client: clientId, p_revision: revision, p_account: account });
      return (must(r) as unknown as ClientAccountSettings | null) ?? null;
    },

    async listInvoices(workspaceId, filter = {}) {
      // PostgREST caps one response (about 1000 rows), so read newest-first in pages until a short page.
      const PAGE = 1000;
      const out: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = sb.from("sr_invoices").select(INVOICE_SELECT).eq("workspace_id", workspaceId);
        if (filter.clientId !== undefined) q = q.eq("client_id", filter.clientId);
        if (filter.dealId !== undefined) q = q.eq("crm_deal_id", filter.dealId);
        const r = await q
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE - 1);
        const rows = (must(r) as Row[] | null) ?? [];
        out.push(...rows);
        if (rows.length < PAGE) break;
      }
      return out.map(invoiceFrom);
    },

    getInvoice: invoiceById,

    async takeInvoiceNumber(workspaceId, year) {
      const r = await sb.rpc("sr_take_invoice_number", { p_workspace: workspaceId, p_year: year });
      return must(r) as unknown as string;
    },

    async insertInvoice(i, event) {
      const row = { ...invoiceRow(i), workspace_id: i.workspaceId, created_by: i.createdBy || null, crm_deal_id: i.dealId || null };
      const r = await sb.from("sr_invoices").insert(row).select("id").single();
      const id = (must(r) as Row).id as string;
      await addEvent(id, event);
      const out = await invoiceById(i.workspaceId, id);
      if (!out) throw new StoreError("Invoice vanished after insert.");
      return out;
    },

    async updateDraft(workspaceId, id, revision, patch, event) {
      const r = await sb
        .from("sr_invoices")
        .update({ ...invoiceRow({ ...patch, status: undefined }), revision: revision + 1, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .eq("revision", revision)
        .eq("status", "Draft")
        .select("id")
        .maybeSingle();
      if (!must(r)) return null;
      await addEvent(id, event);
      return invoiceById(workspaceId, id);
    },

    async issueInvoice(id, revision, patch, payment, events) {
      const p = invoiceRow(patch);
      const allowed = ["status", "number", "branding", "customer", "invoice_hash", "issued_at", "sent_at", "receipt_draft"];
      const p_patch: Row = {};
      for (const k of allowed) if (k in p) p_patch[k] = p[k];
      const r = await sb.rpc("sr_issue_invoice", {
        p_id: id,
        p_revision: revision,
        p_patch,
        p_payment: payment ? paymentRow(payment) : null,
        p_events: events.map(eventRow),
      });
      return must(r) === true;
    },

    async recordPayment(id, revision, payment, status, event) {
      const r = await sb.rpc("sr_record_payment", {
        p_id: id,
        p_revision: revision,
        p_payment: paymentRow(payment),
        p_status: status,
        p_event: eventRow(event),
      });
      return must(r) === true;
    },

    async setInvoiceState(workspaceId, id, revision, patch, event) {
      const o: Row = { revision: revision + 1, updated_at: new Date().toISOString() };
      if (patch.status !== undefined) o.status = patch.status;
      if (patch.sentAt !== undefined) o.sent_at = patch.sentAt;
      if (patch.invoiceHash !== undefined) o.invoice_hash = patch.invoiceHash;
      const r = await sb
        .from("sr_invoices")
        .update(o)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .eq("revision", revision)
        .select("id")
        .maybeSingle();
      if (!must(r)) return null;
      await addEvent(id, event);
      return invoiceById(workspaceId, id);
    },

    async setReceiptHash(paymentId, hash) {
      const r = await sb.from("sr_payments").update({ receipt_hash: hash }).eq("id", paymentId).is("receipt_hash", null).select("id");
      return ((must(r) as Row[] | null) ?? []).length > 0;
    },

    async setInvoiceHash(invoiceId, hash) {
      const r = await sb.from("sr_invoices").update({ invoice_hash: hash }).eq("id", invoiceId).is("invoice_hash", null).select("id");
      return ((must(r) as Row[] | null) ?? []).length > 0;
    },

    async insertToken(t) {
      const r = await sb.from("sr_tokens").insert(tokenRow(t)).select("*").single();
      return tokenFrom(must(r) as Row);
    },

    async findToken(digest) {
      const r = await sb.from("sr_tokens").select("*").eq("digest", digest).maybeSingle();
      const data = must(r) as Row | null;
      return data ? tokenFrom(data) : null;
    },

    async getToken(id) {
      const data = must(await sb.from("sr_tokens").select("*").eq("id", id).maybeSingle()) as Row | null;
      return data ? tokenFrom(data) : null;
    },

    async updateTokenIf(id, expected, patch) {
      const r = await sb
        .from("sr_tokens")
        .update(tokenRow({ ...patch, workspaceId: undefined }))
        .eq("id", id)
        .eq("attempts", expected.attempts)
        .eq("code_sends", expected.codeSends)
        .select("id");
      return (must(r) as Row[]).length > 0;
    },

    async updateToken(id, patch) {
      const r = await sb.from("sr_tokens").update(tokenRow({ ...patch, workspaceId: undefined })).eq("id", id);
      if (r.error) throw new StoreError(r.error.message);
    },

    async revokeInvoiceTokens(invoiceId) {
      const r = await sb.from("sr_tokens").update({ revoked: true }).eq("invoice_id", invoiceId);
      if (r.error) throw new StoreError(r.error.message);
    },

    async insertSession(s) {
      const r = await sb.from("sr_sessions").insert({
        digest: s.digest,
        kind: s.kind,
        token_id: s.tokenId ?? null,
        workspace_id: s.workspaceId,
        invoice_id: s.invoiceId ?? null,
        expires_at: iso(s.expires),
      });
      if (r.error) throw new StoreError(r.error.message);
    },

    async findSession(digest) {
      const r = await sb.from("sr_sessions").select("*").eq("digest", digest).maybeSingle();
      const d = must(r) as Row | null;
      if (!d) return null;
      return {
        digest: d.digest,
        kind: "billing",
        ...(d.token_id ? { tokenId: d.token_id } : {}),
        workspaceId: d.workspace_id,
        ...(d.invoice_id ? { invoiceId: d.invoice_id } : {}),
        expires: ms(d.expires_at) ?? 0,
      };
    },

    async insertDelivery(d) {
      const r = await sb
        .from("sr_deliveries")
        .insert({
          workspace_id: d.workspaceId,
          invoice_id: d.invoiceId ?? null,
          agreement_id: d.agreementId ?? null,
          participant_id: d.participantId ?? null,
          // Only when set, so invoice emails work before the 3B migration adds the column.
          ...(d.jobId ? { job_id: d.jobId } : {}),
          recipient: d.recipient,
          subject: d.subject,
          purpose: d.purpose,
          route: d.route ?? null,
          status: d.status,
          error: d.error ?? null,
        })
        .select("*")
        .single();
      return deliveryFrom(must(r) as Row);
    },

    async finishDelivery(id, status, error) {
      const r = await sb.from("sr_deliveries").update({ status, error: error ?? null }).eq("id", id);
      if (r.error) throw new StoreError(r.error.message);
    },

    async holdJobDelivery(jobId, error) {
      const r = await sb.from("sr_deliveries").update({ status: "failed", error }).eq("job_id", jobId).select("id");
      return ((must(r) as Row[] | null) ?? []).length > 0;
    },

    async listDeliveries(workspaceId, limit) {
      const r = await sb
        .from("sr_deliveries")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return ((must(r) as Row[] | null) ?? []).map(deliveryFrom);
    },

    async putBlob(workspaceId, bytes) {
      const hash = createHash("sha256").update(bytes).digest("hex");
      const r = await sb.storage.from(BUCKET).upload(`${workspaceId}/${hash}`, bytes, {
        upsert: true,
        contentType: "application/octet-stream",
      });
      if (r.error) throw new StoreError(r.error.message);
      return hash;
    },

    async getBlob(workspaceId, hash) {
      const r = await sb.storage.from(BUCKET).download(`${workspaceId}/${hash}`);
      if (r.error || !r.data) throw new StoreError(r.error?.message ?? "Blob not found.");
      return new Uint8Array(await r.data.arrayBuffer());
    },

    async signedBlobUrl(workspaceId, hash, seconds, downloadName) {
      const r = await sb.storage
        .from(BUCKET)
        .createSignedUrl(`${workspaceId}/${hash}`, seconds, downloadName ? { download: downloadName } : undefined);
      if (r.error || !r.data) throw new StoreError(r.error?.message ?? "Could not create a download link.");
      return r.data.signedUrl;
    },

    async listTemplateFiles(workspaceId) {
      const r = await sb.from("sr_template_files").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true });
      return ((must(r) as Row[] | null) ?? []).map((t) => ({ workspaceId: t.workspace_id, hash: t.hash, name: t.name }));
    },

    async addTemplateFile(f) {
      const up = await sb
        .from("sr_template_files")
        .upsert(
          {
            workspace_id: f.workspaceId,
            hash: f.hash,
            name: f.name,
            size_bytes: f.sizeBytes,
            scan_engine: f.scanEngine,
            created_at: new Date().toISOString(),
            scanned_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,hash" },
        );
      if (up.error) throw new StoreError(up.error.message);
      // Rows beyond the newest 20 (newest first, so the 21st onwards are the oldest).
      const extra = await sb
        .from("sr_template_files")
        .select("hash")
        .eq("workspace_id", f.workspaceId)
        .order("created_at", { ascending: false })
        .range(TEMPLATE_FILE_LIMIT, 999);
      const hashes = ((must(extra) as Row[] | null) ?? []).map((x) => x.hash as string);
      if (!hashes.length) return;
      const del = await sb.from("sr_template_files").delete().eq("workspace_id", f.workspaceId).in("hash", hashes);
      if (del.error) throw new StoreError(del.error.message);
    },

    async listAgreements(workspaceId, senderId, filter = {}) {
      let q = sb.from("sr_agreements").select(AGREEMENT_SUMMARY_COLUMNS).eq("workspace_id", workspaceId);
      if (senderId !== null) q = q.eq("sender_id", senderId);
      if (filter.clientId !== undefined) q = q.eq("client_id", filter.clientId);
      if (filter.dealId !== undefined) q = q.eq("crm_deal_id", filter.dealId);
      const data = must(await q.order("updated_at", { ascending: false })) as Row[] | null;
      return (data ?? []).map((r) => {
        const { rowVersion: _rv, ...summary } = agreementSummaryFrom(r);
        return summary;
      });
    },

    async getAgreement(workspaceId, id) {
      const r = await sb.from("sr_agreements").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      const data = must(r) as Row | null;
      return data ? agreementFrom(data) : null;
    },

    async insertAgreement(a) {
      const r = await sb.from("sr_agreements").insert({ ...agreementRow(a), crm_deal_id: a.dealId || null }).select("*").single();
      return agreementFrom(must(r) as Row);
    },

    async updateAgreement(workspaceId, id, rowVersion, patch) {
      const r = await sb
        .from("sr_agreements")
        .update(agreementRow(patch))
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .eq("row_version", rowVersion)
        .select("*")
        .maybeSingle();
      const data = must(r) as Row | null;
      return data ? agreementFrom(data) : null;
    },

    async countDrafts(workspaceId) {
      const r = await sb
        .from("sr_agreements")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "Draft")
        .is("trashed_at", null);
      if (r.error) throw new StoreError(r.error.message);
      return r.count ?? 0;
    },

    async listAgreementTemplates(workspaceId) {
      const r = await sb
        .from("sr_agreement_templates")
        .select(TEMPLATE_SUMMARY_COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      return ((must(r) as Row[] | null) ?? []).map((t) => ({ id: t.id, name: t.name, type: t.type, version: num(t.version), created: t.created_at }));
    },

    async getAgreementTemplate(workspaceId, id) {
      const r = await sb.from("sr_agreement_templates").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      const data = must(r) as Row | null;
      return data ? templateFrom(data) : null;
    },

    async insertAgreementTemplate(t) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const top = await sb
          .from("sr_agreement_templates")
          .select("version")
          .eq("workspace_id", t.workspaceId)
          .eq("name", t.name)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        const version = num((must(top) as Row | null)?.version) + 1;
        const r = await sb
          .from("sr_agreement_templates")
          .insert({
            workspace_id: t.workspaceId,
            name: t.name,
            type: t.type,
            version,
            content: t.content,
            roles: t.roles,
            fields: t.fields,
            branding: t.branding ?? null,
            document_hash: t.documentHash ?? null,
            pages: t.pages ?? null,
            source_kind: t.sourceKind ?? null,
          })
          .select("*")
          .single();
        if (!r.error) return templateFrom(r.data as Row);
        if ((r.error as { code?: string }).code !== "23505") throw new StoreError(r.error.message);
      }
      throw new AppError("This template was saved at the same moment elsewhere. Try again.", 409);
    },

    async insertSignToken(t) {
      const r = await sb
        .from("sr_sign_tokens")
        .insert({
          digest: t.digest,
          purpose: t.purpose,
          workspace_id: t.workspaceId,
          agreement_id: t.agreementId,
          participant_id: t.participantId,
          email: t.email,
          version: t.version,
          expires_at: iso(t.expires),
          revoked: t.revoked,
        })
        .select("*")
        .single();
      return signTokenFrom(must(r) as Row);
    },

    async revokeSignTokens(agreementId, participantId, purpose) {
      let q = sb.from("sr_sign_tokens").update({ revoked: true }).eq("agreement_id", agreementId);
      if (participantId !== undefined) q = q.eq("participant_id", participantId);
      if (purpose !== undefined) q = q.eq("purpose", purpose);
      const r = await q;
      if (r.error) throw new StoreError(r.error.message);
    },

    async findSignToken(digest) {
      const data = must(await sb.from("sr_sign_tokens").select("*").eq("digest", digest).maybeSingle()) as Row | null;
      return data ? signTokenFrom(data) : null;
    },

    async getSignToken(id) {
      const data = must(await sb.from("sr_sign_tokens").select("*").eq("id", id).maybeSingle()) as Row | null;
      return data ? signTokenFrom(data) : null;
    },

    async updateSignTokenIf(id, expected, patch) {
      const r = await sb
        .from("sr_sign_tokens")
        .update(signTokenRow(patch))
        .eq("id", id)
        .eq("attempts", expected.attempts)
        .eq("code_sends", expected.codeSends)
        .select("id");
      return ((must(r) as Row[] | null) ?? []).length > 0;
    },

    async updateSignToken(id, patch) {
      const r = await sb.from("sr_sign_tokens").update(signTokenRow(patch)).eq("id", id);
      if (r.error) throw new StoreError(r.error.message);
    },

    async insertSignSession(s) {
      const r = await sb.from("sr_sign_sessions").insert({
        digest: s.digest,
        token_id: s.tokenId,
        workspace_id: s.workspaceId,
        agreement_id: s.agreementId,
        participant_id: s.participantId,
        purpose: s.purpose,
        version: s.version,
        expires_at: iso(s.expires),
      });
      if (r.error) throw new StoreError(r.error.message);
    },

    async findSignSession(digest) {
      const d = must(await sb.from("sr_sign_sessions").select("*").eq("digest", digest).maybeSingle()) as Row | null;
      if (!d) return null;
      return {
        digest: d.digest,
        tokenId: d.token_id,
        workspaceId: d.workspace_id,
        agreementId: d.agreement_id,
        participantId: d.participant_id,
        purpose: d.purpose,
        version: num(d.version),
        expires: ms(d.expires_at) ?? 0,
      };
    },

    async deleteSignSessions(before) {
      const r = await sb.from("sr_sign_sessions").delete().lt("expires_at", new Date(before).toISOString());
      if (r.error) throw new StoreError(r.error.message);
    },

    async insertJob(j) {
      const up = await sb.from("sr_jobs").upsert(
        {
          workspace_id: j.workspaceId,
          agreement_id: j.agreementId ?? null,
          participant_id: j.participantId ?? null,
          kind: j.kind,
          purpose: j.purpose,
          dedupe: j.dedupe,
          payload: j.payload,
          ...(j.available !== undefined ? { available_at: iso(j.available) } : {}),
        },
        { onConflict: "dedupe", ignoreDuplicates: true },
      );
      if (up.error) throw new StoreError(up.error.message);
      const r = await sb.from("sr_jobs").select("*").eq("dedupe", j.dedupe).single();
      return jobFrom(must(r) as Row);
    },

    async claimJobs(limit, leaseSeconds, ids) {
      const r = await sb.rpc("sr_claim_jobs", { p_limit: limit, p_lease_seconds: leaseSeconds, p_ids: ids ?? null });
      return ((must(r) as unknown as Row[] | null) ?? []).map(jobFrom);
    },

    async getJob(id) {
      const data = must(await sb.from("sr_jobs").select("*").eq("id", id).maybeSingle()) as Row | null;
      return data ? jobFrom(data) : null;
    },

    async updateJob(id, patch) {
      const o: Row = { updated_at: new Date().toISOString() };
      if (patch.status !== undefined) o.status = patch.status;
      if (patch.available !== undefined) o.available_at = iso(patch.available);
      if (patch.payload !== undefined) o.payload = patch.payload;
      if (patch.error !== undefined) o.error = patch.error === "" ? null : patch.error;
      if (patch.manualReview !== undefined) o.manual_review = patch.manualReview;
      const r = await sb.from("sr_jobs").update(o).eq("id", id);
      if (r.error) throw new StoreError(r.error.message);
    },

    async requeueJob(id, from, opts = {}) {
      const t = new Date().toISOString();
      const r = await sb
        .from("sr_jobs")
        .update({ status: "queued", available_at: t, error: null, updated_at: t, ...(opts.resetAttempts ? { attempts: 0 } : {}) })
        .eq("id", id)
        .eq("status", from)
        .select("id");
      return ((must(r) as Row[] | null) ?? []).length > 0;
    },

    async markLiveAttempt(id) {
      const t = new Date().toISOString();
      const r = await sb
        .from("sr_jobs")
        .update({ live_attempted_at: t, manual_review: true, updated_at: t })
        .eq("id", id)
        .is("live_attempted_at", null)
        .select("id");
      return ((must(r) as Row[] | null) ?? []).length > 0;
    },

    async clearJobPayloads(agreementId, exceptId) {
      const t = new Date().toISOString();
      const q = await sb
        .from("sr_jobs")
        .update({ status: "suppressed", payload: "", updated_at: t })
        .eq("agreement_id", agreementId)
        .neq("id", exceptId)
        .eq("status", "queued");
      if (q.error) throw new StoreError(q.error.message);
      const r = await sb.from("sr_jobs").update({ payload: "", updated_at: t }).eq("agreement_id", agreementId).neq("id", exceptId);
      if (r.error) throw new StoreError(r.error.message);
    },

    async purgeJobs(before) {
      const r = await sb.from("sr_jobs").delete().in("status", ["done", "suppressed"]).lt("updated_at", before);
      if (r.error) throw new StoreError(r.error.message);
    },

    async getAgreementById(id) {
      if (!UUID.test(id)) return null;
      const data = must(await sb.from("sr_agreements").select("*").eq("id", id).maybeSingle()) as Row | null;
      return data ? agreementFrom(data) : null;
    },

    async listDueAgreements(limit) {
      const r = await sb.rpc("sr_agreements_due", { p_limit: limit });
      return ((must(r) as unknown as Row[] | null) ?? []).map(agreementFrom);
    },

    async listDeletionsDue(limit) {
      const r = await sb.rpc("sr_deletions_due", { p_limit: limit });
      return ((must(r) as unknown as Row[] | null) ?? []).map(agreementFrom);
    },

    async listStrandedFinalising(limit) {
      const r = await sb.rpc("sr_finalising_stranded", { p_limit: limit });
      return ((must(r) as unknown as Row[] | null) ?? []).map(agreementFrom);
    },

    async listRefusedCompletionMail(limit) {
      const r = await sb.rpc("sr_completion_mail_refused", { p_limit: limit });
      return ((must(r) as unknown as Row[] | null) ?? []).map(jobFrom);
    },

    async deleteAgreement(workspaceId, id) {
      const r = await sb.from("sr_agreements").delete().eq("workspace_id", workspaceId).eq("id", id).select("id");
      if (r.error) {
        if ((r.error as { code?: string }).code === "P0001") return false;
        throw new StoreError(r.error.message);
      }
      return ((r.data as Row[] | null) ?? []).length > 0;
    },

    async blobInUse(workspaceId, hash) {
      const r = await sb.rpc("sr_blob_in_use", { p_workspace: workspaceId, p_hash: hash });
      return must(r) === true;
    },

    async removeBlob(workspaceId, hash) {
      const r = await sb.storage.from(BUCKET).remove([`${workspaceId}/${hash}`]);
      if (r.error) throw new StoreError(r.error.message);
    },

    async registerEvidenceKey(keyId, publicKeyPem) {
      const up = await sb.from("sr_evidence_keys").upsert({ key_id: keyId, public_key: publicKeyPem }, { onConflict: "key_id", ignoreDuplicates: true });
      if (up.error) throw new StoreError(up.error.message);
      const r = await sb.from("sr_evidence_keys").select("public_key").eq("key_id", keyId).maybeSingle();
      const data = must(r) as Row | null;
      if (!data) throw new StoreError(`Evidence key ${keyId} could not be recorded.`);
      if (data.public_key !== publicKeyPem) throw new StoreError(`Evidence key ${keyId} does not match its recorded public key.`);
    },

    async listSignTokens(agreementId) {
      const r = await sb.from("sr_sign_tokens").select("*").eq("agreement_id", agreementId).order("created_at", { ascending: true });
      return ((must(r) as Row[] | null) ?? []).map(signTokenFrom);
    },

    async listAgreementDeliveries(agreementId) {
      const r = await sb.from("sr_deliveries").select("*").eq("agreement_id", agreementId).order("created_at", { ascending: true });
      return ((must(r) as Row[] | null) ?? []).map(deliveryFrom);
    },

    async createUpload(workspaceId, agreementId) {
      const id = randomUUID();
      const path = `${workspaceId}/quarantine/${id}.pdf`;
      const r = await sb.from("sr_uploads").insert({ id, workspace_id: workspaceId, agreement_id: agreementId, path }).select("*").single();
      const ticket = uploadFrom(must(r) as Row);
      const signed = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
      if (signed.error || !signed.data) throw new StoreError(signed.error?.message ?? "Could not create an upload link.");
      return { ...ticket, id, path, token: signed.data.token };
    },

    async takeUpload(workspaceId, id) {
      if (!UUID.test(id)) return null;
      const r = await sb
        .from("sr_uploads")
        .update({ used_at: new Date().toISOString() })
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .is("used_at", null)
        .gt("created_at", new Date(Date.now() - UPLOAD_TICKET_MS).toISOString())
        .select("*")
        .maybeSingle();
      const data = must(r) as Row | null;
      return data ? uploadFrom(data) : null;
    },

    async readQuarantine(path) {
      const r = await sb.storage.from(BUCKET).download(path);
      if (r.error) {
        // storage-js: a missing object is statusCode "404" in the body, on HTTP 400 (older) or 404 (newer).
        const e = r.error as { status?: number; statusCode?: string };
        if (e.status === 404 || String(e.statusCode) === "404") return null;
        throw new StoreError(r.error.message);
      }
      if (!r.data) return null;
      return new Uint8Array(await r.data.arrayBuffer());
    },

    async removeQuarantine(path) {
      try {
        const r = await sb.storage.from(BUCKET).remove([path]);
        if (r.error) console.error("[signroom] quarantine cleanup failed");
      } catch {
        console.error("[signroom] quarantine cleanup failed");
      }
    },

    async sweepUploads(workspaceId, before) {
      const r = await sb.from("sr_uploads").select("path").eq("workspace_id", workspaceId).lt("created_at", before);
      const paths = ((must(r) as Row[] | null) ?? []).map((x) => x.path as string);
      if (!paths.length) return;
      const rm = await sb.storage.from(BUCKET).remove(paths);
      if (rm.error) {
        console.error("[signroom] quarantine cleanup failed");
        return;
      }
      const del = await sb.from("sr_uploads").delete().eq("workspace_id", workspaceId).lt("created_at", before);
      if (del.error) throw new StoreError(del.error.message);
    },
  };
}
