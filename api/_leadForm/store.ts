import type { SupabaseClient } from "@supabase/supabase-js";
import { StoreError } from "../_signroom/errors.js";

/**
 * What the web-form server reads and writes: the form, the submissions that
 * count towards its spam limit, and the lead it creates. Service role only.
 */

export type StoredForm = {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  askPhone: boolean;
  askCompany: boolean;
  askMessage: boolean;
  heading: string;
  intro: string;
  buttonLabel: string;
  thankYou: string;
  source: string;
  ownerId: string | null;
};

export type NewLead = {
  organizationId: string;
  workspaceId: string;
  ownerId: string | null;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  companyId: string | null;
  source: string;
};

export type SubmissionResult = "lead" | "again" | "refused";

export interface LeadFormStore {
  form(id: string): Promise<StoredForm | null>;
  /** How many times this sender has sent this form since `since`. */
  sentBySender(formId: string, senderHash: string, since: string): Promise<number>;
  /** How many times this form has been sent by anyone since `since`. */
  sentToForm(formId: string, since: string): Promise<number>;
  recordSubmission(formId: string, senderHash: string, result: SubmissionResult, contactId: string | null): Promise<void>;
  /** The lead of the workspace that already has this email address (compared without capitals), or null. */
  leadByEmail(workspaceId: string, email: string): Promise<{ id: string; ownerId: string | null } | null>;
  /** The workspace's company of this name (compared without capitals), made when it does not exist. */
  companyByName(organizationId: string, workspaceId: string, name: string, ownerId: string | null): Promise<string>;
  insertLead(lead: NewLead): Promise<string>;
  /** One line on the lead's timeline. `kind` is the CRM's own activity type. */
  note(lead: { id: string; organizationId: string; workspaceId: string }, kind: "contact_created" | "note", description: string, formId: string): Promise<void>;
  /** The organisation's owner and admins, for the "new lead" notice when the form gives its leads to nobody. */
  admins(organizationId: string): Promise<string[]>;
  notify(userIds: string[], title: string, message: string, link: string): Promise<void>;
}

type Row = Record<string, any>;

const formFrom = (r: Row): StoredForm => ({
  id: r.id,
  organizationId: r.organization_id,
  workspaceId: r.workspace_id,
  name: String(r.name ?? ""),
  enabled: r.enabled === true,
  askPhone: r.ask_phone !== false,
  askCompany: r.ask_company !== false,
  askMessage: r.ask_message !== false,
  heading: String(r.heading ?? ""),
  intro: String(r.intro ?? ""),
  buttonLabel: String(r.button_label ?? "Send"),
  thankYou: String(r.thank_you ?? ""),
  source: String(r.source ?? "Website form"),
  ownerId: r.owner_id ?? null,
});

/** `%` and `_` mean "anything" to ilike; an address or a name must be matched as written. */
const literal = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function supabaseStore(sb: SupabaseClient): LeadFormStore {
  const must = <T>(reply: { data: T; error: { message?: string; code?: string } | null }): T => {
    if (reply.error) throw new StoreError(`${reply.error.code ?? ""} ${reply.error.message ?? "database error"}`.trim());
    return reply.data;
  };
  const count = async (q: PromiseLike<{ count: number | null; error: { message?: string } | null }>): Promise<number> => {
    const r = await q;
    if (r.error) throw new StoreError(r.error.message ?? "database error");
    return r.count ?? 0;
  };

  return {
    async form(id) {
      const got = await sb.from("crm_lead_forms").select("*").eq("id", id).maybeSingle();
      // Until migration 192 is run there is no such table, and so no such form: a visitor is told the form is not available.
      if (got.error && (got.error.code === "42P01" || got.error.code === "PGRST205")) return null;
      const r = must(got) as Row | null;
      return r ? formFrom(r) : null;
    },

    sentBySender: (formId, senderHash, since) =>
      count(sb.from("crm_lead_form_submissions").select("id", { count: "exact", head: true }).eq("form_id", formId).eq("sender_hash", senderHash).gte("created_at", since)),

    sentToForm: (formId, since) => count(sb.from("crm_lead_form_submissions").select("id", { count: "exact", head: true }).eq("form_id", formId).gte("created_at", since)),

    async recordSubmission(formId, senderHash, result, contactId) {
      must(await sb.from("crm_lead_form_submissions").insert({ form_id: formId, sender_hash: senderHash, result, contact_id: contactId }));
    },

    async leadByEmail(workspaceId, email) {
      const rows = must(await sb.from("crm_contacts").select("id, owner_id").eq("workspace_id", workspaceId).ilike("email", literal(email)).order("created_at", { ascending: true }).limit(1)) as Row[] | null;
      const r = rows?.[0];
      return r ? { id: r.id, ownerId: r.owner_id ?? null } : null;
    },

    async companyByName(organizationId, workspaceId, name, ownerId) {
      const found = must(await sb.from("crm_companies").select("id").eq("workspace_id", workspaceId).ilike("name", literal(name)).order("created_at", { ascending: true }).limit(1)) as Row[] | null;
      if (found?.[0]) return found[0].id as string;
      const made = must(await sb.from("crm_companies").insert({ organization_id: organizationId, workspace_id: workspaceId, owner_id: ownerId, name }).select("id").single()) as Row;
      return made.id as string;
    },

    async insertLead(lead) {
      const made = must(
        await sb
          .from("crm_contacts")
          .insert({
            organization_id: lead.organizationId,
            workspace_id: lead.workspaceId,
            owner_id: lead.ownerId,
            first_name: lead.firstName,
            last_name: lead.lastName,
            email: lead.email,
            phone: lead.phone,
            company_id: lead.companyId,
            lifecycle_stage: "lead",
            lead_status: "new",
            source: lead.source,
          })
          .select("id")
          .single(),
      ) as Row;
      return made.id as string;
    },

    async note(lead, kind, description, formId) {
      must(
        await sb.from("crm_activities").insert({
          organization_id: lead.organizationId,
          workspace_id: lead.workspaceId,
          user_id: null,
          type: kind,
          description,
          contact_id: lead.id,
          metadata: { source: "lead_form", formId },
        }),
      );
    },

    async admins(organizationId) {
      const o = must(await sb.from("organizations").select("owner_id, members").eq("organization_id", organizationId).maybeSingle()) as Row | null;
      if (!o) return [];
      const ids = new Set<string>();
      if (typeof o.owner_id === "string") ids.add(o.owner_id);
      for (const m of Array.isArray(o.members) ? (o.members as Row[]) : []) {
        const active = m?.status === undefined || m?.status === null || m?.status === "active";
        if (m && typeof m.userId === "string" && active && (m.role === "owner" || m.role === "admin")) ids.add(m.userId);
      }
      return [...ids];
    },

    async notify(userIds, title, message, link) {
      if (userIds.length === 0) return;
      const now = new Date().toISOString();
      must(
        await sb.from("notifications").insert(
          userIds.map((userId) => ({ user_id: userId, type: "crm_lead", title, message, task_id: null, project_id: null, actor_user_id: null, actor_display_name: null, read: false, link, created_at: now })),
        ),
      );
    },
  };
}
