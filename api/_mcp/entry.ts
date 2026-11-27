import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminClient, siteOrigin } from "../_signroom/host/admin.js";
import { bodyBytes } from "../_signroom/host/bodySize.js";
import { allowedOrigin, isOwnOrigin } from "../_signroom/host/origin.js";
import { handle as realHandle, type HttpReply, type HttpRequest, type McpDeps } from "./http.js";
import { supabaseStore } from "./store.js";
import { testSender } from "./testSend.js";

/**
 * The connector's door. Vercel's plan has no room for one more function, so
 * it lives inside the email function (api/email/warmup.ts hands over every
 * request that carries ?mcp=...; vercel.json sends /api/mcp and the two
 * /.well-known addresses there).
 *
 * Claude reaches it from its own servers: no Origin, no sign-in of ours. So
 * nothing here trusts where a request came from; the connector itself asks
 * for Claude's token (http.ts), and the two addresses for our own pages ask
 * for our own Origin and the signed-in account.
 */

export const MAX_BODY_BYTES = 400_000;
export const UNAVAILABLE = { error: "temporarily_unavailable", error_description: "TaskCalendar is temporarily unavailable. Try again in a minute." };

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

/** JSON, or the fields of a form (the token address is sent as a form). */
function bodyOf(raw: unknown): unknown {
  if (typeof raw !== "string") return Buffer.isBuffer(raw) ? {} : raw ?? {};
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

/**
 * This site's address as the caller reached it. Claude must be told the same
 * host it was given (with or without "www"), so the host of the request is
 * used when it is one of ours; anything else gets the site's own address.
 */
export function siteOf(req: VercelRequest): string | null {
  for (const host of [first(req.headers["x-forwarded-host"]), first(req.headers.host)]) {
    const candidate = `https://${host.trim().toLowerCase()}`;
    if (host && isOwnOrigin(candidate)) return candidate;
  }
  return siteOrigin();
}

/** The signed-in account behind our own Bearer token (a confirmed email only), or null. Never answers by itself. */
async function signedIn(req: VercelRequest): Promise<{ id: string } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(first(req.headers.authorization));
  const sb = adminClient();
  if (!m || !sb) return null;
  try {
    const { data, error } = await sb.auth.getUser(m[1]);
    return !error && data?.user?.email_confirmed_at ? { id: data.user.id } : null;
  } catch {
    return null;
  }
}

export type EntryDeps = {
  /** The connector's deps for one request, or null when the database is not configured. */
  build: () => McpDeps | null;
  handle: (d: McpDeps, r: HttpRequest) => Promise<HttpReply>;
  site: (req: VercelRequest) => string | null;
  signedIn: (req: VercelRequest) => Promise<{ id: string } | null>;
};

export function mcpHandler(d: EntryDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (bodyBytes(req) > MAX_BODY_BYTES) {
      res.status(413).json({ error: "too_large" });
      return;
    }
    let out: HttpReply;
    try {
      const deps = d.build();
      const site = d.site(req);
      if (!deps || !site) {
        res.setHeader("Cache-Control", "no-store");
        res.status(503).json(UNAVAILABLE);
        return;
      }
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query ?? {})) if (k !== "mcp") query[k] = first(v);
      let body: unknown;
      try {
        // Reading the body is where a request with broken JSON fails: that is the caller's mistake, not a fault of ours.
        body = bodyOf(req.body);
      } catch {
        res.setHeader("Cache-Control", "no-store");
        res.status(400).json({ error: "invalid_request", error_description: "The body could not be read." });
        return;
      }
      out = await d.handle(deps, {
        method: String(req.method),
        route: first((req.query ?? {}).mcp).replace(/^\/+|\/+$/g, ""),
        authorization: first(req.headers.authorization),
        origin: first(req.headers.origin),
        query,
        body,
        site,
        ownPage: allowedOrigin(req),
        signedIn: () => d.signedIn(req),
      });
    } catch (e) {
      console.error("[mcp] failed", e instanceof Error ? e.name : "unknown");
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json(UNAVAILABLE);
      return;
    }
    for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
    if (out.json === undefined) res.status(out.status).end();
    else res.status(out.status).json(out.json);
  };
}

function buildDeps(): McpDeps | null {
  const sb = adminClient();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!sb || !serviceKey) return null;
  const store = supabaseStore(sb);
  const serverKey = (process.env.INTEGRATION_TOKEN_KEY ?? "").trim();
  return {
    auth: store,
    email: store,
    // Client ids are signed with a value made from the server's own database key: nothing new to set up, and nobody else can make one.
    secret: createHash("sha256").update(`mcp-client-signing|${serviceKey}`, "utf8").digest("hex"),
    sendTest: serverKey ? testSender(sb, serverKey) : undefined,
    onFault: (e) => console.error("[mcp] tool failed", e instanceof Error ? e.name : "unknown"),
  };
}

export default mcpHandler({ build: buildDeps, handle: realHandle, site: siteOf, signedIn });
