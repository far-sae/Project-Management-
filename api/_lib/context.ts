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

/** Constant-time string compare for shared secrets. */
export function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function siteUrl(): string {
  return env('PUBLIC_SITE_URL').replace(/\/+$/, '');
}
