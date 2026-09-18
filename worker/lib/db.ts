// Configuration and the Supabase client the worker claims and settles with.
//
// The worker has no user session, so it cannot satisfy the row level security
// policies that gate normal access: it connects with the service role key,
// which bypasses them. That key must never reach the browser — it has no
// VITE_ prefix for exactly that reason.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Everything that has to be present before the worker is allowed to claim a
 * single row. A worker that claims a batch and only then discovers
 * INTEGRATION_TOKEN_KEY is missing has already taken those rows out of the
 * queue, where they sit in 'sending' until the recovery sweep finds them.
 */
export const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'INTEGRATION_TOKEN_KEY',
  'EMAIL_UNSUBSCRIBE_SECRET',
  'PUBLIC_SITE_URL',
] as const;

/**
 * Reads a required variable, or throws naming it. The name, never the value:
 * this message ends up in logs, and two of these variables are keys.
 */
export function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is not set. The worker needs: ${REQUIRED_ENV.join(', ')}.`);
  }
  return value.trim();
}

/**
 * The service-role client. Sessions are off in both directions: there is no
 * browser to persist one to, and a background refresh timer would keep the
 * process alive after a shutdown signal.
 */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
