import { createHash, randomUUID } from "node:crypto";
import { AppError, StoreError } from "./errors.js";
import { orgRoleOf, type OrgRole } from "./context.js";
import { TEMPLATE_FILE_LIMIT, UPLOAD_TICKET_MS, type CrmCompany, type StoredAgreement, type Store } from "./store.js";
import type {
  Agreement,
  AgreementTemplate,
  BillingToken,
  Client,
  Delivery,
  GuestSession,
  Invoice,
  InvoiceEvent,
  Job,
  Payment,
  SignSession,
  SignToken,
  TemplateFile,
  UploadTicket,
  Workspace,
} from "./shared/types.js";

/**
 * An in-memory Store for tests. It enforces the same rules as the database:
 * a stale revision changes nothing (null / false), an issued invoice is frozen
 * (only status, sentAt and an empty invoiceHash may move), payments are
 * append-only except the receipt hash going from empty to a value, and each
 * workspace's numbers and receipt numbers are unique. Agreements follow the
 * sr_agreements_guard trigger: append-only events, a once-only sender-signed
 * hash, and a sent or finished agreement that only moves through the allowed
 * fields (same sentences as the database).
 */
export function fakeStore(): Store & {
  dump(): unknown;
  putQuarantine(path: string, bytes: Uint8Array): void;
  quarantinePaths(): string[];
  jobs(): Job[];
  signSessions(): SignSession[];
  blobPaths(): string[];
  evidenceKeys(): Map<string, string>;
  /** Test helper: a TaskCalendar workspace inside an organisation (made if new). `ownerId` is the organisation's owner_id. */
  seedWorkspace(w: { id: string; organizationId: string; name?: string; ownerId?: string }): void;
  /** Test helper: sets (or replaces) a person's entry in the members list of the organisation that owns the workspace. */
  setOrgMember(workspaceId: string, userId: string, role: OrgRole, status?: string): void;
  /** Test helper: an organisation admin ("Owner") or member ("Member") of the workspace's organisation. */
  addMember(workspaceId: string, userId: string, role: "Owner" | "Member"): void;
  /** Test helpers: what crm_companies, crm_contacts and crm_deals hold. Seeding an id again replaces that row. */
  seedCompany(c: { id: string; workspaceId: string | null; organizationId?: string; name: string; email?: string; address?: string; city?: string; state?: string; postalCode?: string; country?: string }): void;
  seedContact(c: { companyId: string; firstName: string; lastName?: string; email?: string; created?: string }): void;
  seedDeal(d: { id: string; workspaceId: string | null; companyId?: string | null }): void;
} {
  const workspaces = new Map<string, Workspace>();
  /** TaskCalendar's own tables: workspaces, organizations (owner_id and the members list) and the CRM. */
  const tcWorkspaces = new Map<string, { id: string; organizationId: string; name: string }>();
  const orgs = new Map<string, { owner_id: string | null; members: { userId: string; role: string; status?: string }[] }>();
  const companies = new Map<string, { workspaceId: string | null; row: Omit<CrmCompany, "contacts"> }>();
  const contacts: { companyId: string; name: string; email: string; created: string }[] = [];
  const deals = new Map<string, { workspaceId: string | null; companyId: string | null }>();
  const DEAL_RULE = "The linked deal cannot change.";
  const seq = new Map<string, number>();
  const clients = new Map<string, Client>();
  const invoices = new Map<string, Omit<Invoice, "payments" | "events">>();
  const payments = new Map<string, Payment & { invoiceId: string; workspaceId: string }>();
  const events: (InvoiceEvent & { invoiceId: string })[] = [];
  const tokens = new Map<string, BillingToken>();
  const sessions = new Map<string, GuestSession>();
  const deliveries = new Map<string, Delivery>();
  const blobs = new Map<string, Uint8Array>();
  /** Oldest first; a re-added hash moves to the end. */
  const templateFiles: (TemplateFile & { sizeBytes: number; scanEngine: string })[] = [];
  const agreements = new Map<string, StoredAgreement>();
  const agreementOrder = new Map<string, number>();
  const agreementTemplates: AgreementTemplate[] = [];
  const signTokens = new Map<string, SignToken>();
  const signSessions = new Map<string, SignSession>();
  const jobs = new Map<string, Job>();
  /** When each job last changed (epoch ms), for purgeJobs. */
  const jobUpdated = new Map<string, number>();
  const evidenceKeys = new Map<string, string>();
  const uploads = new Map<string, UploadTicket>();
  const quarantine = new Map<string, Uint8Array>();
  const now = () => new Date().toISOString();
  const clone = <T>(v: T): T => structuredClone(v);
  const DAY_MS = 86_400_000;
  const HOUR_MS = 3_600_000;

  const assemble = (i: Omit<Invoice, "payments" | "events">): Invoice =>
    clone({
      ...i,
      payments: [...payments.values()]
        .filter((p) => p.invoiceId === i.id)
        .map(({ invoiceId: _i, workspaceId: _w, ...p }) => p),
      events: events.filter((e) => e.invoiceId === i.id).map(({ invoiceId: _i, ...e }) => e),
    });

  const FREE_AFTER_DRAFT = new Set(["status", "sentAt", "revision", "updated", "invoiceHash"]);
  function applyPatch(inv: Omit<Invoice, "payments" | "events">, patch: Partial<Invoice>) {
    const changes = Object.entries(patch).filter(
      ([k, v]) => v !== undefined && !["id", "workspaceId", "payments", "events", "revision", "created", "updated"].includes(k),
    );
    // As the database: the deal link is set at insert and never moves, even on a draft.
    if (Object.prototype.hasOwnProperty.call(patch, "dealId") && (patch.dealId ?? null) !== (inv.dealId ?? null)) throw new StoreError(DEAL_RULE);
    if (inv.status !== "Draft") {
      for (const [k, v] of changes) {
        if (k === "invoiceHash") {
          if (inv.invoiceHash && inv.invoiceHash !== v) throw new AppError("An issued invoice cannot be changed.");
        } else if (!FREE_AFTER_DRAFT.has(k) && JSON.stringify((inv as Record<string, unknown>)[k]) !== JSON.stringify(v)) {
          throw new AppError("An issued invoice cannot be changed.");
        }
      }
    }
    Object.assign(inv, Object.fromEntries(changes));
  }

  function addPayment(inv: { id: string; workspaceId: string }, p: Payment) {
    if (p.amountMinor <= 0) throw new StoreError("Payment amount must be above zero.");
    for (const q of payments.values())
      if (q.workspaceId === inv.workspaceId && q.receiptNumber === p.receiptNumber)
        throw new StoreError("Receipt number already used.");
    payments.set(p.id, { ...clone(p), invoiceId: inv.id, workspaceId: inv.workspaceId });
  }

  const SENT_FREE = new Set([
    "status", "sentAt", "completedAt", "lastReminderAt", "participants", "senderReleasePending", "senderSignedHash",
    "archivedAt", "trashedAt", "legalHold", "events", "finalSnapshot", "artifacts",
  ]);
  const FINISHED_FREE = new Set(["archivedAt", "trashedAt", "legalHold", "events", "exportedAt", "deletionAt"]);
  const BLANKABLE = ["senderId", "documentHash", "senderSignedHash", "deadline", "sendKey", "templateVersionId", "archivedAt", "trashedAt", "sentAt", "completedAt", "lastReminderAt", "exportedAt", "deletionAt", "linkOrigin"];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  const bump = (inv: Omit<Invoice, "payments" | "events">) => {
    inv.revision += 1;
    inv.updated = now();
  };

  return {
    dump: () => clone({ workspaces: [...workspaces.values()], clients: [...clients.values()], invoices: [...invoices.values()].map(assemble), tokens: [...tokens.values()], sessions: [...sessions.values()], deliveries: [...deliveries.values()] }),

    async workspaceAccess(workspaceId, userId) {
      const w = tcWorkspaces.get(workspaceId.toLowerCase());
      const org = w && orgs.get(w.organizationId);
      const role = org ? orgRoleOf(org, userId) : null;
      return w && role ? { workspaceId: w.id, name: w.name, role } : null;
    },
    async ensureWorkspace(workspaceId, name, userId) {
      const existing = workspaces.get(workspaceId);
      if (existing) return clone(existing);
      const w: Workspace = { id: workspaceId, owner: userId, name, replyTo: "", retentionDays: 2555, suspended: false, created: now() };
      workspaces.set(w.id, w);
      return clone(w);
    },

    async getWorkspace(id) {
      const w = workspaces.get(id);
      return w ? clone(w) : null;
    },
    async updateWorkspace(id, patch) {
      const w = workspaces.get(id);
      if (!w) throw new AppError("Workspace not found.", 404);
      Object.assign(w, clone(patch), { id: w.id, owner: w.owner });
      return clone(w);
    },

    async listClients(workspaceId, includeArchived) {
      return [...clients.values()].filter((c) => c.workspaceId === workspaceId && (includeArchived || !c.archived)).map(clone);
    },
    async getClient(workspaceId, id) {
      const c = clients.get(id.toLowerCase());
      return c && c.workspaceId === workspaceId ? clone(c) : null;
    },
    async insertClient(c) {
      // unique (workspace, CRM company): the row that is already there is returned.
      if (c.crmCompanyId)
        for (const x of clients.values()) if (x.workspaceId === c.workspaceId && x.crmCompanyId === c.crmCompanyId) return clone(x);
      const out: Client = { ...clone(c), crmCompanyId: c.crmCompanyId ?? null, id: randomUUID(), created: now() };
      clients.set(out.id, out);
      return clone(out);
    },
    async updateClient(workspaceId, id, patch) {
      const c = clients.get(id);
      if (!c || c.workspaceId !== workspaceId) throw new AppError("Client not found.", 404);
      Object.assign(c, clone(patch), { id: c.id, workspaceId: c.workspaceId, crmCompanyId: c.crmCompanyId ?? null });
      return clone(c);
    },
    async getClientByCompany(workspaceId, companyId) {
      for (const c of clients.values()) if (c.workspaceId === workspaceId && c.crmCompanyId === companyId) return clone(c);
      return null;
    },
    async clientHasDocuments(workspaceId, clientId) {
      if ([...invoices.values()].some((i) => i.workspaceId === workspaceId && i.clientId === clientId && i.status !== "Draft")) return true;
      return [...agreements.values()].some((a) => a.workspaceId === workspaceId && a.clientId === clientId && a.status !== "Draft");
    },
    async crmCompany(workspaceId, companyId) {
      const c = companies.get(companyId);
      if (!c || c.workspaceId !== workspaceId) return null;
      const mine = contacts
        .filter((x) => x.companyId === companyId && x.email)
        .sort((a, b) => a.created.localeCompare(b.created))
        .map(({ name, email }) => ({ name, email }));
      return clone({ ...c.row, contacts: mine });
    },
    async crmDeal(workspaceId, dealId) {
      const d = deals.get(dealId);
      return d && d.workspaceId === workspaceId ? { id: dealId, companyId: d.companyId } : null;
    },

    async setClientAccount(workspaceId, clientId, revision, account) {
      const c = clients.get(clientId);
      if (!c || c.workspaceId !== workspaceId || c.archived || (c.account?.revision ?? 0) !== revision) return null;
      c.account = clone(account);
      return clone(c.account);
    },

    async listInvoices(workspaceId, filter = {}) {
      return [...invoices.values()]
        .filter((i) => i.workspaceId === workspaceId)
        .filter((i) => filter.clientId === undefined || i.clientId === filter.clientId)
        .filter((i) => filter.dealId === undefined || i.dealId === filter.dealId)
        .map(assemble)
        .reverse();
    },
    async getInvoice(workspaceId, id) {
      const i = invoices.get(id);
      return i && i.workspaceId === workspaceId ? assemble(i) : null;
    },
    async takeInvoiceNumber(workspaceId, year) {
      if (!workspaces.has(workspaceId)) throw new StoreError("Workspace not found.");
      const n = seq.get(workspaceId) ?? 1;
      seq.set(workspaceId, n + 1);
      return `INV-${year}-${String(n).padStart(5, "0")}`;
    },
    async insertInvoice(i, event) {
      if (i.number)
        for (const x of invoices.values())
          if (x.workspaceId === i.workspaceId && x.number === i.number) throw new StoreError("Invoice number already used.");
      const t = now();
      const row = { ...clone(i), dealId: i.dealId || null, id: randomUUID(), revision: 1, created: t, updated: t };
      invoices.set(row.id, row);
      events.push({ ...clone(event), invoiceId: row.id });
      return assemble(row);
    },
    async updateDraft(workspaceId, id, revision, patch, event) {
      const inv = invoices.get(id);
      if (!inv || inv.workspaceId !== workspaceId || inv.revision !== revision || inv.status !== "Draft") return null;
      applyPatch(inv, { ...clone(patch), status: undefined });
      bump(inv);
      events.push({ ...clone(event), invoiceId: id });
      return assemble(inv);
    },
    async issueInvoice(id, revision, patch, payment, evs) {
      const inv = invoices.get(id);
      if (!inv || inv.revision !== revision) return false;
      // Validate everything first so a refusal writes nothing, as in the transaction.
      const draftCopy = { ...inv };
      applyPatch(draftCopy, clone(patch));
      if (patch.number)
        for (const x of invoices.values())
          if (x.id !== id && x.workspaceId === inv.workspaceId && x.number === patch.number)
            throw new StoreError("Invoice number already used.");
      if (payment) {
        if (payment.amountMinor <= 0) throw new StoreError("Payment amount must be above zero.");
        for (const q of payments.values())
          if (q.workspaceId === inv.workspaceId && q.receiptNumber === payment.receiptNumber)
            throw new StoreError("Receipt number already used.");
      }
      Object.assign(inv, draftCopy);
      bump(inv);
      if (payment) addPayment(inv, payment);
      for (const e of evs) events.push({ ...clone(e), invoiceId: id });
      return true;
    },
    async recordPayment(id, revision, payment, status, event) {
      const inv = invoices.get(id);
      if (!inv || inv.revision !== revision) return false;
      addPayment(inv, payment);
      applyPatch(inv, { status });
      bump(inv);
      events.push({ ...clone(event), invoiceId: id });
      return true;
    },
    async setInvoiceState(workspaceId, id, revision, patch, event) {
      const inv = invoices.get(id);
      if (!inv || inv.workspaceId !== workspaceId || inv.revision !== revision) return null;
      applyPatch(inv, clone(patch));
      bump(inv);
      events.push({ ...clone(event), invoiceId: id });
      return assemble(inv);
    },
    async setReceiptHash(paymentId, hash) {
      const p = payments.get(paymentId);
      if (!p || p.receiptHash) return false;
      p.receiptHash = hash;
      return true;
    },
    async setInvoiceHash(invoiceId, hash) {
      const inv = invoices.get(invoiceId);
      if (!inv || inv.invoiceHash) return false;
      inv.invoiceHash = hash;
      return true;
    },

    async insertToken(t) {
      const out: BillingToken = { ...clone(t), id: randomUUID() };
      for (const x of tokens.values()) if (x.digest === out.digest) throw new StoreError("Duplicate token.");
      tokens.set(out.id, out);
      return clone(out);
    },
    async findToken(digest) {
      for (const t of tokens.values()) if (t.digest === digest) return clone(t);
      return null;
    },
    async getToken(id) {
      const t = tokens.get(id);
      return t ? clone(t) : null;
    },
    async updateTokenIf(id, expected, patch) {
      const t = tokens.get(id);
      if (!t || t.attempts !== expected.attempts || t.codeSends !== expected.codeSends) return false;
      Object.assign(t, clone(patch), { id: t.id });
      return true;
    },
    async updateToken(id, patch) {
      const t = tokens.get(id);
      if (t) Object.assign(t, clone(patch), { id: t.id });
    },
    async revokeInvoiceTokens(invoiceId) {
      for (const t of tokens.values()) if (t.invoiceId === invoiceId) t.revoked = true;
    },
    async insertSession(s) {
      sessions.set(s.digest, clone(s));
    },
    async findSession(digest) {
      const s = sessions.get(digest);
      return s ? clone(s) : null;
    },

    async insertDelivery(d) {
      const out: Delivery = { ...clone(d), id: randomUUID(), created: now() };
      deliveries.set(out.id, out);
      return clone(out);
    },
    async finishDelivery(id, status, error) {
      const d = deliveries.get(id);
      if (!d) return;
      d.status = status;
      if (error) d.error = error;
      else delete d.error;
    },
    async holdJobDelivery(jobId, error) {
      let found = false;
      for (const d of deliveries.values())
        if (d.jobId === jobId) {
          d.status = "failed";
          d.error = error;
          found = true;
        }
      return found;
    },
    async listDeliveries(workspaceId, limit) {
      return [...deliveries.values()].filter((d) => d.workspaceId === workspaceId).reverse().slice(0, limit).map(clone);
    },

    async listAgreements(workspaceId, senderId, filter = {}) {
      return [...agreements.values()]
        .filter((a) => a.workspaceId === workspaceId && (senderId === null || a.senderId === senderId))
        .filter((a) => filter.clientId === undefined || a.clientId === filter.clientId)
        .filter((a) => filter.dealId === undefined || a.dealId === filter.dealId)
        .sort((a, b) => b.updated.localeCompare(a.updated) || agreementOrder.get(b.id)! - agreementOrder.get(a.id)!)
        .map((a) => {
          const { content: _c, events: _e, branding: _b, frozen: _f, fields: _fl, rowVersion: _rv, ...summary } = clone(a);
          return summary;
        });
    },
    async getAgreement(workspaceId, id) {
      const a = agreements.get(id);
      return a && a.workspaceId === workspaceId ? clone(a) : null;
    },
    async insertAgreement(a) {
      const t = now();
      const row: StoredAgreement = { ...clone(a), dealId: a.dealId || null, id: randomUUID(), created: t, updated: t, rowVersion: 1 };
      for (const k of BLANKABLE) if ((row as Record<string, unknown>)[k] === "" && k !== "deadline" && k !== "senderId") delete (row as Record<string, unknown>)[k];
      agreements.set(row.id, row);
      agreementOrder.set(row.id, agreementOrder.size);
      return clone(row);
    },
    async updateAgreement(workspaceId, id, rowVersion, patch) {
      const cur = agreements.get(id);
      if (!cur || cur.workspaceId !== workspaceId || cur.rowVersion !== rowVersion) return null;
      const changes = Object.entries(clone(patch)).filter(([, v]) => v !== undefined);
      const next: Record<string, unknown> = { ...cur };
      for (const [k, v] of changes) {
        if (v === "" && BLANKABLE.includes(k)) {
          if (k === "deadline" || k === "senderId") next[k] = "";
          else delete next[k];
        } else next[k] = v;
      }
      // Same checks, same order, same sentences as sr_agreements_guard.
      if (Object.prototype.hasOwnProperty.call(patch, "dealId") && ((patch as { dealId?: unknown }).dealId ?? null) !== (cur.dealId ?? null)) throw new StoreError(DEAL_RULE);
      const oldEvents = cur.events ?? [];
      const newEvents = (next.events as Agreement["events"]) ?? [];
      if (newEvents.length < oldEvents.length || oldEvents.some((e, i) => !same(e, newEvents[i])))
        throw new StoreError("Evidence history is append-only.");
      if (cur.senderSignedHash && next.senderSignedHash !== cur.senderSignedHash)
        throw new StoreError("Sender-signed document is immutable.");
      if (cur.artifacts && !same(next.artifacts, cur.artifacts)) throw new StoreError("Completed artifacts are immutable.");
      if (cur.finalSnapshot && !same(next.finalSnapshot, cur.finalSnapshot)) throw new StoreError("The final evidence snapshot is immutable.");
      if (cur.status !== "Draft") {
        const free = cur.status === "Awaiting signatures" || cur.status === "Finalising" ? SENT_FREE : FINISHED_FREE;
        for (const k of new Set([...Object.keys(next), ...Object.keys(cur)]))
          if (!free.has(k) && k !== "rowVersion" && k !== "updated" && !same(next[k], (cur as Record<string, unknown>)[k]))
            throw new StoreError("Sent and finished agreements cannot change.");
      }
      Object.assign(cur, next, { id: cur.id, workspaceId: cur.workspaceId, rowVersion: cur.rowVersion + 1, updated: now() });
      for (const k of BLANKABLE) if (!(k in next)) delete (cur as Record<string, unknown>)[k];
      return clone(cur);
    },
    async countDrafts(workspaceId) {
      return [...agreements.values()].filter((a) => a.workspaceId === workspaceId && a.status === "Draft" && !a.trashedAt).length;
    },
    async listAgreementTemplates(workspaceId) {
      return agreementTemplates
        .filter((t) => t.workspaceId === workspaceId)
        .map((t) => ({ id: t.id, name: t.name, type: t.type, version: t.version, created: t.created }))
        .reverse();
    },
    async getAgreementTemplate(workspaceId, id) {
      const t = agreementTemplates.find((x) => x.id === id && x.workspaceId === workspaceId);
      return t ? clone(t) : null;
    },
    async insertAgreementTemplate(t) {
      const top = Math.max(0, ...agreementTemplates.filter((x) => x.workspaceId === t.workspaceId && x.name === t.name).map((x) => x.version));
      const out: AgreementTemplate = { ...clone(t), id: randomUUID(), version: top + 1, created: now() };
      agreementTemplates.push(out);
      return clone(out);
    },
    async insertSignToken(t) {
      const out: SignToken = { ...clone(t), id: randomUUID(), attempts: 0, codeSends: 0 };
      for (const x of signTokens.values()) if (x.digest === out.digest) throw new StoreError("Duplicate token.");
      signTokens.set(out.id, out);
      return clone(out);
    },
    async revokeSignTokens(agreementId, participantId, purpose) {
      for (const t of signTokens.values())
        if (t.agreementId === agreementId && (participantId === undefined || t.participantId === participantId) && (purpose === undefined || t.purpose === purpose))
          t.revoked = true;
    },
    async findSignToken(digest) {
      for (const t of signTokens.values()) if (t.digest === digest) return clone(t);
      return null;
    },
    async getSignToken(id) {
      const t = signTokens.get(id);
      return t ? clone(t) : null;
    },
    async updateSignTokenIf(id, expected, patch) {
      const t = signTokens.get(id);
      if (!t || t.attempts !== expected.attempts || t.codeSends !== expected.codeSends) return false;
      Object.assign(t, clone(patch), { id: t.id });
      return true;
    },
    async updateSignToken(id, patch) {
      const t = signTokens.get(id);
      if (t) Object.assign(t, clone(patch), { id: t.id });
    },
    async insertSignSession(s) {
      signSessions.set(s.digest, clone(s));
    },
    async findSignSession(digest) {
      const s = signSessions.get(digest);
      return s ? clone(s) : null;
    },
    async deleteSignSessions(before) {
      for (const [d, s] of [...signSessions]) if (s.expires < before) signSessions.delete(d);
    },

    async insertJob(j) {
      for (const x of jobs.values()) if (x.dedupe === j.dedupe) return clone(x);
      const out: Job = {
        id: randomUUID(),
        workspaceId: j.workspaceId,
        ...(j.agreementId !== undefined ? { agreementId: j.agreementId } : {}),
        ...(j.participantId !== undefined ? { participantId: j.participantId } : {}),
        kind: j.kind,
        purpose: j.purpose,
        dedupe: j.dedupe,
        status: "queued",
        attempts: 0,
        available: j.available ?? Date.now(),
        payload: j.payload,
        manualReview: false,
        created: now(),
      };
      jobs.set(out.id, out);
      jobUpdated.set(out.id, Date.now());
      return clone(out);
    },
    async claimJobs(limit, leaseSeconds, ids) {
      const t = Date.now();
      const due = [...jobs.values()]
        .filter((j) => (j.status === "queued" && j.available <= t) || (j.status === "working" && (j.leaseUntil ?? 0) < t))
        .filter((j) => !ids || ids.includes(j.id))
        .sort((a, b) => a.available - b.available || a.created.localeCompare(b.created))
        .slice(0, limit);
      for (const j of due) {
        j.status = "working";
        j.attempts += 1;
        j.leaseUntil = t + leaseSeconds * 1000;
        jobUpdated.set(j.id, t);
      }
      return due.map(clone);
    },
    async getJob(id) {
      const j = jobs.get(id);
      return j ? clone(j) : null;
    },
    async updateJob(id, patch) {
      const j = jobs.get(id);
      if (!j) return;
      const { error, ...rest } = clone(patch);
      Object.assign(j, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      if (error !== undefined) {
        if (error === "") delete j.error;
        else j.error = error;
      }
      jobUpdated.set(id, Date.now());
    },
    async requeueJob(id, from, opts = {}) {
      const j = jobs.get(id);
      if (!j || j.status !== from) return false;
      j.status = "queued";
      j.available = Date.now();
      delete j.error;
      if (opts.resetAttempts) j.attempts = 0;
      jobUpdated.set(id, Date.now());
      return true;
    },
    async markLiveAttempt(id) {
      const j = jobs.get(id);
      if (!j || j.liveAttemptedAt) return false;
      j.liveAttemptedAt = now();
      j.manualReview = true;
      jobUpdated.set(id, Date.now());
      return true;
    },
    async clearJobPayloads(agreementId, exceptId) {
      for (const j of jobs.values())
        if (j.agreementId === agreementId && j.id !== exceptId) {
          j.payload = "";
          if (j.status === "queued") j.status = "suppressed";
          jobUpdated.set(j.id, Date.now());
        }
    },
    async purgeJobs(before) {
      const cutoff = Date.parse(before);
      for (const [id, j] of [...jobs]) if ((j.status === "done" || j.status === "suppressed") && (jobUpdated.get(id) ?? 0) < cutoff) jobs.delete(id);
    },

    async getAgreementById(id) {
      const a = agreements.get(id);
      return a ? clone(a) : null;
    },
    // The lists follow sr_agreements_due, sr_deletions_due, sr_finalising_stranded and sr_completion_mail_refused.
    async listDueAgreements(limit) {
      const t = Date.now();
      const reminderAt = (a: StoredAgreement) =>
        !a.senderReleasePending && a.reminderDays > 0 ? Date.parse(a.lastReminderAt || a.sentAt || "") + a.reminderDays * DAY_MS : NaN;
      const deadlineAt = (a: StoredAgreement) => (a.deadline ? Date.parse(a.deadline + "T00:00:00Z") + DAY_MS : NaN);
      const noticeQueued = (a: StoredAgreement) => a.events.some((e) => e.type === "Expiry notification queued");
      const dueAt = (a: StoredAgreement) =>
        Math.min(...[a.status === "Expired" ? Date.parse(a.updated) : NaN, deadlineAt(a), reminderAt(a)].filter((x) => !Number.isNaN(x)));
      return [...agreements.values()]
        .filter(
          (a) =>
            (a.status === "Awaiting signatures" && (deadlineAt(a) <= t || reminderAt(a) < t)) || (a.status === "Expired" && !noticeQueued(a)),
        )
        .sort((a, b) => dueAt(a) - dueAt(b) || agreementOrder.get(a.id)! - agreementOrder.get(b.id)!)
        .slice(0, limit)
        .map(clone);
    },
    async listDeletionsDue(limit) {
      const t = Date.now();
      const busy = (id: string) => [...jobs.values()].some((j) => j.dedupe === "delete:" + id && j.status !== "suppressed");
      return [...agreements.values()]
        .filter(
          (a) =>
            a.deletionAt &&
            Date.parse(a.deletionAt) <= t &&
            !a.legalHold &&
            a.status !== "Awaiting signatures" &&
            a.status !== "Finalising" &&
            !busy(a.id),
        )
        .sort((a, b) => Date.parse(a.deletionAt!) - Date.parse(b.deletionAt!) || agreementOrder.get(a.id)! - agreementOrder.get(b.id)!)
        .slice(0, limit)
        .map(clone);
    },
    async listStrandedFinalising(limit) {
      const t = Date.now();
      const wait = (j: Job) => Math.min(24 * HOUR_MS, HOUR_MS * 2 ** Math.max(j.attempts - 5, 0));
      const covered = (id: string) =>
        [...jobs.values()].some((j) => j.dedupe === "finalise:" + id && (j.status !== "failed" || (jobUpdated.get(j.id) ?? 0) > t - wait(j)));
      return [...agreements.values()]
        .filter((a) => a.status === "Finalising" && !covered(a.id))
        .sort((a, b) => a.updated.localeCompare(b.updated) || agreementOrder.get(a.id)! - agreementOrder.get(b.id)!)
        .slice(0, limit)
        .map(clone);
    },
    async listRefusedCompletionMail(limit) {
      const t = Date.now();
      return [...jobs.values()]
        .filter(
          (j) =>
            j.kind === "mail" &&
            j.purpose === "completion" &&
            j.status === "failed" &&
            !j.manualReview &&
            !j.liveAttemptedAt &&
            j.payload !== "" &&
            j.attempts < 12 &&
            (jobUpdated.get(j.id) ?? 0) <= t - DAY_MS,
        )
        .sort((a, b) => (jobUpdated.get(a.id) ?? 0) - (jobUpdated.get(b.id) ?? 0) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(clone);
    },
    async deleteAgreement(workspaceId, id) {
      const a = agreements.get(id);
      if (!a || a.workspaceId !== workspaceId) return false;
      if (!a.deletionAt || Date.parse(a.deletionAt) > Date.now() || a.legalHold || a.status === "Awaiting signatures" || a.status === "Finalising") return false;
      agreements.delete(id);
      for (const [k, t] of [...signTokens]) if (t.agreementId === id) signTokens.delete(k);
      for (const [k, s] of [...signSessions]) if (s.agreementId === id) signSessions.delete(k);
      for (const [k, d] of [...deliveries]) if (d.agreementId === id) deliveries.delete(k);
      for (const [k, u] of [...uploads]) if (u.agreementId === id) uploads.delete(k);
      return true;
    },
    async blobInUse(workspaceId, hash) {
      for (const a of agreements.values()) {
        if (a.workspaceId !== workspaceId) continue;
        if (a.documentHash === hash || a.senderSignedHash === hash || a.frozen?.sourceHash === hash) return true;
        if (a.artifacts && Object.values(a.artifacts).includes(hash)) return true;
      }
      if (agreementTemplates.some((t) => t.workspaceId === workspaceId && t.documentHash === hash)) return true;
      if ([...invoices.values()].some((i) => i.workspaceId === workspaceId && i.invoiceHash === hash)) return true;
      if ([...payments.values()].some((p) => p.workspaceId === workspaceId && p.receiptHash === hash)) return true;
      return templateFiles.some((f) => f.workspaceId === workspaceId && f.hash === hash);
    },
    async removeBlob(workspaceId, hash) {
      blobs.delete(`${workspaceId}/${hash}`);
    },
    async registerEvidenceKey(keyId, publicKeyPem) {
      const have = evidenceKeys.get(keyId);
      if (have === undefined) evidenceKeys.set(keyId, publicKeyPem);
      else if (have !== publicKeyPem) throw new StoreError(`Evidence key ${keyId} does not match its recorded public key.`);
    },
    jobs: () => [...jobs.values()].map(clone),
    signSessions: () => [...signSessions.values()].map(clone),
    blobPaths: () => [...blobs.keys()],
    evidenceKeys: () => new Map(evidenceKeys),
    async listSignTokens(agreementId) {
      return [...signTokens.values()].filter((t) => t.agreementId === agreementId).map(clone);
    },
    async listAgreementDeliveries(agreementId) {
      return [...deliveries.values()].filter((d) => d.agreementId === agreementId).map(clone);
    },
    async createUpload(workspaceId, agreementId) {
      const id = randomUUID();
      const ticket: UploadTicket = { id, workspaceId, agreementId, path: `${workspaceId}/quarantine/${id}.pdf`, created: now() };
      uploads.set(id, ticket);
      return { ...clone(ticket), token: `fake-token-${id}` };
    },
    async takeUpload(workspaceId, id) {
      const t = uploads.get(id);
      if (!t || t.workspaceId !== workspaceId || t.used || Date.now() - Date.parse(t.created) > UPLOAD_TICKET_MS) return null;
      t.used = now();
      return clone(t);
    },
    async readQuarantine(path) {
      const b = quarantine.get(path);
      return b ? new Uint8Array(b) : null;
    },
    async removeQuarantine(path) {
      quarantine.delete(path);
    },
    async sweepUploads(workspaceId, before) {
      for (const [id, t] of [...uploads]) {
        if (t.workspaceId !== workspaceId || t.created >= before) continue;
        quarantine.delete(t.path);
        uploads.delete(id);
      }
    },
    putQuarantine(path, bytes) {
      quarantine.set(path, new Uint8Array(bytes));
    },
    quarantinePaths() {
      return [...quarantine.keys()];
    },

    async putBlob(workspaceId, bytes) {
      const hash = createHash("sha256").update(bytes).digest("hex");
      blobs.set(`${workspaceId}/${hash}`, new Uint8Array(bytes));
      return hash;
    },
    async getBlob(workspaceId, hash) {
      const b = blobs.get(`${workspaceId}/${hash}`);
      if (!b) throw new StoreError("Blob not found.");
      return new Uint8Array(b);
    },
    async signedBlobUrl(workspaceId, hash, seconds, downloadName) {
      if (!blobs.has(`${workspaceId}/${hash}`)) throw new StoreError("Blob not found.");
      const q = new URLSearchParams({ token: "fake", expires: String(seconds), ...(downloadName ? { download: downloadName } : {}) });
      return `https://storage.test/signroom/${workspaceId}/${hash}?${q}`;
    },

    async listTemplateFiles(workspaceId) {
      return templateFiles.filter((t) => t.workspaceId === workspaceId).map(({ workspaceId: w, hash, name }) => ({ workspaceId: w, hash, name }));
    },
    async addTemplateFile(f) {
      const at = templateFiles.findIndex((t) => t.workspaceId === f.workspaceId && t.hash === f.hash);
      if (at >= 0) templateFiles.splice(at, 1);
      templateFiles.push(clone(f));
      const mine = templateFiles.filter((t) => t.workspaceId === f.workspaceId);
      for (const old of mine.slice(0, Math.max(0, mine.length - TEMPLATE_FILE_LIMIT))) templateFiles.splice(templateFiles.indexOf(old), 1);
    },

    seedWorkspace(w) {
      tcWorkspaces.set(w.id.toLowerCase(), { id: w.id.toLowerCase(), organizationId: w.organizationId, name: w.name ?? "Workspace" });
      const org = orgs.get(w.organizationId) ?? { owner_id: null, members: [] };
      if (w.ownerId !== undefined) org.owner_id = w.ownerId;
      orgs.set(w.organizationId, org);
    },
    setOrgMember(workspaceId, userId, role, status = "active") {
      const w = tcWorkspaces.get(workspaceId.toLowerCase());
      const org = w && orgs.get(w.organizationId);
      if (!org) throw new Error("Seed the workspace first.");
      org.members = org.members.filter((m) => m.userId !== userId);
      org.members.push({ userId, role, status });
    },
    addMember(workspaceId, userId, role) {
      this.setOrgMember(workspaceId, userId, role === "Owner" ? "admin" : "member");
    },
    seedCompany(c) {
      companies.set(c.id, {
        workspaceId: c.workspaceId,
        row: { id: c.id, name: c.name, email: c.email ?? "", address: c.address ?? "", city: c.city ?? "", state: c.state ?? "", postalCode: c.postalCode ?? "", country: c.country ?? "" },
      });
    },
    seedContact(c) {
      contacts.push({ companyId: c.companyId, name: [c.firstName, c.lastName ?? ""].map((v) => v.trim()).filter(Boolean).join(" "), email: (c.email ?? "").trim(), created: c.created ?? now() });
    },
    seedDeal(d) {
      deals.set(d.id, { workspaceId: d.workspaceId, companyId: d.companyId ?? null });
    },
  };
}
