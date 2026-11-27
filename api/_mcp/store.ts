import type { SupabaseClient } from "@supabase/supabase-js";
import { orgRoleOf } from "../_signroom/context.js";
import { StoreError } from "../_signroom/errors.js";
import type { Action, Connection, ConnectionStore } from "./http.js";
import type { AuthCode, McpAuthStore } from "./oauth.js";
import type { Campaign, CampaignStatus, Contact, EmailStore, Mailbox, OutboxRow } from "./tools.js";

/**
 * What the connector reads and keeps, on the service key (the server only).
 *
 * Its own tables (215_claude_connector.sql): mcp_connections, mcp_auth_codes,
 * mcp_tokens and mcp_actions. No browser can read them.
 *
 * The Email area's tables are read and written the way the Email page does
 * it. The service key skips the database's own rules, so every question of
 * "may this person" is asked in tools.ts before anything here is called.
 */

type Row = Record<string, any>;
type Reply<T> = { data: T; error: { message?: string; code?: string } | null };

const PAGE = 1000;
const CHUNK = 500;
const SUPPRESSED_MOST = 50_000;

const must = <T>(reply: Reply<T>): T => {
  if (reply.error) throw new StoreError(`${reply.error.code ?? ""} ${reply.error.message ?? "database error"}`.trim());
  return reply.data;
};
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Only what a search word may hold: it is put inside a filter, where a comma or a bracket would change its meaning. */
const searchWord = (v: string): string => v.replace(/[^\p{L}\p{N}@._ -]/gu, "").trim().slice(0, 80);

const contactFrom = (r: Row): Contact => ({
  id: r.id,
  firstName: text(r.first_name).trim(),
  lastName: text(r.last_name).trim(),
  email: text(r.email).trim() || null,
  jobTitle: text(r.job_title).trim(),
  painPoint: text(r.pain_point).trim(),
  groupId: typeof r.group_id === "string" ? r.group_id : null,
});

const campaignFrom = (r: Row): Campaign => ({
  id: r.id,
  organizationId: r.organization_id,
  workspaceId: r.workspace_id ?? null,
  kind: text(r.kind) || "bulk",
  name: text(r.name),
  subject: text(r.subject),
  bodyHtml: text(r.body_html),
  status: (text(r.status) || "draft") as CampaignStatus,
  accountId: r.account_id ?? null,
  scheduledAt: r.scheduled_at ?? null,
  createdAt: text(r.created_at),
  counts: { queued: num(r.queued_count), sent: num(r.sent_count), failed: num(r.failed_count), leftOut: num(r.suppressed_count), replied: num(r.replied_count), bounced: num(r.bounced_count), opened: num(r.opened_count) },
});

