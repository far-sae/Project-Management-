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
  return mapLead(data as Record<string, unknown>);
};

export const deleteLead = async (
  organizationId: string,
  leadId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal<Lead>(STORE.leads(organizationId), reviveLead);
    writeLocal(STORE.leads(organizationId), all.filter((l) => l.leadId !== leadId));
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

export const subscribeToLeads = (
  organizationId: string,
  callback: (leads: Lead[]) => void,
): (() => void) => {
  getOrganizationLeads(organizationId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};

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

  return () => { channel.unsubscribe(); };
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
    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .insert({
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
      })
      .select("client_id")
      .single();
    if (clientErr || !clientRow) {
      logger.error("convertLead: client insert failed:", clientErr);
      throw clientErr ?? new Error("Failed to create account");
    }
    clientId = clientRow.client_id as string;
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
  let contactId: string | null = null;
  if (input.createContact !== false) {
    const { data: contactRow, error: contactErr } = await supabase
      .from("client_contacts")
      .insert({
        client_id: clientId,
        organization_id: organizationId,
        first_name: lead.firstName,
        last_name: lead.lastName,
        full_name: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
        title: lead.title,
        email: lead.email,
        phone: lead.phone,
        mobile: lead.mobile,
        is_primary: !input.existingClientId,
        created_by: userId,
      })
      .select("contact_id")
      .single();
    if (contactErr) {
      logger.error("convertLead: contact insert failed:", contactErr);
      await rollback(null, null);
      throw new Error(
        `Couldn't create the contact (${contactErr.message ?? "unknown"}). Lead was not converted.`,
      );
    }
    contactId = contactRow.contact_id as string;
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
