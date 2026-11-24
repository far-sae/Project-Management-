import type { SupabaseClient } from "@supabase/supabase-js";
import { orgRoleOf, type OrgRole } from "../_signroom/context.js";
import { StoreError } from "../_signroom/errors.js";
import type { CallCountry } from "./shared/numbers.js";
import type { CallActivityMeta, CallOutcome, CallStatus } from "./shared/types.js";
import { forwardingOf, type Forwarding, type InboundStore } from "./inbound.js";

/**
 * What the calling server keeps: one row per call (crm_calls, migration 188)
 * and the timeline entry each finished call leaves on its lead or company.
 * Read and written with the service role only.
 */

/** The lead or company a call is for. */
export type Target = {
  kind: "contact" | "company";
  id: string;
  organizationId: string;
  workspaceId: string | null;
};

export type Call = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  userId: string;
  contactId: string | null;
  companyId: string | null;
  toNumber: string;
  fromNumber: string;
  country: CallCountry;
  status: CallStatus;
  callSid: string | null;
  seconds: number;
  recordingSid: string | null;
  recordingSeconds: number;
  outcome: CallOutcome | null;
  note: string;
  createdAt: string;
  endedAt: string | null;
  updatedAt: string;
  /** 'out': a call we placed. 'in': somebody called one of our numbers back. */
  direction: "out" | "in";
  /** The name of the person who took a call back. */
  answeredBy: string | null;
};

export type NewCall = Pick<Call, "organizationId" | "workspaceId" | "userId" | "contactId" | "companyId" | "toNumber" | "fromNumber" | "country">;
export type CallPatch = Partial<Pick<Call, "status" | "callSid" | "seconds" | "recordingSid" | "recordingSeconds" | "outcome" | "note" | "endedAt" | "answeredBy">>;

/** The names behind the ids on a list of calls. An id that is missing was deleted since. */
export type Names = { contacts: Record<string, string>; companies: Record<string, string>; users: Record<string, string> };

export interface VoiceStore extends InboundStore {
  /** False until migration 188 has been run. */
  tablesReady(): Promise<boolean>;
  /** False until the call-backs table (migration 211) is there. */
  forwardingReady(): Promise<boolean>;
  saveForwarding(organizationId: string, value: Forwarding, userId: string): Promise<void>;
  /** The organisation a workspace belongs to, or null when there is no such workspace. */
  workspaceOrg(workspaceId: string): Promise<string | null>;
  /** The calls of a workspace that reached the provider, newest first, older than `before` when given. */
  listCalls(workspaceId: string, opts: { before?: string; limit: number }): Promise<Call[]>;
  /** How the calls of a workspace since `since` went: status and length of each. */
  callResults(workspaceId: string, since: string): Promise<Array<Pick<Call, "status" | "seconds">>>;
  names(ids: { contacts: string[]; companies: string[]; users: string[] }): Promise<Names>;
  /** The person's role in an organisation, or null when they are not an active member. */
  orgRole(organizationId: string, userId: string): Promise<OrgRole | null>;
  contact(id: string): Promise<Target | null>;
  company(id: string): Promise<Target | null>;
  /** How many calls this person has started since `since`. */
  callsSince(userId: string, since: string): Promise<number>;
  insertCall(call: NewCall): Promise<Call>;
  getCall(id: string): Promise<Call | null>;
  patchCall(id: string, patch: CallPatch): Promise<Call | null>;
  /** Writes (or rewrites) the call's one timeline entry. */
  saveActivity(call: Call, description: string, metadata: CallActivityMeta): Promise<void>;
  /** Removes the call and the timeline entry it left. */
  deleteCall(id: string): Promise<void>;
  /** Every call made to one lead, newest first. */
  callsOfContact(contactId: string): Promise<Call[]>;
  /** The phone numbers on a workspace's leads, as they were typed, to match a dialled number to its lead. */
  leadPhones(workspaceId: string): Promise<Array<{ id: string; phone: string }>>;
}

type Row = Record<string, any>;

/** Calls of one lead read at once. */
export const PERSON_CALLS_LIMIT = 1000;
/** Leads looked at when a dialled number is matched to its lead. */
export const LEAD_PHONES_LIMIT = 5000;

const callFrom = (r: Row): Call => ({
  id: r.id,
  organizationId: r.organization_id,
  workspaceId: r.workspace_id ?? null,
  userId: r.user_id,
  contactId: r.contact_id ?? null,
  companyId: r.company_id ?? null,
  toNumber: r.to_number,
  fromNumber: r.from_number,
  country: r.country,
  status: r.status,
  callSid: r.twilio_call_sid ?? null,
  seconds: Number(r.duration_seconds) || 0,
  recordingSid: r.recording_sid ?? null,
  recordingSeconds: Number(r.recording_seconds) || 0,
  outcome: r.outcome ?? null,
  note: r.note ?? "",
  createdAt: r.created_at,
  endedAt: r.ended_at ?? null,
  updatedAt: r.updated_at,
  // Columns migration 211 adds: absent before it is run, and every call is then one we placed.
  direction: r.direction === "in" ? "in" : "out",
  answeredBy: r.answered_by ?? null,
});