export function supabaseStore(sb: SupabaseClient): McpAuthStore & ConnectionStore & EmailStore {
  const connectionFrom = (r: Row): Connection & { organizationId: string } => ({ id: r.id, organizationId: r.organization_id, userId: r.user_id, clientName: text(r.client_name) || "Claude", createdAt: text(r.created_at), lastUsedAt: r.last_used_at ?? null });

  async function liveConnection(id: string): Promise<Row | null> {
    const row = must(await sb.from("mcp_connections").select("id, organization_id, user_id, client_hash, revoked_at").eq("id", id).maybeSingle()) as Row | null;
    return row && !row.revoked_at ? row : null;
  }

  return {
    // ── The connector's own tables ─────────────────────────────────────────
    async ready() {
      const { error } = await sb.from("mcp_connections").select("id").limit(1);
      return !error;
    },

    async saveCode(code: AuthCode) {
      must(
        await sb.from("mcp_auth_codes").insert({
          code_hash: code.hash,
          organization_id: code.organizationId,
          user_id: code.userId,
          client_hash: code.clientHash,
          client_name: code.clientName,
          redirect_uri: code.redirectUri,
          code_challenge: code.challenge,
          expires_at: code.expiresAt,
        }),
      );
      // Old codes are of no use to anybody: swept now and then, never the reason an Allow fails.
      await sb.from("mcp_auth_codes").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
    },

    async takeCode(hash, now) {
      // One statement: of two tries with the same code, only one finds it unused.
      const rows = must(await sb.from("mcp_auth_codes").update({ used_at: now }).eq("code_hash", hash).is("used_at", null).gt("expires_at", now).select("*")) as Row[] | null;
      const r = rows?.[0];
      return r ? { hash: r.code_hash, organizationId: r.organization_id, userId: r.user_id, clientHash: r.client_hash, clientName: r.client_name, redirectUri: r.redirect_uri, challenge: r.code_challenge, expiresAt: r.expires_at } : null;
    },

    async retireConnections(c, now) {
      const old = must(await sb.from("mcp_connections").update({ revoked_at: now }).eq("organization_id", c.organizationId).eq("user_id", c.userId).eq("client_name", c.clientName).is("revoked_at", null).select("id")) as Row[] | null;
      const ids = (old ?? []).map((r) => r.id);
      if (ids.length) must(await sb.from("mcp_tokens").delete().in("connection_id", ids));
    },

    async createConnection(c) {
      const row = must(await sb.from("mcp_connections").insert({ organization_id: c.organizationId, user_id: c.userId, client_name: c.clientName, client_hash: c.clientHash }).select("id").single()) as Row;
      return row.id;
    },

    async saveToken(t) {
      must(await sb.from("mcp_tokens").insert({ token_hash: t.hash, connection_id: t.connectionId, kind: t.kind, expires_at: t.expiresAt }));
      if (t.kind === "access") await sb.from("mcp_tokens").delete().eq("connection_id", t.connectionId).lt("expires_at", new Date().toISOString());
    },

    async takeRefresh(hash, now, clientHash) {
      // Whose token it is comes first: another client's try must neither work nor use the token up.
      const seen = must(await sb.from("mcp_tokens").select("connection_id, used_at, expires_at").eq("token_hash", hash).eq("kind", "refresh").maybeSingle()) as Row | null;
      const conn = seen ? await liveConnection(seen.connection_id) : null;
      if (!seen || !conn) return null;
      if (clientHash && conn.client_hash && conn.client_hash !== clientHash) return null;
      if (seen.used_at) return { connectionId: conn.id, again: true, usedAt: seen.used_at };
      // One statement: of two tries with the same token, only one finds it unused.
      const taken = must(await sb.from("mcp_tokens").update({ used_at: now }).eq("token_hash", hash).eq("kind", "refresh").is("used_at", null).gt("expires_at", now).select("connection_id")) as Row[] | null;
      if (taken?.[0]) return { connectionId: conn.id, again: false, usedAt: now };
      // Lost the race to another try a moment ago, or simply too old.
      return seen.expires_at > now ? { connectionId: conn.id, again: true, usedAt: now } : null;
    },

    async readAccess(hash, now) {
      const t = must(await sb.from("mcp_tokens").select("connection_id").eq("token_hash", hash).eq("kind", "access").gt("expires_at", now).maybeSingle()) as Row | null;
      const conn = t ? await liveConnection(t.connection_id) : null;
      return conn ? { connectionId: conn.id, organizationId: conn.organization_id, userId: conn.user_id } : null;
    },

    async revokeConnection(id, now) {
      must(await sb.from("mcp_connections").update({ revoked_at: now }).eq("id", id));
      must(await sb.from("mcp_tokens").delete().eq("connection_id", id));
    },

    async touchConnection(id, now) {
      await sb.from("mcp_connections").update({ last_used_at: now }).eq("id", id);
    },

    async connections(organizationId) {
      const rows = must(await sb.from("mcp_connections").select("*").eq("organization_id", organizationId).is("revoked_at", null).order("created_at", { ascending: false }).limit(100)) as Row[] | null;
      return (rows ?? []).map((r) => {
        const { organizationId: _org, ...rest } = connectionFrom(r);
        return rest;
      });
    },

    async connection(id) {
      const r = must(await sb.from("mcp_connections").select("*").eq("id", id).is("revoked_at", null).maybeSingle()) as Row | null;
      return r ? connectionFrom(r) : null;
    },

    async actions(organizationId, limit): Promise<Action[]> {
      const rows = must(await sb.from("mcp_actions").select("created_at, user_id, summary").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(limit)) as Row[] | null;
      return (rows ?? []).map((r) => ({ at: text(r.created_at), userId: r.user_id, summary: text(r.summary) }));
    },

    async logAction(a) {
      must(await sb.from("mcp_actions").insert({ connection_id: a.connectionId, organization_id: a.organizationId, user_id: a.userId, tool: a.tool, target_id: a.targetId, summary: a.summary }));
    },

    async countActions(organizationId, tool, since) {
      const { count, error } = await sb.from("mcp_actions").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("tool", tool).gte("created_at", since);
      if (error) throw new StoreError(`${error.code ?? ""} ${error.message ?? "database error"}`.trim());
      return count ?? 0;
    },

    async madeByClaude(organizationId, targetId, tool) {
      const { count, error } = await sb.from("mcp_actions").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("tool", tool).eq("target_id", targetId);
      if (error) throw new StoreError(`${error.code ?? ""} ${error.message ?? "database error"}`.trim());
      return (count ?? 0) > 0;
    },

    // ── People and places ──────────────────────────────────────────────────
    async orgRole(organizationId, userId) {
      const o = must(await sb.from("organizations").select("owner_id, members").eq("organization_id", organizationId).maybeSingle()) as Row | null;
      return o ? orgRoleOf(o, userId) : null;
    },

    async emailGiven(organizationId, userId) {
      // Before the Team page's "Pages" were set up the table is not there: the answer is then "nothing was chosen".
      const { data, error } = await sb.from("org_member_access").select("level").eq("organization_id", organizationId).eq("user_id", userId).eq("area", "email").maybeSingle();
      return error || !data ? null : text((data as Row).level) || null;
    },

    async workspaces(organizationId) {
      const rows = must(await sb.from("workspaces").select("workspace_id, name").eq("organization_id", organizationId).order("created_at", { ascending: true })) as Row[] | null;
      return (rows ?? []).map((r) => ({ id: r.workspace_id, name: text(r.name) || "Workspace" }));
    },

    async memberWorkspaceIds(organizationId, userId) {
      const rows = must(await sb.from("projects").select("workspace_id, owner_id, members").eq("organization_id", organizationId).not("workspace_id", "is", null)) as Row[] | null;
      const mine = (rows ?? []).filter((p) => p.owner_id === userId || (Array.isArray(p.members) && p.members.some((m: Row) => String(m?.userId ?? m?.user_id ?? "") === userId)));
      return [...new Set(mine.map((p) => String(p.workspace_id)))];
    },

    async ownOnly(workspaceId) {
      const { data, error } = await sb.from("crm_visibility").select("own_only").eq("workspace_id", workspaceId).maybeSingle();
      if (!error) return (data as Row | null)?.own_only === true;
      // The switch came with a later CRM file; where that table does not exist everybody sees every lead, as before.
      if (error.code === "42P01" || error.code === "PGRST205") return false;
      // Any other fault: not knowing is not a reason to show a member everybody's leads.
      throw new StoreError(`${error.code ?? ""} ${error.message ?? "database error"}`.trim());
    },

    async userEmail(userId) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      return error ? null : data?.user?.email ?? null;
    },

    // ── The Email area ─────────────────────────────────────────────────────
    async mailboxes(organizationId, workspaceId): Promise<Mailbox[]> {
      const rows = must(await sb.from("mailbox_status").select("*").eq("organization_id", organizationId).eq("workspace_id", workspaceId).order("last_sent_at", { ascending: true, nullsFirst: true })) as Row[] | null;
      return (rows ?? []).map((r) => ({ id: r.id, label: text(r.label), fromEmail: text(r.from_email), status: text(r.status), isActive: r.is_active !== false, pausedReason: r.paused_reason ?? null, dailyAllowance: num(r.effective_limit), sentToday: num(r.sent_today) }));
    },

    async groups(organizationId, workspaceId) {
      const rows = must(await sb.from("email_groups").select("id, name, angle").eq("organization_id", organizationId).eq("workspace_id", workspaceId).order("name", { ascending: true })) as Row[] | null;
      return (rows ?? []).map((r) => ({ id: r.id, name: text(r.name), angle: text(r.angle) }));
    },

    async contacts(organizationId, workspaceId, f) {
      const out: Contact[] = [];
      const idChunks: (string[] | null)[] = f.ids ? Array.from({ length: Math.ceil(f.ids.length / 100) }, (_, i) => f.ids!.slice(i * 100, i * 100 + 100)) : [null];
      for (const ids of idChunks) {
        for (let from = 0; out.length < f.limit; from += PAGE) {
          let q = sb.from("crm_contacts").select("*").eq("organization_id", organizationId).eq("workspace_id", workspaceId);
          if (ids) q = q.in("id", ids);
          // Chosen one by one, a lead without an address is still found, so the person can be told.
          else q = q.not("email", "is", null).neq("email", "");
          if (f.groupId) q = q.eq("group_id", f.groupId);
          if (f.ownerId) q = q.eq("owner_id", f.ownerId);
          const word = f.search ? searchWord(f.search) : "";
          if (word) q = q.or(`first_name.ilike.*${word}*,last_name.ilike.*${word}*,email.ilike.*${word}*`);
          const rows = (must(await q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + Math.min(PAGE, f.limit - out.length) - 1)) as Row[] | null) ?? [];
          out.push(...rows.map(contactFrom));
          if (rows.length < PAGE) break;
        }
      }
      return out.slice(0, f.limit);
    },

    async countContacts(organizationId, workspaceId, f) {
      let q = sb.from("crm_contacts").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("workspace_id", workspaceId).not("email", "is", null).neq("email", "");
      if (f.groupId) q = q.eq("group_id", f.groupId);
      if (f.ownerId) q = q.eq("owner_id", f.ownerId);
      const { count, error } = await q;
      if (error) throw new StoreError(`${error.code ?? ""} ${error.message ?? "database error"}`.trim());
      return count ?? 0;
    },

    async suppressed(organizationId) {
      const out: string[] = [];
      for (let from = 0; from < SUPPRESSED_MOST; from += PAGE) {
        const rows = (must(await sb.from("email_suppressions").select("email").eq("organization_id", organizationId).order("email", { ascending: true }).range(from, from + PAGE - 1)) as Row[] | null) ?? [];
        out.push(...rows.map((r) => text(r.email).trim().toLowerCase()));
        if (rows.length < PAGE) break;
      }
      return out;
    },

    async sendWindow(organizationId) {
      const { data, error } = await sb.from("email_settings").select("*").eq("organization_id", organizationId).maybeSingle();
      const r = data as Row | null;
      // No row: the database's own defaults apply (working hours, Monday to Friday, UTC).
      if (error) return null;
      if (!r) return { enabled: true, start: 8, end: 18, days: [1, 2, 3, 4, 5], timezone: "UTC" };
      return { enabled: r.send_window_enabled !== false, start: num(r.send_window_start), end: num(r.send_window_end), days: Array.isArray(r.send_days) ? r.send_days.map(num) : [1, 2, 3, 4, 5], timezone: text(r.send_timezone) || "UTC" };
    },

    async templates(organizationId, workspaceId) {
      const rows = must(await sb.from("email_templates").select("id, name, subject, body_html").eq("organization_id", organizationId).eq("workspace_id", workspaceId).order("name", { ascending: true })) as Row[] | null;
      return (rows ?? []).map((r) => ({ id: r.id, name: text(r.name), subject: text(r.subject), bodyHtml: text(r.body_html) }));
    },

    async saveTemplate(t) {
      if (t.id) {
        const rows = must(await sb.from("email_templates").update({ name: t.name, subject: t.subject, body_html: t.bodyHtml }).eq("id", t.id).eq("organization_id", t.organizationId).eq("workspace_id", t.workspaceId).select("id")) as Row[] | null;
        return rows?.[0]?.id ?? null;
      }
      const row = must(await sb.from("email_templates").insert({ organization_id: t.organizationId, workspace_id: t.workspaceId, created_by: t.userId, name: t.name, subject: t.subject, body_html: t.bodyHtml }).select("id").single()) as Row;
      return row.id;
    },

    async takesTurns() {
      // Told by a column 216 adds: where it is missing, a campaign is still given one mailbox when it starts.
      const { error } = await sb.from("email_campaigns").select("sender_name").limit(1);
      return !error;
    },

    async createCampaign(c) {
      // Always "bulk": that is the kind that gets the unsubscribe link, whatever the number of people.
      const row = must(
        await sb
          .from("email_campaigns")
          .insert({
            organization_id: c.organizationId, workspace_id: c.workspaceId, created_by: c.userId, account_id: c.accountId, kind: "bulk", name: c.name, subject: c.subject, body_html: c.bodyHtml,
            // Named only when there is something to keep, so a database from before 216 never hears of them.
            ...(c.senderName ? { sender_name: c.senderName } : {}),
            ...(c.replyTo ? { reply_to: c.replyTo } : {}),
          })
          .select("id")
          .single(),
      ) as Row;
      return row.id;
    },

    async addToOutbox(campaignId, organizationId, rows: OutboxRow[]) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        must(await sb.from("email_messages").insert(rows.slice(i, i + CHUNK).map((r) => ({ campaign_id: campaignId, organization_id: organizationId, contact_id: r.contactId, to_email: r.email, to_name: r.name, merge_data: r.mergeData }))));
      }
    },

    async setCounts(campaignId, queued, leftOut) {
      must(await sb.from("email_campaigns").update({ queued_count: queued, suppressed_count: leftOut }).eq("id", campaignId));
    },

    async campaign(organizationId, id) {
      const r = must(await sb.from("email_campaigns").select("*").eq("id", id).eq("organization_id", organizationId).maybeSingle()) as Row | null;
      return r ? campaignFrom(r) : null;
    },

    async campaigns(organizationId, workspaceId, limit) {
      const rows = must(await sb.from("email_campaigns").select("*").eq("organization_id", organizationId).eq("workspace_id", workspaceId).neq("kind", "sequence").order("created_at", { ascending: false }).limit(limit)) as Row[] | null;
      return (rows ?? []).map(campaignFrom);
    },

    async firstOutboxRow(campaignId) {
      const rows = must(await sb.from("email_messages").select("to_email, to_name, contact_id, merge_data").eq("campaign_id", campaignId).limit(1)) as Row[] | null;
      const r = rows?.[0];
      if (!r) return null;
      const merge: Record<string, string> = {};
      for (const [k, v] of Object.entries((r.merge_data ?? {}) as Row)) merge[k] = v === null || v === undefined ? "" : String(v);
      return { email: text(r.to_email), name: r.to_name ?? null, contactId: r.contact_id ?? null, mergeData: merge };
    },

    async startCampaign(id, at) {
      // A planned campaign is held back by each email's own "not before" time, as on the Email page. Starting now
      // sets that time to now, so nothing stays held back from an earlier try to plan it.
      must(await sb.from("email_messages").update({ send_after: at ?? new Date().toISOString() }).eq("campaign_id", id).eq("status", "queued"));
      const reply = await sb.from("email_campaigns").update({ status: at ? "scheduled" : "sending", scheduled_at: at }).eq("id", id).eq("status", "draft").select("id");
      // The database itself refuses to start a campaign in a workspace with no working mailbox (migration 168).
      if (reply.error && (reply.error.code === "23514" || /mailbox/i.test(reply.error.message ?? ""))) return "no_mailbox";
      const rows = must(reply) as Row[] | null;
      return rows?.length ? "started" : "changed";
    },

    async pauseCampaign(id) {
      const rows = must(await sb.from("email_campaigns").update({ status: "paused" }).eq("id", id).in("status", ["sending", "scheduled"]).select("id")) as Row[] | null;
      return (rows ?? []).length > 0;
    },

    async resumeCampaign(id, waiting) {
      const rows = must(await sb.from("email_campaigns").update({ status: waiting ? "scheduled" : "sending" }).eq("id", id).eq("status", "paused").select("id")) as Row[] | null;
      return (rows ?? []).length > 0;
    },

    async deleteDraft(id) {
      const rows = must(await sb.from("email_campaigns").delete().eq("id", id).eq("status", "draft").select("id")) as Row[] | null;
      return (rows ?? []).length > 0;
    },
  };
}
