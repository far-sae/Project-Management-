// Shared plumbing for the email API routes. Files under api/_lib are not
// routes (Vercel ignores the underscore prefix).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Service-role client. Never expose this key or its client to a browser. */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function siteUrl(): string {
  return env('PUBLIC_SITE_URL').replace(/\/+$/, '');
}
