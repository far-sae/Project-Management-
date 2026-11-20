import { createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminClient, siteOrigin } from "./_signroom/host/admin.js";
import { refuseSignedOut } from "./_signroom/host/auth.js";
import { runInBackground } from "./_signroom/host/background.js";
import { refuseOversize } from "./_signroom/host/bodySize.js";
import { refuseForeign } from "./_signroom/host/origin.js";
import { UNAVAILABLE_MESSAGE } from "./_signroom/host/rateLimit.js";
import { readEvidenceKey } from "./_signroom/evidence.js";
import { readJobKey } from "./_signroom/jobs.js";
import { mailFrom, type MailDeps } from "./_signroom/mail.js";
import { readKey } from "./_signroom/mailbox/crypto.js";
import { systemLookup } from "./_signroom/mailbox/ssrf.js";
import { nodemailerTransport } from "./_signroom/mailbox/transport.js";
import { supabaseStore as documentsStore } from "./_signroom/store.js";
import { claudeClient } from "./_automation/ai.js";
import type { AutoDeps } from "./_automation/deps.js";
import { BODY_TOO_LARGE_MESSAGE, DATABASE_KEY_MESSAGE, DATABASE_URL_MESSAGE, FAILED_MESSAGE } from "./_automation/messages.js";
import { route as realRoute, type RouteRequest, type RouteResult } from "./_automation/router.js";
import { supabaseStore } from "./_automation/supabaseStore.js";

/**
 * CRM automation (the agents that carry a new lead to a running project): one
 * Vercel function reached as /api/automation/<path> (vercel.json rewrites it
 * to ?path=<path>).
 *
 * Order: our own pages only, a body of at most 500 KB (the longest assistant conversation with its draft fits), the signed-in account
 * with the workspace it is working in from X-Workspace-Id, then the router
 * (paths and rules: _automation/router.ts). One exception: ops/run, Vercel's
 * cron call every 5 minutes, which sends no Origin and no sign-in and is
 * checked by its "Authorization: Bearer <CRON_SECRET>" header instead.
 */
export const config = { maxDuration: 300 };

export const MAX_BODY_BYTES = 500_000;
/** Longest X-Workspace-Id we read (a uuid is 36); anything longer is ignored. */
export const WORKSPACE_HEADER_MAX = 64;

export type AutomationDeps = {
  /** refuseSignedOut plus the account's email: null once it has answered (401, 403 or 503). */
  signedIn: (req: VercelRequest, res: VercelResponse) => Promise<{ id: string; email: string } | null>;
  route: (deps: AutoDeps, r: RouteRequest) => Promise<RouteResult>;
  /** The route deps for one request, or null when Supabase is not configured. */
  build?: (keepAlive?: (work: Promise<unknown>) => void) => AutoDeps | null;
  /** CRON_SECRET when omitted (tests pass their own). */
  cronSecret?: () => string | undefined;
  /** What the owner still has to set up, as a sentence for the page, or null. Nothing is checked when omitted. */
  setup?: () => string | null;
  /** Keeps the function alive until the promise settles (Vercel's waitUntil when omitted). */
  keepAlive?: (p: Promise<unknown>) => void;
};

/** What is missing before the automation server can run at all, as one plain sentence, or null. It names settings, never their values. */
export function setupProblem(): string | null {
  if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) return DATABASE_KEY_MESSAGE;
  if (!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim()) return DATABASE_URL_MESSAGE;
  return null;
}

/**
 * "Authorization: Bearer <secret>" against the cron secret, in constant time
 * over their sha256 (so any length compares, and nothing about the secret's
 * length or prefix leaks through timing).
 */
function cronSecretMatches(req: VercelRequest, secret: string): boolean {
  const h = req.headers.authorization;
  const m = /^Bearer (\S+)$/.exec((Array.isArray(h) ? h[0] : h) ?? "");
  if (!m) return false;
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(m[1]), digest(secret));
}

/**
 * ops/run, Vercel's cron call (a GET every 5 minutes; a POST is accepted too):
 * the cron secret instead of sign-in and the origin check. The run keeps the
 * function alive by itself and never depends on the caller still listening.
 */
