import { supabase } from "./config";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type LeadStatus =
  | "new"
  | "attempted_to_contact"
  | "contact_in_future"
  | "contacted"
  | "junk_lead"
  | "lost_lead"
  | "not_contacted"
  | "pre_qualified"
  | "not_qualified"
  | "converted";

export type LeadNoteKind = "note" | "call" | "meeting" | "email" | "task";

export interface Lead {
  leadId: string;
  organizationId: string;
  workspaceId: string;
  leadNumber: string;

  salutation: string | null;
  firstName: string | null;
  lastName: string;
  title: string | null;

  email: string | null;
  phone: string | null;
  mobile: string | null;
  fax: string | null;
  website: string | null;
  skypeId: string | null;
  twitter: string | null;
  linkedinUrl: string | null;

  company: string;
  industry: string | null;
  annualRevenue: number | null;
  noOfEmployees: number | null;

  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;

  leadOwnerId: string | null;
  leadOwnerName: string | null;
  leadSource: string | null;
  leadStatus: LeadStatus;
  rating: string | null;
  emailOptOut: boolean;

  convertedAt: Date | null;
  convertedToClientId: string | null;
  convertedToContactId: string | null;
  convertedToDealId: string | null;

  description: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
  imageUrl: string | null;

  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadNote {
  noteId: string;
  leadId: string;
  organizationId: string;
  kind: LeadNoteKind;
  subject: string | null;
  body: string | null;
  occurredAt: Date;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLeadInput {
  workspaceId?: string;
  salutation?: string | null;
  firstName?: string | null;
  lastName: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  fax?: string | null;
  website?: string | null;
  skypeId?: string | null;
  twitter?: string | null;
  linkedinUrl?: string | null;
  company: string;
  industry?: string | null;
  annualRevenue?: number | null;
  noOfEmployees?: number | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  leadOwnerId?: string | null;
  leadOwnerName?: string | null;
  leadSource?: string | null;
  leadStatus?: LeadStatus;
  rating?: string | null;
  emailOptOut?: boolean;
  description?: string | null;
  tags?: string[];
  customFields?: Record<string, unknown>;
  imageUrl?: string | null;
}

export type UpdateLeadInput = Partial<CreateLeadInput>;

export interface CreateLeadNoteInput {
  kind?: LeadNoteKind;
  subject?: string | null;
  body?: string | null;
  occurredAt?: Date;
}

export interface ConvertLeadInput {
  /** When set, attach the new contact + deal to this existing account
   *  instead of creating a fresh one. */
  existingClientId?: string | null;
  /** When false, skip contact creation (just create the account). */
  createContact?: boolean;
  /** When provided, also create a deal of this shape. */
  createDeal?: {
    title: string;
    value: number;
    currency?: string;
    pipelineId?: string | null;
    stageId?: string | null;
    expectedCloseDate?: Date | null;
  } | null;
}

export interface ConvertLeadResult {
  lead: Lead;
  clientId: string;
  contactId: string | null;
  dealId: string | null;
  /** Best-effort warnings for sub-steps the caller asked for but the
   *  service couldn't complete (e.g. createContact requested but the
   *  insert was denied by RLS). Lets the UI degrade the toast and the
   *  audit log surface partial-success accurately. */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants — kept close to Zoho's defaults so the UX feels familiar
// ─────────────────────────────────────────────────────────────────────────────

export const LEAD_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new",                    label: "New" },
  { value: "attempted_to_contact",   label: "Attempted to Contact" },
  { value: "contacted",              label: "Contacted" },
  { value: "contact_in_future",      label: "Contact in Future" },
  { value: "not_contacted",          label: "Not Contacted" },
  { value: "pre_qualified",          label: "Pre-Qualified" },
  { value: "not_qualified",          label: "Not Qualified" },
  { value: "junk_lead",              label: "Junk Lead" },
  { value: "lost_lead",              label: "Lost Lead" },
  { value: "converted",              label: "Converted" },
];

export const LEAD_SOURCE_OPTIONS = [
  "Advertisement",
  "Cold Call",
  "Employee Referral",
  "External Referral",
  "Online Store",
  "Partner",
  "Public Relations",
  "Sales Email Alias",
  "Seminar Partner",
  "Seminar Internal",
  "Trade Show",
  "Web Download",
  "Web Research",
  "Chat",
  "Twitter",
  "Facebook",
  "LinkedIn",
  "Other",
];

export const LEAD_INDUSTRY_OPTIONS = [
  "ASP",
  "Data/Telecom OEM",
  "ERP",
  "Government",
  "Higher Education",
  "K-12 Education",
  "Network Equipment",
  "Non-Management ISV",
  "Optical Networking",
  "Service Providers",
  "Small/Medium Enterprise",
  "Storage Networking",
  "Wireless",
];

export const LEAD_RATING_OPTIONS = [
  "Active",
  "Acquired",
  "Market Failed",
  "Project Cancelled",
  "Shut Down",
];

export const LEAD_SALUTATIONS = ["Mr.", "Ms.", "Mrs.", "Dr.", "Prof."];

// ─────────────────────────────────────────────────────────────────────────────
// Validation + helpers
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const sanitize = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
};

const sanitizeTags = (tags: string[] | null | undefined): string[] => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = sanitize(raw);
    if (t) seen.add(t.slice(0, 50));
    if (seen.size >= 25) break;
  }
  return [...seen];
};

const validateInput = (input: CreateLeadInput) => {
  if (!sanitize(input.company)) throw new Error("Company is required");
  if (!sanitize(input.lastName)) throw new Error("Last name is required");
  if (input.email && !EMAIL_RE.test(input.email.trim())) {
    throw new Error("Invalid email address");
  }
  if (input.annualRevenue != null && input.annualRevenue < 0) {
    throw new Error("Annual revenue cannot be negative");
  }
  if (input.noOfEmployees != null && input.noOfEmployees < 0) {
    throw new Error("Employee count cannot be negative");
  }
};

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");

// ─────────────────────────────────────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────────────────────────────────────