const COLUMN: Record<keyof CallPatch, string> = {
  status: "status",
  callSid: "twilio_call_sid",
  seconds: "duration_seconds",
  recordingSid: "recording_sid",
  recordingSeconds: "recording_seconds",
  outcome: "outcome",
  note: "note",
  endedAt: "ended_at",
  answeredBy: "answered_by",
};

export function supabaseStore(sb: SupabaseClient): VoiceStore {
  const must = <T>(reply: { data: T; error: { message?: string; code?: string } | null }): T => {
    if (reply.error) throw new StoreError(`${reply.error.code ?? ""} ${reply.error.message ?? "database error"}`.trim());
    return reply.data;
  };

  async function target(table: "crm_contacts" | "crm_companies", kind: Target["kind"], id: string): Promise<Target | null> {
    const r = must(await sb.from(table).select("id, organization_id, workspace_id").eq("id", id).maybeSingle()) as Row | null;
    return r ? { kind, id: r.id, organizationId: r.organization_id, workspaceId: r.workspace_id ?? null } : null;
  }

  return {
    async tablesReady() {
      const { error } = await sb.from("crm_calls").select("id").limit(1);
      return !error;
    },

    async workspaceOrg(workspaceId) {
      const w = must(await sb.from("workspaces").select("organization_id").eq("workspace_id", workspaceId).maybeSingle()) as Row | null;
      return w && typeof w.organization_id === "string" ? w.organization_id : null;
    },

    async listCalls(workspaceId, opts) {
      // A call still "starting" never reached the provider (the line failed first): it is not a call anyone made.
      let q = sb.from("crm_calls").select("*").eq("workspace_id", workspaceId).neq("status", "starting").order("created_at", { ascending: false }).limit(opts.limit);
      if (opts.before) q = q.lt("created_at", opts.before);
      return ((must(await q) as Row[] | null) ?? []).map(callFrom);
    },

    async callResults(workspaceId, since) {
      const data = must(
        await sb.from("crm_calls").select("status, duration_seconds").eq("workspace_id", workspaceId).neq("status", "starting").gte("created_at", since).limit(5000),
      ) as Row[] | null;
      return (data ?? []).map((r) => ({ status: r.status, seconds: Number(r.duration_seconds) || 0 }));
    },

    async names(ids) {
      const out: Names = { contacts: {}, companies: {}, users: {} };
      if (ids.contacts.length) {
        const rows = must(await sb.from("crm_contacts").select("id, first_name, last_name").in("id", ids.contacts)) as Row[] | null;
        for (const r of rows ?? []) out.contacts[r.id] = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
      }
      if (ids.companies.length) {
        const rows = must(await sb.from("crm_companies").select("id, name").in("id", ids.companies)) as Row[] | null;
        for (const r of rows ?? []) out.companies[r.id] = String(r.name ?? "");
      }
      if (ids.users.length) {
        // Names as people keep them themselves; a missing profile is simply left out.
        const got = await sb.from("user_profiles").select("id, display_name, email").in("id", ids.users);
        if (!got.error) for (const r of (got.data ?? []) as Row[]) out.users[r.id] = String(r.display_name || r.email || "");
      }
      return out;
    },

    async orgRole(organizationId, userId) {
      const o = must(await sb.from("organizations").select("owner_id, members").eq("organization_id", organizationId).maybeSingle()) as Row | null;
      return o ? orgRoleOf(o, userId) : null;
    },

    contact: (id) => target("crm_contacts", "contact", id),
    company: (id) => target("crm_companies", "company", id),

    async callsSince(userId, since) {
      const { count, error } = await sb.from("crm_calls").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
      if (error) throw new StoreError(error.message ?? "database error");
      return count ?? 0;
    },

    async insertCall(c) {
      const data = must(
        await sb
          .from("crm_calls")
          .insert({
            organization_id: c.organizationId,
            workspace_id: c.workspaceId,
            user_id: c.userId,
            contact_id: c.contactId,
            company_id: c.companyId,
            to_number: c.toNumber,
            from_number: c.fromNumber,
            country: c.country,
            status: "starting",
          })
          .select()
          .single(),
      ) as Row;
      return callFrom(data);
    },

    async getCall(id) {
      const data = must(await sb.from("crm_calls").select("*").eq("id", id).maybeSingle()) as Row | null;
      return data ? callFrom(data) : null;
    },

    async patchCall(id, patch) {
      const row: Row = { updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[COLUMN[k as keyof CallPatch]] = v;
      const data = must(await sb.from("crm_calls").update(row).eq("id", id).select().maybeSingle()) as Row | null;
      return data ? callFrom(data) : null;
    },

    async callsOfContact(contactId) {
      return ((must(await sb.from("crm_calls").select("*").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(PERSON_CALLS_LIMIT)) as Row[] | null) ?? []).map(callFrom);
    },

    async leadPhones(workspaceId) {
      const data = must(
        await sb.from("crm_contacts").select("id, phone").eq("workspace_id", workspaceId).not("phone", "is", null).order("created_at", { ascending: true }).limit(LEAD_PHONES_LIMIT),
      ) as Row[] | null;
      return (data ?? []).filter((r) => typeof r.phone === "string" && r.phone.trim() !== "").map((r) => ({ id: r.id as string, phone: r.phone as string }));
    },

    // ── Call-backs (migration 211) ──────────────────────────────────────

    async forwardingReady() {
      const { error } = await sb.from("crm_call_forwarding").select("organization_id").limit(1);
      return !error;
    },

    async forwarding(organizationId) {
      // A database without the table simply has no call-backs: nobody is rung.
      const { data, error } = await sb.from("crm_call_forwarding").select("enabled, people, ring_seconds, screen").eq("organization_id", organizationId).maybeSingle();
      return forwardingOf(error ? null : (data as Row | null));
    },

    async saveForwarding(organizationId, value, userId) {
      must(await sb.from("crm_call_forwarding").upsert({
        organization_id: organizationId, enabled: value.enabled, people: value.people, ring_seconds: value.ringSeconds, screen: value.screen,
        updated_by: userId, updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id" }));
    },

    async forwardingOrgs() {
      const { data, error } = await sb.from("crm_call_forwarding").select("organization_id, people").eq("enabled", true).limit(50);
      if (error) return [];
      return ((data ?? []) as Row[]).filter((r) => Array.isArray(r.people) && r.people.length > 0).map((r) => String(r.organization_id));
    },

    async lastCallTo(number) {
      // Only calls we placed: a call back is never the reason the next one finds its organisation.
      const { data, error } = await sb.from("crm_calls").select("organization_id, workspace_id, user_id, contact_id, company_id, direction")
        .eq("to_number", number).order("created_at", { ascending: false }).limit(5);
      if (error) return null;
      const r = ((data ?? []) as Row[]).find((row) => row.direction !== "in");
      return r ? { organizationId: r.organization_id, workspaceId: r.workspace_id ?? null, userId: r.user_id, contactId: r.contact_id ?? null, companyId: r.company_id ?? null } : null;
    },

    async orgOwner(organizationId) {
      const o = must(await sb.from("organizations").select("owner_id").eq("organization_id", organizationId).maybeSingle()) as Row | null;
      return o && typeof o.owner_id === "string" ? o.owner_id : null;
    },

    async orgAdmins(organizationId) {
      const o = must(await sb.from("organizations").select("owner_id, members").eq("organization_id", organizationId).maybeSingle()) as Row | null;
      if (!o) return [];
      const members = Array.isArray(o.members) ? (o.members as Row[]) : [];
      const admins = members.filter((m) => ["owner", "admin"].includes(String(m.role))).map((m) => String(m.userId ?? m.user_id ?? "")).filter(Boolean);
      return [...new Set([...(typeof o.owner_id === "string" ? [o.owner_id] : []), ...admins])];
    },

    async insertIncoming(c) {
      const data = must(
        await sb.from("crm_calls").insert({
          organization_id: c.organizationId, workspace_id: c.workspaceId, user_id: c.userId, contact_id: c.contactId, company_id: c.companyId,
          to_number: c.toNumber, from_number: c.fromNumber, country: c.country, status: "ringing", twilio_call_sid: c.callSid, direction: "in",
        }).select().single(),
      ) as Row;
      return callFrom(data);
    },

    async nameOf(call) {
      if (call.contactId) {
        const r = must(await sb.from("crm_contacts").select("first_name, last_name").eq("id", call.contactId).maybeSingle()) as Row | null;
        const name = r ? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() : "";
        if (name) return name;
      }
      if (call.companyId) {
        const r = must(await sb.from("crm_companies").select("name").eq("id", call.companyId).maybeSingle()) as Row | null;
        if (r?.name) return String(r.name);
      }
      return "";
    },

    async notify(userIds, title, message, link) {
      if (userIds.length === 0) return;
      must(await sb.from("notifications").insert(userIds.map((userId) => ({ user_id: userId, type: "crm_call", title, message: message.slice(0, 300), read: false, link }))));
    },

    async deleteCall(id) {
      // The timeline entry has the call's own id; only a "call" entry is ever removed this way.
      must(await sb.from("crm_activities").delete().eq("id", id).eq("type", "call"));
      must(await sb.from("crm_calls").delete().eq("id", id));
    },

    async saveActivity(call, description, metadata) {
      // The entry's id is the call's id, so writing it twice (the provider's report and the person's own note) keeps one entry.
      must(
        await sb.from("crm_activities").upsert(
          {
            id: call.id,
            organization_id: call.organizationId,
            workspace_id: call.workspaceId,
            user_id: call.userId,
            type: "call",
            description,
            contact_id: call.contactId,
            company_id: call.companyId,
            metadata,
            created_at: call.createdAt,
          },
          { onConflict: "id" },
        ),
      );
    },
  };
}
