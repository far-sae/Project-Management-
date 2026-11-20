import type { VercelRequest, VercelResponse } from "@vercel/node";
import { decryptSecret, encryptSecret } from "../_lib/crypto";
import { adminClient } from "../_signroom/host/admin.js";
import { refuseSignedOut } from "../_signroom/host/auth.js";
import { refuseOversize } from "../_signroom/host/bodySize.js";
import { refuseForeign } from "../_signroom/host/origin.js";
import { mailReach } from "../_warmup/mailreach.js";
import { route as realRoute, type RouteRequest, type RouteResult, type WarmupDeps } from "../_warmup/router.js";
import { supabaseStore } from "../_warmup/store.js";

/**
 * Mailbox warm-up (MailReach): /api/email/warmup?do=<status|key|connect|pause>.
 * Our own pages only, a small body, the signed-in account, then the router
 * (rules: _warmup/router.ts). The warm-up service's key and the mailbox
 * passwords are read and used here only; neither is ever sent to a browser.
 */
export const config = { maxDuration: 60 };

export const MAX_BODY_BYTES = 10_000;
export const BODY_TOO_LARGE_MESSAGE = "That request is too large.";
export const FAILED_MESSAGE = "Something went wrong. Please try again.";
export const UNAVAILABLE_MESSAGE = "Warm-up is temporarily unavailable. Please try again in a minute.";

export type WarmupHandlerDeps = {
  signedIn: (req: VercelRequest, res: VercelResponse) => Promise<{ id: string } | null>;
  route: (deps: WarmupDeps, r: RouteRequest) => Promise<RouteResult>;
  /** The route deps for one request, or null when the database is not configured. */
  build: () => WarmupDeps | null;
};

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

function bodyOf(raw: unknown): Record<string, unknown> {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v || "{}");
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v) ? (v as Record<string, unknown>) : {};
}

export function warmupHandler(d: WarmupHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (refuseForeign(req, res)) return;
    if (refuseOversize(req, res, MAX_BODY_BYTES, BODY_TOO_LARGE_MESSAGE)) return;
    const who = await d.signedIn(req, res);
    if (!who) return;

    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query ?? {})) if (k !== "do") query[k] = first(v);

    let out: RouteResult;
    try {
      const deps = d.build();
      if (!deps) {
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
      }
      out = await d.route(deps, { method: String(req.method), action: first((req.query ?? {}).do), query, body: bodyOf(req.body), user: { id: who.id } });
    } catch (e) {
      console.error("[warmup] failed", e instanceof Error ? e.name : "unknown");
      res.status(500).json({ error: FAILED_MESSAGE });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.status(out.status).json(out.json ?? {});
  };
}

async function realSignedIn(req: VercelRequest, res: VercelResponse): Promise<{ id: string } | null> {
  const who = await refuseSignedOut(req, res);
  return who ? { id: who.userId } : null;
}

function buildDeps(): WarmupDeps | null {
  const sb = adminClient();
  if (!sb) return null;
  // The same server key the mailbox passwords are stored under.
  const serverKey = (process.env.INTEGRATION_TOKEN_KEY ?? "").trim();
  return {
    store: supabaseStore(sb),
    service: (apiKey) => mailReach(apiKey, fetch),
    crypto: serverKey ? { encrypt: (plain) => encryptSecret(plain, serverKey), decrypt: (packed) => decryptSecret(packed, serverKey) } : null,
  };
}

export default warmupHandler({ signedIn: realSignedIn, route: realRoute, build: buildDeps });
