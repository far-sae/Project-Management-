import type { SupabaseClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminClient } from "./admin.js";

/**
 * The signed-in check for the documents server:
 *   401 { error: SIGN_IN_MESSAGE } with no valid token,
 *   403 { error: VERIFY_EMAIL_MESSAGE } for an unconfirmed email,
 *   503 { error: AUTH_UNAVAILABLE_MESSAGE } when Auth can't answer.
 * Returns null when it has answered, else the account's id and email.
 */

export const SIGN_IN_MESSAGE = "Please sign in to use this tool.";
export const VERIFY_EMAIL_MESSAGE = "Please verify your email first.";
export const AUTH_UNAVAILABLE_MESSAGE = "Sign-in is temporarily unavailable. Please try again in a minute.";

export type AuthDeps = { adminClient: () => Pick<SupabaseClient, "auth"> | null };

const realAuthDeps: AuthDeps = { adminClient };

function bearerToken(req: VercelRequest): string | null {
  const h = req.headers.authorization;
  const m = /^Bearer\s+(\S+)$/i.exec((Array.isArray(h) ? h[0] : h) ?? "");
  return m ? m[1] : null;
}

/** Signed-in accounts with a confirmed email only: the Supabase access token, checked by Auth itself. */
export async function refuseSignedOut(
  req: VercelRequest,
  res: VercelResponse,
  deps: AuthDeps = realAuthDeps,
): Promise<{ userId: string; email: string } | null> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: SIGN_IN_MESSAGE });
    return null;
  }
  const sb = deps.adminClient();
  if (!sb) {
    res.status(503).json({ error: AUTH_UNAVAILABLE_MESSAGE });
    return null;
  }
  let reply: { data: { user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null }; error: { status?: number } | null };
  try {
    reply = await sb.auth.getUser(token);
  } catch {
    res.status(503).json({ error: AUTH_UNAVAILABLE_MESSAGE });
    return null;
  }
  if (reply.error) {
    const s = reply.error.status ?? 0;
    // 4xx: a bad, expired or foreign token (the public key included). Anything else, 429 (Auth
    // throttling us) included, is Auth failing: a 401 there would send a signed-in user round the login loop.
    if (s >= 400 && s < 500 && s !== 429) res.status(401).json({ error: SIGN_IN_MESSAGE });
    else res.status(503).json({ error: AUTH_UNAVAILABLE_MESSAGE });
    return null;
  }
  const user = reply.data?.user;
  if (!user) {
    res.status(401).json({ error: SIGN_IN_MESSAGE });
    return null;
  }
  if (!user.email_confirmed_at) {
    res.status(403).json({ error: VERIFY_EMAIL_MESSAGE });
    return null;
  }
  return { userId: user.id, email: user.email ?? "" };
}
