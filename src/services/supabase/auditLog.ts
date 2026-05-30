import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type AuditAction =
  | "role_changed"
  | "member_invited"
  | "member_removed"
  | "mfa_enabled"
  | "mfa_disabled"
  | "login"
  | "logout"
  | "integration_connected"
  | "integration_disconnected"
  | "bulk_delete"
  | "bulk_edit"
  | "client_imported"
  | "data_exported"
  | "settings_changed";

export interface AuditEvent {
  eventId: string;
  organizationId: string;
  actorUserId: string | null;
  actorName: string | null;
  action: AuditAction | string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  occurredAt: Date;
}

export interface RecordEventInput {
  action: AuditAction | string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
}

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");

const mapEvent = (r: Record<string, unknown>): AuditEvent => ({
  eventId: r.event_id as string,
  organizationId: r.organization_id as string,
  actorUserId: (r.actor_user_id as string) ?? null,
  actorName: (r.actor_name as string) ?? null,
  action: r.action as string,
  targetType: (r.target_type as string) ?? null,
  targetId: (r.target_id as string) ?? null,
  targetLabel: (r.target_label as string) ?? null,
  metadata: (r.metadata as Record<string, unknown>) ?? {},
  ip: (r.ip as string) ?? null,
  userAgent: (r.user_agent as string) ?? null,
  occurredAt: new Date(r.occurred_at as string),
});

/**
 * Best-effort audit write. Never throws — losing an audit row is annoying
 * but should not break the user-facing action that triggered it.
 */
export const recordAuditEvent = async (
  organizationId: string | null,
  actor: { userId: string | null; displayName: string | null } | null,
  input: RecordEventInput,
): Promise<void> => {
  if (!organizationId || isLocalOrg(organizationId)) return;
  try {
    const { error } = await supabase.from("security_audit_log").insert({
      organization_id: organizationId,
      actor_user_id: actor?.userId ?? null,
      actor_name: actor?.displayName ?? null,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      metadata: input.metadata ?? {},
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    if (error) logger.warn("audit write failed:", error);
  } catch (err) {
    logger.warn("audit write threw:", err);
  }
};

/**
 * Specific error class so the AuditLogSettingsTab can distinguish "table
 * missing" / "RLS denied" / "local org" / "real failure" and show the
 * right hint to the operator instead of swallowing to an empty list.
 */
export class AuditLogError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "local_org"
      | "table_missing"
      | "permission_denied"
      | "network"
      | "unknown",
  ) {
    super(message);
    this.name = "AuditLogError";
  }
}

export const listAuditEvents = async (
  organizationId: string,
  opts: {
    actionFilter?: string | null;
    limit?: number;
  } = {},
): Promise<AuditEvent[]> => {
  if (isLocalOrg(organizationId)) {
    throw new AuditLogError(
      "Audit log isn't recorded in local-only mode. Connect Supabase to start capturing events.",
      "local_org",
    );
  }
  let q = supabase
    .from("security_audit_log")
    .select("*")
    .eq("organization_id", organizationId)
    .order("occurred_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.actionFilter) q = q.eq("action", opts.actionFilter);
  const { data, error } = await q;
  if (error) {
    const e = error as { code?: string; message?: string; details?: string; hint?: string };
    const code = String(e.code ?? "");
    const msg = String(e.message ?? "");
    const composed = [e.message, e.details, e.hint && `(hint: ${e.hint})`, code && `[${code}]`]
      .filter(Boolean)
      .join(" — ");
    logger.error(`failed to load audit events: ${composed || "no reason"}`, error);

    // 42P01 = undefined_table → migration 095 not applied.
    if (code === "42P01" || /relation .* does not exist/i.test(msg)) {
      throw new AuditLogError(
        "The security_audit_log table doesn't exist. Apply migration 095 (`supabase db push`) to create it.",
        "table_missing",
      );
    }
    // 42501 = permission denied (likely RLS — only owners/admins can read).
    if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
      throw new AuditLogError(
        "Only owners and admins can view the audit log. Ask an owner to change your role if you need access.",
        "permission_denied",
      );
    }
    throw new AuditLogError(composed || "Couldn't load audit events.", "unknown");
  }
  return (data ?? []).map(mapEvent);
};
