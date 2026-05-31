// supabase/functions/_shared/notifyOrgAdmins.ts
//
// Edge-function helper for fanning out an email notification to every
// owner + admin (+ optionally every member) of an organisation.
//
// Why this helper exists: a bunch of "something important happened"
// surfaces (new lead form submission, deal closed-won, lead converted,
// member-invited acceptance) need to email the people who can act on
// them — but the existing notify-send-gmail function sends FROM a
// rep's connected Gmail. Org events don't have a natural sender, so
// we'd want to send from any one of the org's admins. This helper
// picks the org owner as the "from" identity, then loops the
// owner+admin set as recipients.
//
// Failure mode: per-recipient sends are independent. If one rep
// hasn't connected Gmail, the others still get the email. Errors are
// logged but never re-raised — notifications must not block the
// originating action (form submission, lead convert, etc.).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaGmail } from "./gmailSend.ts";

export interface OrgMember {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: "owner" | "admin" | "member" | "viewer";
}

export interface NotifyOrgArgs {
  admin: SupabaseClient;
  organizationId: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  /** Whether plain 'member' role users also get the email. Default
   *  false — most org-level notifications are admin/owner concerns. */
  includeMembers?: boolean;
  /** Optional log prefix used in console.warn lines. */
  source?: string;
}

const buildShellHtml = (subject: string, body: string): string => `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
    <h2 style="margin:0 0 12px;font-size:18px;color:#111">${subject}</h2>
    <div style="font-size:14px;line-height:1.5;color:#374151">${body}</div>
    <p style="margin:24px 0 0;font-size:11px;color:#9ca3af">
      You're getting this because you're an admin of this TaskCalendar workspace.
    </p>
  </div>
</body></html>`;

/**
 * Fan-out send. Returns the count of recipients we successfully
 * dispatched to. Recipients that don't have Gmail connected, or
 * whose send threw for any other reason, are skipped (logged, not
 * raised).
 */
export const notifyOrgAdmins = async (args: NotifyOrgArgs): Promise<number> => {
  const { admin, organizationId, subject, bodyHtml, bodyText, includeMembers, source } = args;
  const tag = source ? `[${source}] ` : "";

  // Pull the org row — owner_id + the cached members array (jsonb).
  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select("owner_id, members")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (orgErr || !orgRow) {
    console.warn(`${tag}notifyOrgAdmins: org lookup failed —`, orgErr ?? "not found");
    return 0;
  }
  const ownerId = (orgRow as { owner_id?: string | null }).owner_id ?? null;
  const members = ((orgRow as { members?: unknown }).members ?? []) as Array<{
    userId?: string; user_id?: string;
    email?: string | null;
    displayName?: string | null; display_name?: string | null;
    role?: string;
    status?: string;
  }>;

  const wantRoles = new Set<string>(includeMembers
    ? ["owner", "admin", "member"]
    : ["owner", "admin"]);

  // Build the recipient set. Skip duplicates by userId, and skip
  // anyone with no email on file (Gmail can't send to nobody).
  const seen = new Set<string>();
  const recipients: OrgMember[] = [];
  for (const m of members) {
    const userId = (m.userId ?? m.user_id ?? "") as string;
    const role = String(m.role ?? "member").toLowerCase();
    if (!userId || !wantRoles.has(role) || seen.has(userId)) continue;
    if (m.status && m.status !== "active") continue;
    if (!m.email) continue;
    seen.add(userId);
    recipients.push({
      userId,
      email: m.email,
      displayName: (m.displayName ?? m.display_name ?? null) as string | null,
      role: role as OrgMember["role"],
    });
  }

  if (recipients.length === 0) {
    console.log(`${tag}notifyOrgAdmins: no recipients found for org ${organizationId}`);
    return 0;
  }

  // Pick a sender. We prefer the owner since their Gmail (if
  // connected) is the most natural "from" for an org-level notice. If
  // the owner hasn't connected Gmail, sendViaGmail throws for that
  // recipient and we move on — each recipient gets their own
  // attempt with the owner as the sender, so the worst case is
  // "nobody gets emailed because nobody's Gmail is connected".
  const senderId = ownerId ?? recipients[0]?.userId;
  if (!senderId) return 0;

  const html = bodyHtml.startsWith("<!doctype") ? bodyHtml : buildShellHtml(subject, bodyHtml);
  const text = bodyText ?? bodyHtml.replace(/<[^>]+>/g, "").slice(0, 2000);

  let sent = 0;
  for (const r of recipients) {
    if (!r.email) continue;
    try {
      await sendViaGmail({
        admin,
        senderUserId: senderId,
        to: r.email,
        subject,
        bodyText: text,
        bodyHtml: html,
      });
      sent += 1;
    } catch (err) {
      // Most common: senderId hasn't connected Gmail. Logged once
      // per recipient so we can see the pattern, but never re-raised.
      console.warn(`${tag}notifyOrgAdmins: send to ${r.email} failed —`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
};