const mapLead = (r: Record<string, unknown>): Lead => ({
  leadId: r.lead_id as string,
  organizationId: r.organization_id as string,
  workspaceId: r.workspace_id as string,
  leadNumber: r.lead_number as string,

  salutation: (r.salutation as string) ?? null,
  firstName: (r.first_name as string) ?? null,
  lastName: r.last_name as string,
  title: (r.title as string) ?? null,

  email: (r.email as string) ?? null,
  phone: (r.phone as string) ?? null,
  mobile: (r.mobile as string) ?? null,
  fax: (r.fax as string) ?? null,
  website: (r.website as string) ?? null,
  skypeId: (r.skype_id as string) ?? null,
  twitter: (r.twitter as string) ?? null,
  linkedinUrl: (r.linkedin_url as string) ?? null,

  company: r.company as string,
  industry: (r.industry as string) ?? null,
  annualRevenue: r.annual_revenue != null ? Number(r.annual_revenue) : null,
  noOfEmployees: r.no_of_employees != null ? Number(r.no_of_employees) : null,

  street: (r.street as string) ?? null,
  city: (r.city as string) ?? null,
  state: (r.state as string) ?? null,
  postalCode: (r.postal_code as string) ?? null,
  country: (r.country as string) ?? null,

  leadOwnerId: (r.lead_owner_id as string) ?? null,
  leadOwnerName: (r.lead_owner_name as string) ?? null,
  leadSource: (r.lead_source as string) ?? null,
  leadStatus: ((r.lead_status as string) || "new") as LeadStatus,
  rating: (r.rating as string) ?? null,
  emailOptOut: Boolean(r.email_opt_out),

  convertedAt: r.converted_at ? new Date(r.converted_at as string) : null,
  convertedToClientId: (r.converted_to_client_id as string) ?? null,
  convertedToContactId: (r.converted_to_contact_id as string) ?? null,
  convertedToDealId: (r.converted_to_deal_id as string) ?? null,

  description: (r.description as string) ?? null,
  tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  customFields: (r.custom_fields as Record<string, unknown>) ?? {},
  imageUrl: (r.image_url as string) ?? null,

  createdBy: (r.created_by as string) ?? null,
  createdByName: (r.created_by_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const mapLeadNote = (r: Record<string, unknown>): LeadNote => ({
  noteId: r.note_id as string,
  leadId: r.lead_id as string,
  organizationId: r.organization_id as string,
  kind: ((r.kind as string) || "note") as LeadNoteKind,
  subject: (r.subject as string) ?? null,
  body: (r.body as string) ?? null,
  occurredAt: new Date(r.occurred_at as string),
  authorId: (r.author_id as string) ?? null,
  authorName: (r.author_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

// ─────────────────────────────────────────────────────────────────────────────
// Local-org fallback (matches the clients.ts pattern)
// ─────────────────────────────────────────────────────────────────────────────

const STORE = {
  leads: (orgId: string) => `pm_leads_${orgId}`,
  notes: (orgId: string) => `pm_lead_notes_${orgId}`,
};

const reviveLead = (l: Lead): Lead => ({
  ...l,
  createdAt: new Date(l.createdAt),
  updatedAt: new Date(l.updatedAt),
  convertedAt: l.convertedAt ? new Date(l.convertedAt) : null,
});
const reviveLeadNote = (n: LeadNote): LeadNote => ({
  ...n,
  occurredAt: new Date(n.occurredAt),
  createdAt: new Date(n.createdAt),
  updatedAt: new Date(n.updatedAt),
});

const readLocal = <T>(key: string, revive: (x: T) => T): T[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return (JSON.parse(raw) as T[]).map(revive);
  } catch { return []; }
};
const writeLocal = <T>(key: string, value: T[]) =>
  localStorage.setItem(key, JSON.stringify(value));

const nextLeadNumber = async (organizationId: string): Promise<string> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal<Lead>(STORE.leads(organizationId), reviveLead);
    const max = all.reduce((m, l) => {
      const match = /^L-(\d+)$/.exec(l.leadNumber);
      return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    return `L-${String(max + 1).padStart(6, "0")}`;
  }
  const { data, error } = await supabase.rpc("next_lead_number", {
    p_organization_id: organizationId,
  });
  if (error) {
    logger.warn("next_lead_number rpc failed, falling back:", error);
    return `L-${Date.now()}`;
  }
  return String(data);
};

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export const createLead = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateLeadInput,
): Promise<Lead> => {
  validateInput(input);

  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const number = await nextLeadNumber(organizationId);
    const lead: Lead = {
      leadId: crypto.randomUUID(),
      organizationId,
      workspaceId: input.workspaceId ?? "local-default",
      leadNumber: number,
      salutation: sanitize(input.salutation),
      firstName: sanitize(input.firstName),
      lastName: sanitize(input.lastName)!,
      title: sanitize(input.title),
      email: sanitize(input.email),
      phone: sanitize(input.phone),
      mobile: sanitize(input.mobile),
      fax: sanitize(input.fax),
      website: sanitize(input.website),
      skypeId: sanitize(input.skypeId),
      twitter: sanitize(input.twitter),
      linkedinUrl: sanitize(input.linkedinUrl),
      company: sanitize(input.company)!,
      industry: sanitize(input.industry),
      annualRevenue: input.annualRevenue ?? null,
      noOfEmployees: input.noOfEmployees ?? null,
      street: sanitize(input.street),
      city: sanitize(input.city),
      state: sanitize(input.state),
      postalCode: sanitize(input.postalCode),
      country: sanitize(input.country),
      leadOwnerId: input.leadOwnerId ?? userId,
      leadOwnerName: input.leadOwnerName ?? userName,
      leadSource: sanitize(input.leadSource),
      leadStatus: input.leadStatus ?? "new",
      rating: sanitize(input.rating),
      emailOptOut: Boolean(input.emailOptOut),
      convertedAt: null,
      convertedToClientId: null,
      convertedToContactId: null,
      convertedToDealId: null,
      description: sanitize(input.description),
      tags: sanitizeTags(input.tags),
      customFields: input.customFields ?? {},
      imageUrl: sanitize(input.imageUrl),
      createdBy: userId,
      createdByName: userName,
      createdAt: now,
      updatedAt: now,
    };
    const all = readLocal<Lead>(STORE.leads(organizationId), reviveLead);
    writeLocal(STORE.leads(organizationId), [lead, ...all]);
    notifyLocalLeadsChanged(organizationId);
    return lead;
  }

  if (!input.workspaceId) {
    throw new Error(
      "Cannot create a lead without a workspace. Pick a workspace in the sidebar first.",
    );
  }

  const number = await nextLeadNumber(organizationId);

  const { data, error } = await supabase
    .from("leads")
    .insert({
      organization_id: organizationId,
      workspace_id: input.workspaceId,
      lead_number: number,
      salutation: sanitize(input.salutation),
      first_name: sanitize(input.firstName),
      last_name: sanitize(input.lastName)!,
      title: sanitize(input.title),
      email: sanitize(input.email),
      phone: sanitize(input.phone),
      mobile: sanitize(input.mobile),
      fax: sanitize(input.fax),
      website: sanitize(input.website),
      skype_id: sanitize(input.skypeId),
      twitter: sanitize(input.twitter),
      linkedin_url: sanitize(input.linkedinUrl),
      company: sanitize(input.company)!,
      industry: sanitize(input.industry),
      annual_revenue: input.annualRevenue ?? null,
      no_of_employees: input.noOfEmployees ?? null,
      street: sanitize(input.street),
      city: sanitize(input.city),
      state: sanitize(input.state),
      postal_code: sanitize(input.postalCode),
      country: sanitize(input.country),
      lead_owner_id: input.leadOwnerId ?? userId,
      lead_owner_name: input.leadOwnerName ?? userName,
      lead_source: sanitize(input.leadSource),
      lead_status: input.leadStatus ?? "new",
      rating: sanitize(input.rating),
      email_opt_out: Boolean(input.emailOptOut),
      description: sanitize(input.description),
      tags: sanitizeTags(input.tags),
      custom_fields: input.customFields ?? {},
      image_url: sanitize(input.imageUrl),
      created_by: userId,
      created_by_name: userName,
    })
    .select()
    .single();

  if (error) {
    logger.error("createLead failed:", error);
    throw error;
  }
  notifyLeadsChanged(organizationId);
  return mapLead(data as Record<string, unknown>);
};

export const updateLead = async (
  organizationId: string,
  leadId: string,
  input: UpdateLeadInput,
): Promise<Lead> => {
  if (input.email && !EMAIL_RE.test(input.email.trim())) {
    throw new Error("Invalid email address");
  }
  if (input.annualRevenue != null && input.annualRevenue < 0) {
    throw new Error("Annual revenue cannot be negative");
  }

  if (isLocalOrg(organizationId)) {
    const all = readLocal<Lead>(STORE.leads(organizationId), reviveLead);
    const idx = all.findIndex((l) => l.leadId === leadId);
    if (idx === -1) throw new Error("Lead not found");
    const merged: Lead = { ...all[idx] };
    const assign = <K extends keyof Lead>(k: K, v: Lead[K] | undefined) => {
      if (v !== undefined) merged[k] = v as Lead[K];
    };
    assign("workspaceId", input.workspaceId);
    assign("salutation", input.salutation !== undefined ? sanitize(input.salutation) : undefined);
    assign("firstName", input.firstName !== undefined ? sanitize(input.firstName) : undefined);
    assign("lastName", input.lastName ? sanitize(input.lastName) ?? all[idx].lastName : undefined);
    assign("title", input.title !== undefined ? sanitize(input.title) : undefined);
    assign("email", input.email !== undefined ? sanitize(input.email) : undefined);
    assign("phone", input.phone !== undefined ? sanitize(input.phone) : undefined);
    assign("mobile", input.mobile !== undefined ? sanitize(input.mobile) : undefined);
    assign("fax", input.fax !== undefined ? sanitize(input.fax) : undefined);
    assign("website", input.website !== undefined ? sanitize(input.website) : undefined);
    assign("skypeId", input.skypeId !== undefined ? sanitize(input.skypeId) : undefined);
    assign("twitter", input.twitter !== undefined ? sanitize(input.twitter) : undefined);
    assign("linkedinUrl", input.linkedinUrl !== undefined ? sanitize(input.linkedinUrl) : undefined);
    assign("company", input.company ? sanitize(input.company) ?? all[idx].company : undefined);
    assign("industry", input.industry !== undefined ? sanitize(input.industry) : undefined);
    assign("annualRevenue", input.annualRevenue);
    assign("noOfEmployees", input.noOfEmployees);
    assign("street", input.street !== undefined ? sanitize(input.street) : undefined);
    assign("city", input.city !== undefined ? sanitize(input.city) : undefined);
    assign("state", input.state !== undefined ? sanitize(input.state) : undefined);
    assign("postalCode", input.postalCode !== undefined ? sanitize(input.postalCode) : undefined);
    assign("country", input.country !== undefined ? sanitize(input.country) : undefined);
    assign("leadOwnerId", input.leadOwnerId);
    assign("leadOwnerName", input.leadOwnerName);
    assign("leadSource", input.leadSource !== undefined ? sanitize(input.leadSource) : undefined);
    assign("leadStatus", input.leadStatus);
    assign("rating", input.rating !== undefined ? sanitize(input.rating) : undefined);
    if (input.emailOptOut !== undefined) merged.emailOptOut = Boolean(input.emailOptOut);
    assign("description", input.description !== undefined ? sanitize(input.description) : undefined);
    if (input.tags !== undefined) merged.tags = sanitizeTags(input.tags);
    if (input.customFields !== undefined) merged.customFields = input.customFields;
    assign("imageUrl", input.imageUrl !== undefined ? sanitize(input.imageUrl) : undefined);
    merged.updatedAt = new Date();
    all[idx] = merged;
    writeLocal(STORE.leads(organizationId), all);
    notifyLocalLeadsChanged(organizationId);
    return merged;
  }

  const patch: Record<string, unknown> = {};
  if (input.workspaceId !== undefined) patch.workspace_id = input.workspaceId;
  if (input.salutation !== undefined) patch.salutation = sanitize(input.salutation);
  if (input.firstName !== undefined) patch.first_name = sanitize(input.firstName);
  if (input.lastName !== undefined) patch.last_name = sanitize(input.lastName);
  if (input.title !== undefined) patch.title = sanitize(input.title);
  if (input.email !== undefined) patch.email = sanitize(input.email);
  if (input.phone !== undefined) patch.phone = sanitize(input.phone);
  if (input.mobile !== undefined) patch.mobile = sanitize(input.mobile);
  if (input.fax !== undefined) patch.fax = sanitize(input.fax);
  if (input.website !== undefined) patch.website = sanitize(input.website);
  if (input.skypeId !== undefined) patch.skype_id = sanitize(input.skypeId);
  if (input.twitter !== undefined) patch.twitter = sanitize(input.twitter);
  if (input.linkedinUrl !== undefined) patch.linkedin_url = sanitize(input.linkedinUrl);
  if (input.company !== undefined) patch.company = sanitize(input.company);
  if (input.industry !== undefined) patch.industry = sanitize(input.industry);
  if (input.annualRevenue !== undefined) patch.annual_revenue = input.annualRevenue;
  if (input.noOfEmployees !== undefined) patch.no_of_employees = input.noOfEmployees;
  if (input.street !== undefined) patch.street = sanitize(input.street);
  if (input.city !== undefined) patch.city = sanitize(input.city);
  if (input.state !== undefined) patch.state = sanitize(input.state);
  if (input.postalCode !== undefined) patch.postal_code = sanitize(input.postalCode);
  if (input.country !== undefined) patch.country = sanitize(input.country);
  if (input.leadOwnerId !== undefined) patch.lead_owner_id = input.leadOwnerId;
  if (input.leadOwnerName !== undefined) patch.lead_owner_name = input.leadOwnerName;
  if (input.leadSource !== undefined) patch.lead_source = sanitize(input.leadSource);
  if (input.leadStatus !== undefined) patch.lead_status = input.leadStatus;
  if (input.rating !== undefined) patch.rating = sanitize(input.rating);
  if (input.emailOptOut !== undefined) patch.email_opt_out = Boolean(input.emailOptOut);
  if (input.description !== undefined) patch.description = sanitize(input.description);
  if (input.tags !== undefined) patch.tags = sanitizeTags(input.tags);
  if (input.customFields !== undefined) patch.custom_fields = input.customFields;
  if (input.imageUrl !== undefined) patch.image_url = sanitize(input.imageUrl);

  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .select()
    .single();

  if (error) {
    logger.error("updateLead failed:", error);
    throw error;
  }
  notifyLeadsChanged(organizationId);
  return mapLead(data as Record<string, unknown>);
};

export const deleteLead = async (
  organizationId: string,
  leadId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal<Lead>(STORE.leads(organizationId), reviveLead);
    writeLocal(STORE.leads(organizationId), all.filter((l) => l.leadId !== leadId));
    notifyLocalLeadsChanged(organizationId);
    return;
  }
  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId);
  if (error) {
    logger.error("deleteLead failed:", error);
    throw error;
  }
  notifyLeadsChanged(organizationId);
};

export const getOrganizationLeads = async (
  organizationId: string,
): Promise<Lead[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal<Lead>(STORE.leads(organizationId), reviveLead).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("getOrganizationLeads failed:", error);
    return [];
  }
  return (data || []).map(mapLead);
};

