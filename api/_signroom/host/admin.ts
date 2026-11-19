import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { siteUrl } from "../../_lib/context";

/**
 * Where the database is. SUPABASE_URL, or the address the browser side
 * already has (VITE_SUPABASE_URL): it is the same project and not a secret.
 */
const databaseUrl = (): string => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const databaseKey = (): string => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

/**
 * What the owner still has to set before the documents server can run, as one
 * plain sentence, or null when nothing is missing. It names settings, never
 * their values, so it is safe to show on the page.
 */
export function setupProblem(): string | null {
  if (!databaseKey()) return "Documents are not set up yet: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel's environment variables.";
  if (!databaseUrl()) return "Documents are not set up yet: SUPABASE_URL is missing in Vercel's environment variables.";
  return null;
}

/**
 * The service-role Supabase client for the documents server, made once per
 * warm function. Null while the database address or key is not set (the entry
 * then answers 503 with setupProblem). Never send this client to a browser.
 */
let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient | null {
  if (cached) return cached;
  if (setupProblem()) return null;
  try {
    cached = createClient(databaseUrl(), databaseKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  } catch {
    return null;
  }
  return cached;
}

/** Test hook: forget the cached client so a test can change the environment. */
export function __resetAdminClientForTests(): void {
  cached = null;
}

const webOrigin = (value: string): string | null => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
};

/**
 * The site's own address without a trailing slash: PUBLIC_SITE_URL when it is
 * set, otherwise the project's production domain that Vercel provides by
 * itself (VERCEL_PROJECT_PRODUCTION_URL, a bare host). Null when neither gives
 * a web address. The fallback matters: without it, a deployment whose
 * PUBLIC_SITE_URL was never set refuses every call from its own pages.
 */
export function siteOrigin(): string | null {
  let configured: string | null = null;
  try {
    configured = siteUrl();
  } catch {
    configured = null;
  }
  if (configured) return webOrigin(configured);
  const production = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return production ? webOrigin(`https://${production}`) : null;
}
