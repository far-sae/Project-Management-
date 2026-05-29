import { supabase } from "./config";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Types — the Contacts module exposes a denormalised "ContactWithAccount"
// shape so the list / detail / drawer don't have to do their own join when
// they want to show the parent account name and workspace.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactWithAccount {
  contactId: string;
  organizationId: string;
  workspaceId: string;
  clientId: string;
  clientName: string;
  clientType: string | null;

  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  title: string | null;
  department: string | null;

  email: string | null;
  secondaryEmail: string | null;
  phone: string | null;
  mobile: string | null;
  homePhone: string | null;
  otherPhone: string | null;
  asstPhone: string | null;
  fax: string | null;
  skypeId: string | null;
  twitter: string | null;
  linkedinUrl: string | null;

  mailingStreet: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
  mailingCountry: string | null;
  otherStreet: string | null;
  otherCity: string | null;
  otherState: string | null;
  otherZip: string | null;
  otherCountry: string | null;

  assistant: string | null;
  reportingTo: string | null;
  reportingToName: string | null;

  leadSource: string | null;
  dateOfBirth: Date | null;
  emailOptOut: boolean;
  description: string | null;
  notes: string | null;
  tags: string[];
  ownerId: string | null;
  ownerName: string | null;
  photoUrl: string | null;
  isPrimary: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContactWithAccountInput {
  clientId: string;        // parent account is required
  salutation?: string | null;
  firstName?: string | null;
  lastName: string;
  title?: string | null;
  department?: string | null;
  email?: string | null;
  secondaryEmail?: string | null;
  phone?: string | null;
  mobile?: string | null;
  homePhone?: string | null;
  otherPhone?: string | null;
  asstPhone?: string | null;
  fax?: string | null;
  skypeId?: string | null;
  twitter?: string | null;
  linkedinUrl?: string | null;
  mailingStreet?: string | null;
  mailingCity?: string | null;
  mailingState?: string | null;
  mailingZip?: string | null;
  mailingCountry?: string | null;
  otherStreet?: string | null;
  otherCity?: string | null;
  otherState?: string | null;
  otherZip?: string | null;
  otherCountry?: string | null;
  assistant?: string | null;
  reportingTo?: string | null;
  leadSource?: string | null;
  dateOfBirth?: Date | null;
  emailOptOut?: boolean;
  description?: string | null;
  notes?: string | null;
  tags?: string[];
  ownerId?: string | null;
  ownerName?: string | null;
  isPrimary?: boolean;
  photoUrl?: string | null;
}

export type UpdateContactInput = Partial<Omit<CreateContactWithAccountInput, "clientId">>
  & { clientId?: string };

// ─────────────────────────────────────────────────────────────────────────────
// Constants / Lookups (Zoho defaults, kept compact)
// ─────────────────────────────────────────────────────────────────────────────

export const CONTACT_LEAD_SOURCE_OPTIONS = [
  "Advertisement", "Cold Call", "Employee Referral", "External Referral",
  "Online Store", "Partner", "Public Relations", "Sales Email Alias",
  "Seminar Partner", "Seminar Internal", "Trade Show", "Web Download",
  "Web Research", "Chat", "Twitter", "Facebook", "LinkedIn", "Other",
] as const;

export const CONTACT_SALUTATIONS = ["Mr.", "Ms.", "Mrs.", "Dr.", "Prof."] as const;

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

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");

/** Build a Date at LOCAL midnight from a 'YYYY-MM-DD' string. `new Date(str)`
 *  parses as UTC midnight which then shifts in negative-UTC timezones. */
const parseLocalDate = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/** Inverse of parseLocalDate: produce 'YYYY-MM-DD' from a local-midnight
 *  Date without going through toISOString (which would re-introduce the
 *  UTC shift). */
const formatLocalDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────────────────────────────────────

interface ContactRow {
  contact_id: string;
  organization_id: string;
  client_id: string;
  salutation: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  department: string | null;
  email: string | null;
  secondary_email: string | null;
  phone: string | null;
  mobile: string | null;
  home_phone: string | null;
  other_phone: string | null;
  asst_phone: string | null;
  fax: string | null;
  skype_id: string | null;
  twitter: string | null;
  linkedin_url: string | null;
  mailing_street: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  mailing_country: string | null;
  other_street: string | null;
  other_city: string | null;
  other_state: string | null;
  other_zip: string | null;
  other_country: string | null;
  assistant: string | null;
  reporting_to: string | null;
  lead_source: string | null;
  date_of_birth: string | null;
  email_opt_out: boolean | null;
  description: string | null;
  notes: string | null;
  tags: string[] | null;
  owner_id: string | null;
  owner_name: string | null;
  photo_url: string | null;
  is_primary: boolean | null;
  created_at: string;
  updated_at: string;
  // joined from clients
  client?: { name: string; type: string | null; workspace_id: string } | null;
}

