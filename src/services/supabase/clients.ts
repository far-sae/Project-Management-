import { supabase } from "./config";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ClientType = "customer" | "prospect" | "partner" | "vendor" | "other";
export type ClientStatus = "active" | "inactive" | "archived";
export type ClientNoteKind = "note" | "call" | "meeting" | "email" | "task";

export interface Client {
  clientId: string;
  organizationId: string;
  name: string;
  legalName?: string | null;
  industry?: string | null;
  type: ClientType;
  status: ClientStatus;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  annualRevenue?: number | null;
  employeeCount?: number | null;
  rating?: string | null;
  source?: string | null;
  description?: string | null;
  tags: string[];
  accountOwnerId?: string | null;
  accountOwnerName?: string | null;
  customFields: Record<string, unknown>;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientContact {
  contactId: string;
  clientId: string;
  organizationId: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  title?: string | null;
  department?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  isPrimary: boolean;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientNote {
  noteId: string;
  clientId: string;
  organizationId: string;
  kind: ClientNoteKind;
  subject?: string | null;
  body?: string | null;
  occurredAt: Date;
  authorId?: string | null;
  authorName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientAttachment {
  attachmentId: string;
  clientId: string;
  organizationId: string;
  fileName: string;
  filePath: string;
  fileUrl?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  uploadedBy?: string | null;
  uploadedByName?: string | null;
  createdAt: Date;
}

export interface CreateClientInput {
  name: string;
  legalName?: string | null;
  industry?: string | null;
  type?: ClientType;
  status?: ClientStatus;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  annualRevenue?: number | null;
  employeeCount?: number | null;
  rating?: string | null;
  source?: string | null;
  description?: string | null;
  tags?: string[];
  accountOwnerId?: string | null;
  accountOwnerName?: string | null;
  customFields?: Record<string, unknown>;
}

export type UpdateClientInput = Partial<CreateClientInput>;

export interface CreateContactInput {
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  department?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}

export type UpdateContactInput = Partial<CreateContactInput>;

export interface CreateNoteInput {
  kind?: ClientNoteKind;
  subject?: string | null;
  body?: string | null;
  occurredAt?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation — these are the hardening layer the UI relies on. Server-side
// CHECK constraints are the ultimate guard, but failing fast here gives users
// inline errors instead of an opaque Postgres rejection.
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^(https?:\/\/)?[\w.-]+(\.[a-zA-Z]{2,})+([\/?#].*)?$/;

export const isValidEmail = (email: string | null | undefined): boolean =>
  !email || EMAIL_RE.test(email.trim());

export const isValidWebsite = (url: string | null | undefined): boolean =>
  !url || URL_RE.test(url.trim());

/**
 * Strip non-printable C0/DEL control bytes and trim — keeps DB clean of
 * invisible junk that often slips in from copy/paste or pasted CSVs. We
 * preserve TAB (0x09), LF (0x0A) and CR (0x0D) so multi-line `description`
 * and `notes` fields keep their formatting.
 */
const sanitizeText = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  let out = "";
  const s = String(v);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const isCtrl =
      (code >= 0 && code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 127;
    if (!isCtrl) out += s[i];
  }
  out = out.trim();
  return out.length === 0 ? null : out;
};

const sanitizeTags = (tags: string[] | null | undefined): string[] => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = sanitizeText(raw);
    if (t) seen.add(t.slice(0, 50));
    if (seen.size >= 25) break;
  }
  return [...seen];
};

const validateClientInput = (input: CreateClientInput) => {
  if (!input.name || sanitizeText(input.name) === null) {
    throw new Error("Client name is required");
  }
  if (input.email && !isValidEmail(input.email)) {
    throw new Error("Invalid client email address");
  }
  if (input.website && !isValidWebsite(input.website)) {
    throw new Error("Invalid client website");
  }
  if (input.annualRevenue != null && input.annualRevenue < 0) {
    throw new Error("Annual revenue cannot be negative");
  }
  if (input.employeeCount != null && input.employeeCount < 0) {
    throw new Error("Employee count cannot be negative");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Mappers (snake_case → camelCase)
// ─────────────────────────────────────────────────────────────────────────────

const mapClient = (row: Record<string, unknown>): Client => ({
  clientId: row.client_id as string,
  organizationId: row.organization_id as string,
  name: row.name as string,
  legalName: (row.legal_name as string) ?? null,
  industry: (row.industry as string) ?? null,
  type: ((row.type as string) || "customer") as ClientType,
  status: ((row.status as string) || "active") as ClientStatus,
  website: (row.website as string) ?? null,
  email: (row.email as string) ?? null,
  phone: (row.phone as string) ?? null,
  addressLine1: (row.address_line1 as string) ?? null,
  addressLine2: (row.address_line2 as string) ?? null,
  city: (row.city as string) ?? null,
  state: (row.state as string) ?? null,
  postalCode: (row.postal_code as string) ?? null,
  country: (row.country as string) ?? null,
  annualRevenue: row.annual_revenue != null ? Number(row.annual_revenue) : null,
  employeeCount: row.employee_count != null ? Number(row.employee_count) : null,
  rating: (row.rating as string) ?? null,
  source: (row.source as string) ?? null,
  description: (row.description as string) ?? null,
  tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
  accountOwnerId: (row.account_owner_id as string) ?? null,
  accountOwnerName: (row.account_owner_name as string) ?? null,
  customFields:
    (row.custom_fields as Record<string, unknown>) ?? {},
  createdBy: (row.created_by as string) ?? null,
  createdByName: (row.created_by_name as string) ?? null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const mapContact = (row: Record<string, unknown>): ClientContact => ({
  contactId: row.contact_id as string,
  clientId: row.client_id as string,
  organizationId: row.organization_id as string,
  firstName: (row.first_name as string) ?? null,
  lastName: (row.last_name as string) ?? null,
  fullName: (row.full_name as string) ?? null,
  title: (row.title as string) ?? null,
  department: (row.department as string) ?? null,
  email: (row.email as string) ?? null,
  phone: (row.phone as string) ?? null,
  mobile: (row.mobile as string) ?? null,
  isPrimary: Boolean(row.is_primary),
  notes: (row.notes as string) ?? null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const mapNote = (row: Record<string, unknown>): ClientNote => ({
  noteId: row.note_id as string,
  clientId: row.client_id as string,
  organizationId: row.organization_id as string,
  kind: ((row.kind as string) || "note") as ClientNoteKind,
  subject: (row.subject as string) ?? null,
  body: (row.body as string) ?? null,
  occurredAt: new Date(row.occurred_at as string),
  authorId: (row.author_id as string) ?? null,
  authorName: (row.author_name as string) ?? null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const mapAttachment = (row: Record<string, unknown>): ClientAttachment => ({
  attachmentId: row.attachment_id as string,
  clientId: row.client_id as string,
  organizationId: row.organization_id as string,
  fileName: row.file_name as string,
  filePath: row.file_path as string,
  fileUrl: (row.file_url as string) ?? null,
  fileType: (row.file_type as string) ?? null,
  fileSize: row.file_size != null ? Number(row.file_size) : null,
  uploadedBy: (row.uploaded_by as string) ?? null,
  uploadedByName: (row.uploaded_by_name as string) ?? null,
  createdAt: new Date(row.created_at as string),
});

// ─────────────────────────────────────────────────────────────────────────────
// Local-org fallback (mirrors expenses.ts pattern). Lets the app run end-to-end
// without Supabase wired up so contributors can develop offline.
// ─────────────────────────────────────────────────────────────────────────────

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");

const STORE = {
  clients: (orgId: string) => `pm_clients_${orgId}`,
  contacts: (orgId: string) => `pm_client_contacts_${orgId}`,
  notes: (orgId: string) => `pm_client_notes_${orgId}`,
  attachments: (orgId: string) => `pm_client_attachments_${orgId}`,
};

const reviveClient = (c: Client): Client => ({
  ...c,
  createdAt: new Date(c.createdAt),
  updatedAt: new Date(c.updatedAt),
});
const reviveContact = (c: ClientContact): ClientContact => ({
  ...c,
  createdAt: new Date(c.createdAt),
  updatedAt: new Date(c.updatedAt),
});
const reviveNote = (n: ClientNote): ClientNote => ({
  ...n,
  occurredAt: new Date(n.occurredAt),
  createdAt: new Date(n.createdAt),
  updatedAt: new Date(n.updatedAt),
});
const reviveAttachment = (a: ClientAttachment): ClientAttachment => ({
  ...a,
  createdAt: new Date(a.createdAt),
});

const readLocal = <T>(key: string, revive: (x: T) => T): T[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return (JSON.parse(raw) as T[]).map(revive);
  } catch {
    return [];
  }
};
const writeLocal = <T>(key: string, value: T[]) =>
  localStorage.setItem(key, JSON.stringify(value));

// ─────────────────────────────────────────────────────────────────────────────
// Clients CRUD
// ─────────────────────────────────────────────────────────────────────────────

export const createClient = async (
  organizationId: string,
  userId: string,
  userName: string,
  input: CreateClientInput,
): Promise<Client> => {
  validateClientInput(input);

  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const client: Client = {
      clientId: crypto.randomUUID(),
      organizationId,
      name: sanitizeText(input.name)!,
      legalName: sanitizeText(input.legalName ?? null),
      industry: sanitizeText(input.industry ?? null),
      type: input.type ?? "customer",
      status: input.status ?? "active",
      website: sanitizeText(input.website ?? null),
      email: sanitizeText(input.email ?? null),
      phone: sanitizeText(input.phone ?? null),
      addressLine1: sanitizeText(input.addressLine1 ?? null),
      addressLine2: sanitizeText(input.addressLine2 ?? null),
      city: sanitizeText(input.city ?? null),
      state: sanitizeText(input.state ?? null),
      postalCode: sanitizeText(input.postalCode ?? null),
      country: sanitizeText(input.country ?? null),
      annualRevenue: input.annualRevenue ?? null,
      employeeCount: input.employeeCount ?? null,
      rating: sanitizeText(input.rating ?? null),
      source: sanitizeText(input.source ?? null),
      description: sanitizeText(input.description ?? null),
      tags: sanitizeTags(input.tags),
      accountOwnerId: input.accountOwnerId ?? userId,
      accountOwnerName: input.accountOwnerName ?? userName,
      customFields: input.customFields ?? {},
      createdBy: userId,
      createdByName: userName,
      createdAt: now,
      updatedAt: now,
    };
    const all = readLocal<Client>(STORE.clients(organizationId), reviveClient);
    writeLocal(STORE.clients(organizationId), [client, ...all]);
    return client;
  }

  const row = {
    organization_id: organizationId,
    name: sanitizeText(input.name)!,
    legal_name: sanitizeText(input.legalName ?? null),
    industry: sanitizeText(input.industry ?? null),
    type: input.type ?? "customer",
    status: input.status ?? "active",
    website: sanitizeText(input.website ?? null),
    email: sanitizeText(input.email ?? null),
    phone: sanitizeText(input.phone ?? null),
    address_line1: sanitizeText(input.addressLine1 ?? null),
    address_line2: sanitizeText(input.addressLine2 ?? null),
    city: sanitizeText(input.city ?? null),
    state: sanitizeText(input.state ?? null),
    postal_code: sanitizeText(input.postalCode ?? null),
    country: sanitizeText(input.country ?? null),
    annual_revenue: input.annualRevenue ?? null,
    employee_count: input.employeeCount ?? null,
    rating: sanitizeText(input.rating ?? null),
    source: sanitizeText(input.source ?? null),
    description: sanitizeText(input.description ?? null),
    tags: sanitizeTags(input.tags),
    account_owner_id: input.accountOwnerId ?? userId,
    account_owner_name: input.accountOwnerName ?? userName,
    custom_fields: input.customFields ?? {},
    created_by: userId,
    created_by_name: userName,
  };

  const { data, error } = await supabase
    .from("clients")
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create client:", error);
    throw error;
  }
  return mapClient(data);
};

export const updateClient = async (
  organizationId: string,
  clientId: string,
  input: UpdateClientInput,
): Promise<Client> => {
  if (input.email && !isValidEmail(input.email)) {
    throw new Error("Invalid client email address");
  }
  if (input.website && !isValidWebsite(input.website)) {
    throw new Error("Invalid client website");
  }

  if (isLocalOrg(organizationId)) {
    const all = readLocal<Client>(STORE.clients(organizationId), reviveClient);
    const idx = all.findIndex((c) => c.clientId === clientId);
    if (idx === -1) throw new Error("Client not found");
    const merged: Client = { ...all[idx] };
    const assign = <K extends keyof Client>(k: K, v: Client[K] | undefined) => {
      if (v !== undefined) merged[k] = v as Client[K];
    };
    assign("name", input.name ? sanitizeText(input.name) ?? all[idx].name : undefined);
    assign("legalName", input.legalName !== undefined ? sanitizeText(input.legalName) : undefined);
    assign("industry", input.industry !== undefined ? sanitizeText(input.industry) : undefined);
    assign("type", input.type);
    assign("status", input.status);
    assign("website", input.website !== undefined ? sanitizeText(input.website) : undefined);
    assign("email", input.email !== undefined ? sanitizeText(input.email) : undefined);
    assign("phone", input.phone !== undefined ? sanitizeText(input.phone) : undefined);
    assign("addressLine1", input.addressLine1 !== undefined ? sanitizeText(input.addressLine1) : undefined);
    assign("addressLine2", input.addressLine2 !== undefined ? sanitizeText(input.addressLine2) : undefined);
    assign("city", input.city !== undefined ? sanitizeText(input.city) : undefined);
    assign("state", input.state !== undefined ? sanitizeText(input.state) : undefined);
    assign("postalCode", input.postalCode !== undefined ? sanitizeText(input.postalCode) : undefined);
    assign("country", input.country !== undefined ? sanitizeText(input.country) : undefined);
    assign("annualRevenue", input.annualRevenue);
    assign("employeeCount", input.employeeCount);
    assign("rating", input.rating !== undefined ? sanitizeText(input.rating) : undefined);
    assign("source", input.source !== undefined ? sanitizeText(input.source) : undefined);
    assign("description", input.description !== undefined ? sanitizeText(input.description) : undefined);
    if (input.tags !== undefined) merged.tags = sanitizeTags(input.tags);
    assign("accountOwnerId", input.accountOwnerId);
    assign("accountOwnerName", input.accountOwnerName);
    if (input.customFields !== undefined) merged.customFields = input.customFields;
    merged.updatedAt = new Date();
    all[idx] = merged;
    writeLocal(STORE.clients(organizationId), all);
    return merged;
  }

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = sanitizeText(input.name);
  if (input.legalName !== undefined) update.legal_name = sanitizeText(input.legalName);
  if (input.industry !== undefined) update.industry = sanitizeText(input.industry);
  if (input.type !== undefined) update.type = input.type;
  if (input.status !== undefined) update.status = input.status;
  if (input.website !== undefined) update.website = sanitizeText(input.website);
  if (input.email !== undefined) update.email = sanitizeText(input.email);
  if (input.phone !== undefined) update.phone = sanitizeText(input.phone);
  if (input.addressLine1 !== undefined) update.address_line1 = sanitizeText(input.addressLine1);
  if (input.addressLine2 !== undefined) update.address_line2 = sanitizeText(input.addressLine2);
  if (input.city !== undefined) update.city = sanitizeText(input.city);
  if (input.state !== undefined) update.state = sanitizeText(input.state);
  if (input.postalCode !== undefined) update.postal_code = sanitizeText(input.postalCode);
  if (input.country !== undefined) update.country = sanitizeText(input.country);
  if (input.annualRevenue !== undefined) update.annual_revenue = input.annualRevenue;
  if (input.employeeCount !== undefined) update.employee_count = input.employeeCount;
  if (input.rating !== undefined) update.rating = sanitizeText(input.rating);
  if (input.source !== undefined) update.source = sanitizeText(input.source);
  if (input.description !== undefined) update.description = sanitizeText(input.description);
  if (input.tags !== undefined) update.tags = sanitizeTags(input.tags);
  if (input.accountOwnerId !== undefined) update.account_owner_id = input.accountOwnerId;
  if (input.accountOwnerName !== undefined) update.account_owner_name = input.accountOwnerName;
  if (input.customFields !== undefined) update.custom_fields = input.customFields;

  const { data, error } = await supabase
    .from("clients")
    .update(update)
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .select()
    .single();

  if (error) {
    logger.error("Failed to update client:", error);
    throw error;
  }
  return mapClient(data);
};

export const deleteClient = async (
  organizationId: string,
  clientId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    writeLocal(
      STORE.clients(organizationId),
      readLocal<Client>(STORE.clients(organizationId), reviveClient).filter(
        (c) => c.clientId !== clientId,
      ),
    );
    writeLocal(
      STORE.contacts(organizationId),
      readLocal<ClientContact>(STORE.contacts(organizationId), reviveContact).filter(
        (c) => c.clientId !== clientId,
      ),
    );
    writeLocal(
      STORE.notes(organizationId),
      readLocal<ClientNote>(STORE.notes(organizationId), reviveNote).filter(
        (n) => n.clientId !== clientId,
      ),
    );
    writeLocal(
      STORE.attachments(organizationId),
      readLocal<ClientAttachment>(
        STORE.attachments(organizationId),
        reviveAttachment,
      ).filter((a) => a.clientId !== clientId),
    );
    return;
  }
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("organization_id", organizationId)
    .eq("client_id", clientId);
  if (error) {
    logger.error("Failed to delete client:", error);
    throw error;
  }
};

export const getOrganizationClients = async (
  organizationId: string,
): Promise<Client[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal<Client>(STORE.clients(organizationId), reviveClient).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
  }
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) {
    logger.error("Failed to load clients:", error);
    return [];
  }
  return (data || []).map(mapClient);
};

export const subscribeToClients = (
  organizationId: string,
  callback: (clients: Client[]) => void,
): (() => void) => {
  getOrganizationClients(organizationId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};

  const channel = supabase
    .channel(
      `clients-${organizationId}-${Math.random().toString(36).slice(2, 9)}`,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "clients",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getOrganizationClients(organizationId).then(callback);
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Contacts
// ─────────────────────────────────────────────────────────────────────────────

export const getClientContacts = async (
  organizationId: string,
  clientId: string,
): Promise<ClientContact[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal<ClientContact>(STORE.contacts(organizationId), reviveContact)
      .filter((c) => c.clientId === clientId)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  }
  const { data, error } = await supabase
    .from("client_contacts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("Failed to load contacts:", error);
    return [];
  }
  return (data || []).map(mapContact);
};

export const createContact = async (
  organizationId: string,
  clientId: string,
  userId: string,
  input: CreateContactInput,
): Promise<ClientContact> => {
  if (input.email && !isValidEmail(input.email)) {
    throw new Error("Invalid contact email address");
  }
  const hasIdentity =
    sanitizeText(input.firstName) || sanitizeText(input.lastName) || sanitizeText(input.email);
  if (!hasIdentity) {
    throw new Error("Contact must have a name or email");
  }

  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const contact: ClientContact = {
      contactId: crypto.randomUUID(),
      clientId,
      organizationId,
      firstName: sanitizeText(input.firstName ?? null),
      lastName: sanitizeText(input.lastName ?? null),
      fullName: [sanitizeText(input.firstName), sanitizeText(input.lastName)]
        .filter(Boolean)
        .join(" ") || null,
      title: sanitizeText(input.title ?? null),
      department: sanitizeText(input.department ?? null),
      email: sanitizeText(input.email ?? null),
      phone: sanitizeText(input.phone ?? null),
      mobile: sanitizeText(input.mobile ?? null),
      isPrimary: Boolean(input.isPrimary),
      notes: sanitizeText(input.notes ?? null),
      createdAt: now,
      updatedAt: now,
    };
    const all = readLocal<ClientContact>(STORE.contacts(organizationId), reviveContact);
    if (contact.isPrimary) {
      // Demote any existing primary so we mirror the partial unique index.
      all.forEach((c) => {
        if (c.clientId === clientId) c.isPrimary = false;
      });
    }
    writeLocal(STORE.contacts(organizationId), [contact, ...all]);
    return contact;
  }

  // Atomically demote existing primary + insert (see migration 044_create_client_contact_atomic.sql).
  const { data, error } = await supabase
    .rpc("create_client_contact", {
      p_organization_id: organizationId,
      p_client_id: clientId,
      p_created_by: userId,
      p_first_name: sanitizeText(input.firstName ?? null),
      p_last_name: sanitizeText(input.lastName ?? null),
      p_title: sanitizeText(input.title ?? null),
      p_department: sanitizeText(input.department ?? null),
      p_email: sanitizeText(input.email ?? null),
      p_phone: sanitizeText(input.phone ?? null),
      p_mobile: sanitizeText(input.mobile ?? null),
      p_is_primary: Boolean(input.isPrimary),
      p_notes: sanitizeText(input.notes ?? null),
    })
    .single();

  if (error) {
    logger.error("Failed to create contact:", error);
    const code = (error as { code?: string }).code;
    const msg = String((error as { message?: string }).message ?? "");
    if (
      code === "23505" ||
      msg.includes("ux_client_contacts_primary") ||
      msg.toLowerCase().includes("duplicate key")
    ) {
      throw new Error(
        "This client already has a primary contact. Remove primary from the other contact or try again.",
      );
    }
    throw error;
  }
  return mapContact(data as Record<string, unknown>);
};

export const updateContact = async (
  organizationId: string,
  contactId: string,
  input: UpdateContactInput,
): Promise<ClientContact> => {
  if (input.email && !isValidEmail(input.email)) {
    throw new Error("Invalid contact email address");
  }

  if (isLocalOrg(organizationId)) {
    const all = readLocal<ClientContact>(STORE.contacts(organizationId), reviveContact);
    const idx = all.findIndex((c) => c.contactId === contactId);
    if (idx === -1) throw new Error("Contact not found");
    const target = all[idx];
    const merged: ClientContact = { ...target };
    if (input.firstName !== undefined) merged.firstName = sanitizeText(input.firstName);
    if (input.lastName !== undefined) merged.lastName = sanitizeText(input.lastName);
    if (input.title !== undefined) merged.title = sanitizeText(input.title);
    if (input.department !== undefined) merged.department = sanitizeText(input.department);
    if (input.email !== undefined) merged.email = sanitizeText(input.email);
    if (input.phone !== undefined) merged.phone = sanitizeText(input.phone);
    if (input.mobile !== undefined) merged.mobile = sanitizeText(input.mobile);
    if (input.notes !== undefined) merged.notes = sanitizeText(input.notes);
    if (input.isPrimary !== undefined) merged.isPrimary = Boolean(input.isPrimary);
    merged.fullName =
      [merged.firstName, merged.lastName].filter(Boolean).join(" ") || null;
    merged.updatedAt = new Date();
    if (merged.isPrimary) {
      all.forEach((c) => {
        if (c.clientId === merged.clientId && c.contactId !== contactId) {
          c.isPrimary = false;
        }
      });
    }
    all[idx] = merged;
    writeLocal(STORE.contacts(organizationId), all);
    return merged;
  }

  const update: Record<string, unknown> = {};
  if (input.firstName !== undefined) update.first_name = sanitizeText(input.firstName);
  if (input.lastName !== undefined) update.last_name = sanitizeText(input.lastName);
  if (input.title !== undefined) update.title = sanitizeText(input.title);
  if (input.department !== undefined) update.department = sanitizeText(input.department);
  if (input.email !== undefined) update.email = sanitizeText(input.email);
  if (input.phone !== undefined) update.phone = sanitizeText(input.phone);
  if (input.mobile !== undefined) update.mobile = sanitizeText(input.mobile);
  if (input.notes !== undefined) update.notes = sanitizeText(input.notes);

  if (input.isPrimary === true) {
    // Read the row to know which client to demote primaries on.
    const { data: existing } = await supabase
      .from("client_contacts")
      .select("client_id")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .single();
    if (existing?.client_id) {
      await supabase
        .from("client_contacts")
        .update({ is_primary: false })
        .eq("organization_id", organizationId)
        .eq("client_id", existing.client_id)
        .eq("is_primary", true)
        .neq("contact_id", contactId);
    }
    update.is_primary = true;
  } else if (input.isPrimary === false) {
    update.is_primary = false;
  }

  const { data, error } = await supabase
    .from("client_contacts")
    .update(update)
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .select()
    .single();
  if (error) {
    logger.error("Failed to update contact:", error);
    throw error;
  }
  return mapContact(data);
};

export const deleteContact = async (
  organizationId: string,
  contactId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    writeLocal(
      STORE.contacts(organizationId),
      readLocal<ClientContact>(STORE.contacts(organizationId), reviveContact).filter(
        (c) => c.contactId !== contactId,
      ),
    );
    return;
  }
  const { error } = await supabase
    .from("client_contacts")
    .delete()
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId);
  if (error) {
    logger.error("Failed to delete contact:", error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Notes / activity log
// ─────────────────────────────────────────────────────────────────────────────

export const getClientNotes = async (
  organizationId: string,
  clientId: string,
): Promise<ClientNote[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal<ClientNote>(STORE.notes(organizationId), reviveNote)
      .filter((n) => n.clientId === clientId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }
  const { data, error } = await supabase
    .from("client_notes")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("occurred_at", { ascending: false });
  if (error) {
    logger.error("Failed to load notes:", error);
    return [];
  }
  return (data || []).map(mapNote);
};

export const createNote = async (
  organizationId: string,
  clientId: string,
  userId: string,
  userName: string,
  input: CreateNoteInput,
): Promise<ClientNote> => {
  const subject = sanitizeText(input.subject ?? null);
  const body = sanitizeText(input.body ?? null);
  if (!subject && !body) {
    throw new Error("Note must have a subject or body");
  }

  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const note: ClientNote = {
      noteId: crypto.randomUUID(),
      clientId,
      organizationId,
      kind: input.kind ?? "note",
      subject,
      body,
      occurredAt: input.occurredAt ?? now,
      authorId: userId,
      authorName: userName,
      createdAt: now,
      updatedAt: now,
    };
    const all = readLocal<ClientNote>(STORE.notes(organizationId), reviveNote);
    writeLocal(STORE.notes(organizationId), [note, ...all]);
    return note;
  }

  const row = {
    client_id: clientId,
    organization_id: organizationId,
    kind: input.kind ?? "note",
    subject,
    body,
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    author_id: userId,
    author_name: userName,
  };

  const { data, error } = await supabase
    .from("client_notes")
    .insert(row)
    .select()
    .single();
  if (error) {
    logger.error("Failed to create note:", error);
    throw error;
  }
  return mapNote(data);
};

export const deleteNote = async (
  organizationId: string,
  noteId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    writeLocal(
      STORE.notes(organizationId),
      readLocal<ClientNote>(STORE.notes(organizationId), reviveNote).filter(
        (n) => n.noteId !== noteId,
      ),
    );
    return;
  }
  const { error } = await supabase
    .from("client_notes")
    .delete()
    .eq("organization_id", organizationId)
    .eq("note_id", noteId);
  if (error) {
    logger.error("Failed to delete note:", error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// File attachments — stored in Supabase Storage bucket "attachments" under
// {orgId}/clients/{clientId}/{timestamp}-{sanitized-filename}
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB — keep aligned with other modules.
const ALLOWED_MIME = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "text/plain",
  "text/csv",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
]);

const sanitizeFileName = (name: string): string =>
  name
    // Strip any path-traversal attempts ("..", separators) before the regex
    // collapse, defence-in-depth even though Supabase Storage scopes paths.
    .replace(/\\|\//g, "_")
    .replace(/\.\./g, "_")
    .replace(/[^a-zA-Z0-9_.\-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);

export const uploadClientAttachment = async (
  organizationId: string,
  clientId: string,
  userId: string,
  userName: string,
  file: File,
): Promise<ClientAttachment> => {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `File is too large (max ${(MAX_ATTACHMENT_BYTES / 1024 / 1024) | 0} MB)`,
    );
  }
  // Empty MIME means the browser couldn't sniff it — accept those (most common
  // for .csv from Windows). For everything else, enforce the whitelist.
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    throw new Error(`File type "${file.type}" is not allowed`);
  }

  const safeName = sanitizeFileName(file.name);

  if (isLocalOrg(organizationId)) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = reader.result;
        if (typeof r !== "string") {
          reject(new Error("Unexpected file read result"));
          return;
        }
        resolve(r);
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
    const attachment: ClientAttachment = {
      attachmentId: crypto.randomUUID(),
      clientId,
      organizationId,
      fileName: file.name,
      filePath: `local/${safeName}`,
      fileUrl: dataUrl,
      fileType: file.type || null,
      fileSize: file.size,
      uploadedBy: userId,
      uploadedByName: userName,
      createdAt: new Date(),
    };
    const all = readLocal<ClientAttachment>(
      STORE.attachments(organizationId),
      reviveAttachment,
    );
    writeLocal(STORE.attachments(organizationId), [attachment, ...all]);
    return attachment;
  }

  const path = `${organizationId}/clients/${clientId}/${Date.now()}-${safeName}`;
  const bucket = "attachments";

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (uploadError) {
    logger.error("Failed to upload client attachment:", uploadError);
    throw uploadError;
  }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);

  const row = {
    client_id: clientId,
    organization_id: organizationId,
    file_name: file.name,
    file_path: path,
    file_url: urlData.publicUrl,
    file_type: file.type || null,
    file_size: file.size,
    uploaded_by: userId,
    uploaded_by_name: userName,
  };

  const { data, error } = await supabase
    .from("client_attachments")
    .insert(row)
    .select()
    .single();
  if (error) {
    // Best-effort cleanup so we don't orphan the storage object on a DB failure.
    await supabase.storage.from(bucket).remove([path]).catch(() => undefined);
    logger.error("Failed to record client attachment:", error);
    throw error;
  }
  return mapAttachment(data);
};

export const getClientAttachments = async (
  organizationId: string,
  clientId: string,
): Promise<ClientAttachment[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal<ClientAttachment>(
      STORE.attachments(organizationId),
      reviveAttachment,
    )
      .filter((a) => a.clientId === clientId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  const { data, error } = await supabase
    .from("client_attachments")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("Failed to load attachments:", error);
    return [];
  }
  return (data || []).map(mapAttachment);
};

export const deleteAttachment = async (
  organizationId: string,
  attachment: ClientAttachment,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    writeLocal(
      STORE.attachments(organizationId),
      readLocal<ClientAttachment>(
        STORE.attachments(organizationId),
        reviveAttachment,
      ).filter((a) => a.attachmentId !== attachment.attachmentId),
    );
    return;
  }
  const { error } = await supabase
    .from("client_attachments")
    .delete()
    .eq("organization_id", organizationId)
    .eq("attachment_id", attachment.attachmentId);
  if (error) {
    logger.error("Failed to delete attachment record:", error);
    throw error;
  }
  // Best-effort: also drop the storage object.
  if (attachment.filePath && !attachment.filePath.startsWith("local/")) {
    await supabase.storage
      .from("attachments")
      .remove([attachment.filePath])
      .catch((err) => logger.warn("Storage cleanup failed:", err));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CSV helpers — Salesforce's headline feature is "data loader". Keep this on
// the service layer so the import dialog stays thin.
// ─────────────────────────────────────────────────────────────────────────────

export const CLIENT_CSV_HEADERS = [
  "name",
  "legal_name",
  "industry",
  "type",
  "status",
  "website",
  "email",
  "phone",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "annual_revenue",
  "employee_count",
  "rating",
  "source",
  "description",
  "tags",
  "account_owner_name",
] as const;

export interface CsvRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  imported: Client[];
  errors: CsvRowError[];
}

/** Parse one CSV row (already keyed by lowercased headers) into CreateClientInput. */
const csvRowToInput = (row: Record<string, string>): CreateClientInput => {
  const num = (v: string | undefined): number | null => {
    if (!v) return null;
    const n = Number(String(v).replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const tags = (row.tags || "")
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const type = ((row.type || "customer").toLowerCase()) as ClientType;
  const status = ((row.status || "active").toLowerCase()) as ClientStatus;

  return {
    name: row.name,
    legalName: row.legal_name || null,
    industry: row.industry || null,
    type: ["customer", "prospect", "partner", "vendor", "other"].includes(type)
      ? type
      : "customer",
    status: ["active", "inactive", "archived"].includes(status) ? status : "active",
    website: row.website || null,
    email: row.email || null,
    phone: row.phone || null,
    addressLine1: row.address_line1 || null,
    addressLine2: row.address_line2 || null,
    city: row.city || null,
    state: row.state || null,
    postalCode: row.postal_code || null,
    country: row.country || null,
    annualRevenue: num(row.annual_revenue),
    employeeCount: (() => {
      const n = num(row.employee_count);
      return n == null ? null : Math.round(n);
    })(),
    rating: row.rating || null,
    source: row.source || null,
    description: row.description || null,
    tags,
    accountOwnerName: row.account_owner_name || null,
  };
};

export const importClientsFromCsv = async (
  organizationId: string,
  userId: string,
  userName: string,
  rows: Array<Record<string, string>>,
): Promise<ImportResult> => {
  const errors: CsvRowError[] = [];
  const imported: Client[] = [];

  // Process serially: 50–500 row CSVs are realistic, parallel inserts blow up
  // the realtime channel and trigger duplicate names on retries.
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const normalised: Record<string, string> = {};
    for (const k of Object.keys(raw)) {
      normalised[k.toLowerCase().trim()] = (raw[k] ?? "").toString();
    }
    try {
      const input = csvRowToInput(normalised);
      if (!sanitizeText(input.name)) {
        errors.push({ row: i + 2, message: "Missing client name" });
        continue;
      }
      const client = await createClient(organizationId, userId, userName, input);
      imported.push(client);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push({ row: i + 2, message });
    }
  }

  return { imported, errors };
};

/** Build a CSV string for export. Quotes fields containing commas/newlines/quotes. */
export const exportClientsToCsv = (clients: Client[]): string => {
  const headers = [...CLIENT_CSV_HEADERS];
  const escape = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const c of clients) {
    lines.push(
      [
        c.name,
        c.legalName,
        c.industry,
        c.type,
        c.status,
        c.website,
        c.email,
        c.phone,
        c.addressLine1,
        c.addressLine2,
        c.city,
        c.state,
        c.postalCode,
        c.country,
        c.annualRevenue,
        c.employeeCount,
        c.rating,
        c.source,
        c.description,
        (c.tags || []).join(";"),
        c.accountOwnerName,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
};

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

export const formatRevenue = (
  amount: number | null | undefined,
  currency = "USD",
): string => {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      notation: amount >= 1_000_000 ? "compact" : "standard",
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
};
