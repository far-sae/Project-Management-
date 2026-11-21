import { supabase } from "@/services/supabase/config";
import type { TestDraft } from "@/lib/email/testDraft";

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Calls `POST /api/email/verify` to send a test message through
 * `accountId`'s SMTP credentials, then marks the account active or error
 * server-side. Shared by the Accounts tab's "Send test" button and the
 * Compose tab's "Send test to me" button — it is the same route either way.
 *
 * The route always sends to the caller's own address (read off their
 * Supabase JWT server-side) and ignores any recipient the client might send,
 * so there is no address parameter here. Only an organization owner or
 * admin passes the route's membership check; a member's call returns a 403
 * that surfaces as `{ ok: false, error }`.
 *
 * With a `draft` (the Compose tab) the test is the email being written;
 * without one it is a plain line that only proves the mailbox can send.
 */
export const verifyAccount = async (accountId: string, draft?: TestDraft | null): Promise<VerifyResult> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "Not authenticated" };

  try {
    const res = await fetch("/api/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(draft ? { accountId, draft } : { accountId }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `Verification failed: ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
};
