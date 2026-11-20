import type { SupabaseClient } from "@supabase/supabase-js";
import { orgRoleOf, type OrgRole } from "../_signroom/context.js";
import { StoreError } from "../_signroom/errors.js";

/**
 * What the warm-up server reads and keeps: the organisation's own key for the
 * warm-up service (email_warmup_keys, migration 189, encrypted, server only)
 * and the sending mailboxes it already has (email_accounts and their stored
 * password). Read and written with the service role only.
 */

export type Mailbox = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  email: string;
  fromName: string;
  username: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string | null;
  imapPort: number | null;
};

export interface WarmupStore {
  /** False until migration 189 has been run. */
  tablesReady(): Promise<boolean>;
  orgRole(organizationId: string, userId: string): Promise<OrgRole | null>;
  /** The organisation's key for the warm-up service, still encrypted, or null. */
  key(organizationId: string): Promise<string | null>;
  saveKey(organizationId: string, encrypted: string, userId: string): Promise<void>;
  removeKey(organizationId: string): Promise<void>;
  /** The organisation's sending mailboxes; one workspace's when given. */
  mailboxes(organizationId: string, workspaceId: string | null): Promise<Mailbox[]>;
  mailbox(id: string): Promise<Mailbox | null>;
  /** The mailbox's stored password, still encrypted, or null. */
  mailboxSecret(id: string): Promise<string | null>;
}

type Row = Record<string, any>;

const COLUMNS = "id, organization_id, workspace_id, from_email, from_name, smtp_username, smtp_host, smtp_port, smtp_secure";

const mailboxFrom = (r: Row): Mailbox => ({
  id: r.id,
  organizationId: r.organization_id,
  workspaceId: r.workspace_id ?? null,
  email: String(r.from_email ?? "").trim().toLowerCase(),
  fromName: String(r.from_name ?? ""),
  username: String(r.smtp_username ?? ""),
  smtpHost: String(r.smtp_host ?? ""),
  smtpPort: Number(r.smtp_port) || 587,
  smtpSecure: r.smtp_secure === true,
  imapHost: typeof r.imap_host === "string" && r.imap_host.trim() ? r.imap_host.trim() : null,
  imapPort: typeof r.imap_port === "number" ? r.imap_port : null,
});

export function supabaseStore(sb: SupabaseClient): WarmupStore {
  const must = <T>(reply: { data: T; error: { message?: string; code?: string } | null }): T => {
    if (reply.error) throw new StoreError(`${reply.error.code ?? ""} ${reply.error.message ?? "database error"}`.trim());
    return reply.data;
  };

  /** With the inbox columns when the database has them (migration 157), without when it does not. */
  async function read(build: (columns: string) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>): Promise<Row[]> {
    let got = await build(`${COLUMNS}, imap_host, imap_port`);
    if (got.error) got = await build(COLUMNS);
    const data = must(got);
    return Array.isArray(data) ? (data as Row[]) : data ? [data as Row] : [];
  }

  return {
    async tablesReady() {
      const { error } = await sb.from("email_warmup_keys").select("organization_id").limit(1);
      return !error;
    },

    async orgRole(organizationId, userId) {
      const o = must(await sb.from("organizations").select("owner_id, members").eq("organization_id", organizationId).maybeSingle()) as Row | null;
      return o ? orgRoleOf(o, userId) : null;
    },

    async key(organizationId) {
      const r = must(await sb.from("email_warmup_keys").select("key_encrypted").eq("organization_id", organizationId).maybeSingle()) as Row | null;
      return r && typeof r.key_encrypted === "string" ? r.key_encrypted : null;
    },

    async saveKey(organizationId, encrypted, userId) {
      must(
        await sb
          .from("email_warmup_keys")
          .upsert({ organization_id: organizationId, key_encrypted: encrypted, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id" }),
      );
    },

    async removeKey(organizationId) {
      must(await sb.from("email_warmup_keys").delete().eq("organization_id", organizationId));
    },

    async mailboxes(organizationId, workspaceId) {
      const rows = await read((columns) => {
        const q = sb.from("email_accounts").select(columns).eq("organization_id", organizationId);
        return workspaceId ? q.eq("workspace_id", workspaceId) : q;
      });
      return rows.map(mailboxFrom);
    },

    async mailbox(id) {
      const rows = await read((columns) => sb.from("email_accounts").select(columns).eq("id", id).maybeSingle());
      return rows[0] ? mailboxFrom(rows[0]) : null;
    },

    async mailboxSecret(id) {
      const r = must(await sb.from("email_account_secrets").select("secret_encrypted").eq("account_id", id).maybeSingle()) as Row | null;
      return r && typeof r.secret_encrypted === "string" ? r.secret_encrypted : null;
    },
  };
}
