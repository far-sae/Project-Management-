import type { SupabaseClient } from "@supabase/supabase-js";
import { orgRoleOf, type OrgRole } from "../_signroom/context.js";
import { StoreError } from "../_signroom/errors.js";
import type { CallCountry } from "./shared/numbers.js";
import type { CallActivityMeta, CallOutcome, CallStatus } from "./shared/types.js";

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
};

export type NewCall = Pick<Call, "organizationId" | "workspaceId" | "userId" | "contactId" | "companyId" | "toNumber" | "fromNumber" | "country">;
export type CallPatch = Partial<Pick<Call, "status" | "callSid" | "seconds" | "recordingSid" | "recordingSeconds" | "outcome" | "note" | "endedAt">>;

export interface VoiceStore {
  /** False until migration 188 has been run. */
  tablesReady(): Promise<boolean>;
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
}

type Row = Record<string, any>;

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