const mapContactWithAccount = (
  r: ContactRow,
  reportingToName?: string | null,
): ContactWithAccount => ({
  contactId: r.contact_id,
  organizationId: r.organization_id,
  workspaceId: r.client?.workspace_id ?? "",
  clientId: r.client_id,
  clientName: r.client?.name ?? "",
  clientType: r.client?.type ?? null,

  salutation: r.salutation,
  firstName: r.first_name,
  lastName: r.last_name,
  fullName: r.full_name,
  title: r.title,
  department: r.department,

  email: r.email,
  secondaryEmail: r.secondary_email,
  phone: r.phone,
  mobile: r.mobile,
  homePhone: r.home_phone,
  otherPhone: r.other_phone,
  asstPhone: r.asst_phone,
  fax: r.fax,
  skypeId: r.skype_id,
  twitter: r.twitter,
  linkedinUrl: r.linkedin_url,

  mailingStreet: r.mailing_street,
  mailingCity: r.mailing_city,
  mailingState: r.mailing_state,
  mailingZip: r.mailing_zip,
  mailingCountry: r.mailing_country,
  otherStreet: r.other_street,
  otherCity: r.other_city,
  otherState: r.other_state,
  otherZip: r.other_zip,
  otherCountry: r.other_country,

  assistant: r.assistant,
  reportingTo: r.reporting_to,
  reportingToName: reportingToName ?? null,

  leadSource: r.lead_source,
  // Postgres returns 'YYYY-MM-DD' for date columns. `new Date(str)` parses
  // that as UTC midnight, which then renders as the previous local day in
  // any negative-UTC timezone (all of the Americas). Build the Date from
  // explicit local-time components so DOB doesn't drift on display.
  dateOfBirth: r.date_of_birth ? parseLocalDate(r.date_of_birth) : null,
  emailOptOut: Boolean(r.email_opt_out),
  description: r.description,
  notes: r.notes,
  tags: Array.isArray(r.tags) ? r.tags : [],
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  photoUrl: r.photo_url,
  isPrimary: Boolean(r.is_primary),

  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const validateContactInput = (input: CreateContactWithAccountInput) => {
  if (!sanitize(input.lastName)) throw new Error("Last name is required");
  if (!input.clientId) throw new Error("Pick an account to attach this contact to");
  if (input.email && !EMAIL_RE.test(input.email.trim())) {
    throw new Error("Invalid email address");
  }
  if (input.secondaryEmail && !EMAIL_RE.test(input.secondaryEmail.trim())) {
    throw new Error("Invalid secondary email");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

/** Cross-account contacts for the org. Optionally filtered to a subset of
 *  clientIds (used by useContacts to enforce workspace scoping). */
export const getOrganizationContacts = async (
  organizationId: string,
  opts: { clientIds?: string[] | null } = {},
): Promise<ContactWithAccount[]> => {
  if (isLocalOrg(organizationId)) return [];

  let q = supabase
    .from("client_contacts")
    .select(`
      *,
      client:clients!client_contacts_client_id_fkey (
        name, type, workspace_id
      )
    `)
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  if (opts.clientIds) {
    if (opts.clientIds.length === 0) return [];
    q = q.in("client_id", opts.clientIds);
  }

  const { data, error } = await q;
  if (error) {
    logger.error("getOrganizationContacts failed:", error);
    return [];
  }

  const rows = (data ?? []) as ContactRow[];

  // Second pass: resolve reporting_to → name. One round-trip total because we
  // batch the lookup. Worth the network cost: the detail drawer shows it
  // prominently and the table groups by reporting tree.
  const reportingToIds = Array.from(
    new Set(rows.map((r) => r.reporting_to).filter((v): v is string => !!v)),
  );
  const reportingToNameMap = new Map<string, string>();
  if (reportingToIds.length > 0) {
    const { data: rep } = await supabase
      .from("client_contacts")
      .select("contact_id, full_name, first_name, last_name")
      .in("contact_id", reportingToIds);
    for (const r of (rep ?? []) as Array<{
      contact_id: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>) {
      const name =
        r.full_name ?? [r.first_name, r.last_name].filter(Boolean).join(" ");
      reportingToNameMap.set(r.contact_id, name || "—");
    }
  }

  return rows.map((r) =>
    mapContactWithAccount(
      r,
      r.reporting_to ? reportingToNameMap.get(r.reporting_to) ?? null : null,
    ),
  );
};

export const getContact = async (
  organizationId: string,
  contactId: string,
): Promise<ContactWithAccount | null> => {
  if (isLocalOrg(organizationId)) return null;
  const { data, error } = await supabase
    .from("client_contacts")
    .select(`
      *,
      client:clients!client_contacts_client_id_fkey (
        name, type, workspace_id
      )
    `)
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error || !data) {
    if (error) logger.error("getContact failed:", error);
    return null;
  }
  const row = data as ContactRow;
  let reportingToName: string | null = null;
  if (row.reporting_to) {
    const { data: rep } = await supabase
      .from("client_contacts")
      .select("contact_id, full_name, first_name, last_name")
      .eq("contact_id", row.reporting_to)
      .maybeSingle();
    if (rep) {
      const r = rep as {
        full_name: string | null;
        first_name: string | null;
        last_name: string | null;
      };
      reportingToName =
        r.full_name ?? [r.first_name, r.last_name].filter(Boolean).join(" ") ?? null;
    }
  }
  return mapContactWithAccount(row, reportingToName);
};

/** Contacts who report to the given contact. Workspace-aware: callers pass
 *  the set of client IDs visible in the current workspace so cross-workspace
 *  reporting edges don't leak into the drawer when a parent account is
 *  later moved to a different workspace. Passing `null` keeps the prior
 *  org-wide behaviour for the All-workspaces view. */
export const getReportingContacts = async (
  organizationId: string,
  contactId: string,
  opts: { allowedClientIds?: string[] | null } = {},
): Promise<ContactWithAccount[]> => {
  if (isLocalOrg(organizationId)) return [];
  let q = supabase
    .from("client_contacts")
    .select(`
      *,
      client:clients!client_contacts_client_id_fkey (
        name, type, workspace_id
      )
    `)
    .eq("organization_id", organizationId)
    .eq("reporting_to", contactId);
  if (opts.allowedClientIds) {
    if (opts.allowedClientIds.length === 0) return [];
    q = q.in("client_id", opts.allowedClientIds);
  }
  const { data, error } = await q;
  if (error) {
    logger.error("getReportingContacts failed:", error);
    return [];
  }
  return ((data ?? []) as ContactRow[]).map((r) => mapContactWithAccount(r));
};

export const createContactFull = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateContactWithAccountInput,
): Promise<ContactWithAccount> => {
  validateContactInput(input);
  if (isLocalOrg(organizationId)) {
    throw new Error(
      "Contacts aren't supported in local-only mode. Connect Supabase first.",
    );
  }

  const row: Record<string, unknown> = {
    organization_id: organizationId,
    client_id: input.clientId,
    salutation: sanitize(input.salutation),
    first_name: sanitize(input.firstName),
    last_name: sanitize(input.lastName)!,
    full_name:
      [sanitize(input.firstName), sanitize(input.lastName)]
        .filter(Boolean)
        .join(" ") || null,
    title: sanitize(input.title),
    department: sanitize(input.department),
    email: sanitize(input.email),
    secondary_email: sanitize(input.secondaryEmail),
    phone: sanitize(input.phone),
    mobile: sanitize(input.mobile),
    home_phone: sanitize(input.homePhone),
    other_phone: sanitize(input.otherPhone),
    asst_phone: sanitize(input.asstPhone),
    fax: sanitize(input.fax),
    skype_id: sanitize(input.skypeId),
    twitter: sanitize(input.twitter),
    linkedin_url: sanitize(input.linkedinUrl),
    mailing_street: sanitize(input.mailingStreet),
    mailing_city: sanitize(input.mailingCity),
    mailing_state: sanitize(input.mailingState),
    mailing_zip: sanitize(input.mailingZip),
    mailing_country: sanitize(input.mailingCountry),
    other_street: sanitize(input.otherStreet),
    other_city: sanitize(input.otherCity),
    other_state: sanitize(input.otherState),
    other_zip: sanitize(input.otherZip),
    other_country: sanitize(input.otherCountry),
    assistant: sanitize(input.assistant),
    reporting_to: input.reportingTo ?? null,
    lead_source: sanitize(input.leadSource),
    date_of_birth: input.dateOfBirth ? formatLocalDate(input.dateOfBirth) : null,
    email_opt_out: Boolean(input.emailOptOut),
    description: sanitize(input.description),
    notes: sanitize(input.notes),
    tags: sanitizeTags(input.tags),
    owner_id: input.ownerId ?? userId,
    owner_name: input.ownerName ?? userName,
    photo_url: sanitize(input.photoUrl),
    is_primary: Boolean(input.isPrimary),
    created_by: userId,
  };

  // If this contact is flagged primary, demote other primaries on the
  // same client first so the partial unique index on (client_id) where
  // is_primary is true isn't violated. Track which row we demoted so we
  // can restore it if the subsequent insert fails — otherwise a failed
  // insert leaves the account with NO primary contact.
  let demotedContactId: string | null = null;
  if (input.isPrimary) {
    const { data: demoted } = await supabase
      .from("client_contacts")
      .update({ is_primary: false })
      .eq("organization_id", organizationId)
      .eq("client_id", input.clientId)
      .eq("is_primary", true)
      .select("contact_id")
      .maybeSingle();
    demotedContactId = (demoted as { contact_id?: string } | null)?.contact_id ?? null;
  }

  const { data, error } = await supabase
    .from("client_contacts")
    .insert(row)
    .select(`*, client:clients!client_contacts_client_id_fkey ( name, type, workspace_id )`)
    .single();
  if (error || !data) {
    logger.error("createContactFull failed:", error);
    // Restore the previously-primary contact so the account isn't left
    // with zero primaries because of a failed insert. Best-effort — if
    // the restore itself fails we still want to surface the original
    // insert error to the caller.
    if (demotedContactId) {
      try {
        await supabase
          .from("client_contacts")
          .update({ is_primary: true })
          .eq("contact_id", demotedContactId);
      } catch (restoreErr) {
        logger.warn("createContactFull: failed to restore primary after insert error:", restoreErr);
      }
    }
    throw error ?? new Error("Failed to create contact");
  }
  return mapContactWithAccount(data as ContactRow);
};

export const updateContactFull = async (
  organizationId: string,
  contactId: string,
  input: UpdateContactInput,
): Promise<ContactWithAccount> => {
  if (input.email && !EMAIL_RE.test(input.email.trim())) {
    throw new Error("Invalid email address");
  }
  if (input.secondaryEmail && !EMAIL_RE.test(input.secondaryEmail.trim())) {
    throw new Error("Invalid secondary email");
  }
  if (isLocalOrg(organizationId)) {
    throw new Error("Contacts aren't supported in local-only mode.");
  }

  const patch: Record<string, unknown> = {};
  if (input.clientId !== undefined) patch.client_id = input.clientId;
  if (input.salutation !== undefined) patch.salutation = sanitize(input.salutation);
  if (input.firstName !== undefined) patch.first_name = sanitize(input.firstName);
  if (input.lastName !== undefined) patch.last_name = sanitize(input.lastName);
  if (input.firstName !== undefined || input.lastName !== undefined) {
    patch.full_name =
      [
        input.firstName !== undefined ? sanitize(input.firstName) : null,
        input.lastName !== undefined ? sanitize(input.lastName) : null,
      ]
        .filter(Boolean)
        .join(" ") || null;
  }
  if (input.title !== undefined) patch.title = sanitize(input.title);
  if (input.department !== undefined) patch.department = sanitize(input.department);
  if (input.email !== undefined) patch.email = sanitize(input.email);
  if (input.secondaryEmail !== undefined) patch.secondary_email = sanitize(input.secondaryEmail);
  if (input.phone !== undefined) patch.phone = sanitize(input.phone);
  if (input.mobile !== undefined) patch.mobile = sanitize(input.mobile);
  if (input.homePhone !== undefined) patch.home_phone = sanitize(input.homePhone);
  if (input.otherPhone !== undefined) patch.other_phone = sanitize(input.otherPhone);
  if (input.asstPhone !== undefined) patch.asst_phone = sanitize(input.asstPhone);
  if (input.fax !== undefined) patch.fax = sanitize(input.fax);
  if (input.skypeId !== undefined) patch.skype_id = sanitize(input.skypeId);
  if (input.twitter !== undefined) patch.twitter = sanitize(input.twitter);
  if (input.linkedinUrl !== undefined) patch.linkedin_url = sanitize(input.linkedinUrl);
  if (input.mailingStreet !== undefined) patch.mailing_street = sanitize(input.mailingStreet);
  if (input.mailingCity !== undefined) patch.mailing_city = sanitize(input.mailingCity);
  if (input.mailingState !== undefined) patch.mailing_state = sanitize(input.mailingState);
  if (input.mailingZip !== undefined) patch.mailing_zip = sanitize(input.mailingZip);
  if (input.mailingCountry !== undefined) patch.mailing_country = sanitize(input.mailingCountry);
  if (input.otherStreet !== undefined) patch.other_street = sanitize(input.otherStreet);
  if (input.otherCity !== undefined) patch.other_city = sanitize(input.otherCity);
  if (input.otherState !== undefined) patch.other_state = sanitize(input.otherState);
  if (input.otherZip !== undefined) patch.other_zip = sanitize(input.otherZip);
  if (input.otherCountry !== undefined) patch.other_country = sanitize(input.otherCountry);
  if (input.assistant !== undefined) patch.assistant = sanitize(input.assistant);
  if (input.reportingTo !== undefined) patch.reporting_to = input.reportingTo;
  if (input.leadSource !== undefined) patch.lead_source = sanitize(input.leadSource);
  if (input.dateOfBirth !== undefined) {
    patch.date_of_birth = input.dateOfBirth ? formatLocalDate(input.dateOfBirth) : null;
  }
  if (input.emailOptOut !== undefined) patch.email_opt_out = Boolean(input.emailOptOut);
  if (input.description !== undefined) patch.description = sanitize(input.description);
  if (input.notes !== undefined) patch.notes = sanitize(input.notes);
  if (input.tags !== undefined) patch.tags = sanitizeTags(input.tags);
  if (input.ownerId !== undefined) patch.owner_id = input.ownerId;
  if (input.ownerName !== undefined) patch.owner_name = input.ownerName;
  if (input.photoUrl !== undefined) patch.photo_url = sanitize(input.photoUrl);

  // Demote any existing primary on this client before flipping ours, so
  // the partial unique index on (client_id) where is_primary is true holds.
  if (input.isPrimary === true) {
    const { data: targetClient } = await supabase
      .from("client_contacts")
      .select("client_id")
      .eq("contact_id", contactId)
      .maybeSingle();
    const clientId =
      input.clientId ?? (targetClient as { client_id?: string } | null)?.client_id;
    if (clientId) {
      await supabase
        .from("client_contacts")
        .update({ is_primary: false })
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("is_primary", true)
        .neq("contact_id", contactId);
    }
    patch.is_primary = true;
  } else if (input.isPrimary === false) {
    patch.is_primary = false;
  }

  const { data, error } = await supabase
    .from("client_contacts")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .select(`*, client:clients!client_contacts_client_id_fkey ( name, type, workspace_id )`)
    .single();
  if (error || !data) {
    logger.error("updateContactFull failed:", error);
    throw error ?? new Error("Failed to update contact");
  }
  return mapContactWithAccount(data as ContactRow);
};

export const deleteContactFull = async (
  organizationId: string,
  contactId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) return;
  const { error } = await supabase
    .from("client_contacts")
    .delete()
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId);
  if (error) {
    logger.error("deleteContactFull failed:", error);
    throw error;
  }
};

export const subscribeToOrganizationContacts = (
  organizationId: string,
  callback: (contacts: ContactWithAccount[]) => void,
  opts: { clientIds?: string[] | null } = {},
): (() => void) => {
  getOrganizationContacts(organizationId, opts).then(callback);
  if (isLocalOrg(organizationId)) return () => {};

  const channel = supabase
    .channel(`contacts-${organizationId}-${Math.random().toString(36).slice(2, 9)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "client_contacts",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => { getOrganizationContacts(organizationId, opts).then(callback); },
    )
    .subscribe();

  return () => { channel.unsubscribe(); };
};

export const contactDisplayName = (c: ContactWithAccount): string => {
  if (c.fullName) return c.fullName;
  const parts = [c.salutation, c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "(unnamed)";
};
