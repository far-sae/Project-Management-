import type { VercelRequest, VercelResponse } from "@vercel/node";
import { siteOrigin } from "./admin.js";

/**
 * Only our own pages may call the documents server. Browsers always send
 * Origin on a POST; a same-origin GET may carry only Referer, so Referer is
 * used when Origin is absent. This stops other sites from using the endpoints
 * from their own pages. It does not stop scripts (headers can be forged): the
 * sign-in, the guest sessions and the rate limits are what protect the data.
 *
 * Allowed hosts: the PUBLIC_SITE_URL host (and its www / bare twin, which is
 * the same site), localhost, and this deployment's own Vercel hosts.
 */

/**
 * A preview deployment may call its own endpoints, and nothing else may:
 * VERCEL_URL (this deployment) and VERCEL_BRANCH_URL (its branch alias) are
 * set by Vercel. No pattern such as "*-project.vercel.app": project names on
 * vercel.app are first come, first served, so anyone could register a
 * look-alike and use our endpoints from their page.
 */
function previewHosts(): string[] {
  return [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .map((v) => (v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, ""))
    .filter(Boolean);
}

/** The site's own host and its www / bare twin. Empty when PUBLIC_SITE_URL is not set. */
function siteHosts(): string[] {
  const origin = siteOrigin();
  if (!origin) return [];
  const host = new URL(origin).hostname.toLowerCase();
  if (host === "localhost") return [host];
  return [host, host.startsWith("www.") ? host.slice(4) : "www." + host];
}

function hostOf(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  try {
    return new URL(v).hostname.toLowerCase();
  } catch {
    return null; // "null" (sandboxed frames) and garbage
  }
}

export function allowedOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  const host = origin ? hostOf(origin) : hostOf(req.headers.referer);
  if (!host) return false;
  return host === "localhost" || siteHosts().includes(host) || previewHosts().includes(host);
}

/** Answers 403 { error: "forbidden" } to other sites. True when it has answered. */
export function refuseForeign(req: VercelRequest, res: VercelResponse): boolean {
  if (allowedOrigin(req)) return false;
  res.status(403).json({ error: "forbidden" });
  return true;
}