async function cronRun(d: AutomationDeps, req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = d.cronSecret ? d.cronSecret() : process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: UNAVAILABLE_MESSAGE });
    return;
  }
  if (!cronSecretMatches(req, secret)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  let out: RouteResult;
  try {
    const deps = d.build ? d.build(d.keepAlive) : null;
    if (d.build && !deps) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    const run = d.route(deps as AutoDeps, { method: "POST", path: ["ops", "run"], query: {}, body: {}, user: null, cron: true });
    if (d.keepAlive) d.keepAlive(run);
    else runInBackground(() => run);
    out = await run;
  } catch (e) {
    console.error("[automation] failed", e instanceof Error ? e.name : "unknown");
    res.status(500).json({ error: FAILED_MESSAGE });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.status(out.status).json(out.json ?? {});
}

/** ?path=runs/abc/stop (or the array form) as segments. */
export function splitPath(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : [raw ?? ""];
  return parts.flatMap((p) => String(p).split("/")).filter(Boolean);
}

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

/** The workspace the caller is working in: the first X-Workspace-Id value when it is non-empty and at most 64 characters, else none. */
function workspaceOf(req: VercelRequest): string | undefined {
  const h = req.headers["x-workspace-id"];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === "string" && v.length > 0 && v.length <= WORKSPACE_HEADER_MAX ? v : undefined;
}

/**
 * The real deps: the automation's own store, the documents server's mail deps
 * (so an agent's email goes out exactly as a document's does) and Claude.
 */
function buildDeps(keepAlive?: (work: Promise<unknown>) => void): AutoDeps | null {
  const sb = adminClient();
  if (!sb) return null;
  const mail: MailDeps = {
    store: documentsStore(sb),
    sb,
    fetch,
    resendKey: process.env.RESEND_API_KEY || undefined,
    from: mailFrom(process.env.SIGNROOM_MAIL_FROM, siteOrigin()) ?? undefined,
    // The workspace's own mailbox: without this key every email goes out through Resend.
    key: readKey(process.env.SIGNROOM_MAIL_KEY),
    transport: nodemailerTransport,
    lookup: systemLookup,
    jobKey: readJobKey(process.env.SIGNROOM_JOB_KEY),
    evidenceKey: readEvidenceKey(process.env),
  };
  return { store: supabaseStore(sb), mail, claude: claudeClient(process.env.ANTHROPIC_API_KEY || undefined), ...(keepAlive ? { keepAlive } : {}) };
}

/** refuseSignedOut already read the account with its token: its id and email go straight to the router. */
export async function realSignedIn(req: VercelRequest, res: VercelResponse): Promise<{ id: string; email: string } | null> {
  const who = await refuseSignedOut(req, res);
  return who ? { id: who.userId, email: who.email } : null;
}

export function automationHandler(d: AutomationDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    const q = req.query ?? {};
    const path = splitPath(q.path);
    // Vercel's cron sends no Origin: the scheduled run is checked by its secret instead.
    if ((req.method === "GET" || req.method === "POST") && path.length === 2 && path[0] === "ops" && path[1] === "run") return cronRun(d, req, res);
    if (refuseForeign(req, res)) return;
    // Not set up yet: say exactly what is missing, rather than "busy" or a sign-in error.
    const problem = d.setup ? d.setup() : null;
    if (problem) {
      res.status(503).json({ error: problem });
      return;
    }
    if (refuseOversize(req, res, MAX_BODY_BYTES, BODY_TOO_LARGE_MESSAGE)) return;

    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) if (k !== "path") query[k] = String(Array.isArray(v) ? v[0] : v);

    const who = await d.signedIn(req, res);
    if (!who) return;
    const workspaceId = workspaceOf(req);
    const user = workspaceId === undefined ? { id: who.id, email: who.email } : { id: who.id, email: who.email, workspaceId };

    let out: RouteResult;
    try {
      const deps = d.build ? d.build(d.keepAlive) : null;
      if (d.build && !deps) {
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
      }
      out = await d.route(deps as AutoDeps, { method: String(req.method), path, query, body: bodyOf(req.body), user });
    } catch (e) {
      console.error("[automation] failed", e instanceof Error ? e.name : "unknown");
      res.status(500).json({ error: FAILED_MESSAGE });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.status(out.status).json(out.json ?? {});
  };
}

export default automationHandler({ signedIn: realSignedIn, route: realRoute, build: buildDeps, setup: setupProblem });
