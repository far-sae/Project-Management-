import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, siteUrl } from "../../_lib/context";

/**
 * The service-role Supabase client for the documents server, made once per
 * warm function. Null when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not
 * set (the entry then answers 503). Never send this client to a browser.
 */
let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient | null {
  if (cached) return cached;
  try {
    cached = serviceClient();
  } catch {
    return null;
  }
  return cached;
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