// Cross-instance sync (same pattern as deals + clients). Fires in BOTH
// modes so siblings on the same page sync without waiting on Supabase
// realtime.
const LEADS_CHANGED_EVENT = "pm-leads-changed";

export const notifyLeadsChanged = (organizationId: string) => {
  try {
    window.dispatchEvent(new CustomEvent(LEADS_CHANGED_EVENT, { detail: { organizationId } }));
  } catch { /* ignore */ }
};

/** @deprecated use notifyLeadsChanged. */
export const notifyLocalLeadsChanged = notifyLeadsChanged;

export const subscribeToLeads = (
  organizationId: string,
  callback: (leads: Lead[]) => void,
): (() => void) => {
  getOrganizationLeads(organizationId).then(callback);

  const ceHandler = (e: Event) => {
    const ce = e as CustomEvent<{ organizationId: string }>;
    if (ce.detail?.organizationId !== organizationId) return;
    getOrganizationLeads(organizationId).then(callback);
  };
  window.addEventListener(LEADS_CHANGED_EVENT, ceHandler);

  if (isLocalOrg(organizationId)) {
    return () => window.removeEventListener(LEADS_CHANGED_EVENT, ceHandler);
  }

  const channel = supabase
    .channel(`leads-${organizationId}-${Math.random().toString(36).slice(2, 9)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "leads",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => { getOrganizationLeads(organizationId).then(callback); },
    )
    .subscribe();

  return () => {
    window.removeEventListener(LEADS_CHANGED_EVENT, ceHandler);
    channel.unsubscribe();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Convert: lead → client (+ contact, + optional deal)
// ─────────────────────────────────────────────────────────────────────────────

export const convertLead = async (
  organizationId: string,
  userId: string,
  userName: string,
  lead: Lead,
  input: ConvertLeadInput,
): Promise<ConvertLeadResult> => {
  if (lead.leadStatus === "converted") {
    throw new Error("This lead has already been converted.");
  }
  if (isLocalOrg(organizationId)) {
    throw new Error("Convert isn't supported in local-only mode. Connect Supabase first.");
  }

  const warnings: string[] = [];

  // ── Idempotency: claim the lead first via a guarded update. If 0 rows are
  //   returned the lead is already converted (likely by another tab or a
  //   double-click race) and we abort before creating any side-effects.
  //
  //   We use .neq('lead_status', 'converted') so a concurrent winner
  //   already-converted row stays untouched. Real conversion data is
  //   stamped on a follow-up update at the end of the happy path.
  const claimStamp = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from("leads")
    .update({ updated_at: claimStamp })
    .eq("organization_id", organizationId)
    .eq("lead_id", lead.leadId)
    .neq("lead_status", "converted")
    .select("lead_id")
    .maybeSingle();
  if (claimErr) {
    logger.error("convertLead: idempotency claim failed:", claimErr);
    throw claimErr;
  }
  if (!claimed) {
    throw new Error("This lead is already being converted in another window.");
  }

  // 1. Resolve the target client (account). When the caller picked an
  //    existing account, verify it lives in the same workspace+org as the
  //    lead so a tampered API call can't cross-link to another workspace.
  let clientId: string;
  let createdClientId: string | null = null;   // for rollback on later failure
  if (input.existingClientId) {
    const { data: existing, error: existingErr } = await supabase
      .from("clients")
      .select("client_id, organization_id, workspace_id")
      .eq("client_id", input.existingClientId)
      .maybeSingle();
    if (existingErr || !existing) {
      throw existingErr ?? new Error("Target account not found.");
    }
    if (
      existing.organization_id !== organizationId ||
      existing.workspace_id !== lead.workspaceId
    ) {
      throw new Error(
        "Target account belongs to a different workspace. Pick an account in the lead's workspace, or create a new one.",
      );
    }
    clientId = input.existingClientId;
  } else {
    // Route through the crm_create_client RPC (security definer) so that
    // plain members can convert a lead into an account without tripping
    // the owner/admin-only RLS on direct clients INSERTs. The RPC checks
    // org membership + non-viewer role itself before inserting.
    const clientPayload: Record<string, unknown> = {
      organization_id: organizationId,
      workspace_id: lead.workspaceId,
      name: lead.company,
      industry: lead.industry,
      website: lead.website,
      email: lead.email,
      phone: lead.phone,
      address_line1: lead.street,
      city: lead.city,
      state: lead.state,
      postal_code: lead.postalCode,
      country: lead.country,
      annual_revenue: lead.annualRevenue,
      employee_count: lead.noOfEmployees,
      rating: lead.rating,
      source: lead.leadSource,
      description: lead.description,
      tags: lead.tags,
      account_owner_id: lead.leadOwnerId ?? userId,
      account_owner_name: lead.leadOwnerName ?? userName,
      custom_fields: lead.customFields,
      created_by: userId,
      created_by_name: userName,
    };

    let createdId: string | null = null;
    let lastError: unknown = null;
    const strippedCols: string[] = [];

    // Strip 42703 "column X does not exist" errors and retry up to 8x so
    // a partially-migrated DB (e.g. missing migration 103 → no `fax`
    // column) still gets the account created without those columns.
    const tryStripMissingColumn = (err: unknown): string | null => {
      const e = err as { code?: string; message?: string } | null;
      if (!e || (e.code !== "42703" && !/does not exist/i.test(String(e.message ?? "")))) return null;
      const m = /column "([^"]+)" of relation/i.exec(String(e.message ?? ""));
      const col = m?.[1];
      if (!col || !(col in clientPayload)) return null;
      delete clientPayload[col];
      strippedCols.push(col);
      return col;
    };

    // Primary path: RPC.
    const tryRpc = async () => {
      const { data, error } = await supabase
        .rpc("crm_create_client", { p_organization_id: organizationId, p_client: clientPayload })
        .single();
      return { data, error };
    };
    const tryDirect = async () => {
      const { data, error } = await supabase
        .from("clients").insert(clientPayload).select("client_id").single();
      return { data, error };
    };

    // Round 1: try the RPC. If it 42703s, the deployed RPC body
    // hardcodes columns the table doesn't have yet — stripping our jsonb
    // payload won't help because the RPC's own INSERT references them
    // regardless. The only escape is to switch to the direct path where
    // we control the column list, and keep stripping on each retry.
    let attempt = await tryRpc();

    // Switch to direct insert on missing-RPC, signature drift, bad jsonb,
    // OR a 42703 from inside the RPC body.
    const shouldFallBackToDirect = (err: unknown): boolean => {
      const code = String((err as { code?: string } | null)?.code ?? "");
      if (code === "PGRST202" || code === "42883" || code === "22P02") return true;
      if (code.startsWith("PGRST")) return true;
      if (code === "42703") return true; // RPC body references a missing column
      return /does not exist/i.test(String((err as { message?: string } | null)?.message ?? ""));
    };

    if (attempt.error && shouldFallBackToDirect(attempt.error)) {
      // Strip anything the RPC complained about before the first direct
      // attempt, since we're about to use a payload-driven INSERT.
      tryStripMissingColumn(attempt.error);
      attempt = await tryDirect();
    }

    // Keep stripping + retrying on the direct path while 42703s keep
    // coming back. Caps at 8 to avoid an infinite loop on a wildly
    // mismatched schema.
    for (let i = 0; i < 8 && attempt.error; i++) {
      const stripped = tryStripMissingColumn(attempt.error);
      if (!stripped) break;
      attempt = await tryDirect();
    }

    if (!attempt.error && attempt.data) {
      createdId = (attempt.data as { client_id: string }).client_id;
    } else {
      lastError = attempt.error;
    }

    if (strippedCols.length > 0) {
      logger.warn(
        `convertLead: dropped ${strippedCols.length} column(s) the DB doesn't know about: `
        + `${strippedCols.join(", ")}. Apply migrations 103–110 to keep these values.`,
      );
    }

    if (!createdId) {
      const e = lastError as { code?: string; message?: string; details?: string; hint?: string } | null;
      const composed = [e?.message, e?.details, e?.hint && `(hint: ${e.hint})`, e?.code && `[${e.code}]`]
        .filter(Boolean)
        .join(" — ");
      logger.error(`convertLead: client insert failed: ${composed || "unknown reason"}`, lastError);
      throw new Error(
        composed
          || "Failed to create the account for this lead — usually a permissions issue. Make sure the latest CRM client-RPC migration is deployed and your role allows account creation.",
      );
    }
    clientId = createdId;
    createdClientId = clientId;
  }

  // Compensating rollback when a downstream step fails. Only deletes things
  // this invocation created — we never touch a pre-existing account.
  const rollback = async (
    createdContactId: string | null,
    createdDealId: string | null,
  ) => {
    if (createdDealId) {
      await supabase.from("deals").delete().eq("deal_id", createdDealId);
    }
    if (createdContactId) {
      await supabase.from("client_contacts").delete().eq("contact_id", createdContactId);
    }
    if (createdClientId) {
      await supabase.from("clients").delete().eq("client_id", createdClientId);
    }
  };

  // 2. Create the contact (when the caller asked for one). The reviewer
  //    flagged the old behaviour — silently swallow contact failures —
  //    because it lets the lead be marked converted with contactId=null
  //    even though the rep explicitly opted in.
  //
  //    Schema notes:
  //    - full_name on client_contacts is a STORED generated column
  //      (migration 041). Writing it raises 428C9 / 400. We let the DB
  //      compute it from first_name + last_name and never include it.
  //    - Same strip-and-retry pattern as the client insert above so the
  //      contact lands even on a partially-migrated DB (e.g. missing
  //      `mobile`).
  let contactId: string | null = null;
  if (input.createContact !== false) {
    const contactPayload: Record<string, unknown> = {
      client_id: clientId,
      organization_id: organizationId,
      first_name: lead.firstName,
      last_name: lead.lastName,
      title: lead.title,
      email: lead.email,
      phone: lead.phone,
      mobile: lead.mobile,
      is_primary: !input.existingClientId,
      created_by: userId,
    };
    const strippedContactCols: string[] = [];
    const stripContactCol = (err: unknown): string | null => {
      const e = err as { code?: string; message?: string } | null;
      if (!e || (e.code !== "42703" && e.code !== "428C9" && !/does not exist|generated/i.test(String(e.message ?? "")))) return null;
      const m = /column "([^"]+)"/i.exec(String(e.message ?? ""));
      const col = m?.[1];
      if (!col || !(col in contactPayload)) return null;
      delete contactPayload[col];
      strippedContactCols.push(col);
      return col;
    };
    const tryContactInsert = async () =>
      supabase.from("client_contacts").insert(contactPayload).select("contact_id").single();

    let cAttempt = await tryContactInsert();
    for (let i = 0; i < 8 && cAttempt.error; i++) {
      const stripped = stripContactCol(cAttempt.error);
      if (!stripped) break;
      cAttempt = await tryContactInsert();
    }
    if (strippedContactCols.length > 0) {
      logger.warn(
        `convertLead: dropped contact column(s) the DB doesn't know about: ${strippedContactCols.join(", ")}. `
        + `Apply migration 102 (Zoho contact fields) to keep these values.`,
      );
    }

    if (cAttempt.error) {
      const e = cAttempt.error as { code?: string; message?: string; details?: string; hint?: string };
      const composed = [e.message, e.details, e.hint && `(hint: ${e.hint})`, e.code && `[${e.code}]`]
        .filter(Boolean)
        .join(" — ");
      logger.error(`convertLead: contact insert failed: ${composed || "unknown reason"}`, cAttempt.error);
      await rollback(null, null);
      throw new Error(
        `Couldn't create the contact: ${composed || "unknown error"}. Lead was not converted.`,
      );
    }
    contactId = (cAttempt.data as { contact_id: string }).contact_id;
  }

  // 3. Optional deal creation. If the caller asked for one and it fails, we
  //    surface it as a warning rather than throwing — the account+contact
  //    have already landed and rolling back here would be more surprising
  //    than the rep manually adding the deal. But we DO leave a clear note
  //    on the result so the UI can show a non-success toast.
  let dealId: string | null = null;
  if (input.createDeal) {
    const { data: dealRow, error: dealErr } = await supabase
      .from("deals")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        pipeline_id: input.createDeal.pipelineId ?? null,
        stage_id: input.createDeal.stageId ?? null,
        title: input.createDeal.title,
        value: input.createDeal.value,
        currency: (input.createDeal.currency ?? "USD").toUpperCase(),
        expected_close_date: input.createDeal.expectedCloseDate
          ? input.createDeal.expectedCloseDate.toISOString().slice(0, 10)
          : null,
        owner_id: lead.leadOwnerId ?? userId,
        owner_name: lead.leadOwnerName ?? userName,
        created_by: userId,
        created_by_name: userName,
      })
      .select("deal_id")
      .single();
    if (dealErr) {
      logger.warn("convertLead: deal insert failed:", dealErr);
      warnings.push(
        `Deal creation failed: ${dealErr.message ?? "unknown error"}. The account and contact were created; add the deal manually.`,
      );
    } else if (dealRow) {
      dealId = dealRow.deal_id as string;
    }
  }

  // 4. Final stamp on the lead. Re-guard with .neq so a concurrent winner
  //    still wins; if the guard rejects us we roll back our side-effects
  //    and tell the caller the conversion was claimed by someone else.
  const { data: updatedLead, error: updErr } = await supabase
    .from("leads")
    .update({
      lead_status: "converted",
      converted_at: new Date().toISOString(),
      converted_to_client_id: clientId,
      converted_to_contact_id: contactId,
      converted_to_deal_id: dealId,
    })
    .eq("organization_id", organizationId)
    .eq("lead_id", lead.leadId)
    .neq("lead_status", "converted")
    .select()
    .maybeSingle();
  if (updErr || !updatedLead) {
    logger.error("convertLead: status update failed:", updErr);
    await rollback(contactId, dealId);
    throw updErr ?? new Error("Failed to mark lead as converted. The new account, contact, and deal were rolled back.");
  }

  return {
    lead: mapLead(updatedLead as Record<string, unknown>),
    clientId,
    contactId,
    dealId,
    warnings,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Notes (lead-scoped)
// ─────────────────────────────────────────────────────────────────────────────

export const getLeadNotes = async (
  organizationId: string,
  leadId: string,
): Promise<LeadNote[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal<LeadNote>(STORE.notes(organizationId), reviveLeadNote)
      .filter((n) => n.leadId === leadId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }
  const { data, error } = await supabase
    .from("lead_notes")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .order("occurred_at", { ascending: false });
  if (error) {
    logger.error("getLeadNotes failed:", error);
    return [];
  }
  return (data || []).map(mapLeadNote);
};

export const createLeadNote = async (
  organizationId: string,
  leadId: string,
  userId: string | null,
  userName: string | null,
  input: CreateLeadNoteInput,
): Promise<LeadNote> => {
  const subject = sanitize(input.subject ?? null);
  const body = sanitize(input.body ?? null);
  if (!subject && !body) {
    throw new Error("Note must have a subject or body");
  }

  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const note: LeadNote = {
      noteId: crypto.randomUUID(),
      leadId,
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
    const all = readLocal<LeadNote>(STORE.notes(organizationId), reviveLeadNote);
    writeLocal(STORE.notes(organizationId), [note, ...all]);
    return note;
  }

  const { data, error } = await supabase
    .from("lead_notes")
    .insert({
      organization_id: organizationId,
      lead_id: leadId,
      kind: input.kind ?? "note",
      subject,
      body,
      occurred_at: (input.occurredAt ?? new Date()).toISOString(),
      author_id: userId,
      author_name: userName,
    })
    .select()
    .single();
  if (error) {
    logger.error("createLeadNote failed:", error);
    throw error;
  }
  return mapLeadNote(data as Record<string, unknown>);
};

export const deleteLeadNote = async (
  organizationId: string,
  noteId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal<LeadNote>(STORE.notes(organizationId), reviveLeadNote);
    writeLocal(STORE.notes(organizationId), all.filter((n) => n.noteId !== noteId));
    return;
  }
  const { error } = await supabase
    .from("lead_notes")
    .delete()
    .eq("organization_id", organizationId)
    .eq("note_id", noteId);
  if (error) {
    logger.error("deleteLeadNote failed:", error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

export const leadDisplayName = (l: Lead): string => {
  const parts = [l.salutation, l.firstName, l.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : l.company;
};

export const leadStatusLabel = (s: LeadStatus): string => {
  return LEAD_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
};

// ─────────────────────────────────────────────────────────────────────────────
// CSV import — Zoho-style "Import Leads" feature
// ─────────────────────────────────────────────────────────────────────────────

/** Header aliases keep the importer permissive — Apollo / Salesforce /
 *  HubSpot exports all use slightly different column names. Map them to a
 *  canonical internal key so the parser only has to learn one shape. */
const LEAD_HEADER_ALIASES: Record<string, string> = {
  firstname: "first_name",
  "first name": "first_name",
  givenname: "first_name",
  lastname: "last_name",
  "last name": "last_name",
  surname: "last_name",
  familyname: "last_name",
  fullname: "full_name",
  "full name": "full_name",
  name: "full_name",
  email: "email",
  emailaddress: "email",
  "email address": "email",
  workemail: "email",
  phone: "phone",
  phonenumber: "phone",
  workphone: "phone",
  mobile: "mobile",
  mobilephone: "mobile",
  cellphone: "mobile",
  cell: "mobile",
  fax: "fax",
  website: "website",
  url: "website",
  domain: "website",
  company: "company",
  companyname: "company",
  organization: "company",
  organizationname: "company",
  account: "company",
  accountname: "company",
  industry: "industry",
  vertical: "industry",
  title: "title",
  "job title": "title",
  jobtitle: "title",
  position: "title",
  role: "title",
  salutation: "salutation",
  honorific: "salutation",
  city: "city",
  state: "state",
  region: "state",
  country: "country",
  street: "street",
  address: "street",
  address1: "street",
  "address line 1": "street",
  zipcode: "postal_code",
  zip: "postal_code",
  postalcode: "postal_code",
  postal: "postal_code",
  annualrevenue: "annual_revenue",
  "annual revenue": "annual_revenue",
  revenue: "annual_revenue",
  employeecount: "no_of_employees",
  "employee count": "no_of_employees",
  numberofemployees: "no_of_employees",
  "no. of employees": "no_of_employees",
  employees: "no_of_employees",
  leadowner: "lead_owner_name",
  "lead owner": "lead_owner_name",
  owner: "lead_owner_name",
  assignedto: "lead_owner_name",
  leadsource: "lead_source",
  "lead source": "lead_source",
  source: "lead_source",
  leadstatus: "lead_status",
  "lead status": "lead_status",
  status: "lead_status",
  stage: "lead_status",
  rating: "rating",
  description: "description",
  notes: "description",
  comments: "description",
  tags: "tags",
  labels: "tags",
  linkedin: "linkedin_url",
  linkedinurl: "linkedin_url",
  "linkedin url": "linkedin_url",
  twitter: "twitter",
  twitterhandle: "twitter",
  skype: "skype_id",
  skypeid: "skype_id",
};

const normalizeHeader = (h: string): string => {
  const cleaned = h.toLowerCase().trim();
  // Collapse runs of separators so "Last_Name", "last-name", "last name" all match.
  const compact = cleaned.replace(/[\s_\-./()]+/g, "");
  if (LEAD_HEADER_ALIASES[compact]) return LEAD_HEADER_ALIASES[compact];
  if (LEAD_HEADER_ALIASES[cleaned]) return LEAD_HEADER_ALIASES[cleaned];
  // Try a sorted-token canonical form so "Email (Work)" and "Work Email"
  // both collapse to the same lookup key. Catches Salesforce/HubSpot
  // exports that put the qualifier in parens vs. as a prefix.
  const tokens = cleaned.split(/[\s_\-./()]+/).filter(Boolean).sort();
  if (tokens.length >= 2) {
    const sortedCompact = tokens.join("");
    if (LEAD_HEADER_ALIASES[sortedCompact]) return LEAD_HEADER_ALIASES[sortedCompact];
  }
  return cleaned;
};

export interface ParsedCsv {
  rows: Array<Record<string, string>>;
  /** Source headers that collapsed to the same canonical key. When this
   *  happens the import would silently last-write-wins, so the dialog
   *  surfaces them as a warning. */
  duplicateHeaders: Array<{ canonical: string; sources: string[] }>;
}

/** Parse a CSV string into row objects. Handles quoted fields, escaped quotes,
 *  embedded commas, embedded newlines, BOM, and normalises CRLF both inside
 *  AND outside quoted fields. Header row is normalised so callers can read
 *  by canonical key. */
export const parseLeadCsv = (text: string): ParsedCsv => {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      // Inside quotes, normalise CRLF to LF so Windows-exported quoted
      // descriptions don't keep stray \r characters.
      if (c === "\r") {
        if (src[i + 1] === "\n") {
          field += "\n";
          i += 2;
        } else {
          field += "\n";
          i += 1;
        }
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      cur.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      // swallow CR; the next LF closes the row
      i += 1;
      continue;
    }
    if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  if (rows.length === 0) return { rows: [], duplicateHeaders: [] };

  // Normalise headers and detect collisions where multiple source columns
  // would clobber each other in the row dict.
  const sourceHeaders = rows[0];
  const headers = sourceHeaders.map((h) => normalizeHeader(h));
  const sourcesByCanonical = new Map<string, string[]>();
  for (let c = 0; c < headers.length; c++) {
    const key = headers[c];
    const sources = sourcesByCanonical.get(key) ?? [];
    sources.push(sourceHeaders[c]);
    sourcesByCanonical.set(key, sources);
  }
  const duplicateHeaders: Array<{ canonical: string; sources: string[] }> = [];
  for (const [canonical, sources] of sourcesByCanonical.entries()) {
    if (sources.length > 1) duplicateHeaders.push({ canonical, sources });
  }

  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((v) => v.trim() === "")) continue;
    const obj: Record<string, string> = {};
    // Last-write-wins on duplicates, but we already warned via
    // duplicateHeaders so the rep can rename or remove a column.
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (cells[c] ?? "").trim();
    }
    out.push(obj);
  }
  return { rows: out, duplicateHeaders };
};

const LEAD_STATUS_LOOKUP: Record<string, LeadStatus> = {
  new: "new",
  contacted: "contacted",
  "not contacted": "not_contacted",
  "not_contacted": "not_contacted",
  "attempted to contact": "attempted_to_contact",
  "attempted_to_contact": "attempted_to_contact",
  "contact in future": "contact_in_future",
  "contact_in_future": "contact_in_future",
  "pre-qualified": "pre_qualified",
  "pre qualified": "pre_qualified",
  "pre_qualified": "pre_qualified",
  qualified: "pre_qualified",
  "not qualified": "not_qualified",
  "not_qualified": "not_qualified",
  unqualified: "not_qualified",
  "junk lead": "junk_lead",
  junk: "junk_lead",
  "junk_lead": "junk_lead",
  "lost lead": "lost_lead",
  lost: "lost_lead",
  "lost_lead": "lost_lead",
  converted: "converted",
};

const parseLeadStatusValue = (raw: string | undefined | null): LeadStatus | null => {
  if (!raw) return null;
  const k = raw.toLowerCase().trim();
  return LEAD_STATUS_LOOKUP[k] ?? null;
};

const parseTagList = (raw: string | undefined | null): string[] => {
  if (!raw) return [];
  return raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
};

// Detect magnitude suffixes BEFORE stripping non-numeric chars so '1.5M',
// '$2.3B', '500K', '1.2bn' all parse as the order-of-magnitude they intend.
// Apollo / Crunchbase / ZoomInfo revenue exports use these almost universally.
const MAGNITUDE_SUFFIXES: Array<{ re: RegExp; mult: number }> = [
  { re: /\bt(?:rillion)?\b/i, mult: 1e12 },
  { re: /\bb(?:n|illion)?\b/i, mult: 1e9 },
  { re: /\bmm\b/i,             mult: 1e6 },
  { re: /\bm(?:illion)?\b/i,   mult: 1e6 },
  { re: /\bk\b/i,              mult: 1e3 },
];

const parseNumber = (raw: string | undefined | null): number | null => {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let multiplier = 1;
  let body = s;
  for (const { re, mult } of MAGNITUDE_SUFFIXES) {
    if (re.test(body)) {
      multiplier = mult;
      body = body.replace(re, "").trim();
      break;
    }
  }
  // Now strip currency / commas / spaces while keeping '.' and '-' so
  // "$1,234.56" -> 1234.56. Scientific notation (1e6) survives because
  // we only strip the magnitude letter when it appears as a word boundary.
  const cleaned = body.replace(/[^\d.\-eE+]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * multiplier;
};

export interface LeadCsvRowError {
  row: number;       // 1-indexed against the source spreadsheet (header = row 1)
  message: string;
}

export interface LeadCsvCoercion {
  row: number;
  field: string;
  original: string;
  coercedTo: string;
}

export interface ImportLeadsResult {
  imported: Lead[];
  errors: LeadCsvRowError[];
  /** Headers we saw but couldn't map to a canonical lead field. Useful for
   *  the dialog's "we ignored these columns" diagnostic. */
  unknownHeaders: string[];
  /** Canonical headers we expected but didn't see in the file. */
  missingRequired: string[];
  /** Source columns that collapsed to the same canonical key (e.g. both
   *  'Email' and 'Work Email' map to email — only the rightmost wins). */
  duplicateHeaders: Array<{ canonical: string; sources: string[] }>;
  /** Per-row value-level coercions the dialog should surface so the user
   *  doesn't end up with a silently inflated 'New' cohort etc. */
  coercions: LeadCsvCoercion[];
  /** True when the import was halted early because too many consecutive
   *  rows failed with the same systemic error (auth/RLS). */
  aborted: boolean;
}

/** Build a CreateLeadInput from a single parsed CSV row. Splits full_name
 *  into first/last when explicit columns weren't provided. Returns either
 *  ok=true with the input, or ok=false with a human-readable reason. Also
 *  appends to coercions[] for any value-level normalisations the importer
 *  applied silently (e.g. unknown lead_status → 'new'), so the dialog can
 *  warn the user instead of letting them discover the mismatch later. */
const buildLeadInput = (
  row: Record<string, string>,
  workspaceId: string,
  rowNumber: number,
  coercions: LeadCsvCoercion[],
  extraColumns: string[] = [],
): { ok: true; input: CreateLeadInput } | { ok: false; reason: string } => {
  let firstName = row.first_name?.trim() ?? "";
  let lastName = row.last_name?.trim() ?? "";

  if (!lastName && row.full_name?.trim()) {
    const parts = row.full_name.trim().split(/\s+/);
    if (parts.length === 1) {
      lastName = parts[0];
    } else {
      firstName = firstName || parts.slice(0, -1).join(" ");
      lastName = parts[parts.length - 1];
    }
  }

  if (!lastName) {
    return { ok: false, reason: "Missing last name (or full name)." };
  }

  const company = row.company?.trim() ?? "";
  if (!company) {
    return { ok: false, reason: "Missing company. Set a Company column, or 'Organization' / 'Account'." };
  }

  const annualRevenue = parseNumber(row.annual_revenue);
  const noOfEmployeesRaw = parseNumber(row.no_of_employees);
  const noOfEmployees =
    noOfEmployeesRaw == null ? null : Math.round(noOfEmployeesRaw);

  // Track coercions on lead_status so the user sees a 'these rows had
  // unknown statuses' panel rather than ending up with a falsely inflated
  // "New" cohort after the import.
  const rawStatus = row.lead_status?.trim() ?? "";
  let status: LeadStatus = "new";
  if (rawStatus) {
    const parsed = parseLeadStatusValue(rawStatus);
    if (parsed) {
      status = parsed;
    } else {
      coercions.push({
        row: rowNumber,
        field: "lead_status",
        original: rawStatus,
        coercedTo: "new",
      });
    }
  }

  // Fold any "Keep extra columns" picks from the import dialog into
  // customFields so the rep doesn't lose data the CSV had that doesn't
  // match a standard lead column.
  const customFields: Record<string, unknown> = {};
  for (const col of extraColumns) {
    const key = col.trim();
    if (!key) continue;
    const val = row[key];
    if (val == null || val === '') continue;
    customFields[key] = val;
  }

  const input: CreateLeadInput = {
    workspaceId,
    salutation: row.salutation || null,
    firstName: firstName || null,
    lastName,
    title: row.title || null,
    email: row.email || null,
    phone: row.phone || null,
    mobile: row.mobile || null,
    fax: row.fax || null,
    website: row.website || null,
    skypeId: row.skype_id || null,
    twitter: row.twitter || null,
    linkedinUrl: row.linkedin_url || null,
    company,
    industry: row.industry || null,
    annualRevenue,
    noOfEmployees,
    street: row.street || null,
    city: row.city || null,
    state: row.state || null,
    postalCode: row.postal_code || null,
    country: row.country || null,
    leadOwnerName: row.lead_owner_name || null,
    leadSource: row.lead_source || null,
    leadStatus: status,
    rating: row.rating || null,
    description: row.description || null,
    tags: parseTagList(row.tags),
    customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
  };

  return { ok: true, input };
};

/** Headers the importer actively reads. Anything outside this set is
 *  ignored (and reported back in unknownHeaders so the dialog can warn). */
const KNOWN_LEAD_HEADERS = new Set<string>([
  "first_name", "last_name", "full_name", "salutation", "title",
  "email", "phone", "mobile", "fax", "website",
  "company", "industry", "annual_revenue", "no_of_employees",
  "street", "city", "state", "country", "postal_code",
  "lead_owner_name", "lead_source", "lead_status", "rating",
  "description", "tags",
  "skype_id", "twitter", "linkedin_url",
]);

const REQUIRED_LEAD_HEADERS = ["last_name", "company"] as const;

/** When this many consecutive rows fail with the exact same error message,
 *  we assume the failure is structural (RLS / auth / workspace mismatch)
 *  and abort the loop rather than burn through hundreds of identical
 *  Supabase round-trips against a tenant the rep can't write to. */
const IDENTICAL_FAILURE_ABORT_THRESHOLD = 5;

export const computeImportPrecheck = (
  rows: Array<Record<string, string>>,
  extraColumns: string[] = [],
): { unknownHeaders: string[]; missingRequired: string[] } => {
  const seen = new Set<string>();
  if (rows.length > 0) {
    for (const k of Object.keys(rows[0])) seen.add(k);
  }
  // Columns the rep explicitly opted to keep are not "unknown" anymore —
  // they're intentional custom fields.
  const extra = new Set(extraColumns.map((s) => s.trim()).filter(Boolean));
  const unknownHeaders = Array.from(seen).filter(
    (h) => !KNOWN_LEAD_HEADERS.has(h) && h !== "full_name" && !extra.has(h),
  );
  const missingRequired = REQUIRED_LEAD_HEADERS.filter(
    (h) => !(seen.has(h) || (h === "last_name" && seen.has("full_name"))),
  );
  return { unknownHeaders, missingRequired: [...missingRequired] };
};

export const importLeadsFromCsv = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  workspaceId: string,
  rows: Array<Record<string, string>>,
  options: {
    duplicateHeaders?: Array<{ canonical: string; sources: string[] }>;
    /** Extra CSV column names the rep ticked in "Keep extra columns" —
     *  these become lead.customFields entries instead of being dropped. */
    extraColumns?: string[];
  } = {},
): Promise<ImportLeadsResult> => {
  const errors: LeadCsvRowError[] = [];
  const imported: Lead[] = [];
  const coercions: LeadCsvCoercion[] = [];
  const extraColumns = (options.extraColumns ?? []).map((s) => s.trim()).filter(Boolean);
  const { unknownHeaders, missingRequired } = computeImportPrecheck(rows, extraColumns);
  const duplicateHeaders = options.duplicateHeaders ?? [];

  // Circuit-breaker state. Track the last error message and how many times
  // we've seen it in a row.
  let lastErrorMessage: string | null = null;
  let consecutiveIdenticalErrors = 0;
  let aborted = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;
    const built = buildLeadInput(row, workspaceId, rowNumber, coercions, extraColumns);
    if (!built.ok) {
      errors.push({ row: rowNumber, message: built.reason });
      lastErrorMessage = built.reason;
      consecutiveIdenticalErrors += 1;
      // Pre-validation errors don't usually pile up identically across
      // hundreds of rows, but if they do (e.g. every row missing company),
      // bail out early too.
      if (consecutiveIdenticalErrors >= IDENTICAL_FAILURE_ABORT_THRESHOLD) {
        errors.push({
          row: rowNumber + 1,
          message: `Aborted after ${consecutiveIdenticalErrors} identical "${lastErrorMessage}" errors — fix the source data and re-import.`,
        });
        aborted = true;
        break;
      }
      continue;
    }
    try {
      const lead = await createLead(organizationId, userId, userName, built.input);
      imported.push(lead);
      consecutiveIdenticalErrors = 0;
      lastErrorMessage = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push({ row: rowNumber, message });
      if (message === lastErrorMessage) {
        consecutiveIdenticalErrors += 1;
      } else {
        lastErrorMessage = message;
        consecutiveIdenticalErrors = 1;
      }
      if (consecutiveIdenticalErrors >= IDENTICAL_FAILURE_ABORT_THRESHOLD) {
        errors.push({
          row: rowNumber + 1,
          message: `Aborted after ${consecutiveIdenticalErrors} identical "${message}" errors — likely a permission / workspace issue. Fix and retry.`,
        });
        aborted = true;
        break;
      }
    }
  }

  return {
    imported, errors, unknownHeaders, missingRequired,
    duplicateHeaders, coercions, aborted,
  };
};

/** Static CSV template the dialog offers as a "Download template" link.
 *  Match Zoho's column order so reps coming from there feel at home. */
export const buildLeadsCsvTemplate = (): string => {
  const headers = [
    "salutation", "first_name", "last_name", "title", "company",
    "email", "phone", "mobile", "website",
    "industry", "annual_revenue", "no_of_employees",
    "street", "city", "state", "postal_code", "country",
    "lead_source", "lead_status", "rating",
    "description", "tags",
    "linkedin_url", "twitter", "skype_id",
  ];
  const sample = [
    "Ms.", "Sam", "Smith", "Owner", "Sam's Cafe",
    "sam@samscafe.com", "+15551112222", "+15553334444", "samscafe.com",
    "Small/Medium Enterprise", "500000", "5",
    "12 Main St", "Boston", "MA", "02108", "USA",
    "Web Research", "new", "Active",
    "Interested in a yearly contract.", "vip,hot",
    "https://linkedin.com/in/example", "@samscafe", "sam.live",
  ];
  const escape = (v: string) => /[",\n\r]/.test(v)
    ? `"${v.replace(/"/g, '""')}"`
    : v;
  return [headers.join(","), sample.map(escape).join(",")].join("\n") + "\n";
};

