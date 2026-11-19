import { createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminClient, siteOrigin } from "./_signroom/host/admin.js";
import { refuseSignedOut } from "./_signroom/host/auth.js";
import { runInBackground } from "./_signroom/host/background.js";
import { refuseOversize } from "./_signroom/host/bodySize.js";
import { refuseForeign } from "./_signroom/host/origin.js";
import { UNAVAILABLE_MESSAGE } from "./_signroom/host/rateLimit.js";
import { FAILED_MESSAGE, route as realRoute, type RouteDeps, type RouteRequest, type RouteResult } from "./_signroom/router.js";
import { TEMPLATE_MAX_BYTES, TEMPLATE_SIZE_MESSAGE } from "./_signroom/templates.js";
import { readEvidenceKey } from "./_signroom/evidence.js";
import { readJobKey } from "./_signroom/jobs.js";
import { mailFrom, type MailDeps } from "./_signroom/mail.js";
import { supabaseStore } from "./_signroom/store.js";

/**
 * Signroom (agreements with e-signature, and invoices): one Vercel function
 * reached as /api/signroom/<path> (vercel.json rewrites it to ?path=<path>).
 * Order: our own pages only, a body of at most 1 MB (the logo fits), the
 * signed-in account (billing-guest and guest paths are for invited visitors and
 * need none; they use the sr_billing and sr_sign cookies) with the workspace it
 * is working in from X-Signroom-Workspace (never read on guest or cron paths),
 * then the router. Paths and rules: _signroom/router.ts. The one exception is
 * ops/run, Vercel's cron call every 5 minutes, which is checked by its
 * "Authorization: Bearer <CRON_SECRET>" header instead (cronRun).
 */
export const config = { maxDuration: 300 };

export const MAX_BODY_BYTES = 1_000_000;
export const BODY_TOO_LARGE_MESSAGE = "That request is too large.";
export const GUEST_COOKIE = "sr_billing";
/** An agreement guest's session: never the billing cookie, and never accepted for billing. */
export const SIGN_COOKIE = "sr_sign";
const GUEST_MAX_AGE = 1800;

export type SignroomDeps = {
  /** refuseSignedOut plus the account's email: null once it has answered (401, 403 or 503). */
  signedIn: (req: VercelRequest, res: VercelResponse) => Promise<{ id: string; email: string } | null>;
  route: (deps: RouteDeps, r: RouteRequest) => Promise<RouteResult>;
  /** The route deps for one request, or null when Supabase is not configured. */
  build?: () => RouteDeps | null;
  /** CRON_SECRET when omitted (tests pass their own). */
  cronSecret?: () => string | undefined;
  /** Keeps the function alive until the promise settles (Vercel's waitUntil when omitted). */
  keepAlive?: (p: Promise<unknown>) => void;
};

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
 * the cron secret instead of sign-in and the origin check, since the cron sends
 * no Origin. The run keeps the function alive by itself (waitUntil) and never
 * depends on the caller still listening; the answer goes to whoever is.
 */
async function cronRun(d: SignroomDeps, req: VercelRequest, res: VercelResponse): Promise<void> {
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
    const deps = d.build ? d.build() : null;
    if (d.build && !deps) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    // The run builds no link from this origin: background links use each agreement's own.
    const run = d.route(deps as RouteDeps, { method: "POST", path: ["ops", "run"], query: {}, body: {}, user: null, cron: true, origin: siteOrigin() ?? "" });
    if (d.keepAlive) d.keepAlive(run);
    else runInBackground(() => run);
    out = await run;
  } catch (e) {
    console.error("[signroom] failed", e instanceof Error ? e.name : "unknown");
    res.status(500).json({ error: FAILED_MESSAGE });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.status(out.status).json(out.json ?? {});
}

/** ?path=billing/abc/artifact (or the array form) as segments. */
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

function cookieOf(req: VercelRequest, name: string): string | undefined {
  const h = req.headers.cookie;
  for (const part of String(Array.isArray(h) ? h.join(";") : (h ?? "")).split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || undefined;
  }
  return undefined;
}

/** The X-File-Name header, decoded; letterhead.pdf when it is missing or not valid encoding. */
function fileNameOf(req: VercelRequest): string {
  const h = req.headers["x-file-name"];
  const v = Array.isArray(h) ? h[0] : h;
  try {
    return (v && decodeURIComponent(v)) || "letterhead.pdf";
  } catch {
    return "letterhead.pdf";
  }
}

/** Longest X-Signroom-Workspace we read (a uuid is 36); anything longer is ignored. */
export const WORKSPACE_HEADER_MAX = 64;

/**
 * The workspace the caller is working in: the first X-Signroom-Workspace value
 * when it is non-empty and at most 64 characters, else none. It is required:
 * currentWorkspace refuses a request without one, and checks it against the
 * caller's organisation membership on every request.
 */
function workspaceOf(req: VercelRequest): string | undefined {
  const h = req.headers["x-signroom-workspace"];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === "string" && v.length > 0 && v.length <= WORKSPACE_HEADER_MAX ? v : undefined;
}

