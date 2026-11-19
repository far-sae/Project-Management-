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

/** PUBLIC_SITE_URL without a trailing slash, or null when it is not set or not a web address. */
export function siteOrigin(): string | null {
  try {
    const u = new URL(siteUrl());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}