/** The page's own origin: Origin, else the Referer's (already checked by refuseForeign), else the site's own. */
function originOf(req: VercelRequest): string {
  for (const v of [req.headers.origin, req.headers.referer]) {
    try {
      const s = Array.isArray(v) ? v[0] : v;
      if (s) return new URL(s).origin;
    } catch {
      /* try the next */
    }
  }
  return siteOrigin() ?? "";
}

function buildDeps(): RouteDeps | null {
  const sb = adminClient();
  if (!sb) return null;
  const mail: MailDeps = {
    store: supabaseStore(sb),
    sb,
    fetch,
    resendKey: process.env.RESEND_API_KEY || undefined,
    from: mailFrom(process.env.SIGNROOM_MAIL_FROM, siteOrigin()) ?? undefined,
    scan: { fetch, apiKey: process.env.CLOUDMERSIVE_API_KEY || undefined },
    jobKey: readJobKey(process.env.SIGNROOM_JOB_KEY),
    evidenceKey: readEvidenceKey(process.env),
  };
  return { mail };
}

/** refuseSignedOut already read the account with its token: its id and email go straight to the router. */
export async function realSignedIn(req: VercelRequest, res: VercelResponse): Promise<{ id: string; email: string } | null> {
  const who = await refuseSignedOut(req, res);
  return who ? { id: who.userId, email: who.email } : null;
}

export function signroomHandler(d: SignroomDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    const q = req.query ?? {};
    const path = splitPath(q.path);
    // Vercel's cron sends no Origin: the scheduled run is checked by its secret instead.
    if ((req.method === "GET" || req.method === "POST") && path.length === 2 && path[0] === "ops" && path[1] === "run") return cronRun(d, req, res);
    if (refuseForeign(req, res)) return;
    const isUpload = req.method === "POST" && path.length === 2 && path[0] === "workspaces" && path[1] === "branding-template";
    if (isUpload) {
      if (refuseOversize(req, res, TEMPLATE_MAX_BYTES, TEMPLATE_SIZE_MESSAGE)) return;
    } else if (refuseOversize(req, res, MAX_BODY_BYTES, BODY_TOO_LARGE_MESSAGE)) return;

    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) if (k !== "path") query[k] = String(Array.isArray(v) ? v[0] : v);

    // The letterhead upload is raw bytes (octet-stream); the file name travels in X-File-Name.
    let raw: { bytes: Uint8Array; name: string } | undefined;
    const guest = path[0] === "billing-guest" || path[0] === "guest";
    let user: RouteRequest["user"] = null;
    if (!guest) {
      const who = await d.signedIn(req, res);
      if (!who) return;
      const workspaceId = workspaceOf(req);
      user = workspaceId === undefined ? { id: who.id, email: who.email } : { id: who.id, email: who.email, workspaceId };
    }

    if (isUpload) {
      if (!Buffer.isBuffer(req.body) || req.body.length > TEMPLATE_MAX_BYTES) {
        res.status(400).json({ error: TEMPLATE_SIZE_MESSAGE });
        return;
      }
      raw = { bytes: new Uint8Array(req.body), name: fileNameOf(req) };
    }

    let out: RouteResult;
    try {
      const deps = d.build ? d.build() : null;
      if (d.build && !deps) {
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
      }
      out = await d.route(deps as RouteDeps, {
        method: String(req.method),
        path,
        query,
        body: isUpload ? {} : bodyOf(req.body),
        ...(raw ? { raw } : {}),
        user,
        guestSession: path[0] === "billing-guest" ? cookieOf(req, GUEST_COOKIE) : undefined,
        signSession: path[0] === "guest" ? cookieOf(req, SIGN_COOKIE) : undefined,
        origin: originOf(req),
      });
    } catch (e) {
      console.error("[signroom] failed", e instanceof Error ? e.name : "unknown");
      res.status(500).json({ error: FAILED_MESSAGE });
      return;
    }

    if (out.setGuestSession) {
      res.setHeader(
        "Set-Cookie",
        `${GUEST_COOKIE}=${out.setGuestSession.raw}; HttpOnly; Secure; SameSite=Strict; Path=/api/signroom; Max-Age=${GUEST_MAX_AGE}`,
      );
    }
    if (out.setSignSession) {
      res.setHeader(
        "Set-Cookie",
        `${SIGN_COOKIE}=${out.setSignSession.raw}; HttpOnly; Secure; SameSite=Strict; Path=/api/signroom; Max-Age=${GUEST_MAX_AGE}`,
      );
    }
    res.setHeader("Cache-Control", "private, no-store");
    if (out.pdf) {
      const name = out.pdf.filename.replace(/[^\w.\- ]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${out.pdf.inline ? "inline" : "attachment"}; filename="${name}"`);
      res.status(out.status).send(Buffer.from(out.pdf.bytes));
      return;
    }
    res.status(out.status).json(out.json ?? {});
  };
}

export default signroomHandler({ signedIn: realSignedIn, route: realRoute, build: buildDeps });
